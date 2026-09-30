//! Model-driven page fetch (`fetch_page` command, the executor behind
//! the chat `fetch_url` tool).
//!
//! Thin by design: GET with a timeout, a per-fetch cookie jar, and a
//! byte cap, http/https only, no credentialed URLs. Consent shells get
//! one plain retry, legacy charsets transcode. Returns the raw HTML (bounded); the frontend
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

/// `charset` out of a Content-Type header value (`text/html;
/// charset=windows-1250`), quotes stripped. Pure.
fn charset_from_content_type(value: &str) -> Option<&str> {
    value.split(';').find_map(|part| {
        let (name, label) = part.split_once('=')?;
        if !name.trim().eq_ignore_ascii_case("charset") {
            return None;
        }
        let label = label.trim().trim_matches('"').trim();
        if label.is_empty() {
            None
        } else {
            Some(label)
        }
    })
}

/// Bytes kept to page text: a declared legacy charset transcodes
/// (Mafra serves windows-1250 — strict UTF-8 would fail real
/// pages); otherwise a truncated head decodes lossily (the cut may
/// split a char — a replacement mark beats an error when the head is
/// otherwise readable), while a whole page keeps the strict decode
/// (genuinely broken encodings still fail loudly). Pure.
fn decode_head(taken: Vec<u8>, truncated: bool, charset: Option<&str>) -> Result<String, String> {
    if let Some(label) = charset {
        let lower = label.trim().to_ascii_lowercase();
        if lower != "utf-8" && lower != "utf8" {
            if let Some(enc) = encoding_rs::Encoding::for_label(label.trim().as_bytes()) {
                let (text, _, _) = enc.decode(&taken);
                return Ok(text.into_owned());
            }
        }
    }
    if truncated {
        Ok(String::from_utf8_lossy(&taken).into_owned())
    } else {
        String::from_utf8(taken).map_err(|_| "bad-encoding".into())
    }
}

/// Consent shell sniff: some consent walls (Seznam/Novinky) serve a
/// shell page to browser fingerprints while plain clients get the
/// article, so a consent-titled body is worth one plain retry. Title
/// only — a miss just costs one extra fetch, never a wrong page.
/// Pure.
fn looks_like_consent_shell(html: &str) -> bool {
    html.find("<title>")
        .and_then(|i| {
            html[i + 7..]
                .find("</title>")
                .map(|j| html[i + 7..i + 7 + j].to_ascii_lowercase())
        })
        .map(|t| t.contains("souhlas") || t.contains("consent"))
        .unwrap_or(false)
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
    ($res:expr, $code:ident, $charset:expr) => {{
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
        decode_head(taken, truncated, $charset)
    }};
}

/// One page of HTML (bounded), or a short machine code the frontend
/// maps to its one-sentence copy (`timeout`, `bad-status`, `bad-url`,
/// `bad-encoding`, `failed`). The client impersonates Safari 17.5
/// (TLS + HTTP/2 fingerprints plus the profile's own UA — verified
/// live against Akamai-fronted outlets, where the Chrome profile
/// still eats 403s), so WAF-fronted outlets answer the same reader
/// they'd serve in a browser.
/// One GET through a built rquest client: status gate, capped
/// body, legacy charsets transcoded. The impersonated first try and
/// the plain consent retry share it.
#[cfg(not(target_os = "android"))]
async fn send_capped(client: &rquest::Client, url: &str) -> Result<String, String> {
    let mut res = client
        .get(url)
        .send()
        .await
        .map_err(|e| impersonated_transport_code(&e))?;
    if !res.status().is_success() {
        return Err(bad_status(res.status().as_u16()));
    }
    let charset = res
        .headers()
        .get(rquest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(charset_from_content_type)
        .map(str::to_owned);
    capped_body!(res, impersonated_transport_code, charset.as_deref())
}

/// Plain-client second try for consent shells (see
/// `looks_like_consent_shell`). Whatever it returns stands — no
/// third try.
#[cfg(not(target_os = "android"))]
async fn fetch_plain(url: &str) -> Result<String, String> {
    let client = rquest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|_| "failed".to_string())?;
    send_capped(&client, url).await
}

