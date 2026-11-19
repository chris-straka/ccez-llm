//! The Mac's menu bar Ask (owner, 2026-11-19: "a menu bar item for it
//! so I can click and ask a quick question and then have it answer back
//! to me in a notification and maybe the menu bar item icon changes so
//! I can click and see its response"). This replaces the older "no
//! menu-bar icon on macOS" rule.
//!
//! A click on the icon drops a small window (`/menubar`) under it; the
//! question goes to the main window, which answers with the chosen
//! provider and files the thread as a chat (`src/lib/menubarAsk.ts`).
//! An answer that lands while the window is down marks the icon (a dot)
//! and sends a notification; opening the window clears the mark. A
//! right click offers Open Ccez LLM and Quit.

/// Webview label (and route) of the Ask window.
pub const MENUBAR_LABEL: &str = "menubar";

/// Pure: where the window goes so it hangs centred under the icon,
/// kept on the screen. Physical pixels throughout.
pub fn place_under_icon(
    icon: (f64, f64, f64, f64),
    window_width: f64,
    screen: (f64, f64),
) -> (f64, f64) {
    let (ix, iy, iw, ih) = icon;
    let (sx, sw) = screen;
    let x = ix + iw / 2.0 - window_width / 2.0;
    let x = x.max(sx + 8.0).min(sx + sw - window_width - 8.0);
    (x.round(), (iy + ih + 4.0).round())
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{place_under_icon, MENUBAR_LABEL};
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

    const TRAY_ID: &str = "ccez-menubar";
    const OPEN_ID: &str = "menubar-open-app";
    const QUIT_ID: &str = "menubar-quit";
    /// The page's width; it sets the height itself (just the field when
    /// empty, growing with the thread), so this is where it starts.
    const WIDTH: f64 = 420.0;
    const HEIGHT: f64 = 56.0;
    static WAITING: AtomicBool = AtomicBool::new(false);
    /// When the window last lost focus: the click that hides it by
    /// focusing the menu bar would otherwise show it again at once.
    static HIDDEN_AT: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);

    fn icon(waiting: bool) -> Option<Image<'static>> {
        let bytes: &'static [u8] = if waiting {
            include_bytes!("../icons/menubar-answer.png")
        } else {
            include_bytes!("../icons/menubar.png")
        };
        Image::from_bytes(bytes).ok()
    }

    pub fn build(app: &AppHandle) -> tauri::Result<()> {
        let menu = Menu::with_items(
            app,
            &[
                &MenuItem::with_id(app, OPEN_ID, "Open Ccez LLM", true, None::<&str>)?,
                &MenuItem::with_id(app, QUIT_ID, "Quit Ccez LLM", true, None::<&str>)?,
            ],
        )?;
        let mut tray = TrayIconBuilder::with_id(TRAY_ID)
            .icon_as_template(true)
            .tooltip("Ask Ccez LLM")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                OPEN_ID => crate::desktop::focus_main(app),
                QUIT_ID => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } = event
                {
                    let scale = tray
                        .app_handle()
                        .primary_monitor()
                        .ok()
                        .flatten()
                        .map(|m| m.scale_factor())
                        .unwrap_or(2.0);
                    let pos = rect.position.to_physical::<f64>(scale);
                    let size = rect.size.to_physical::<f64>(scale);
                    toggle(
                        tray.app_handle(),
                        (pos.x, pos.y, size.width, size.height),
                        true,
                    );
                }
            });
        if let Some(image) = icon(false) {
            tray = tray.icon(image);
        }
        tray.build(app)?;
        Ok(())
    }

    fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
        if let Some(w) = app.get_webview_window(MENUBAR_LABEL) {
            return Some(w);
        }
        // Made on the first click, never at launch: startup stays as it was.
        let w = WebviewWindowBuilder::new(app, MENUBAR_LABEL, WebviewUrl::App("/menubar".into()))
            .title("Ask")
            .inner_size(WIDTH, HEIGHT)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            // The Mac's own frosted glass under the page, as menu bar
            // popovers have; the page's panel is mostly see-through.
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
        let handle = w.clone();
        w.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                if let Ok(mut at) = HIDDEN_AT.lock() {
                    *at = Some(std::time::Instant::now());
                }
                let _ = handle.hide();
            }
        });
        Some(w)
    }

    fn toggle(app: &AppHandle, icon_rect: (f64, f64, f64, f64), focus: bool) {
        let Some(w) = window(app) else { return };
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            return;
        }
        // The click that took focus away (and hid it) is this one.
        let just_hidden = HIDDEN_AT
            .lock()
            .ok()
            .and_then(|at| *at)
            .is_some_and(|at| at.elapsed() < std::time::Duration::from_millis(250));
        if just_hidden {
            return;
        }
        let scale = w.scale_factor().unwrap_or(2.0);
        let screen = w
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| app.primary_monitor().ok().flatten())
            .map(|m| (m.position().x as f64, m.size().width as f64))
            .unwrap_or((0.0, 3000.0));
        let (x, y) = place_under_icon(icon_rect, WIDTH * scale, screen);
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.show();
        if focus {
            let _ = w.set_focus();
        }
        mark(app, false);
    }

    /// Open the window under the icon without a click (a key or a script);
    /// `focus: false` leaves the front app in front (drive scripts).
    pub fn show(app: &AppHandle, focus: bool) {
        let Some(tray) = app.tray_by_id(TRAY_ID) else {
            return;
        };
        let Ok(Some(rect)) = tray.rect() else { return };
        let scale = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(2.0);
        let pos = rect.position.to_physical::<f64>(scale);
        let size = rect.size.to_physical::<f64>(scale);
        if let Some(w) = app.get_webview_window(MENUBAR_LABEL) {
            if w.is_visible().unwrap_or(false) {
                if focus {
                    let _ = w.set_focus();
                }
                return;
            }
        }
        toggle(app, (pos.x, pos.y, size.width, size.height), focus);
    }

    pub fn mark(app: &AppHandle, waiting: bool) {
        if WAITING.swap(waiting, Ordering::SeqCst) == waiting {
            return;
        }
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon(icon(waiting));
            let _ = tray.set_icon_as_template(true);
        }
    }

    /// Up on the screen (it hides when it loses focus, so up is in front).
    pub fn seen(app: &AppHandle) -> bool {
        app.get_webview_window(MENUBAR_LABEL)
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    }

    /// The page's height, keeping the top edge under the icon (a plain
    /// resize on macOS keeps the bottom edge and grows the window up).
    pub fn fit(app: &AppHandle, height: f64) {
        let Some(w) = app.get_webview_window(MENUBAR_LABEL) else {
            return;
        };
        let top_left = w.outer_position().ok();
        let _ = w.set_size(tauri::LogicalSize::new(WIDTH, height.clamp(40.0, 640.0)));
        if let Some(p) = top_left {
            let _ = w.set_position(p);
        }
    }

    pub fn hide(app: &AppHandle) {
        if let Some(w) = app.get_webview_window(MENUBAR_LABEL) {
            let _ = w.hide();
        }
    }
}

