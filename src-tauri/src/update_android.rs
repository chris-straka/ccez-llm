//! In-app update for Android (the Tauri updater plugin is
//! desktop-only): `update_download_apk` fetches the release APK into
//! the app cache with progress events, and `update_install_apk` fires
//! the system installer for it (JNI into `studio.ccez.app.Update`).
//! Only Android registers real bodies; every other target gets Err
//! stubs so the handler list stays uniform.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Progress event name the frontend listens for while downloading.
pub const DOWNLOAD_PROGRESS_EVENT: &str = "update-download-progress";

/// Expected release host suffixes. The frontend picks the asset URL
/// off the GitHub release, so only these two can ever arrive:
/// anything else is a bug or tampering, never a download.
fn asset_host_ok(url: &str) -> bool {
    let host = url
        .split("://")
        .nth(1)
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_lowercase();
    host == "github.com" || host.ends_with(".githubusercontent.com")
}

/// One progress tick: bytes so far, total when the server reports it.
#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

/// Fetch `url` (a GitHub release APK) into the app cache, emitting
/// [`DOWNLOAD_PROGRESS_EVENT`] per chunk. Resolves the absolute path
/// for `update_install_apk`. Machine codes: `bad-url`, `bad-status`,
/// `failed`, `timeout`.
#[tauri::command]
pub async fn update_download_apk(app: AppHandle, url: String) -> Result<String, String> {
    if !asset_host_ok(&url) {
        return Err("bad-url".into());
    }
    download_apk(&app, &url).await
}

/// Fire the system installer for a previously downloaded APK. Resolves
/// `"installing"`, or `"needs-approval"` when the user must first allow
/// installs from this app (the settings page opens alongside).
#[tauri::command]
pub fn update_install_apk(app: AppHandle, path: String) -> Result<String, String> {
    install_apk(&app, &path)
}

#[cfg(target_os = "android")]
async fn download_apk(app: &AppHandle, url: &str) -> Result<String, String> {
    use std::io::Write;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent("ccez-llm android updater")
        .build()
        .map_err(|_| "failed".to_string())?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| (if e.is_timeout() { "timeout" } else { "failed" }).to_string())?;
    if !res.status().is_success() {
        return Err("bad-status".into());
    }
    let total = res.content_length();
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "failed".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|_| "failed".to_string())?;
    let dest = dir.join("update.apk");
    // Chunk writes block briefly; the download is network-bound, so no
    // blocking pool for ~100 small writes.
    let mut file = std::fs::File::create(&dest).map_err(|_| "failed".to_string())?;
    let mut received = 0u64;
    loop {
        match res.chunk().await.map_err(|_| "failed".to_string())? {
            Some(bytes) => {
                file.write_all(&bytes).map_err(|_| "failed".to_string())?;
                received += bytes.len() as u64;
                let _ = app.emit(
                    DOWNLOAD_PROGRESS_EVENT,
                    DownloadProgress { received, total },
                );
            }
            None => break,
        }
    }
    // GitHub serves the real bytes: a stub page is never a valid APK.
    let len = file.metadata().map_err(|_| "failed".to_string())?.len();
    if len < 1024 {
        let _ = std::fs::remove_file(&dest);
        return Err("failed".into());
    }
    dest.to_str().map(str::to_owned).ok_or_else(|| "failed".into())
}

#[cfg(not(target_os = "android"))]
async fn download_apk(_app: &AppHandle, _url: &str) -> Result<String, String> {
    Err("in-app updates are Android-only".into())
}

/// Android JNI into `studio.ccez.app.Update` (same bootstrap as
/// `tts_android.rs`: `Update.init` captures the VM + class, commands
/// call static methods). Compiled only on Android.
#[cfg(target_os = "android")]
mod android {
    use std::sync::OnceLock;

    use jni::{
        JNIEnv,
        objects::{GlobalRef, JClass, JObject, JString, JValue},
    };
    use tauri::AppHandle;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static VM: OnceLock<jni::JavaVM> = OnceLock::new();
    static UPDATE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

    fn remember(app: &AppHandle) {
        let _ = APP.set(app.clone());
    }

    /// Called once from `Update.init` (UI thread): capture the VM and
    /// the Update class for the commands.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_Update_nativeInit(
        mut env: JNIEnv,
        _cls: JClass,
        activity: JObject,
    ) {
        let vm = match env.get_java_vm() {
            Ok(vm) => vm,
            Err(_) => return,
        };
        let _ = VM.set(vm);
        let class = (|| -> Result<GlobalRef, jni::errors::Error> {
            let loader = env
                .call_method(
                    &activity,
                    "getClassLoader",
                    "()Ljava/lang/ClassLoader;",
                    &[],
                )?
                .l()?;
            let name = env.new_string("studio.ccez.app.Update")?;
            let raw = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[JValue::from(&name)],
                )?
                .l()?;
            env.new_global_ref(JClass::from(raw))
        })();
        if let Ok(global) = class {
            let _ = UPDATE_CLASS.set(global);
        }
    }

    /// Returns `"installing"`, `"needs-approval"`, or an Err message.
    pub fn install_apk(app: &AppHandle, path: &str) -> Result<String, String> {
        remember(app);
        let vm = VM
            .get()
            .ok_or_else(|| "update bridge not initialized".to_string())?;
        let cls = UPDATE_CLASS
            .get()
            .ok_or_else(|| "update bridge not initialized".to_string())?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("attach failed: {e:?}"))?;
        let arg: JString = env
            .new_string(path)
            .map_err(|e| format!("string alloc failed: {e:?}"))?;
        let out = env
            .call_static_method(
                cls,
                "installApk",
                "(Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::from(&JObject::from(arg))],
            )
            .map_err(|e| format!("installApk() failed: {e:?}"))?;
        let text: String = env
            .get_string(&JString::from(out.l().map_err(|e| {
                format!("bad installApk() return: {e:?}")
            })?))
            .map_err(|e| format!("install result failed: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        match text.as_str() {
            "installing" | "needs-approval" => Ok(text),
            other if other.is_empty() => Err("installer did not start".into()),
            other => Err(other.to_owned()),
        }
    }
}

#[cfg(target_os = "android")]
fn install_apk(app: &AppHandle, path: &str) -> Result<String, String> {
    android::install_apk(app, path)
}

#[cfg(not(target_os = "android"))]
fn install_apk(_app: &AppHandle, _path: &str) -> Result<String, String> {
    Err("in-app updates are Android-only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guards_release_hosts_only() {
        assert!(asset_host_ok(
            "https://objects.githubusercontent.com/foo/bar.apk"
        ));
        assert!(asset_host_ok(
            "https://github.com/chris-straka/ccez-llm/releases/download/v1/x.apk"
        ));
        assert!(!asset_host_ok("https://example.com/x.apk"));
        assert!(!asset_host_ok("https://evilgithub.com/x.apk"));
        assert!(!asset_host_ok("not a url"));
    }
}
