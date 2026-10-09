//! Android Keystore backend for the `keychain_*` commands.
//!
//! The `keyring` crate has no Android backend (it falls back to an
//! in-memory mock), so API keys persist here instead: the Kotlin
//! `Secrets` object envelopes every value with an AES/GCM key from the
//! AndroidKeyStore and keeps the ciphertext in a private
//! SharedPreferences file. The frontend keeps calling the same
//! commands — only this module is Android-gated.
//!
//! JNI bootstrap mirrors `tts_android.rs` (same jni 0.21 types):
//! `Secrets.init` calls [`Java_studio_ccez_app_Secrets_nativeInit`],
//! which captures the `JavaVM` and the Secrets class into globals for
//! the commands. Compiled only on Android; every other platform keeps
//! the `keyring` paths in `lib.rs`.

use std::sync::OnceLock;

use jni::{
    objects::{GlobalRef, JClass, JObject, JValue},
    JNIEnv,
};

static VM: OnceLock<jni::JavaVM> = OnceLock::new();
static SECRETS_CLASS: OnceLock<GlobalRef> = OnceLock::new();

fn with_env<T>(
    ctx: &str,
    f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, String>,
) -> Result<T, String> {
    let vm = VM
        .get()
        .ok_or_else(|| format!("{ctx}: secrets bridge not initialized"))?;
    let cls = SECRETS_CLASS
        .get()
        .ok_or_else(|| format!("{ctx}: secrets bridge not initialized"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("{ctx}: attach failed: {e:?}"))?;
    f(&mut env, cls)
}

fn jstr<'a>(env: &mut JNIEnv<'a>, value: &str) -> Result<JObject<'a>, String> {
    let s: jni::objects::JString = env
        .new_string(value)
        .map_err(|e| format!("string alloc failed: {e:?}"))?;
    Ok(JObject::from(s))
}

/// Prefs key under which a secret is stored, mirroring the
/// `"$service/$account"` key the Kotlin side builds. Test-only: pins
/// the documented format so either side's change must update both.
#[cfg(test)]
pub fn prefs_key(service: &str, account: &str) -> String {
    format!("{service}/{account}")
}

/// Called once from `Secrets.init` (UI thread): capture the VM and the
/// Secrets class for the commands. Failures leave the globals empty
/// and every command reports "not initialized" instead of crashing.
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_Secrets_nativeInit(
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
        let name = env.new_string("studio.ccez.app.Secrets")?;
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
        let _ = SECRETS_CLASS.set(global);
    }
}

/// Read a secret; `None` when nothing is stored (or the store is
/// broken — a broken store reads as "no key", never as a crash).
pub fn get(service: &str, account: &str) -> Result<Option<String>, String> {
    with_env("get", |env, cls| {
        let svc = jstr(env, service)?;
        let acct = jstr(env, account)?;
        let out = env
            .call_static_method(
                cls,
                "get",
                "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::from(&svc), JValue::from(&acct)],
            )
            .map_err(|e| format!("get() failed: {e:?}"))?
            .l()
            .map_err(|e| format!("bad get() return: {e:?}"))?;
        if out.as_raw().is_null() {
            return Ok(None);
        }
        let text: String = env
            .get_string(&jni::objects::JString::from(out))
            .map_err(|e| format!("bad get() string: {e:?}"))?
            .to_string_lossy()
            .into_owned();
        Ok(Some(text))
    })
}

/// Write (create or replace) a secret.
pub fn set(service: &str, account: &str, secret: &str) -> Result<(), String> {
    with_env("set", |env, cls| {
        let svc = jstr(env, service)?;
        let acct = jstr(env, account)?;
        let scr = jstr(env, secret)?;
        let ok = env
            .call_static_method(
                cls,
                "set",
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Z",
                &[JValue::from(&svc), JValue::from(&acct), JValue::from(&scr)],
            )
            .map_err(|e| format!("set() failed: {e:?}"))?
            .z()
            .map_err(|e| format!("bad set() return: {e:?}"))?;
        if ok {
            Ok(())
        } else {
            Err("set() failed: store unavailable".into())
        }
    })
}

/// Delete a secret; missing entries are not an error.
pub fn delete(service: &str, account: &str) -> Result<(), String> {
    with_env("delete", |env, cls| {
        let svc = jstr(env, service)?;
        let acct = jstr(env, account)?;
        env.call_static_method(
            cls,
            "delete",
            "(Ljava/lang/String;Ljava/lang/String;)Z",
            &[JValue::from(&svc), JValue::from(&acct)],
        )
        .map_err(|e| format!("delete() failed: {e:?}"))?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::prefs_key;

    #[test]
    fn prefs_key_joins_service_and_account() {
        assert_eq!(
            prefs_key("studio.ccez.app", "deepseek"),
            "studio.ccez.app/deepseek"
        );
    }

    #[test]
    fn bridge_fails_closed_without_init() {
        // Unit tests never run nativeInit (it needs a JVM), so the
        // globals are empty: every command must report "not
        // initialized" instead of panicking or faking success.
        assert!(super::get("s", "a").is_err());
        assert!(super::set("s", "a", "x").is_err());
        assert!(super::delete("s", "a").is_err());
    }
}
