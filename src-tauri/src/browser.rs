//! The browser pane (desktop): each tab is a native child webview of the
//! main window, placed over a box the frontend measures and keeps in
//! step. The pane's chrome (tabs, address bar, divider) is the app's own
//! HTML; this module only makes, moves, shows and drives the pages, and
//! reports what they do (`browser-load`, `browser-title`,
//! `browser-new-tab`, `browser-download`).
//!
//! The pages get none of the app's powers: their origins are remote, so
//! no capability covers them, and they keep their own cookies and
//! storage (a data store of their own on macOS, a folder elsewhere).
//! See docs/design/browser-pane.md.

#[cfg(desktop)]
use serde::Serialize;

/// A page started or finished loading: `{ id, url, done }`.
pub const LOAD_EVENT: &str = "browser-load";
/// A page's title changed: `{ id, title }`.
pub const TITLE_EVENT: &str = "browser-title";
/// A page asked for a new window (target=_blank, window.open): `{ id, url }`.
pub const NEW_TAB_EVENT: &str = "browser-new-tab";
/// A download finished: `{ id, name, ok }`.
pub const DOWNLOAD_EVENT: &str = "browser-download";

/// A tab's webview label. Ids come from the frontend: short, plain.
fn label(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 32 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("bad tab id".into());
    }
    Ok(format!("browser-{id}"))
}

/// What a page may be: the web, and the blank page a new tab starts on.
fn page_url(raw: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(raw).map_err(|_| "not a URL".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        "about" if raw == "about:blank" => Ok(url),
        _ => Err("only web pages open in the browser".into()),
    }
}

#[cfg(desktop)]
#[derive(Serialize, Clone)]
struct Load {
    id: String,
    url: String,
    done: bool,
}

#[cfg(desktop)]
#[derive(Serialize, Clone)]
struct Title {
    id: String,
    title: String,
}

#[cfg(desktop)]
#[derive(Serialize, Clone)]
struct NewTab {
    id: String,
    url: String,
}

#[cfg(desktop)]
#[derive(Serialize, Clone)]
struct Download {
    id: String,
    name: String,
    ok: bool,
}

/// The pages' own cookies and storage, apart from the app's (macOS 14+).
#[cfg(target_os = "macos")]
const STORE: [u8; 16] = *b"ccez-llm-browser";

#[cfg(desktop)]
fn webview(app: &tauri::AppHandle, id: &str) -> Result<tauri::Webview, String> {
    use tauri::Manager;
    app.get_webview(&label(id)?)
        .ok_or_else(|| "no such tab".to_string())
}

#[cfg(desktop)]
fn rect(x: f64, y: f64, w: f64, h: f64) -> tauri::Rect {
    tauri::Rect {
        position: tauri::LogicalPosition::new(x, y).into(),
        size: tauri::LogicalSize::new(w.max(1.0), h.max(1.0)).into(),
    }
}

