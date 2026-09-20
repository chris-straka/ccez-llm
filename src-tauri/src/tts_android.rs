//! Android TextToSpeech bridge (JNI into `studio.ccez.app.Tts`).
//!
//! Mirrors the macOS contract in `tts.rs` (`tts_supported`, `tts_speak`,
//! `tts_stop`, `tts_voices`, `tts_identify_lang`) so the frontend needs no
//! platform branch: the same invokes and the same `tts-done` window events
//! drive it. The Kotlin object owns the engine on the UI thread; Rust only
//! passes strings and the utterance id across, and completion returns
//! through [`Java_studio_ccez_app_Tts_nativeOnTtsDone`].
//!
//! JNI bootstrap copies wry's own Android pattern (same jni 0.21 types):
//! no `ndk-context` (nothing initializes it in this stack), no
//! `FindClass` from worker threads (invisible to app classes). Instead,
//! `Tts.init` calls [`Java_studio_ccez_app_Tts_nativeInit`], which captures
//! the `JavaVM` and the Tts class (via the activity loader) into globals
//! for the commands to use.
//!
//! Compiled only on Android. Every other platform keeps the tts.rs stubs.

use std::sync::{
    OnceLock,
    atomic::{AtomicU64, Ordering},
};

use jni::{
    JNIEnv,
    objects::{GlobalRef, JClass, JObject, JString, JValue},
    sys::jlong,
};
use tauri::{AppHandle, Emitter};

use super::tts::imp::NativeVoice;

static APP: OnceLock<AppHandle> = OnceLock::new();
static VM: OnceLock<jni::JavaVM> = OnceLock::new();
static TTS_CLASS: OnceLock<GlobalRef> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn remember(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// Payload for `tts-done`. `finished=false` means the utterance was
/// stopped midway (Skip) rather than spoken to the end — same shape as
/// the macOS bridge, so the frontend matches by id either way.
#[derive(Clone, serde::Serialize)]
struct DoneEvent {
    id: u64,
    finished: bool,
}

fn with_env<T>(ctx: &str, f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, String>) -> Result<T, String> {
    let vm = VM
        .get()
        .ok_or_else(|| format!("{ctx}: voice bridge not initialized"))?;
    let cls = TTS_CLASS
        .get()
        .ok_or_else(|| format!("{ctx}: voice bridge not initialized"))?;
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

/// Called once from `Tts.init` (UI thread): capture the VM and the Tts
/// class for the commands. Failures leave the globals empty and every
/// command reports "not initialized" instead of crashing.
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_Tts_nativeInit(
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
        let name = env.new_string("studio.ccez.app.Tts")?;
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
        let _ = TTS_CLASS.set(global);
    }
}

pub fn supported() -> bool {
    with_env("supported", |env, cls| {
        let out = env
            .call_static_method(cls, "supported", "()Z", &[])
            .map_err(|e| format!("supported() failed: {e:?}"))?;
        out.z().map_err(|e| format!("bad supported() return: {e:?}"))
    })
    .unwrap_or(false)
}

pub fn speak(
    app: &AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<u64, String> {
    remember(app);
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    with_env("speak", |env, cls| {
        let text = jstr(env, &text)?;
        let lang = jstr(env, &lang)?;
        let voice = match voice {
            Some(name) => jstr(env, &name)?,
            None => JObject::null(),
        };
        env.call_static_method(
            cls,
            "speak",
            "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;J)V",
            &[
                JValue::from(&text),
                JValue::from(&lang),
                JValue::from(&voice),
                JValue::from(id as jlong),
            ],
        )
        .map_err(|e| format!("speak() failed: {e:?}"))?;
        Ok(id)
    })
}

pub fn stop(app: &AppHandle) -> Result<(), String> {
    remember(app);
    with_env("stop", |env, cls| {
        env.call_static_method(cls, "stop", "()V", &[])
            .map_err(|e| format!("stop() failed: {e:?}"))?;
        Ok(())
    })
}

/// Open the system text-to-speech settings (engine + voice data) via
/// `Tts.openTtsSettings`, which returns "" on success or an error
/// message. Code-only: unverified on device.
pub fn open_tts_settings() -> Result<(), String> {
    with_env("open_tts_settings", |env, cls| {
        let out = env
            .call_static_method(cls, "openTtsSettings", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("openTtsSettings() failed: {e:?}"))?;
        let err: String = env
            .get_string(&JString::from(out.l().map_err(|e| {
                format!("bad openTtsSettings() return: {e:?}")
            })?))
            .map_err(|e| format!("settings result failed: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        if err.is_empty() {
            Ok(())
        } else {
            Err(err)
        }
    })
}

pub fn voices(app: &AppHandle) -> Result<Vec<NativeVoice>, String> {
    remember(app);
    with_env("voices", |env, cls| {
        let out = env
            .call_static_method(cls, "voices", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("voices() failed: {e:?}"))?;
        let text: String = env
            .get_string(&JString::from(out.l().map_err(|e| {
                format!("bad voices() return: {e:?}")
            })?))
            .map_err(|e| format!("voice text failed: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        // Rows are `name|bcp47|quality` (see Tts.voices).
        let mut voices = Vec::new();
        for row in text.lines() {
            let mut parts = row.splitn(3, '|');
            let name = parts.next().unwrap_or("").to_owned();
            let lang = parts.next().unwrap_or("und").to_owned();
            let quality = parts.next().and_then(|q| q.parse().ok()).unwrap_or(0);
            if name.is_empty() {
                continue;
            }
            voices.push(NativeVoice {
                id: name.clone(),
                name,
                lang,
                quality,
            });
        }
        Ok(voices)
    })
}

/// Render `text` to a wav file in the app cache via
/// `synthesizeToFile` (same locale/voice tuning as live speech).
/// Returns the saved path. Code-only: unverified on device.
pub fn save_to_file(
    app: &AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<String, String> {
    remember(app);
    if text.trim().is_empty() {
        return Err("nothing to save".into());
    }
    with_env("save_to_file", |env, cls| {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let text = jstr(env, &text)?;
        let lang = jstr(env, &lang)?;
        let voice = match voice {
            Some(name) => jstr(env, &name)?,
            None => JObject::null(),
        };
        let out = env
            .call_static_method(
                cls,
                "saveToFile",
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;J)Ljava/lang/String;",
                &[
                    JValue::from(&text),
                    JValue::from(&lang),
                    JValue::from(&voice),
                    JValue::from(id as jlong),
                ],
            )
            .map_err(|e| format!("saveToFile() failed: {e:?}"))?;
        let path: String = env
            .get_string(&JString::from(out.l().map_err(|e| {
                format!("bad saveToFile() return: {e:?}")
            })?))
            .map_err(|e| format!("speech path failed: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        if path.is_empty() {
            return Err("speech file was not written".into());
        }
        Ok(path)
    })
}

/// Completion callback from `Tts` (UI thread): forward as `tts-done`.
/// A null error means the utterance played to its natural end.
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_Tts_nativeOnTtsDone(
    _env: JNIEnv,
    _class: JClass,
    id: jlong,
    error: JObject,
) {
    // `error` arrives null on success. A "canceled" stop still counts as
    // unfinished, same as real errors — the frontend only needs finished.
    if id < 0 {
        return;
    }
    if let Some(app) = APP.get() {
        let _ = app.emit(
            "tts-done",
            DoneEvent {
                id: id as u64,
                finished: error.as_raw().is_null(),
            },
        );
    }
}
