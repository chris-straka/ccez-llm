//! The Mac's quick Ask (owner, 2026-11-19: "click and ask a quick question
//! and then have it answer back to me in a notification"). It was asked
//! as a menu bar item; the owner then kept ccez-sketch's icon as the only
//! one up there, so it opens on a hotkey instead: ⌃⌥Space anywhere drops a
//! small Spotlight-style field near the top of the screen the pointer is
//! on (`/quick-ask`). The question goes to the main window, which answers
//! with the chosen provider and files the thread as a chat
//! (`src/lib/quickAsk.ts`). An answer that lands while the field is down
//! comes as a notification; ⌃⌥Space (or the Dock icon) shows it.

/// Webview label (and route) of the Ask window.
pub const QUICK_ASK_LABEL: &str = "quick-ask";

/// The chord, anywhere on the Mac.
/// Not ⌥Space: ChatGPT opens its mini window there (and Siri and ChatGPT
/// both take a double ⌘); nothing on the owner's Mac uses this one.
pub const QUICK_ASK_SHORTCUT: &str = "Control+Alt+Space";

/// Pure: where the window goes on a screen (x, y, width, height), as
/// Spotlight sits: centred, a fifth of the way down. Physical pixels.
pub fn place_on_screen(screen: (f64, f64, f64, f64), window_width: f64) -> (f64, f64) {
    let (sx, sy, sw, sh) = screen;
    (
        (sx + (sw - window_width) / 2.0).round(),
        (sy + sh * 0.2).round(),
    )
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{place_on_screen, QUICK_ASK_LABEL, QUICK_ASK_SHORTCUT};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

    /// The page's width; it sets the height itself (just the field when
    /// empty, growing with the thread), so this is where it starts.
    const WIDTH: f64 = 420.0;
    const HEIGHT: f64 = 56.0;
    /// An answer came while the field was down and hasn't been seen.
    static WAITING: AtomicBool = AtomicBool::new(false);

    // The Ask window as Spotlight's is: a panel that takes the keyboard
    // without making ccez-llm the active app. Activating it raised the
    // main window over whatever the owner was in and gave it the
    // keyboard, so the Ask lost focus and hid at once (seen on screen,
    // 2026-11-19). tao makes an NSWindow; its class becomes this NSPanel
    // subclass right after it is built (no ivars of its own; tao's
    // `focusable` ivar is only read through the two methods overridden
    // here), the way tauri-nspanel does it.
    objc2::define_class!(
        #[unsafe(super(
            objc2_app_kit::NSPanel,
            objc2_app_kit::NSWindow,
            objc2_app_kit::NSResponder,
            objc2_foundation::NSObject
        ))]
        #[thread_kind = objc2::MainThreadOnly]
        #[name = "CcezQuickAskPanel"]
        struct QuickAskPanel;

        impl QuickAskPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key(&self) -> bool {
                true
            }

            #[unsafe(method(canBecomeMainWindow))]
            fn can_become_main(&self) -> bool {
                false
            }
        }
    );

    /// Turn the built window into a non-activating panel (main thread).
    fn make_panel(w: &tauri::WebviewWindow) {
        use objc2::ClassType;
        use objc2_app_kit::{NSPanel, NSWindowCollectionBehavior, NSWindowStyleMask};
        let Ok(ptr) = w.ns_window() else { return };
        if ptr.is_null() || objc2::MainThreadMarker::new().is_none() {
            return;
        }
        // SAFETY: on the main thread, a live NSWindow from tao, swapped to
        // a subclass of NSPanel (itself an NSWindow subclass) that adds no
        // ivars, before it is first shown.
        unsafe {
            objc2::ffi::object_setClass(ptr.cast(), QuickAskPanel::class());
            let panel = &*(ptr as *const NSPanel);
            panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
            panel.setFloatingPanel(true);
            panel.setBecomesKeyOnlyIfNeeded(false);
            panel.setHidesOnDeactivate(false);
            panel.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
        }
    }

    pub fn install(app: &AppHandle) {
        use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
        let handle = app.clone();
        if let Err(error) =
            app.global_shortcut()
                .on_shortcut(QUICK_ASK_SHORTCUT, move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle(&handle, true);
                    }
                })
        {
            // Another app holds the chord: the main window still answers.
            eprintln!("quick ask: {QUICK_ASK_SHORTCUT} unavailable: {error}");
        }
    }

    fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
        if let Some(w) = app.get_webview_window(QUICK_ASK_LABEL) {
            return Some(w);
        }
        // Made the first time it's wanted, never at launch: startup stays
        // as it was.
        let w =
            WebviewWindowBuilder::new(app, QUICK_ASK_LABEL, WebviewUrl::App("/quick-ask".into()))
                .title("Ask")
                .inner_size(WIDTH, HEIGHT)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                // The Mac's own frosted glass under the page, as Spotlight
                // has; the page's panel is mostly see-through.
                .effects(
                    tauri::window::EffectsBuilder::new()
                        .effect(tauri::window::Effect::Popover)
                        .state(tauri::window::EffectState::Active)
                        .radius(12.0)
                        .build(),
                )
                .shadow(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .visible_on_all_workspaces(true)
                .build()
                .ok()?;
        make_panel(&w);
        let handle = w.clone();
        w.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = handle.hide();
            }
        });
        Some(w)
    }

    /// The screen the pointer is on, in physical pixels.
    fn pointer_screen(app: &AppHandle) -> Option<((f64, f64, f64, f64), f64)> {
        let at = app.cursor_position().ok();
        let monitors = app.available_monitors().ok().unwrap_or_default();
        let on = |m: &tauri::Monitor| {
            at.is_some_and(|p| {
                let (pos, size) = (m.position(), m.size());
                p.x >= pos.x as f64
                    && p.x < (pos.x + size.width as i32) as f64
                    && p.y >= pos.y as f64
                    && p.y < (pos.y + size.height as i32) as f64
            })
        };
        let m = monitors
            .iter()
            .find(|m| on(m))
            .cloned()
            .or_else(|| app.primary_monitor().ok().flatten())?;
        let (pos, size) = (m.position(), m.size());
        Some((
            (
                pos.x as f64,
                pos.y as f64,
                size.width as f64,
                size.height as f64,
            ),
            m.scale_factor(),
        ))
    }

    pub fn toggle(app: &AppHandle, focus: bool) {
        let Some(w) = window(app) else { return };
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
        if let Some((screen, scale)) = pointer_screen(app) {
            let (x, y) = place_on_screen(screen, WIDTH * scale);
            let _ = w.set_position(PhysicalPosition::new(x, y));
        }
        // Shown as a panel: it takes the keyboard without activating the
        // app (set_focus would activate it, raising the main window).
        // `focus: false` (scripts) only puts it on screen.
        if focus {
            let _ = w.show();
            // The page focuses its field on this (its own focus events
            // can come before it listens, on the first showing).
            use tauri::Emitter;
            let _ = w.emit_to(QUICK_ASK_LABEL, "quick-ask-shown", ());
        } else if let Ok(ptr) = w.ns_window() {
            if objc2::MainThreadMarker::new().is_some() && !ptr.is_null() {
                // SAFETY: main thread, the live panel made above.
                unsafe { (*(ptr as *const objc2_app_kit::NSWindow)).orderFrontRegardless() };
            }
        }
        WAITING.store(false, Ordering::SeqCst);
    }

    /// Open it without the chord (a script, or the Dock with an answer
    /// waiting); `focus: false` leaves the front app in front.
    pub fn show(app: &AppHandle, focus: bool) {
        if let Some(w) = app.get_webview_window(QUICK_ASK_LABEL) {
            if w.is_visible().unwrap_or(false) {
                if focus {
                    let _ = w.show();
                    use tauri::Emitter;
                    let _ = w.emit_to(QUICK_ASK_LABEL, "quick-ask-shown", ());
                }
                return;
            }
        }
        toggle(app, focus);
    }

    pub fn mark_waiting() {
        WAITING.store(true, Ordering::SeqCst);
    }

    pub fn waiting() -> bool {
        WAITING.load(Ordering::SeqCst)
    }

    /// Up on the screen (it hides when it loses focus, so up is in front).
    pub fn seen(app: &AppHandle) -> bool {
        app.get_webview_window(QUICK_ASK_LABEL)
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    }

    /// The page's height, keeping the top edge where it is (a plain
    /// resize on macOS keeps the bottom edge and grows the window up).
    pub fn fit(app: &AppHandle, height: f64) {
        let Some(w) = app.get_webview_window(QUICK_ASK_LABEL) else {
            return;
        };
        let top_left = w.outer_position().ok();
        let _ = w.set_size(tauri::LogicalSize::new(WIDTH, height.clamp(40.0, 640.0)));
        if let Some(p) = top_left {
            let _ = w.set_position(p);
        }
    }

    pub fn hide(app: &AppHandle) {
        if let Some(w) = app.get_webview_window(QUICK_ASK_LABEL) {
            let _ = w.hide();
        }
    }
}