/// Make tab `id`'s page at `url`, over the box at x, y (w × h, logical
/// pixels from the window's top left). An existing tab is moved there.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn browser_open(
    app: tauri::AppHandle,
    id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    dark: bool,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, &url, x, y, w, h, dark);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        use tauri::{Emitter, Manager};
        let page = page_url(&url)?;
        if let Ok(existing) = webview(&app, &id) {
            existing
                .set_bounds(rect(x, y, w, h))
                .map_err(|e| e.to_string())?;
            return existing.show().map_err(|e| e.to_string());
        }
        let window = app.get_window("main").ok_or("no main window")?;
        let (a, b, c) = (app.clone(), app.clone(), app.clone());
        let (i1, i2, i3, i4) = (id.clone(), id.clone(), id.clone(), id.clone());
        let downloads = app.path().download_dir().ok();
        let d = app.clone();
        // Dark pages open dark: no white flash before the first paint.
        let ground = if dark {
            tauri::window::Color(18, 18, 20, 255)
        } else {
            tauri::window::Color(255, 255, 255, 255)
        };
        let builder =
            tauri::webview::WebviewBuilder::new(label(&id)?, tauri::WebviewUrl::External(page))
                .background_color(ground)
                // ⌘= and ⌘- are the app's menu keys; they zoom the page from there.
                .zoom_hotkeys_enabled(false)
                .on_page_load(move |_, load| {
                    let done = matches!(load.event(), tauri::webview::PageLoadEvent::Finished);
                    let _ = a.emit(
                        LOAD_EVENT,
                        Load {
                            id: i1.clone(),
                            url: load.url().to_string(),
                            done,
                        },
                    );
                })
                .on_document_title_changed(move |_, title| {
                    let _ = b.emit(
                        TITLE_EVENT,
                        Title {
                            id: i2.clone(),
                            title,
                        },
                    );
                })
                // mailto:, tel:, an app's own scheme: the system's, never a
                // dead page in the tab.
                .on_navigation(move |to| match to.scheme() {
                    "http" | "https" | "about" | "data" | "blob" => true,
                    _ => {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = c.opener().open_url(to.as_str(), None::<&str>);
                        false
                    }
                })
                // A new window is a new tab beside this one.
                .on_new_window(move |to, _| {
                    let _ = d.emit(
                        NEW_TAB_EVENT,
                        NewTab {
                            id: i3.clone(),
                            url: to.to_string(),
                        },
                    );
                    tauri::webview::NewWindowResponse::Deny
                })
                .on_download(move |webview, event| {
                    match event {
                        tauri::webview::DownloadEvent::Requested { url, destination } => {
                            if let Some(dir) = &downloads {
                                let name = url
                                    .path_segments()
                                    .and_then(|mut s| s.next_back().map(str::to_string))
                                    .filter(|n| !n.is_empty())
                                    .unwrap_or_else(|| "download".into());
                                *destination = dir.join(name);
                            }
                        }
                        tauri::webview::DownloadEvent::Finished { url, success, .. } => {
                            let name = url
                                .path_segments()
                                .and_then(|mut s| s.next_back().map(str::to_string))
                                .unwrap_or_default();
                            let _ = webview.app_handle().emit(
                                DOWNLOAD_EVENT,
                                Download {
                                    id: i4.clone(),
                                    name,
                                    ok: success,
                                },
                            );
                        }
                        _ => {}
                    }
                    true
                });
        #[cfg(target_os = "macos")]
        let builder = builder.data_store_identifier(STORE);
        #[cfg(not(target_os = "macos"))]
        let builder = match app.path().app_local_data_dir() {
            Ok(dir) => builder.data_directory(dir.join("browser")),
            Err(_) => builder,
        };
        window
            .add_child(
                builder,
                tauri::LogicalPosition::new(x, y),
                tauri::LogicalSize::new(w.max(1.0), h.max(1.0)),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Move tab `id`'s page to the box at x, y (w × h).
#[tauri::command]
pub fn browser_bounds(
    app: tauri::AppHandle,
    id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, x, y, w, h);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    webview(&app, &id)?
        .set_bounds(rect(x, y, w, h))
        .map_err(|e| e.to_string())
}

/// Show or hide tab `id`'s page (an inactive tab, or one stepping aside
/// for the app's own menus and sheets).
#[tauri::command]
pub fn browser_visible(app: tauri::AppHandle, id: String, visible: bool) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, visible);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        let view = webview(&app, &id)?;
        if visible { view.show() } else { view.hide() }.map_err(|e| e.to_string())
    }
}

/// Give tab `id`'s page the keyboard.
#[tauri::command]
pub fn browser_focus(app: tauri::AppHandle, id: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    webview(&app, &id)?.set_focus().map_err(|e| e.to_string())
}

/// Close tab `id`: its page goes for good.
#[tauri::command]
pub fn browser_close(app: tauri::AppHandle, id: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        match webview(&app, &id) {
            Ok(view) => view.close().map_err(|e| e.to_string()),
            Err(_) => Ok(()),
        }
    }
}

