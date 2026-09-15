//! Hover-reveal traffic lights (macOS).
//!
//! The shell uses an overlay titlebar, so the close/minimize/zoom
//! buttons paint over the content at all times. They fade out until
//! the pointer reaches them, then fade back in — macOS fullscreen
//! keeps its own hover chrome, so a fullscreen window forces them
//! visible instead of fighting it. The fade decision is pure and
//! unit-tested below; the AppKit wiring runs on macOS only.

/// Fade ramp, seconds.
const FADE_SECS: f64 = 0.18;
/// Hover margin around each button, points.
const HOVER_PAD: f64 = 10.0;

/// Which alpha the buttons want: hidden at rest, shown on hover,
/// always shown in fullscreen (the OS owns hover chrome there).
pub fn target_alpha(hovered: bool, fullscreen: bool) -> f64 {
    if hovered || fullscreen {
        1.0
    } else {
        0.0
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AllocAnyThread, ClassType, define_class, msg_send};
    use objc2_app_kit::{
        NSAnimationContext, NSButton, NSEvent, NSResponder, NSWindow, NSWindowButton,
        NSWindowStyleMask,
    };
    use objc2_app_kit::{NSTrackingArea, NSTrackingAreaOptions};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSObjectProtocol};

    use super::{FADE_SECS, HOVER_PAD, target_alpha};

    /// Live AppKit handles.
    #[derive(Clone, Copy)]
    struct Handles {
        window: *mut NSWindow,
        buttons: [*const NSButton; 3],
    }

    // SAFETY: only ever dereferenced on the main thread (tracking
    // callbacks and `run_on_main_thread` both run there), and the
    // window and its buttons outlive the app.
    unsafe impl Send for Handles {}
    unsafe impl Sync for Handles {}

    static STATE: OnceLock<Handles> = OnceLock::new();

    // SAFETY: stateless tracking owner — no ivars, no shared mutation.
    // Buttons and window ride the statics above.
    define_class!(
        #[unsafe(super(NSResponder))]
        #[name = "CcezTrafficLights"]
        struct TrafficDelegate;

        unsafe impl NSObjectProtocol for TrafficDelegate {}

        impl TrafficDelegate {
            #[unsafe(method(mouseEntered:))]
            unsafe fn mouse_entered(&self, _event: &NSEvent) {
                fade(target_alpha(true, is_fullscreen()));
            }

            #[unsafe(method(mouseExited:))]
            unsafe fn mouse_exited(&self, _event: &NSEvent) {
                fade(target_alpha(false, is_fullscreen()));
            }
        }
    );

    fn is_fullscreen() -> bool {
        let Some(state) = STATE.get() else {
            return false;
        };
        // SAFETY: main thread, window outlives the app.
        let window = unsafe { &*state.window };
        window
            .styleMask()
            .contains(NSWindowStyleMask::FullScreen)
    }

    fn fade(alpha: f64) {
        let Some(state) = STATE.get() else {
            return;
        };
        NSAnimationContext::beginGrouping();
        NSAnimationContext::currentContext().setDuration(FADE_SECS);
        for ptr in state.buttons {
            // SAFETY: main thread, buttons outlive the window.
            let button = unsafe { &*ptr };
            // The animator proxy carries the alpha change through the
            // grouping above; setting alpha directly would snap.
            let animator: Retained<NSButton> = unsafe { msg_send![button, animator] };
            animator.setAlphaValue(alpha);
        }
        NSAnimationContext::endGrouping();
    }

    fn apply(window: &tauri::WebviewWindow) {
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        // SAFETY: main thread (run_on_main_thread), window outlives setup.
        let ns_window: &NSWindow = unsafe { &*(ptr as *mut NSWindow) };
        let buttons = [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .map(|kind| ns_window.standardWindowButton(kind));
        let [Some(close), Some(minimize), Some(zoom)] = buttons else {
            return;
        };
        let retained = [close, minimize, zoom];
        let _ = STATE.set(Handles {
            window: ns_window as *const NSWindow as *mut NSWindow,
            buttons: [
                &*retained[0] as *const NSButton,
                &*retained[1] as *const NSButton,
                &*retained[2] as *const NSButton,
            ],
        });
        let delegate: Retained<TrafficDelegate> =
            unsafe { msg_send![TrafficDelegate::class(), new] };
        for button in &retained {
            let bounds = button.bounds();
            let rect = NSRect::new(
                NSPoint::new(bounds.origin.x - HOVER_PAD, bounds.origin.y - HOVER_PAD),
                NSSize::new(
                    bounds.size.width + 2.0 * HOVER_PAD,
                    bounds.size.height + 2.0 * HOVER_PAD,
                ),
            );
            // SAFETY: rect/owner/userInfo are all valid; areas die with
            // their buttons, the leaked delegate outlives them.
            let area = unsafe {
                NSTrackingArea::initWithRect_options_owner_userInfo(
                    NSTrackingArea::alloc(),
                    rect,
                    NSTrackingAreaOptions::MouseEnteredAndExited
                        | NSTrackingAreaOptions::ActiveAlways,
                    Some(&*delegate as &AnyObject),
                    None,
                )
            };
            button.addTrackingArea(&area);
        }
        // Leaked for the app's lifetime: tracking areas do not retain
        // their owner, and setup runs once.
        std::mem::forget(delegate);
        // Resting state: hidden unless already fullscreen.
        fade(target_alpha(false, is_fullscreen()));
    }

    /// Arm hover-reveal on the main window. Main thread only.
    pub fn watch(window: tauri::WebviewWindow) {
        let owned = window.clone();
        let _ = window.run_on_main_thread(move || apply(&owned));
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    /// Other platforms have no traffic lights to reveal.
    pub fn watch(_window: tauri::WebviewWindow) {}
}

pub use imp::watch;

#[cfg(test)]
mod tests {
    use super::target_alpha;

    #[test]
    fn resting_buttons_hide() {
        assert_eq!(target_alpha(false, false), 0.0);
    }

    #[test]
    fn hover_shows() {
        assert_eq!(target_alpha(true, false), 1.0);
    }

    #[test]
    fn fullscreen_always_shows() {
        assert_eq!(target_alpha(false, true), 1.0);
        assert_eq!(target_alpha(true, true), 1.0);
    }
}
