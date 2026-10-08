//! `ccez-listen serve`: the drill backend over HTTP, for the phone
//! and the web build (the desktop shell calls the library directly).
//!
//! Private by placement: bind it to loopback and publish it to the
//! tailnet only (`tailscale serve`), never to the internet. Browsers
//! are held to the app's own origins.
//!
//! ```text
//! ccez-listen serve [--addr 127.0.0.1:8797] [--cache DIR]
//! ```

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Arc;

use ccez_listen::Listen;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "https://llm.ccez.uk",
    "http://localhost:5200",
    "http://127.0.0.1:5200",
];

fn header(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).expect("ascii header")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 2;
                    }
                    None => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query(url: &str) -> (String, Vec<(String, String)>) {
    let (path, q) = url.split_once('?').unwrap_or((url, ""));
    let pairs = q
        .split('&')
        .filter(|p| !p.is_empty())
        .map(|p| {
            let (k, v) = p.split_once('=').unwrap_or((p, ""));
            (percent_decode(k), percent_decode(v))
        })
        .collect();
    (path.to_string(), pairs)
}

fn param<'a>(pairs: &'a [(String, String)], key: &str) -> &'a str {
    pairs
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.as_str())
        .unwrap_or("")
}

/// `bytes=a-b` → inclusive range within `len`.
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        return Some((len.saturating_sub(n), len - 1));
    }
    let start: u64 = a.parse().ok()?;
    let end = if b.is_empty() {
        len - 1
    } else {
        b.parse::<u64>().ok()?.min(len - 1)
    };
    (start <= end).then_some((start, end))
}

fn json_response(status: u16, body: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(body.into_bytes())
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", "application/json; charset=utf-8"))
}

fn error_status(e: &str) -> u16 {
    if e.starts_with("listen-bad") {
        400
    } else if e.starts_with("listen-no-track") || e.starts_with("listen-no-captions") {
        404
    } else {
        502
    }
}