/// Tab `id` goes to `url`.
#[tauri::command]
pub fn browser_navigate(app: tauri::AppHandle, id: String, url: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, &url);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    webview(&app, &id)?
        .navigate(page_url(&url)?)
        .map_err(|e| e.to_string())
}

/// Back, forward, reload or stop on tab `id`.
#[tauri::command]
pub fn browser_go(app: tauri::AppHandle, id: String, to: String) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, &to);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        let view = webview(&app, &id)?;
        match to.as_str() {
            "back" => view.eval("history.back()"),
            "forward" => view.eval("history.forward()"),
            "reload" => view.reload(),
            "stop" => view.eval("window.stop()"),
            _ => return Err("unknown move".into()),
        }
        .map_err(|e| e.to_string())
    }
}

/// Tab `id`'s page zoom (1 is as the page is).
#[tauri::command]
pub fn browser_zoom(app: tauri::AppHandle, id: String, factor: f64) -> Result<(), String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, factor);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    webview(&app, &id)?
        .set_zoom(factor.clamp(0.3, 5.0))
        .map_err(|e| e.to_string())
}

/// The browser's menu items for what has the keyboard (menu.rs): `open`
/// the pane shows, `page` its page has the keyboard.
#[tauri::command]
pub fn browser_menu(app: tauri::AppHandle, open: bool, page: bool) {
    #[cfg(all(desktop, not(target_os = "windows")))]
    crate::menu::set_browser(&app, open, page);
    #[cfg(not(all(desktop, not(target_os = "windows"))))]
    let _ = (&app, open, page);
}

/// Find `text` in tab `id`'s page, the next match (or the one before):
/// whether there was one.
#[tauri::command]
pub async fn browser_find(
    app: tauri::AppHandle,
    id: String,
    text: String,
    back: bool,
) -> Result<bool, String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id, &text, back);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        let text = serde_json::to_string(&text).map_err(|e| e.to_string())?;
        let found = eval(
            &app,
            &id,
            &format!("window.find({text}, false, {back}, true)"),
        )
        .await?;
        Ok(found.trim() == "true")
    }
}

/// What the frontend shows of tab `id`: where it is, its title, whether
/// it can go back or forward (the Navigation API, where the engine has
/// it), its icon, whether it's still loading.
#[tauri::command]
pub async fn browser_state(app: tauri::AppHandle, id: String) -> Result<serde_json::Value, String> {
    #[cfg(mobile)]
    {
        let _ = (&app, &id);
        Err("the browser is desktop only".into())
    }
    #[cfg(desktop)]
    {
        let raw = eval(&app, &id, STATE_JS).await?;
        // The engine hands back the value as JSON; WebKit wraps a string
        // result in quotes once more.
        let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        Ok(match value {
            serde_json::Value::String(inner) => {
                serde_json::from_str(&inner).unwrap_or(serde_json::Value::Null)
            }
            other => other,
        })
    }
}

#[cfg(desktop)]
const STATE_JS: &str = r#"JSON.stringify((() => {
  const n = window.navigation;
  const icon = document.querySelector('link[rel~="icon"][href]');
  return {
    url: location.href,
    title: document.title,
    back: n && typeof n.canGoBack === "boolean" ? n.canGoBack : null,
    forward: n && typeof n.canGoForward === "boolean" ? n.canGoForward : null,
    icon: icon ? icon.href : (location.protocol.startsWith("http") ? location.origin + "/favicon.ico" : ""),
    loading: document.readyState !== "complete",
    // Its ground, for the room past its snapshot while the pane widens.
    bg: [document.body, document.documentElement]
      .map((el) => el && getComputedStyle(el).backgroundColor)
      .find((c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") || ""
  };
})())"#;