/// Set up the menu bar icon (macOS; a no-op elsewhere).
#[cfg(desktop)]
pub fn build(app: &tauri::AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    mac::build(app)?;
    let _ = app;
    Ok(())
}

/// An answer is in: true when the Ask window is up (seen);
/// otherwise the icon takes its dot and the caller sends the notification.
#[tauri::command]
pub fn menubar_answered(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        if mac::seen(&app) {
            return true;
        }
        mac::mark(&app, true);
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        true
    }
}

/// Open the Ask window under its icon (no click needed); `focus: false`
/// keeps the front app in front.
#[tauri::command]
pub fn menubar_show(app: tauri::AppHandle, focus: Option<bool>) {
    #[cfg(target_os = "macos")]
    mac::show(&app, focus.unwrap_or(true));
    let _ = (app, focus);
}

/// The Ask window's page is this tall now (it grows with the thread).
#[tauri::command]
pub fn menubar_fit(app: tauri::AppHandle, height: f64) {
    #[cfg(target_os = "macos")]
    mac::fit(&app, height);
    let _ = (app, height);
}

/// Hide the Ask window (Escape).
#[tauri::command]
pub fn menubar_hide(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::hide(&app);
    let _ = app;
}

/// The thread goes on in the main window: hide this one, bring that up.
#[tauri::command]
pub fn menubar_open_main(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    mac::hide(&app);
    #[cfg(desktop)]
    crate::desktop::focus_main(&app);
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::place_under_icon;

    #[test]
    fn hangs_centred_under_the_icon() {
        // A 40px icon at x=2000 on a 3024px screen; a 760px window.
        let (x, y) = place_under_icon((2000.0, 0.0, 40.0, 48.0), 760.0, (0.0, 3024.0));
        assert_eq!((x, y), (1640.0, 52.0));
    }

    #[test]
    fn stays_on_the_screen_at_the_right_edge() {
        let (x, _) = place_under_icon((2980.0, 0.0, 40.0, 48.0), 760.0, (0.0, 3024.0));
        assert_eq!(x, 3024.0 - 760.0 - 8.0);
    }

    #[test]
    fn a_second_screen_to_the_left_counts_from_its_own_edge() {
        let (x, _) = place_under_icon((-1900.0, 0.0, 40.0, 48.0), 760.0, (-1920.0, 1920.0));
        assert_eq!(x, -1912.0);
    }
}
