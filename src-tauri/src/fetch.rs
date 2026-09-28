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
/// Largest page kept (bytes of HTML head; the text cap lives in the
/// frontend). Pages past the cap truncate — the tool contract
/// promises "truncated when long", so a big page still answers from
/// its head instead of failing.
const MAX_HTML_BYTES: usize = 512 * 1024;

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

/// Transport failure to its machine code: timeouts read as
/// `timeout` (send-time and mid-stream alike), everything else as
/// `failed`.
fn transport_code(error: &reqwest::Error) -> String {
    (if error.is_timeout() {
        "timeout"
    } else {
        "failed"
    })
    .to_string()
}

/// Bytes kept to page text: a truncated head decodes lossily (the cut
/// may split a char — a replacement mark beats an error when the head
/// is otherwise readable), while a whole page keeps the strict decode
/// (genuinely broken encodings still fail loudly). Pure.
fn decode_head(taken: Vec<u8>, truncated: bool) -> Result<String, String> {
    if truncated {
        Ok(String::from_utf8_lossy(&taken).into_owned())
    } else {
        String::from_utf8(taken).map_err(|_| "bad-encoding".into())
    }
}

/// One page of HTML (bounded), or a short machine code the frontend
/// maps to its one-sentence copy (`timeout`, `bad-status`, `bad-url`,
/// `bad-encoding`, `failed`).
#[tauri::command]
pub async fn fetch_page(url: String) -> Result<String, String> {
    let url = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .user_agent("ccez-llm page fetch")
        .build()
        .map_err(|_| "failed".to_string())?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| transport_code(&e))?;
    if !res.status().is_success() {
        return Err("bad-status".into());
    }
    // Capped read: large pages truncate to the head instead of
    // failing, so a big demographics page still answers from its
    // first bytes (the frontend cleans and caps the text anyway).
    let mut taken: Vec<u8> = Vec::new();
    let mut truncated = false;
    loop {
        if taken.len() >= MAX_HTML_BYTES {
            // At the cap: one more chunk decides truncated vs exact
            // end (an exact end still decodes strictly below).
            match res.chunk().await.map_err(|e| transport_code(&e))? {
                Some(rest) if !rest.is_empty() => truncated = true,
                _ => {}
            }
            break;
        }
        match res.chunk().await.map_err(|e| transport_code(&e))? {
            Some(bytes) => {
                let room = MAX_HTML_BYTES - taken.len();
                taken.extend_from_slice(&bytes[..bytes.len().min(room)]);
            }
            None => break,
        }
    }
    decode_head(taken, truncated)
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

    #[test]
    fn decode_head_truncates_lossy_but_decodes_whole_pages_strictly() {
        // Truncated mid-char (the head ends inside é): a lossy head
        // with a replacement mark, never an error.
        assert_eq!(
            decode_head(vec![0x68, 0x69, 0xC3], true).unwrap(),
            "hi\u{FFFD}"
        );
        // Whole pages keep the strict decode: clean text passes,
        // broken encodings still fail loudly.
        assert_eq!(decode_head(b"hi".to_vec(), false).unwrap(), "hi");
        assert_eq!(
            decode_head(vec![0xFF], false).unwrap_err(),
            "bad-encoding"
        );
    }
}
