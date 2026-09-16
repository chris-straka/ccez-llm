//! Hover-reveal traffic lights (macOS).
//!
//! The shell uses an overlay titlebar, so the close/minimize/zoom
//! buttons paint over the content at all times. They fade out until
//! the pointer reaches them, then fade back in — macOS fullscreen
//! keeps its own hover chrome, so a fullscreen window forces them
//! visible instead of fighting it.
//!
//! Hover is recomputed from live button geometry on every mouse move
//! (a local event monitor), plus a content-view tracking area that
//! refreshes when the pointer enters or leaves the window — an
//! absolute read every time, so a dropped event self-heals on the
//! next one. Tracking areas are deliberately NOT attached to the
//! buttons themselves: NSControl rebuilds its tracking on state
//! changes, which silently ate the exit events (buttons faded in,
//! then never back out). The fade decision and the padded hit test
//! are pure and unit-tested below; the AppKit wiring runs on macOS
//! only. Buttons are never repositioned or overlaid, so stock hover
//! glyphs and the arrow cursor keep working untouched.

/// Fade ramp, seconds.
const FADE_SECS: f64 = 0.18;
/// Hover margin around each button, points.
const HOVER_PAD: f64 = 10.0;
/// Exit margin, points — deliberately wider than the enter pad. A slow
/// pointer straddling one threshold flipped show/hide on every mouse
/// move, strobing the fade (reads as a dark flash on hover-out); the
/// pointer must clearly leave before hiding.
const HOVER_EXIT_PAD: f64 = 24.0;

/// Which alpha the buttons want: hidden at rest, shown on hover,
/// always shown in fullscreen (the OS owns hover chrome there).
pub fn target_alpha(hovered: bool, fullscreen: bool) -> f64 {
    if hovered || fullscreen {
        1.0
    } else {
        0.0
    }
}

/// Padded hit-test margin for the current state: the enter pad to
/// show, the wider exit pad to hide (hysteresis against boundary
/// jitter — see HOVER_EXIT_PAD).
pub fn hover_pad(shown: bool) -> f64 {
    if shown {
        HOVER_EXIT_PAD
    } else {
        HOVER_PAD
    }
}

/// Screen-space rect for the padded hit test below.
#[derive(Clone, Copy)]
pub struct ScreenRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl ScreenRect {
    /// True when the point lands inside the rect grown by `pad` on
    /// every side (the discovery margin around invisible buttons).
    pub fn contains(&self, px: f64, py: f64, pad: f64) -> bool {
        px >= self.x - pad
            && px <= self.x + self.w + pad
            && py >= self.y - pad
            && py <= self.y + self.h + pad
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ptr::NonNull;
    use std::sync::OnceLock;
    use std::sync::atomic::{AtomicBool, Ordering};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AllocAnyThread, ClassType, define_class, msg_send};
    use objc2_app_kit::{
        NSAnimationContext, NSButton, NSEvent, NSEventMask, NSResponder, NSWindow,
        NSWindowButton, NSWindowStyleMask, NSWorkspace,
    };
    use objc2_app_kit::{NSTrackingArea, NSTrackingAreaOptions};
    use objc2_foundation::{NSPoint, NSRect, NSObjectProtocol};

    use super::{FADE_SECS, ScreenRect, hover_pad, target_alpha};

    /// Live AppKit handle plus the last shown state (change-only
    /// fades: setting the animator target on every mouse move would
    /// restart the ramp under a resting pointer).
    struct Handles {
        window: *mut NSWindow,
        shown: AtomicBool,
    }

    // SAFETY: only ever dereferenced on the main thread (the event
    // monitor, tracking callbacks, and `run_on_main_thread` all run
    // there), and the window outlives the app.
    unsafe impl Send for Handles {}
    unsafe impl Sync for Handles {}

    static STATE: OnceLock<Handles> = OnceLock::new();

    // SAFETY: stateless tracking owner — no ivars, no shared mutation.
    // The window rides the static above; both callbacks just refresh.
    define_class!(
        #[unsafe(super(NSResponder))]
        #[name = "CcezTrafficLights"]
        struct TrafficDelegate;

        unsafe impl NSObjectProtocol for TrafficDelegate {}

        impl TrafficDelegate {
            #[unsafe(method(mouseEntered:))]
            unsafe fn mouse_entered(&self, _event: &NSEvent) {
                // Window (re-)entered, possibly straight onto the
                // lights with no move yet: read the absolute state.
                refresh();
            }

            #[unsafe(method(mouseExited:))]
            unsafe fn mouse_exited(&self, _event: &NSEvent) {
                // Pointer left the window: the monitor goes quiet, so
                // this refresh settles the buttons hidden.
                refresh();
            }
        }
    );

    fn is_fullscreen(window: &NSWindow) -> bool {
        window
            .styleMask()
            .contains(NSWindowStyleMask::FullScreen)
    }

    fn reduce_motion() -> bool {
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
    }

    /// Screen-space rect of one button, or None when it is missing.
    /// Frames are re-read on every call: wry re-insets the lights on
    /// layout, so nothing is cached.
    fn button_rect(window: &NSWindow, kind: NSWindowButton) -> Option<ScreenRect> {
        let button = window.standardWindowButton(kind)?;
        let in_window = button.convertRect_toView(button.bounds(), None);
        let on_screen = window.convertRectToScreen(in_window);
        Some(ScreenRect {
            x: on_screen.origin.x,
            y: on_screen.origin.y,
            w: on_screen.size.width,
            h: on_screen.size.height,
        })
    }