/// Set up the chord (macOS; a no-op elsewhere).
#[cfg(desktop)]
pub fn build(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    mac::install(app);
    let _ = app;
    Ok(())
}

/// The Dock icon: with an answer waiting, show it (true); else false and
/// the caller brings the main window up.
#[cfg(desktop)]
pub fn reopen(app: &tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    if mac::waiting() {
        mac::show(app, true);
        return true;
    }
    let _ = app;
    false
}

/// An answer is in: true when the Ask window is up (seen); otherwise it is
/// kept as waiting and the caller sends the notification.
#[tauri::command]
pub fn quick_ask_answered(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        if mac::seen(&app) {
            return true;
        }
        mac::mark_waiting();
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        true
    }
}

/// Open the Ask window (no chord needed); `focus: false` keeps the front
/// app in front.
#[tauri::command]
pub fn quick_ask_show(app: tauri::AppHandle, focus: Option<bool>) {
    #[cfg(target_os = "macos")]
    mac::show(&app, focus.unwrap_or(true));
    let _ = (app, focus);
}

/// The Ask window's page is this tall now (it grows with the thread).
#[tauri::command]
pub fn quick_ask_fit(app: tauri::AppHandle, height: f64) {
    #[cfg(target_os = "macos")]
    mac::fit(&app, height);
    let _ = (app, height);
}

/// Hide the Ask window (Escape).
#[tauri::command]
pub fn quick_ask_hide(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::hide(&app);
    let _ = app;
}

/// The thread goes on in the main window: hide this one, bring that up.
#[tauri::command]
pub fn quick_ask_open_main(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::hide(&app);
    #[cfg(desktop)]
    crate::desktop::focus_main(&app);
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::place_on_screen;

    #[test]
    fn sits_centred_a_fifth_down() {
        // A 3024x1964 screen, an 840px window.
        assert_eq!(
            place_on_screen((0.0, 0.0, 3024.0, 1964.0), 840.0),
            (1092.0, 393.0)
        );
    }

    #[test]
    fn a_second_screen_counts_from_its_own_corner() {
        assert_eq!(
            place_on_screen((-1920.0, 120.0, 1920.0, 1080.0), 840.0),
            (-1380.0, 336.0)
        );
    }
}
