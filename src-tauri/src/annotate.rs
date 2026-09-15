//! External-text bridge for the native menu entries (Annotate, Speak,
//! Inspect).
//!
//! Android exposes the app in the OS text-selection menu
//! (`ACTION_PROCESS_TEXT` via the *Action manifest aliases — see
//! `MainActivity.kt`, which forwards alias launches into the
//! singleTask instance) and in the system Share sheet (`ACTION_SEND`
//! text/plain straight to MainActivity). Both arrive as native calls
//! into this module, which forwards them as the `annotate-external`
//! window event the frontend listens for. The web annotate row stays
//! untouched: native entries are an additional trigger, never a
//! replacement.
//!
//! Payload shape: `{ "text": string | null, "action": string | null }`.
//! `Some` text carries selections made OUTSIDE the app (composer
//! prefill); `None` means "run the action on the live web selection"
//! (the in-app menu item — the frontend owns the selection, so no
//! text crosses JNI). The action names the tapped alias entry
//! (annotate/speak/inspect); `None` behaves as annotate.
//!
//! The event, the payload, and `remember` compile on every platform; only
//! the `#[no_mangle]` entry points are Android-gated (the `jni` crate
//! itself is an Android-only dependency, so JNI paths stay fully
//! qualified inside those fns).

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Cold-start parking: a PROCESS_TEXT tap while the app is dead lands
/// in Activity.onCreate before setup captures the handle, so there is
/// nobody to emit to yet. The latest such share waits here until the
/// frontend drains it after registering its listener.
static PENDING: OnceLock<Mutex<Option<(String, Option<String>)>>> = OnceLock::new();

fn pending_slot() -> &'static Mutex<Option<(String, Option<String>)>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

fn lock_slot() -> std::sync::MutexGuard<'static, Option<(String, Option<String>)>> {
    pending_slot().lock().unwrap_or_else(|e| e.into_inner())
}

/// Capture the handle for later native-triggered emits. Called once
/// from `setup`, before any activity intent can reach the native fns.
pub fn remember(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// External selections are user text, not code: trim, drop empties, and
/// cap length so a foreign share can't flood the composer. Live only via
/// the Android JNI entry below (plus tests), so non-Android builds would
/// warn as dead code without the allow.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn clean_external(text: &str) -> Option<String> {
    const MAX_CHARS: usize = 4000;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_CHARS).collect())
}

#[derive(Clone, serde::Serialize)]
struct ExternalPayload {
    text: Option<String>,
    action: Option<String>,
}

/// Whitelist the tapped alias entry: anything else (including a
/// hand-built extra) falls back to annotate.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn clean_action(action: &str) -> Option<String> {
    match action.trim() {
        "annotate" | "speak" | "inspect" => Some(action.trim().to_string()),
        _ => None,
    }
}

/// Same Android-only liveness as `clean_external` (plus tests).
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn emit(text: Option<String>, action: Option<String>) {
    match APP.get() {
        Some(app) => {
            let _ = app.emit("annotate-external", ExternalPayload { text, action });
        }
        // No handle yet (cold start): park it for the drain below.
        None => {
            if let Some(text) = text {
                *lock_slot() = Some((text, action));
            }
        }
    }
}

/// Re-emit parked cold-start text, if any. Invoked once by the
/// frontend after its `annotate-external` listener is registered;
/// takes (clears) so a share is never delivered twice.
#[tauri::command]
pub fn drain_pending_external(app: AppHandle) {
    if let Some((text, action)) = lock_slot().take() {
        let _ = app.emit(
            "annotate-external",
            ExternalPayload {
                text: Some(text),
                action,
            },
        );
    }
}

/// Text shared from another app (PROCESS_TEXT or ACTION_SEND).
/// Null/empty shares emit nothing: there is no quote to prefill with.
/// The action names the tapped alias entry (or null); anything outside
/// the whitelist falls back to annotate.
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativeOnExternalText(
    mut env: jni::JNIEnv,
    _this: jni::objects::JObject,
    text: jni::objects::JObject,
    action: jni::objects::JObject,
) {
    let incoming: Option<String> = if text.as_raw().is_null() {
        None
    } else {
        env.get_string(&jni::objects::JString::from(text))
            .ok()
            .map(|s| s.to_string_lossy().into_owned())
            .and_then(|s| clean_external(&s))
    };
    let tapped: Option<String> = if action.as_raw().is_null() {
        None
    } else {
        env.get_string(&jni::objects::JString::from(action))
            .ok()
            .map(|s| s.to_string_lossy().into_owned())
            .and_then(|s| clean_action(&s))
    };
    if let Some(text) = incoming {
        emit(Some(text), tapped);
    } else if tapped.is_some() {
        // In-app tap with no text payload: still run the action on
        // the live web selection (the frontend owns it).
        emit(None, tapped);
    }
}

#[cfg(test)]
mod tests {
    use super::{clean_action, clean_external};

    #[test]
    fn trims_and_keeps_text() {
        assert_eq!(clean_external("  hello  "), Some("hello".into()));
    }

    #[test]
    fn drops_empties() {
        assert_eq!(clean_external(""), None);
        assert_eq!(clean_external("   \n  "), None);
    }

    #[test]
    fn caps_length() {
        let long = "x".repeat(5000);
        let out = clean_external(&long).expect("non-empty");
        assert_eq!(out.chars().count(), 4000);
    }

    #[test]
    fn keeps_multiline_send_shares_verbatim() {
        // ACTION_SEND bodies are multi-line (excerpt + URL): interior
        // newlines survive, only the edges trim.
        assert_eq!(
            clean_external("  Look at this\n\nhttps://example.com/menu  "),
            Some("Look at this\n\nhttps://example.com/menu".into())
        );
    }

    #[test]
    fn parks_text_before_remember() {
        // Unit tests never call remember (it needs a real handle),
        // so APP is unset and emit must park instead of dropping.
        // (Single slot-touching test: the static is process-global,
        // so parallel tests would race its takes.)
        super::lock_slot().take();
        super::emit(Some("  hello  ".into()), Some("speak".into()));
        assert_eq!(
            super::lock_slot().take(),
            Some(("  hello  ".into(), Some("speak".into())))
        );
        // Cold start with no text: there is no live web selection yet,
        // so there is nothing to park and nothing to emit.
        super::emit(None, Some("annotate".into()));
        assert_eq!(super::lock_slot().take(), None);
    }

    #[test]
    fn whitelists_tapped_actions() {
        assert_eq!(clean_action("annotate"), Some("annotate".into()));
        assert_eq!(clean_action("  speak  "), Some("speak".into()));
        assert_eq!(clean_action("inspect"), Some("inspect".into()));
        assert_eq!(clean_action("delete"), None);
        assert_eq!(clean_action(""), None);
    }
}