fn handle(listen: &Listen, req: Request) {
    let origin = req
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str().to_string());
    // A browser page from anywhere else gets nothing; native clients
    // (no Origin) and the app's own origins pass.
    if let Some(o) = &origin {
        if !ORIGINS.contains(&o.as_str()) {
            let _ = req.respond(json_response(403, r#"{"error":"listen-origin"}"#.into()));
            return;
        }
    }
    let cors = |r: Response<_>| -> Response<_> {
        match &origin {
            Some(o) => r
                .with_header(header("Access-Control-Allow-Origin", o))
                .with_header(header("Vary", "Origin"))
                .with_header(header(
                    "Access-Control-Expose-Headers",
                    "Content-Range, Content-Length",
                )),
            None => r,
        }
    };
    if *req.method() == Method::Options {
        let r = cors(Response::from_data(Vec::new()).with_status_code(StatusCode(204)))
            .with_header(header("Access-Control-Allow-Methods", "GET, OPTIONS"))
            .with_header(header("Access-Control-Allow-Headers", "Range"))
            .with_header(header("Access-Control-Max-Age", "86400"));
        let _ = req.respond(r);
        return;
    }
    if *req.method() != Method::Get {
        let _ = req.respond(cors(json_response(405, r#"{"error":"method"}"#.into())));
        return;
    }
    let (path, q) = query(req.url());
    let lang = param(&q, "lang");
    let to_json = |r: Result<String, String>| match r {
        Ok(body) => json_response(200, body),
        Err(e) => json_response(
            error_status(&e),
            serde_json::json!({ "error": e }).to_string(),
        ),
    };
    let ser = |v: serde_json::Result<String>| v.map_err(|e| e.to_string());
    let response = match path.as_str() {
        "/v1/health" => json_response(
            200,
            serde_json::json!({
                "ok": true,
                "ytdlp": ccez_listen::ytdlp::find_tool("yt-dlp").is_some(),
            })
            .to_string(),
        ),
        "/v1/search" => {
            let limit = param(&q, "limit").parse().unwrap_or(12);
            to_json(
                listen
                    .search(param(&q, "q"), param(&q, "kind"), limit)
                    .and_then(|v| ser(serde_json::to_string(&v))),
            )
        }
        "/v1/channel" => {
            let limit = param(&q, "limit").parse().unwrap_or(15);
            to_json(
                listen
                    .channel(param(&q, "ref"), limit)
                    .and_then(|v| ser(serde_json::to_string(&v))),
            )
        }
        "/v1/videos" => {
            let ids: Vec<String> = param(&q, "ids").split(',').map(str::to_string).collect();
            to_json(ser(serde_json::to_string(&listen.videos(&ids, lang))))
        }
        "/v1/fetch" => to_json(
            listen
                .fetch(param(&q, "id"), lang)
                .and_then(|v| ser(serde_json::to_string(&v))),
        ),
        "/v1/audio" => {
            let range = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Range"))
                .map(|h| h.value.as_str().to_string());
            match listen.fetch(param(&q, "id"), lang) {
                Ok(f) => {
                    let _ = req.respond(cors(audio_response(&f.audio_path, &f.audio_mime, range)));
                    return;
                }
                Err(e) => to_json(Err(e)),
            }
        }
        _ => json_response(404, r#"{"error":"not-found"}"#.into()),
    };
    let _ = req.respond(cors(response));
}

fn audio_response(
    path: &std::path::Path,
    mime: &str,
    range: Option<String>,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let Ok(mut file) = File::open(path) else {
        return json_response(404, r#"{"error":"listen-no-track"}"#.into());
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let (start, end, status) = match range.as_deref().and_then(|r| parse_range(r, len)) {
        Some((a, b)) => (a, b, 206),
        None => (0, len.saturating_sub(1), 200),
    };
    let mut buf = vec![0u8; (end + 1 - start) as usize];
    if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
        return json_response(500, r#"{"error":"read"}"#.into());
    }
    let mut r = Response::from_data(buf)
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", mime))
        .with_header(header("Accept-Ranges", "bytes"))
        .with_header(header("Cache-Control", "private, max-age=86400"));
    if status == 206 {
        r = r.with_header(header(
            "Content-Range",
            &format!("bytes {start}-{end}/{len}"),
        ));
    }
    r
}

fn default_cache() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| ".".into());
    if cfg!(target_os = "macos") {
        home.join("Library/Caches/ccez-listen")
    } else {
        std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".cache"))
            .join("ccez-listen")
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("serve") {
        eprintln!("usage: ccez-listen serve [--addr 127.0.0.1:8797] [--cache DIR]");
        std::process::exit(2);
    }
    let mut addr = "127.0.0.1:8797".to_string();
    let mut cache = default_cache();
    let mut it = args.iter().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--addr" => addr = it.next().cloned().unwrap_or(addr),
            "--cache" => cache = it.next().map(PathBuf::from).unwrap_or(cache),
            other => {
                eprintln!("unknown argument {other}");
                std::process::exit(2);
            }
        }
    }
    let server = Server::http(&addr).unwrap_or_else(|e| {
        eprintln!("ccez-listen: can't bind {addr}: {e}");
        std::process::exit(1);
    });
    eprintln!(
        "ccez-listen: serving on http://{addr}, cache {}",
        cache.display()
    );
    let listen = Arc::new(Listen::new(cache));
    for req in server.incoming_requests() {
        let listen = Arc::clone(&listen);
        std::thread::spawn(move || handle(&listen, req));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_clamp_to_the_file() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=990-5000", 1000), Some((990, 999)));
        assert_eq!(parse_range("bytes=5-1", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn queries_decode() {
        let (path, q) = query("/v1/search?q=David+Pakman%20show&kind=channel");
        assert_eq!(path, "/v1/search");
        assert_eq!(param(&q, "q"), "David Pakman show");
        assert_eq!(param(&q, "kind"), "channel");
        assert_eq!(param(&q, "missing"), "");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%C3%A9t%C3%A9"), "été");
    }
}
