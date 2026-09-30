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
/// Browser user agent for the Android leg (which doesn't
/// impersonate — see below): bot-labeled fetches eat WAF denials
/// (Akamai, DataDome) on major outlets, and this is the user's own
/// device reading pages they tapped — reader convention. Off
/// Android the impersonation profile sets its own matching UA.
#[cfg(any(test, target_os = "android"))]
const PAGE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// The URL back when fetchable, `None` when not. Mirrors
/// `validFetchUrl` in the frontend seam (both stay dumb string gates).
pub(crate) fn fetchable_url(url: &str) -> Option<&str> {
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
pub(crate) fn transport_code(error: &reqwest::Error) -> String {
    (if error.is_timeout() {
        "timeout"
    } else {
        "failed"
    })
    .to_string()
}

/// Same mapping for the impersonating client (off Android only).
#[cfg(not(target_os = "android"))]
fn impersonated_transport_code(error: &rquest::Error) -> String {
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

/// Non-2xx status into its machine code. The code rides along
/// (`bad-status:403`) so the frontend can tell a standing wall from
/// a quota blip; the copy matcher only reads the prefix. Takes the
/// bare code because the two HTTP stacks type statuses differently.
/// Pure.
pub(crate) fn bad_status(code: u16) -> String {
    format!("bad-status:{code}")
}

/// Capped read of one response body: large pages truncate to the
/// head instead of failing, so a big page still answers from its
/// first bytes (the frontend cleans and caps the text anyway). The
/// two fetch legs share everything below the client.
macro_rules! capped_body {
    ($res:expr, $code:ident) => {{
        let mut taken: Vec<u8> = Vec::new();
        let mut truncated = false;
        loop {
            if taken.len() >= MAX_HTML_BYTES {
                // At the cap: one more chunk decides truncated vs
                // exact end (an exact end still decodes strictly).
                match $res.chunk().await.map_err(|e| $code(&e))? {
                    Some(rest) if !rest.is_empty() => truncated = true,
                    _ => {}
                }
                break;
            }
            match $res.chunk().await.map_err(|e| $code(&e))? {
                Some(bytes) => {
                    let room = MAX_HTML_BYTES - taken.len();
                    if bytes.len() > room {
                        // The chunk straddles the cap: its tail is
                        // dropped, so the head is truncated even when
                        // no further chunk arrives to say so.
                        truncated = true;
                    }
                    taken.extend_from_slice(&bytes[..bytes.len().min(room)]);
                }
                None => break,
            }
        }
        decode_head(taken, truncated)
    }};
}

/// One page of HTML (bounded), or a short machine code the frontend
/// maps to its one-sentence copy (`timeout`, `bad-status`, `bad-url`,
/// `bad-encoding`, `failed`). The client impersonates Safari 17.5
/// (TLS + HTTP/2 fingerprints plus the profile's own UA — verified
/// live against Akamai-fronted outlets, where the Chrome profile
/// still eats 403s), so WAF-fronted outlets answer the same reader
/// they'd serve in a browser.
#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn fetch_page(url: String) -> Result<String, String> {
    let url = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?;
    let client = rquest::Client::builder()
        .impersonate(rquest::impersonate::Impersonate::Safari17_5)
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|_| "failed".to_string())?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| impersonated_transport_code(&e))?;
    if !res.status().is_success() {
        return Err(bad_status(res.status().as_u16()));
    }
    capped_body!(res, impersonated_transport_code)
}

/// Android leg of `fetch_page`: plain reqwest, no impersonation
/// (boring-sys has no verified NDK cross-compile from here).
/// Same contract, same codes — WAF-fronted outlets just answer it
/// with denials, and the frontend falls back from there.
#[tauri::command]
#[cfg(target_os = "android")]
pub async fn fetch_page(url: String) -> Result<String, String> {
    let url = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .user_agent(PAGE_USER_AGENT)
        .build()
        .map_err(|_| "failed".to_string())?;
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| transport_code(&e))?;
    if !res.status().is_success() {
        return Err(bad_status(res.status().as_u16()));
    }
    capped_body!(res, transport_code)
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
    fn android_leg_ships_a_browser_user_agent() {
        // Bot-labeled UAs eat WAF denials on major outlets; the
        // non-impersonating Android leg must still look like the
        // reader it is (off Android the profile sets its own UA).
        assert!(PAGE_USER_AGENT.starts_with("Mozilla/5.0"));
        assert!(PAGE_USER_AGENT.contains("Chrome/"));
        assert!(!PAGE_USER_AGENT.contains("ccez"));
    }

    #[test]
    fn bad_status_carries_its_code() {
        assert_eq!(bad_status(403), "bad-status:403");
        assert_eq!(bad_status(429), "bad-status:429");
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

    struct StubErr;

    fn stub_code(_: &StubErr) -> String {
        "failed".to_string()
    }

    /// Stand-in response body: canned chunks, no network.
    struct ChunkStub {
        parts: std::collections::VecDeque<Vec<u8>>,
    }

    impl ChunkStub {
        async fn chunk(&mut self) -> Result<Option<Vec<u8>>, StubErr> {
            Ok(self.parts.pop_front())
        }
    }

    fn read_body(parts: Vec<Vec<u8>>) -> Result<String, String> {
        let mut res = ChunkStub {
            parts: parts.into(),
        };
        tauri::async_runtime::block_on(async { capped_body!(res, stub_code) })
    }

    #[test]
    fn capped_body_decodes_small_pages_strictly() {
        assert_eq!(read_body(vec![b"hi".to_vec()]).unwrap(), "hi");
        assert_eq!(read_body(vec![vec![0xFF]]).unwrap_err(), "bad-encoding");
    }

    #[test]
    fn capped_body_decodes_cap_exact_pages_strictly() {
        // The head ends exactly at the cap with nothing after: the
        // probe chunk reads end-of-stream, so the page is whole.
        let out = read_body(vec![vec![b'a'; MAX_HTML_BYTES]]).unwrap();
        assert_eq!(out.len(), MAX_HTML_BYTES);
        assert!(out.bytes().all(|b| b == b'a'));
    }

    #[test]
    fn capped_body_truncates_over_cap_pages_lossily() {
        // One byte past the cap, ending the head mid-char: truncation
        // decodes lossily (replacement mark) instead of failing.
        let out = read_body(vec![vec![b'a'; MAX_HTML_BYTES - 1], vec![0xC3], vec![0xA9]]).unwrap();
        assert_eq!(out, format!("{}\u{FFFD}", "a".repeat(MAX_HTML_BYTES - 1)));
    }

    #[test]
    fn capped_body_counts_a_straddling_chunk_as_truncated() {
        // The last chunk straddles the cap (its tail is dropped with
        // no further chunk after): still truncated, still lossy —
        // never a strict-decode failure on a dropped tail.
        let out = read_body(vec![vec![b'a'; MAX_HTML_BYTES - 1], vec![0xC3, 0xA9]]).unwrap();
        assert_eq!(out, format!("{}\u{FFFD}", "a".repeat(MAX_HTML_BYTES - 1)));
    }
}
