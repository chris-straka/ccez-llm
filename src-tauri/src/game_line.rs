//! Game-line overlay ("Game line"): a small always-on-top window
//! showing the last captured game line with furigana, a one-line
//! translation, and a speak button. The main window pushes lines over
//! the `game-line` event (nothing pops up on capture — the overlay
//! only ever opens from the settings toggle or the tray); closing it
//! emits [`GAME_LINE_CLOSED_EVENT`] so the toggle flips back.

/// Webview label (and route) for the overlay window.
pub const GAME_LINE_LABEL: &str = "game-line";

/// Global event the backend emits when the overlay window closes.
pub const GAME_LINE_CLOSED_EVENT: &str = "game-line-closed";

/// Open (or focus) the game-line overlay. Desktop only — mobile has
/// no second window and reports unsupported like the area picker.
#[tauri::command]
pub fn open_game_line(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = &app;
        return Err("the game line is not supported on this platform".to_string());
    }
    #[cfg(desktop)]
    {
        open_game_line_desktop(&app)
    }
}

/// Desktop half of `open_game_line` (separate so the mobile stub
/// above keeps the command registered everywhere): the builder chain
/// uses desktop-only window methods.
#[cfg(desktop)]
fn open_game_line_desktop(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(line) = app.get_webview_window(GAME_LINE_LABEL) {
        let _ = line.show();
        let _ = line.set_focus();
        return Ok(());
    }
    let window =
        WebviewWindowBuilder::new(app, GAME_LINE_LABEL, WebviewUrl::App("/game-line".into()))
            .title("Game line")
            .inner_size(420.0, 200.0)
            .min_inner_size(320.0, 140.0)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .build()
            .map_err(|_| "the game line could not open".to_string())?;
    // The settings toggle mirrors the window: report its close so the
    // main window can flip the toggle back (a native-frame X gives the
    // frontend no other signal).
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = handle.emit(GAME_LINE_CLOSED_EVENT, ());
        }
    });
    Ok(())
}

/// Close the game-line overlay if it is open (settings toggle off).
/// Mobile reports unsupported; everywhere else a missing window is a
/// silent no-op.
#[tauri::command]
pub fn close_game_line(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = &app;
        return Err("the game line is not supported on this platform".to_string());
    }
    #[cfg(desktop)]
    {
        use tauri::Manager as _;
        if let Some(window) = app.get_webview_window(GAME_LINE_LABEL) {
            let _ = window.close();
        }
        Ok(())
    }
}
