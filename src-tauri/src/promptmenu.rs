//! Prompt-and-settings native text menu flag.
//!
//! The Activity swaps every floating text-selection menu for an empty
//! dummy (see `MainActivity.kt`: no OS text menu anywhere in the app,
//! the WebView owns Annotate / Copy / Speak). The exceptions are the
//! main prompt and the settings panel: a live selection inside either
//! gets the real OS menu (Copy / Cut / Paste / Select All), since
//! selectable labels are only honest with a menu behind them. Chat
//! text matches neither.
//!
//! Crossing the flag: the frontend reports selection transitions
//! through the `set_prompt_menu_allowed` command (cheap, transitions
//! only, long-press headroom beats the bridge by two orders of
//! magnitude); the Activity reads it synchronously at menu time
//! through `nativePromptMenuAllowed`. The flag, the command, and
//! the reader compile on every platform; only the `#[no_mangle]`
//! entry point is Android-gated (the `jni` crate itself is an
//! Android-only dependency, so JNI paths stay fully qualified inside
//! that fn — same shape as `annotate.rs`).

use std::sync::atomic::{AtomicBool, Ordering};

static PROMPT_MENU_ALLOWED: AtomicBool = AtomicBool::new(false);

/// Frontend transition report: true while a live (non-collapsed)
/// selection sits inside the composer, false on collapse, focus
/// departure, or page hide. Stale-true only ever shows one native
/// menu in the wrong place; stale-false only ever shows the dummy.
#[tauri::command]
pub fn set_prompt_menu_allowed(allowed: bool) {
    PROMPT_MENU_ALLOWED.store(allowed, Ordering::SeqCst);
}

fn prompt_menu_allowed() -> bool {
    PROMPT_MENU_ALLOWED.load(Ordering::SeqCst)
}

/// Synchronous Activity read at floating-menu time. JNI name binds to
/// `MainActivity.nativePromptMenuAllowed` (same convention as the
/// `nativeOnExternalText` entry point).
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativePromptMenuAllowed(
    _env: jni::JNIEnv,
    _this: jni::objects::JObject,
) -> jni::sys::jboolean {
    prompt_menu_allowed() as jni::sys::jboolean
}

#[cfg(test)]
mod tests {
    use super::{prompt_menu_allowed, set_prompt_menu_allowed};

    #[test]
    fn flag_round_trips() {
        set_prompt_menu_allowed(true);
        assert!(prompt_menu_allowed());
        set_prompt_menu_allowed(false);
        assert!(!prompt_menu_allowed());
    }

    #[test]
    fn flag_starts_denied() {
        // A fresh process never shows the OS menu until the frontend
        // reports a composer selection; reset first so test order
        // cannot leak state in.
        set_prompt_menu_allowed(false);
        assert!(!prompt_menu_allowed());
    }
}
