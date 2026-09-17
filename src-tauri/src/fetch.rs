//! Model-driven page fetch (`fetch_page` command, the executor behind
//! the chat `fetch_url` tool).
//!
//! Thin by design: GET with a timeout and a byte cap, http/https only,
//! no credentialed URLs. Returns the raw HTML (bounded); the frontend
//! cleans it to readable text, so the browser-preview fallback shares
//! the cap and the copy. Compiled everywhere; only invoked from the
//! shell (browser dev never reaches here).

use std::time::Duration;

const FETCH_TIMEOUT_SECS: u64 = 20;
const MAX_URL_CHARS: usize = 2048;
/// Largest page kept (bytes of HTML; the text cap lives in the frontend).
const MAX_HTML_BYTES: u64 = 512 * 1024;

/// The URL back when fetchable, `None` when not. Mirrors
/// `validFetchUrl` in the frontend seam (both stay dumb string gates).
fn fetchable_url(url: &str) -> Option<&str> {
    if url.is_empty() || url.len() > MAX_URL_CHARS {
        return None;
    }
    if url.bytes().any(|b| b <= 0x20 || b == 0x7f) {
        return None;
    }
    let lower = url.to_ascii_lowercase();
    let after = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))?;
    let host = after.split('/').next().unwrap_or("");
    if host.is_empty() || host.contains('@') {
        return None;
    }
    Some(url)
}

/// One page of HTML (bounded), or a short machine code the frontend
/// maps to its one-sentence copy (`timeout`, `too-big`, `bad-status`,
/// `bad-url`, `failed`).
#[tauri::command]
pub async fn fetch_page(url: String) -> Result<String, String> {
    let url = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .user_agent("ccez-llm page fetch")
        .build()
        .map_err(|_| "failed".to_string())?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| (if e.is_timeout() { "timeout" } else { "failed" }).to_string())?;
    if !res.status().is_success() {
        return Err("bad-status".into());
    }
    if res.content_length().is_some_and(|n| n > MAX_HTML_BYTES) {
        return Err("too-big".into());
    }
    let bytes = res.bytes().await.map_err(|_| "failed".to_string())?;
    if bytes.len() as u64 > MAX_HTML_BYTES {
        return Err("too-big".into());
    }
    String::from_utf8(bytes.into()).map_err(|_| "bad-encoding".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetchable_url_holds_the_gate() {
        assert!(fetchable_url("https://example.com/page?q=1").is_some());
        assert!(fetchable_url("http://localhost:1420/").is_some());
        assert!(fetchable_url("file:///etc/passwd").is_none());
        assert!(fetchable_url("javascript:alert(1)").is_none());
        assert!(fetchable_url("https://user:pass@example.com/").is_none());
        assert!(fetchable_url("https://example.com/a b").is_none());
        assert!(fetchable_url("").is_none());
        assert!(fetchable_url("https://").is_none());
    }
}
