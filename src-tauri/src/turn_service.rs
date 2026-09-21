//! Android foreground-service claim for native turns.
//!
//! The turn runner already survives WebView suspension on process life
//! alone; the service extends that life. While at least one native turn
//! is live, the app runs a `dataSync` foreground service with the
//! quietest notice Android allows (MIN importance: no icon, no buzz,
//! shade-only), so a backgrounded app is far less likely to be killed
//! before the reply lands. When the last turn settles, the claim
//! releases and the service stops.
//! Best-effort throughout: every failure logs through the returned
//! error (which callers ignore) and never fails a turn.
//!
//! JNI bootstrap copies the Tts bridge pattern (same jni 0.21 types):
//! `TurnSvc.init` calls `nativeInit`, which captures the `JavaVM` and
//! the TurnSvc class (via the activity loader) into globals. The live
//! count lives here behind a mutex; the Kotlin object owns the service
//! lifecycle on the main thread.
//!
//! Compiled only on Android. Every other platform keeps the no-op
//! claim/settle pair in `turn.rs`.

use std::sync::{Mutex, OnceLock};

use jni::{
    JNIEnv,
    objects::{GlobalRef, JClass, JObject},
};

static VM: OnceLock<jni::JavaVM> = OnceLock::new();
static SVC_CLASS: OnceLock<GlobalRef> = OnceLock::new();
static LIVE: OnceLock<Mutex<u32>> = OnceLock::new();

fn live_count() -> &'static Mutex<u32> {
    LIVE.get_or_init(|| Mutex::new(0))
}

fn with_env<T>(ctx: &str, f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, String>) -> Result<T, String> {
    let vm = VM
        .get()
        .ok_or_else(|| format!("{ctx}: turn service not initialized"))?;
    let cls = SVC_CLASS
        .get()
        .ok_or_else(|| format!("{ctx}: turn service not initialized"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("{ctx}: attach failed: {e:?}"))?;
    f(&mut env, cls)
}

/// Called once from `TurnSvc.init` (UI thread): capture the VM and the
/// TurnSvc class for the claim calls. Failures leave the globals empty
/// and claims report "not initialized" instead of crashing.
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_TurnSvc_nativeInit(
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
        use jni::objects::JValue;
        let loader = env
            .call_method(
                &activity,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            )?
            .l()?;
        let name = env.new_string("studio.ccez.app.TurnSvc")?;
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
        let _ = SVC_CLASS.set(global);
    }
}

/// First live turn starts the service; later ones only bump the count.
pub fn service_claim() {
    let start = match live_count().lock() {
        Ok(mut count) => {
            *count += 1;
            *count == 1
        }
        Err(_) => false,
    };
    if !start {
        return;
    }
    if let Err(error) = with_env("service_claim", |env, cls| {
        env.call_static_method(cls, "keeperStart", "()V", &[])
            .map_err(|e| format!("keeperStart() failed: {e:?}"))?;
        Ok(())
    }) {
        // The turn still runs without the claim; log-shaped error that
        // the caller (turn.rs) deliberately ignores.
        let _ = error;
    }
}

/// Last settled turn stops the service. Stale stops (more settles than
/// claims) clamp at zero instead of underflowing the count.
pub fn service_settle() {
    let stop = match live_count().lock() {
        Ok(mut count) => {
            if *count > 0 {
                *count -= 1;
            }
            *count == 0
        }
        Err(_) => false,
    };
    if !stop {
        return;
    }
    if let Err(error) = with_env("service_settle", |env, cls| {
        env.call_static_method(cls, "keeperStop", "()V", &[])
            .map_err(|e| format!("keeperStop() failed: {e:?}"))?;
        Ok(())
    }) {
        let _ = error;
    }
}