/// Run `js` in tab `id` and wait for its result (as JSON), a second at most.
#[cfg(desktop)]
async fn eval(app: &tauri::AppHandle, id: &str, js: &str) -> Result<String, String> {
    let view = webview(app, id)?;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    view.eval_with_callback(js, move |out| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(out);
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(1), rx)
        .await
        .map_err(|_| "the page didn't answer".to_string())?
        .map_err(|_| "the page went away".to_string())
}

/// A still JPEG of tab `id`'s page as it shows now, for the app to draw
/// in its place while something of the app's sits over it or the
/// divider moves (native views always draw above the app's HTML).
/// macOS only; elsewhere nothing, and the box shows the page's colour.
#[tauri::command]
pub async fn browser_snapshot(
    app: tauri::AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
    #[cfg(target_os = "macos")]
    {
        snapshot_of(&app, &label(&id)?).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &id);
        Err("snapshots are macOS only".into())
    }
}

/// A still JPEG of the webview labelled `label` (a tab's, or the app's own).
#[cfg(target_os = "macos")]
pub async fn snapshot_of(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<tauri::ipc::Response, String> {
    use tauri::Manager;
    let view = app.get_webview(label).ok_or("no such tab")?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<Vec<u8>>>();
    view.with_webview(move |platform| unsafe { mac::snapshot(platform.inner().cast(), tx) })
        .map_err(|e| e.to_string())?;
    let bytes = tokio::time::timeout(std::time::Duration::from_secs(2), rx)
        .await
        .map_err(|_| "no snapshot".to_string())?
        .map_err(|_| "no snapshot".to_string())?
        .ok_or("no snapshot")?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    /// WKWebView's own snapshot of what it shows, as JPEG, sent on `tx`
    /// (None when it has none). Runs on the main thread (with_webview).
    pub unsafe fn snapshot(
        view: *mut AnyObject,
        tx: tokio::sync::oneshot::Sender<Option<Vec<u8>>>,
    ) {
        let Some(view) = view.as_ref() else {
            let _ = tx.send(None);
            return;
        };
        let tx = std::cell::RefCell::new(Some(tx));
        let done = block2::RcBlock::new(move |image: *mut AnyObject, _error: *mut AnyObject| {
            let bytes = jpeg(image);
            if let Some(tx) = tx.borrow_mut().take() {
                let _ = tx.send(bytes);
            }
        });
        let config: *mut AnyObject = std::ptr::null_mut();
        let _: () =
            msg_send![view, takeSnapshotWithConfiguration: config, completionHandler: &*done];
    }

    /// An NSImage as JPEG bytes, at the screen's own resolution.
    unsafe fn jpeg(image: *mut AnyObject) -> Option<Vec<u8>> {
        let image = image.as_ref()?;
        let tiff: *mut AnyObject = msg_send![image, TIFFRepresentation];
        let tiff = tiff.as_ref()?;
        let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        let rep = rep.as_ref()?;
        let props: *mut AnyObject = msg_send![class!(NSDictionary), dictionary];
        // NSBitmapImageFileTypeJPEG
        let data: *mut AnyObject =
            msg_send![rep, representationUsingType: 3usize, properties: props];
        let data = data.as_ref()?;
        let len: usize = msg_send![data, length];
        let ptr: *const u8 = msg_send![data, bytes];
        if ptr.is_null() || len == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(ptr, len).to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_ids_are_plain() {
        assert_eq!(label("t-1a").unwrap(), "browser-t-1a");
        assert!(label("").is_err());
        assert!(label("../main").is_err());
        assert!(label(&"x".repeat(33)).is_err());
    }

    #[test]
    fn only_web_pages_open() {
        assert!(page_url("https://example.com/").is_ok());
        assert!(page_url("http://example.com/").is_ok());
        assert!(page_url("about:blank").is_ok());
        assert!(page_url("file:///etc/passwd").is_err());
        assert!(page_url("tauri://localhost/").is_err());
        assert!(page_url("javascript:alert(1)").is_err());
    }
}
