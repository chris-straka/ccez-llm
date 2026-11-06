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

/// A browser-pane item that starts off: its keys are the app's own
/// until the pane (or its page) needs them (`set_browser`).
fn page<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, false, accelerator)
}

/// The browser pane's items while the chat has the keyboard keep its
/// keys for the app (⌘[ ⌘] size the prompt's text, ⌘F finds in chats);
/// while the page has it, they're the page's. ⌘W and ⌘L follow whether
/// the pane is open at all. A disabled item's key passes to the app.
pub const PAGE_ITEMS: &[&str] = &[
    "browser-annotate",
    "browser-back",
    "browser-forward",
    "browser-reload",
    "browser-find",
    "browser-actual-size",
];
pub const PANE_ITEMS: &[&str] = &[
    "browser-location",
    "browser-expand",
    "browser-next-tab",
    "browser-prev-tab",
];

/// ⌘W closes a tab only while the browser has the keyboard (its page,
/// or its own tab strip and address bar): typing in the chat, it's the
/// chat's (owner's review, 2026-11-06).
pub const FOCUS_ITEMS: &[&str] = &["browser-close-tab"];
/// The app's own items that step aside while a page has the keyboard,
/// so the page gets the key (⌘B is bold in a mail or a document).
pub const YIELD_ITEMS: &[&str] = &["toggle-sidebar"];

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
            &custom(app, "browser-new-tab", "New Tab", Some("CmdOrCtrl+T"))?,
            &page(
                app,
                "browser-location",
                "Open Location…",
                Some("CmdOrCtrl+L"),
            )?,
            &page(app, "browser-close-tab", "Close Tab", Some("CmdOrCtrl+W"))?,
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
            &sep(app)?,
            &page(app, "browser-find", "Find in Page…", Some("CmdOrCtrl+F"))?,
            &page(
                app,
                "browser-annotate",
                "Annotate Selection in Page",
                Some("CmdOrCtrl+Shift+A"),
            )?,
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
            &custom(
                app,
                "bigger-text",
                "Increase Text Size",
                Some("CmdOrCtrl+="),
            )?,
            &custom(
                app,
                "smaller-text",
                "Decrease Text Size",
                Some("CmdOrCtrl+-"),
            )?,
            &page(
                app,
                "browser-actual-size",
                "Actual Size",
                Some("CmdOrCtrl+0"),
            )?,
            &sep(app)?,
            &custom(app, "browser-toggle", "Browser", Some("CmdOrCtrl+Shift+B"))?,
            &page(
                app,
                "browser-expand",
                "Expand Browser",
                Some("CmdOrCtrl+Shift+E"),
            )?,
            &page(app, "browser-back", "Back", Some("CmdOrCtrl+["))?,
            &page(app, "browser-forward", "Forward", Some("CmdOrCtrl+]"))?,
            &page(app, "browser-reload", "Reload Page", Some("CmdOrCtrl+R"))?,
            &page(
                app,
                "browser-next-tab",
                "Next Tab",
                Some("CmdOrCtrl+Alt+Right"),
            )?,
            &page(
                app,
                "browser-prev-tab",
                "Previous Tab",
                Some("CmdOrCtrl+Alt+Left"),
            )?,
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

/// Turns the browser pane's items on and off: `open` the pane shows,
/// `page` its page has the keyboard, `pane` the pane's own controls do.
pub fn set_browser<R: Runtime>(app: &AppHandle<R>, open: bool, page: bool, pane: bool) {
    let Some(menu) = app.menu() else { return };
    let ids = PANE_ITEMS
        .iter()
        .map(|id| (id, open))
        .chain(PAGE_ITEMS.iter().map(|id| (id, open && page)))
        .chain(FOCUS_ITEMS.iter().map(|id| (id, open && (page || pane))))
        .chain(YIELD_ITEMS.iter().map(|id| (id, !(open && page))));
    for (id, on) in ids {
        if let Some(item) = menu.get(*id).and_then(|kind| kind.as_menuitem().cloned()) {
            let _ = item.set_enabled(on);
        }
    }
}

/// Forward menu clicks to the frontend (see MENU_EVENT).
pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    app.emit(MENU_EVENT, id).ok();
}