    fn hovered(window: &NSWindow, pad: f64) -> bool {
        let at: NSPoint = NSEvent::mouseLocation();
        [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ]
        .into_iter()
        .filter_map(|kind| button_rect(window, kind))
        .any(|rect| rect.contains(at.x, at.y, pad))
    }

    /// Absolute refresh: read hover + fullscreen + motion state and
    /// fade only when the shown state actually flips. The hit test
    /// rides the current state's own pad (wide to hide, tight to
    /// show) so boundary jitter can't strobe the fade.
    fn refresh() {
        let Some(state) = STATE.get() else {
            return;
        };
        // SAFETY: main thread, window outlives the app.
        let window = unsafe { &*state.window };
        let shown = state.shown.load(Ordering::SeqCst);
        let show = target_alpha(hovered(window, hover_pad(shown)), is_fullscreen(window)) > 0.5;
        if show != state.shown.swap(show, Ordering::SeqCst) {
            fade(if show { 1.0 } else { 0.0 });
        }
    }

    fn fade(alpha: f64) {
        let Some(state) = STATE.get() else {
            return;
        };
        NSAnimationContext::beginGrouping();
        if reduce_motion() {
            // Instant settle under Reduce Motion, like the web UI.
            NSAnimationContext::currentContext().setDuration(0.0);
        } else {
            NSAnimationContext::currentContext().setDuration(FADE_SECS);
        }
        // SAFETY: main thread, window outlives the app.
        let window = unsafe { &*state.window };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            let Some(button) = window.standardWindowButton(kind) else {
                continue;
            };
            // The animator proxy carries the alpha change through the
            // grouping above; setting alpha directly would snap.
            let animator: Retained<NSButton> = unsafe { msg_send![&*button, animator] };
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

        // Hover monitor: every mouse move recomputes from live button
        // geometry. The event MUST be returned or the pointer freezes.
        let watcher = RcBlock::new(|event: NonNull<NSEvent>| -> *mut NSEvent {
            refresh();
            event.as_ptr()
        });
        // SAFETY: block takes and returns a valid event pointer; the
        // leaked block and monitor token outlive the app.
        let token = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::MouseMoved,
                &watcher,
            )
        };
        std::mem::forget(watcher);
        // The token only names the monitor for removal; forgetting it
        // leaks the registration alive for the app's lifetime, which
        // is exactly the hover contract (never unhooked).
        std::mem::forget(token);
        let _ = STATE.set(Handles {
            window: ns_window as *const NSWindow as *mut NSWindow,
            shown: AtomicBool::new(false),
        });

        // Content-view tracking area: the monitor only fires on moves,
        // so window enter/exit refresh explicitly (teleport straight
        // onto the lights still reveals; leaving hides). The content
        // view is a plain NSView — no control tracking rebuilds here.
        let delegate: Retained<TrafficDelegate> =
            unsafe { msg_send![TrafficDelegate::class(), new] };
        if let Some(content) = ns_window.contentView() {
            let bounds = content.bounds();
            // SAFETY: rect/owner/userInfo are all valid; the area dies
            // with the view, the leaked delegate outlives it.
            let area = unsafe {
                NSTrackingArea::initWithRect_options_owner_userInfo(
                    NSTrackingArea::alloc(),
                    NSRect::new(bounds.origin, bounds.size),
                    NSTrackingAreaOptions::MouseEnteredAndExited
                        | NSTrackingAreaOptions::ActiveAlways
                        | NSTrackingAreaOptions::InVisibleRect,
                    Some(&*delegate as &AnyObject),
                    None,
                )
            };
            content.addTrackingArea(&area);
        }
        // Leaked for the app's lifetime: tracking areas do not retain
        // their owner, and setup runs once.
        std::mem::forget(delegate);
        // Resting state from the absolute read, not an assumption.
        refresh();
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
    use super::{ScreenRect, hover_pad, target_alpha};

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

    #[test]
    fn exit_pad_exceeds_enter_pad() {
        // Hysteresis: hiding needs a clearly-departed pointer, so a
        // resting pointer near the edge can't strobe the fade.
        assert!(hover_pad(true) > hover_pad(false));
        let rect = ScreenRect {
            x: 100.0,
            y: 100.0,
            w: 14.0,
            h: 16.0,
        };
        // 15pt past the left edge: outside the enter pad, inside
        // the exit pad.
        assert!(!rect.contains(85.0, 108.0, hover_pad(false)));
        assert!(rect.contains(85.0, 108.0, hover_pad(true)));
    }

    #[test]
    fn pad_grows_the_hit_zone() {
        let rect = ScreenRect {
            x: 100.0,
            y: 100.0,
            w: 14.0,
            h: 16.0,
        };
        assert!(rect.contains(107.0, 108.0, 0.0));
        assert!(!rect.contains(90.0, 108.0, 0.0));
        assert!(rect.contains(90.0, 108.0, 10.0));
        assert!(!rect.contains(89.9, 108.0, 10.0));
        assert!(rect.contains(107.0, 126.0, 10.0));
        assert!(!rect.contains(107.0, 126.1, 10.0));
    }
}