#[tauri::command]
#[cfg(not(target_os = "android"))]
pub async fn fetch_page(url: String) -> Result<String, String> {
    let url = fetchable_url(&url).ok_or_else(|| "bad-url".to_string())?;
    let client = rquest::Client::builder()
        .impersonate(rquest::impersonate::Impersonate::Safari17_5)
        // Anonymous-ID dances (Québecor, Tamedia) 307-loop without a
        // jar; it lives for this fetch only and is dropped after.
        .cookie_store(true)
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|_| "failed".to_string())?;
    let html = send_capped(&client, url).await?;
    if looks_like_consent_shell(&html) {
        return fetch_plain(url).await;
    }
    Ok(html)
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
        // Same anonymous-ID dances as the main leg (see above).
        .cookie_store(true)
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
    let charset = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(charset_from_content_type)
        .map(str::to_owned);
    capped_body!(res, transport_code, charset.as_deref())
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
            decode_head(vec![0x68, 0x69, 0xC3], true, None).unwrap(),
            "hi\u{FFFD}"
        );
        // Whole pages keep the strict decode: clean text passes,
        // broken encodings still fail loudly.
        assert_eq!(decode_head(b"hi".to_vec(), false, None).unwrap(), "hi");
        assert_eq!(
            decode_head(vec![0xFF], false, None).unwrap_err(),
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
        tauri::async_runtime::block_on(async { capped_body!(res, stub_code, None) })
    }

    /// Local cookie dance: `/` 307-loops through `/cb` (which sets
    /// the cookie) until the cookie comes back — the Québecor/Tamedia
    /// anonymous-ID shape. `fetch_page` must complete it: no jar, no
    /// content. Loopback-only, ephemeral port, no outside network.
    #[test]
    fn fetch_page_completes_a_cookie_dance() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        fn respond(mut stream: std::net::TcpStream, deadline: std::time::Instant) -> bool {
            // Accepted sockets inherit nonblocking: restore blocking so reads wait for bytes.
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut raw = vec![0u8; 1024];
            let mut head = Vec::new();
            loop {
                match stream.read(&mut raw) {
                    Ok(0) => break,
                    Ok(n) => {
                        head.extend_from_slice(&raw[..n]);
                        if head.windows(4).any(|w| w == b"\r\n\r\n") || head.len() > 8192 {
                            break;
                        }
                    }
                    Err(e)
                        if matches!(
                            e.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                        ) && std::time::Instant::now() < deadline =>
                    {
                        continue;
                    }
                    Err(_) => break,
                }
            }
            let head = String::from_utf8_lossy(&head);
            let target = head.lines().next().unwrap_or("");
            let jarred = head.to_ascii_lowercase().contains("cookie:");
            let response = if target.starts_with("GET /cb") {
                "HTTP/1.1 307 Temporary Redirect\r\nlocation: /\r\nset-cookie: anon=1; Path=/\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
            } else if target.starts_with("GET / ") && jarred {
                "HTTP/1.1 200 OK\r\nconnection: close\r\ncontent-length: 6\r\n\r\ndanced"
            } else if target.starts_with("GET / ") {
                "HTTP/1.1 307 Temporary Redirect\r\nlocation: /cb\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
            } else {
                "HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n"
            };
            let done = response.starts_with("HTTP/1.1 200");
            let _ = stream.write_all(response.as_bytes());
            done
        }

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            // Progress deadlines, not a spawn deadline: a loaded
            // machine may stall the test thread before the dance
            // starts (that flaked a fixed 10s clock), so the clock
            // starts at first accept and refreshes per request.
            let spawned = std::time::Instant::now();
            let mut progress: Option<std::time::Instant> = None;
            loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let deadline = std::time::Instant::now() + Duration::from_secs(15);
                        progress = Some(deadline);
                        if respond(stream, deadline) {
                            break;
                        }
                    }
                    Err(_) => {
                        let now = std::time::Instant::now();
                        let stalled = progress.map_or(false, |d| now > d);
                        let never_started = now.duration_since(spawned) > Duration::from_secs(30);
                        if stalled || never_started {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        });
        let out = tauri::async_runtime::block_on(fetch_page(format!("http://{addr}/")));
        let _ = server.join();
        assert_eq!(out.unwrap(), "danced");
    }

    #[test]
    fn charset_from_content_type_reads_the_label() {
        assert_eq!(
            charset_from_content_type("text/html; charset=windows-1250"),
            Some("windows-1250")
        );
        assert_eq!(
            charset_from_content_type("text/html; charset=\"utf-8\""),
            Some("utf-8")
        );
        assert_eq!(
            charset_from_content_type("text/html; Charset=ISO-8859-2 "),
            Some("ISO-8859-2")
        );
        assert_eq!(charset_from_content_type("text/html"), None);
        assert_eq!(charset_from_content_type("text/html; charset="), None);
    }

    #[test]
    fn decode_head_transcodes_declared_legacy_charsets() {
        // windows-1250 "Příliš" is not valid UTF-8: the declared
        // label transcodes it instead of failing.
        let (bytes, _, _) = encoding_rs::WINDOWS_1250.encode("Příliš");
        assert_eq!(
            decode_head(bytes.into_owned(), false, Some("windows-1250")).unwrap(),
            "Příliš"
        );
        // UTF-8 labels and unknown labels keep the strict path.
        assert_eq!(
            decode_head(vec![0xFF], false, Some("utf-8")).unwrap_err(),
            "bad-encoding"
        );
        assert_eq!(
            decode_head(vec![0xFF], false, Some("x-unknown")).unwrap_err(),
            "bad-encoding"
        );
    }

    #[test]
    fn looks_like_consent_shell_reads_the_title() {
        assert!(looks_like_consent_shell(
            "<html><head><title>Nastavení souhlasu s personalizací</title></head></html>"
        ));
        assert!(looks_like_consent_shell(
            "<title>Cookie consent settings</title>"
        ));
        assert!(!looks_like_consent_shell(
            "<title>Minus 79 haléřů. Vláda oznámila</title>"
        ));
        assert!(!looks_like_consent_shell("<title></title>"));
        assert!(!looks_like_consent_shell("no title here"));
    }

    /// Stub outlet for the fallback tests: `/consent` serves a
    /// consent shell to browser fingerprints and the article
    /// otherwise (the Seznam shape); `/win` serves windows-1250
    /// bytes under a 1250 header (the Mafra shape). Loopback-only,
    /// ephemeral port, no outside network.
    fn spawn_outlet_stub() -> (std::net::SocketAddr, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        const STUB: &str = "<html><head><title>Nastavení souhlasu s personalizací</title></head><body>wall</body></html>";
        const ARTICLE: &str = "<html><head><title>Real story</title><meta property=\"og:image\" content=\"http://x/y.jpg\"></head><body>story</body></html>";

        fn respond(mut stream: std::net::TcpStream, deadline: std::time::Instant) -> bool {
            // Accepted sockets inherit nonblocking: restore blocking so reads wait for bytes.
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut raw = vec![0u8; 1024];
            let mut head = Vec::new();
            loop {
                match stream.read(&mut raw) {
                    Ok(0) => break,
                    Ok(n) => {
                        head.extend_from_slice(&raw[..n]);
                        if head.windows(4).any(|w| w == b"\r\n\r\n") || head.len() > 8192 {
                            break;
                        }
                    }
                    Err(e)
                        if matches!(
                            e.kind(),
                            std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted
                        ) && std::time::Instant::now() < deadline =>
                    {
                        continue;
                    }
                    Err(_) => break,
                }
            }
            let head = String::from_utf8_lossy(&head);
            let lower = head.to_ascii_lowercase();
            let target = head.lines().next().unwrap_or("");
            let mut response = Vec::new();
            let mut done = false;
            if target.starts_with("GET /consent") {
                let browser = lower.contains("safari") && lower.contains("version/");
                let body = if browser { STUB } else { ARTICLE };
                done = !browser;
                response.extend_from_slice(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                );
                response.extend_from_slice(body.as_bytes());
            } else if target.starts_with("GET /win") {
                let text =
                    "<html><head><title>Kůň</title></head><body>Příliš žluťoučký kůň</body></html>";
                let (body, _, _) = encoding_rs::WINDOWS_1250.encode(text);
                done = true;
                response.extend_from_slice(
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=windows-1250\r\nconnection: close\r\ncontent-length: {}\r\n\r\n",
                        body.len()
                    )
                    .as_bytes(),
                );
                response.extend_from_slice(&body);
            } else {
                response.extend_from_slice(
                    b"HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n",
                );
            }
            let _ = stream.write_all(&response);
            done
        }

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let spawned = std::time::Instant::now();
            let mut progress: Option<std::time::Instant> = None;
            loop {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let deadline = std::time::Instant::now() + Duration::from_secs(15);
                        progress = Some(deadline);
                        if respond(stream, deadline) {
                            break;
                        }
                    }
                    Err(_) => {
                        let now = std::time::Instant::now();
                        let stalled = progress.map_or(false, |d| now > d);
                        let never_started = now.duration_since(spawned) > Duration::from_secs(30);
                        if stalled || never_started {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                }
            }
        });
        (addr, server)
    }

    #[test]
    fn fetch_page_retries_consent_shells_plain() {
        let (addr, server) = spawn_outlet_stub();
        let out = tauri::async_runtime::block_on(fetch_page(format!("http://{addr}/consent")));
        let _ = server.join();
        let html = out.unwrap();
        assert!(
            html.contains("Real story"),
            "stuck on the consent shell: {html}"
        );
    }

    #[test]
    fn fetch_page_transcodes_legacy_charsets() {
        let (addr, server) = spawn_outlet_stub();
        let out = tauri::async_runtime::block_on(fetch_page(format!("http://{addr}/win")));
        let _ = server.join();
        assert_eq!(
            out.unwrap(),
            "<html><head><title>Kůň</title></head><body>Příliš žluťoučký kůň</body></html>"
        );
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
