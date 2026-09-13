//! Native menu bar (desktop only): the keyboard shortcuts live here as
//! well as on keys, so Settings (⌘,) and friends are discoverable
//! outside the shortcuts modal. Clicks arrive in the frontend as the
//! `menu-action` window event carrying the item id; the frontend keeps
//! its own key handlers for the browser runtime, where no menu exists.

use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Runtime,
};

/// Window event name carrying the clicked menu item id.
pub const MENU_EVENT: &str = "menu-action";

fn custom<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, accelerator)
}

fn sep<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PredefinedMenuItem<R>> {
    PredefinedMenuItem::separator(app)
}

/// Build the full menu bar. Unknown accelerator strings fall back to
/// no accelerator (the frontend key handler still fires the action);
/// anything else here is a build-time-shaped bug and fails loudly.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        app,
        "Ccez LLM",
        true,
        &[
            &PredefinedMenuItem::about(
                app,
                None,
                Some(AboutMetadata {
                    name: Some("Ccez LLM".into()),
                    ..Default::default()
                }),
            )?,
            &sep(app)?,
            &custom(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &custom(app, "new-chat", "New Chat", Some("CmdOrCtrl+N"))?,
            &sep(app)?,
            &custom(app, "share-sheet", "Share Chat as Study Sheet…", None)?,
            &custom(app, "print-sheet", "Print Study Sheet…", None)?,
            &sep(app)?,
            &custom(app, "delete-chat", "Delete Current Chat", None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &custom(app, "toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+B"))?,
            &custom(app, "next-chat", "Next Chat", None)?,
            &custom(app, "prev-chat", "Previous Chat", None)?,
            &sep(app)?,
            &custom(app, "bigger-text", "Increase Text Size", Some("CmdOrCtrl+="))?,
            &custom(app, "smaller-text", "Decrease Text Size", Some("CmdOrCtrl+-"))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &sep(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&custom(app, "shortcuts", "Keyboard Shortcuts…", None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window_menu, &help])
}

/// Forward menu clicks to the frontend (see MENU_EVENT).
pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    app.emit(MENU_EVENT, id).ok();
}
