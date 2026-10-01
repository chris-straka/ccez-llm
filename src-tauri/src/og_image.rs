//! Share-image readback through a hidden browser window (`fetch_og_image`).
//!
//! Bot-walled press (Cloudflare challenge, DataDome, PerimeterX: AP,
//! NYT, Reuters, Economist, Politico, The Hill, …) 403s the
//! impersonated fetcher, so direct og:image reads fail there. A real
//! browser passes those walls, so this command loads the page hidden,
//! reads its share-image metas, and tears the window down. Desktop
//! only (mobile shells run a single webview): elsewhere it answers
//! `unsupported` and the caller keeps its letter tile. One hidden
//! window at a time; every path destroys its window. New windows
//! never steal focus or touch the taskbar, and throttling stays off
//! so challenge scripts run while hidden.

#[cfg(any(test, desktop))]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(desktop)]
use std::sync::{mpsc, OnceLock};
#[cfg(desktop)]
use std::time::{Duration, Instant};

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::utils::config::BackgroundThrottlingPolicy;
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(desktop)]
use crate::fetch::fetchable_url;

/// Load budget per story (passive challenge solves land inside it).
#[cfg(desktop)]
const LOAD_BUDGET: Duration = Duration::from_secs(12);
/// Ready-poll beat.
#[cfg(desktop)]
const POLL_BEAT: Duration = Duration::from_millis(300);
/// One eval round-trip cap (a wedged renderer must not eat the budget).
#[cfg(desktop)]
const EVAL_TIMEOUT: Duration = Duration::from_secs(2);
/// Settle after `complete` (challenge redirects, late metas).
#[cfg(desktop)]
const SETTLE_AFTER_COMPLETE: Duration = Duration::from_millis(1500);
/// Share-meta read cap.
#[cfg(desktop)]
const META_TIMEOUT: Duration = Duration::from_secs(3);

/// Ready-state probe: always a JSON string (Windows swallows eval
/// exceptions, so every snippet try/catches and stringifies).
#[cfg(any(test, desktop))]
const READY_JS: &str = r#"(() => { try { return document.readyState; } catch (e) { return "unknown"; } })()"#;
/// Share metas as one JSON string: og:image first, twitter:image next.
#[cfg(any(test, desktop))]
const METAS_JS: &str = r#"(() => { try {
  const meta = (sel, attr) => {
    const el = document.querySelector(sel);
    const v = el ? el.getAttribute(attr) : null;
    return v && v.trim() ? v.trim() : null;
  };
  return JSON.stringify({
    og: meta('meta[property="og:image"]', "content"),
    tw: meta('meta[name="twitter:image"]', "content") || meta('meta[property="twitter:image"]', "content")
  });
} catch (e) { return JSON.stringify({ og: null, tw: null }); } })()"#;

#[cfg(desktop)]
fn lane() -> &'static tauri::async_runtime::Mutex<()> {
    static LANE: OnceLock<tauri::async_runtime::Mutex<()>> = OnceLock::new();
    LANE.get_or_init(|| tauri::async_runtime::Mutex::new(()))
}

#[cfg(any(test, desktop))]
static LABEL_SEQ: AtomicU64 = AtomicU64::new(0);

#[cfg(any(test, desktop))]
fn next_label() -> String {
    format!("ogimg-{}", LABEL_SEQ.fetch_add(1, Ordering::Relaxed))
}

/// Bridge JSON string out of an eval result (results arrive
/// JSON-serialized, so a returned string arrives quoted). Pure.
#[cfg(any(test, desktop))]
fn eval_string(result: &str) -> Option<String> {
    serde_json::from_str(result).ok()
}

#[cfg(any(test, desktop))]
#[derive(serde::Deserialize)]
struct ShareMetas {
    og: Option<String>,
    tw: Option<String>,
}

/// First non-blank candidate, og:image before twitter:image. Pure.
#[cfg(any(test, desktop))]
fn pick_share_image(og: Option<&str>, tw: Option<&str>) -> Option<String> {
    [og, tw]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .map(str::to_string)
}

/// Candidate into an absolute URL against the page URL. Absolute,
/// protocol-relative, and data: candidates pass through; root- and
/// path-relative ones join the page origin/dir by string ops (no url
/// crate at hand). Pure.
#[cfg(any(test, desktop))]
fn resolve_candidate(page_url: &str, candidate: &str) -> Option<String> {
    let cand = candidate.trim();
    if cand.is_empty() {
        return None;
    }
    let lower = cand.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
    {
        return Some(cand.to_string());
    }
    let scheme_end = page_url.find("://")?;
    let scheme = &page_url[..scheme_end];
    let after = &page_url[scheme_end + 3..];
    let host_end = after.find('/').unwrap_or(after.len());
    let host = &after[..host_end];
    if host.is_empty() {
        return None;
    }
    if let Some(rest) = cand.strip_prefix("//") {
        return Some(format!("{scheme}://{rest}"));
    }
    if cand.starts_with('/') {
        return Some(format!("{scheme}://{host}{cand}"));
    }
    let path = &after[host_end..];
    let dir = path.rfind('/').map(|i| &path[..i]).unwrap_or("");
    if dir.is_empty() {
        return Some(format!("{scheme}://{host}/{cand}"));
    }
    Some(format!("{scheme}://{host}{dir}/{cand}"))
}

