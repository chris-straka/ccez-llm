//! On-device chat via the ML Kit GenAI Prompt API (AICore / Gemini
//! Nano), Android only.
//!
//! Two Tauri commands form the whole contract with the frontend seam
//! (`src/lib/ondevice/bridge.ts`): `ondevice_status` reports readiness
//! as a `{state, downloadedBytes?, reason?}` payload (extra native
//! fields pass through; the seam validates), and `ondevice_generate`
//! resolves one completion as text. Native availability maps onto the
//! four existing bridge states — no new states: AICore AVAILABLE ->
//! ready, DOWNLOADING -> downloading, DOWNLOADABLE ->
//! unavailable/no-model, UNAVAILABLE -> unavailable/unsupported.
//!
//! The Kotlin side (`OnDevice.kt`) returns JSON strings for both calls
//! (same trick as `Tts.voices`), so no JNI exception plumbing crosses
//! the boundary: generate failures arrive as `{"reason": "<code>"}` and
//! surface here as `Err(code)`, which the frontend maps to its
//! single-sentence toast copy. Reason codes stay inside the set the
//! bridge already knows: no-model, downloading, unsupported, busy,
//! too-long, failed. Keyless throughout — Gemini Nano needs no API key,
//! so settings are untouched.
//!
//! Compiled everywhere; off Android both commands answer without
//! touching JNI (status reads unavailable, generate rejects
//! unsupported), so browser-preview and desktop shells degrade cleanly.

use std::sync::atomic::{AtomicBool, Ordering};

/// In-flight generation guard: Gemini Nano serves one request at a
/// time here, so a second concurrent generate rejects `busy` instead
/// of queueing behind the first.
static GENERATING: AtomicBool = AtomicBool::new(false);

const DEFAULT_MAX_TOKENS: u32 = 512;
const MAX_MAX_TOKENS: u32 = 4096;

/// Clamp the frontend cap into the bridge range (mirrors
/// `clampMaxTokens` in the seam; the native side never trusts it).
fn clamp_max_tokens(raw: Option<u32>) -> u32 {
    match raw {
        None | Some(0) => DEFAULT_MAX_TOKENS,
        Some(n) => n.min(MAX_MAX_TOKENS),
    }
}

/// Read the `reason` out of a Kotlin `{"reason": "<code>"}` payload.
/// Unknown shapes read as `failed` — never a crash, never empty.
#[cfg(target_os = "android")]
fn reason_of(payload: &str) -> String {
    serde_json::from_str::<serde_json::Value>(payload)
        .ok()
        .and_then(|v| v.get("reason")?.as_str().map(str::to_owned))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "failed".into())
}

/// Open AI Core's Play Store page (hidden system component, reached
/// by package id since store search won't find it). Android-only;
/// elsewhere this rejects as unsupported and the UI hides the entry.
#[tauri::command]
pub fn ondevice_open_aicore_page(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return ondevice_android::open_aicore_page(&app);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

/// Bridge + model readiness. Off Android this is `unavailable`
/// without touching JNI; native rejections also read `unavailable`
/// (the bridge isn't there), never throw.
#[tauri::command]
pub fn ondevice_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    return ondevice_android::status(&app)
        .map_err(|e| {
            // A dead bridge reads as unavailable (same contract as the
            // frontend seam outside the shell), never as an error.
            let _ = e;
            "no-bridge".to_string()
        })
        .and_then(|payload| {
            serde_json::from_str::<serde_json::Value>(&payload).map_err(|_| "bad-status".to_string())
        });
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(serde_json::json!({"state": "unavailable", "reason": "unsupported"}))
    }
}

/// One-shot on-device completion. Resolves the text; rejects with a
/// bridge reason code (`no-model`, `downloading`, `unsupported`,
/// `busy`, `too-long`, `failed`) that the frontend maps to its short
/// toast copy. Never reroutes to another provider — that choice lives
/// in the (forbidden here) send path, not in this command.
///
/// Note the camelCase `maxTokens`: Tauri matches invoke arg keys to
/// parameter names, and the seam sends `{prompt, maxTokens}`.
#[tauri::command]
#[allow(non_snake_case)]
pub fn ondevice_generate(
    app: tauri::AppHandle,
    prompt: String,
    maxTokens: Option<u32>,
) -> Result<String, String> {
    if prompt.trim().is_empty() {
        return Err("failed".into());
    }
    // One request at a time; the second caller retries in a moment.
    if GENERATING.swap(true, Ordering::SeqCst) {
        return Err("busy".into());
    }
    let out = ondevice_generate_inner(&app, &prompt, clamp_max_tokens(maxTokens));
    GENERATING.store(false, Ordering::SeqCst);
    out
}

#[cfg(target_os = "android")]
fn ondevice_generate_inner(
    app: &tauri::AppHandle,
    prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let payload = ondevice_android::generate(app, prompt, max_tokens)?;
    let value: serde_json::Value =
        serde_json::from_str(&payload).map_err(|_| "failed".to_string())?;
    if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
        if !text.is_empty() {
            return Ok(text.to_owned());
        }
        return Err("failed".into());
    }
    Err(reason_of(&payload))
}