/// One eval round-trip on the blocking pool (std channel: no new
/// async deps for this module).
#[cfg(desktop)]
fn eval_blocking(window: &WebviewWindow, js: &str, wait: Duration) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    window
        .eval_with_callback(js, move |s| {
            let _ = tx.send(s);
        })
        .ok()?;
    rx.recv_timeout(wait).ok()
}

#[cfg(desktop)]
fn page_ready(window: &WebviewWindow) -> bool {
    eval_blocking(window, READY_JS, EVAL_TIMEOUT)
        .and_then(|s| eval_string(&s))
        .is_some_and(|state| state == "complete")
}

/// Load, settle, and read one hidden window. Blocking: runs on the
/// blocking pool under the lane mutex; the caller destroys the window.
#[cfg(desktop)]
fn read_from_window(window: &WebviewWindow, page_url: &str) -> Result<Option<String>, String> {
    let deadline = Instant::now() + LOAD_BUDGET;
    loop {
        if Instant::now() >= deadline {
            return Err("timeout".to_string());
        }
        if page_ready(window) {
            break;
        }
        std::thread::sleep(POLL_BEAT);
    }
    std::thread::sleep(SETTLE_AFTER_COMPLETE);
    let raw = eval_blocking(window, METAS_JS, META_TIMEOUT).ok_or_else(|| "failed".to_string())?;
    let inner = eval_string(&raw).ok_or_else(|| "failed".to_string())?;
    let metas: ShareMetas = serde_json::from_str(&inner).unwrap_or(ShareMetas { og: None, tw: None });
    let picked = pick_share_image(metas.og.as_deref(), metas.tw.as_deref());
    Ok(picked.and_then(|c| resolve_candidate(page_url, &c)))
}

#[cfg(desktop)]
fn read_share_image(app: AppHandle, page_url: &str) -> Result<Option<String>, String> {
    let url = tauri::Url::parse(page_url).map_err(|_| "bad-url".to_string())?;
    let window = WebviewWindowBuilder::new(&app, next_label(), WebviewUrl::External(url))
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .build()
        .map_err(|_| "failed".to_string())?;
    let out = read_from_window(&window, page_url);
    let _ = window.destroy();
    out
}

/// Share image for a story URL via a hidden desktop browser, or
/// `unsupported` off-desktop. Codes: `bad-url`, `timeout`, `failed`.
#[cfg(desktop)]
#[tauri::command]
pub async fn fetch_og_image(app: AppHandle, url: String) -> Result<Option<String>, String> {
    let page = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?.to_string();
    let _lane = lane().lock().await;
    tauri::async_runtime::spawn_blocking(move || read_share_image(app, &page))
        .await
        .map_err(|_| "failed".to_string())?
}

/// Mobile shells run a single webview: no hidden leg there.
#[cfg(not(desktop))]
#[tauri::command]
pub async fn fetch_og_image(_app: AppHandle, _url: String) -> Result<Option<String>, String> {
    Err("unsupported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eval_string_unquotes_bridge_results() {
        assert_eq!(eval_string(r#""complete""#).as_deref(), Some("complete"));
        assert_eq!(eval_string(r#""{\"og\":null}""#).as_deref(), Some(r#"{"og":null}"#));
        assert!(eval_string("complete").is_none());
    }

    #[test]
    fn pick_share_image_prefers_og_and_skips_blanks() {
        assert_eq!(
            pick_share_image(Some("https://x/og.jpg"), Some("https://x/tw.jpg")).as_deref(),
            Some("https://x/og.jpg")
        );
        assert_eq!(
            pick_share_image(Some("  "), Some("https://x/tw.jpg")).as_deref(),
            Some("https://x/tw.jpg")
        );
        assert_eq!(pick_share_image(None, None), None);
    }

    #[test]
    fn resolve_candidate_joins_every_shape() {
        let page = "https://www.example.com/news/article-1?x=1";
        assert_eq!(
            resolve_candidate(page, "https://cdn.example.com/i.jpg").as_deref(),
            Some("https://cdn.example.com/i.jpg")
        );
        assert_eq!(
            resolve_candidate(page, "//cdn.example.com/i.jpg").as_deref(),
            Some("https://cdn.example.com/i.jpg")
        );
        assert_eq!(
            resolve_candidate(page, "data:image/gif;base64,AAA").as_deref(),
            Some("data:image/gif;base64,AAA")
        );
        assert_eq!(
            resolve_candidate(page, "/assets/i.jpg").as_deref(),
            Some("https://www.example.com/assets/i.jpg")
        );
        assert_eq!(
            resolve_candidate(page, "i.jpg").as_deref(),
            Some("https://www.example.com/news/i.jpg")
        );
        assert!(resolve_candidate(page, "   ").is_none());
    }

    #[test]
    fn meta_script_reads_both_fallbacks_without_throwing() {
        assert!(METAS_JS.contains(r#"meta[property="og:image"]"#));
        assert!(METAS_JS.contains(r#"meta[name="twitter:image"]"#));
        assert!(METAS_JS.contains("try {"));
        assert!(READY_JS.contains("document.readyState"));
    }

    #[test]
    fn labels_never_repeat() {
        assert_ne!(next_label(), next_label());
    }
}