#[cfg(not(target_os = "android"))]
fn ondevice_generate_inner(
    app: &tauri::AppHandle,
    _prompt: &str,
    _max_tokens: u32,
) -> Result<String, String> {
    let _ = app;
    Err("unsupported".into())
}

/// Android JNI bridge into `studio.ccez.app.OnDevice` (same bootstrap
/// as `tts_android.rs`: no `ndk-context`, no `FindClass` from worker
/// threads — `OnDevice.init` captures the `JavaVM` and class via the
/// activity loader into globals for the commands to use).
///
/// Compiled only on Android.
#[cfg(target_os = "android")]
mod ondevice_android {
    use jni::{
        JNIEnv,
        objects::{GlobalRef, JClass, JObject, JString, JValue},
        sys::jint,
    };
    use std::sync::OnceLock;

    static VM: OnceLock<jni::JavaVM> = OnceLock::new();
    static CLASS: OnceLock<GlobalRef> = OnceLock::new();

    fn with_env<T>(
        ctx: &str,
        f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, String>,
    ) -> Result<T, String> {
        let vm = VM
            .get()
            .ok_or_else(|| format!("{ctx}: on-device bridge not initialized"))?;
        let cls = CLASS
            .get()
            .ok_or_else(|| format!("{ctx}: on-device bridge not initialized"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("{ctx}: attach failed: {e:?}"))?;
        f(&mut env, cls)
    }

    fn jstr<'a>(env: &mut JNIEnv<'a>, value: &str) -> Result<JObject<'a>, String> {
        let s: JString = env
            .new_string(value)
            .map_err(|e| format!("string alloc failed: {e:?}"))?;
        Ok(JObject::from(s))
    }

    fn jstring_result(env: &mut JNIEnv, out: JObject, ctx: &str) -> Result<String, String> {
        if out.as_raw().is_null() {
            return Err(format!("{ctx} returned null"));
        }
        let text: String = env
            .get_string(&JString::from(out))
            .map_err(|e| format!("{ctx} text failed: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        Ok(text)
    }

    /// Called once from `OnDevice.init` (UI thread): capture the VM and
    /// the OnDevice class for the commands. Failures leave the globals
    /// empty and every command reports "not initialized" instead of
    /// crashing.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_OnDevice_nativeInit(
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
            let name = env.new_string("studio.ccez.app.OnDevice")?;
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
            let _ = CLASS.set(global);
        }
    }

    /// Raw Kotlin status JSON (`{"state": ...}`); the command validates
    /// it before returning.
    pub fn status(_app: &tauri::AppHandle) -> Result<String, String> {
        with_env("status", |env, cls| {
            let out = env
                .call_static_method(cls, "status", "()Ljava/lang/String;", &[])
                .map_err(|e| format!("status() failed: {e:?}"))?;
            let obj: JObject = out
                .l()
                .map_err(|e| format!("bad status() return: {e:?}"))?;
            jstring_result(env, obj, "status")
        })
    }

    /// Raw Kotlin generate JSON (`{"text": ...}` or `{"reason": ...}`).
    pub fn generate(
        _app: &tauri::AppHandle,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        with_env("generate", |env, cls| {
            let prompt = jstr(env, prompt)?;
            let out = env
                .call_static_method(
                    cls,
                    "generate",
                    "(Ljava/lang/String;I)Ljava/lang/String;",
                    &[JValue::from(&prompt), JValue::from(max_tokens as jint)],
                )
                .map_err(|e| format!("generate() failed: {e:?}"))?;
            let obj: JObject = out
                .l()
                .map_err(|e| format!("bad generate() return: {e:?}"))?;
            jstring_result(env, obj, "generate")
        })
    }

    /// Open AI Core's Play Store page. Kotlin returns "" on success or
    /// a short message; a non-empty message rejects so the UI can say
    /// the store didn't open.
    pub fn open_aicore_page(_app: &tauri::AppHandle) -> Result<(), String> {
        with_env("open_aicore_page", |env, cls| {
            let out = env
                .call_static_method(cls, "openAicorePage", "()Ljava/lang/String;", &[])
                .map_err(|e| format!("openAicorePage() failed: {e:?}"))?;
            let obj: JObject = out
                .l()
                .map_err(|e| format!("bad openAicorePage() return: {e:?}"))?;
            let message = jstring_result(env, obj, "openAicorePage")?;
            if message.is_empty() {
                Ok(())
            } else {
                Err(message)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_max_tokens_holds_the_bridge_range() {
        assert_eq!(clamp_max_tokens(None), DEFAULT_MAX_TOKENS);
        assert_eq!(clamp_max_tokens(Some(0)), DEFAULT_MAX_TOKENS);
        assert_eq!(clamp_max_tokens(Some(64)), 64);
        assert_eq!(clamp_max_tokens(Some(100_000)), MAX_MAX_TOKENS);
    }
}
