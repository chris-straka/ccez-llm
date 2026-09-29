//! Google News link decoder (`news_decode_url` command).
//!
//! RSS story links are opaque signed redirects
//! (`/rss/articles/{id}`): the publisher URL needs the documented
//! two-step (protocol after ssujitx/google-news-url-decoder,
//! re-verified live 2026-09-29): fetch the article page for its
//! per-fetch signature (`data-n-a-sg`/`data-n-a-ts`, sitting near
//! the END of ~600KB of markup — past `fetch_page`'s truncation
//! cap, hence this command), then one `batchexecute` POST with the
//! `garturlreq` envelope. Returns the publisher URL. Compiled
//! everywhere; only invoked from the shell.

use std::time::Duration;

use crate::fetch::{fetchable_url, transport_code};

const NEWS_TIMEOUT_SECS: u64 = 20;
/// Params page head kept: ~600KB of shell markup today, with room.
const MAX_PARAMS_BYTES: usize = 1024 * 1024;
const BATCHEXECUTE_URL: &str =
    "https://news.google.com/_/DotsSplashUi/data/batchexecute";

/// Article id out of a Google News URL (`/read/`, `/articles/`, or
/// `/rss/articles/`). Pure.
fn article_id(link: &str) -> Option<String> {
    let after_scheme = link.split("://").nth(1)?;
    let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
    if &after_scheme[..host_end] != "news.google.com" {
        return None;
    }
    let path = after_scheme[host_end..].split('?').next().unwrap_or("");
    let mut segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.len() < 2 {
        return None;
    }
    let id = segs.pop()?;
    let kind = segs.pop()?;
    if kind != "articles" && kind != "read" {
        return None;
    }
    if id.is_empty() {
        return None;
    }
    Some(id.to_string())
}

/// Params-page URL for one id. Locale stays at the US defaults:
/// RSS links never carry `hl`/`gl` (only `?oc=5`), and a
/// correctly-shaped request with a foreign-locale signature still
/// decodes to null — verified live, twice.
fn params_page_url(art_id: &str) -> String {
    format!(
        "https://news.google.com/rss/articles/{art_id}?hl=en-US&gl=US&ceid=US%3Aen"
    )
}

/// Percent-encode a form value exactly like the reference decoder
/// (Python `quote` with `/` safe): unreserved bytes plus `/` stay,
/// the rest go `%XX` uppercase. Pure.
fn percent_encode(input: &str) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~/";
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        if UNRESERVED.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// One-id `f.req=...` POST body. The triple-nested envelope plus
/// the opaque context tuple are byte-pinned below against the
/// reference implementation's own builder — hand-copying this
/// constant wrong yields plausible 200s with null payloads. Pure.
fn batchexecute_body(art_id: &str, ts: &str, sig: &str) -> String {
    let ctx = serde_json::json!([
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0
    ]);
    let ts_value: serde_json::Value = match ts.parse::<i64>() {
        Ok(n) => n.into(),
        Err(_) => ts.into(),
    };
    let inner = serde_json::json!(["garturlreq", ctx, art_id, ts_value, sig]);
    let inner_text =
        serde_json::to_string(&inner).unwrap_or_else(|_| String::new());
    let envelope = serde_json::json!([[["Fbv4je", inner_text, null, "0"]]]);
    let text = serde_json::to_string(&envelope).unwrap_or_else(|_| String::new());
    format!("f.req={}", percent_encode(&text))
}

/// `data-n-a-sg`/`data-n-a-ts` out of a params page (single
/// occurrence, verified live). Pure.
fn parse_signature(html: &str) -> Option<(String, String)> {
    fn attr(html: &str, name: &str) -> Option<String> {
        let key = format!("{name}=\"");
        let start = html.find(&key)? + key.len();
        let end = html[start..].find('"')?;
        Some(html[start..start + end].to_string())
    }
    let sg = attr(html, "data-n-a-sg")?;
    let ts = attr(html, "data-n-a-ts")?;
    if sg.is_empty() || ts.is_empty() {
        return None;
    }
    Some((sg, ts))
}

/// Publisher URL out of a `batchexecute` response: skip the `)]}'`
/// prefix, take the first `Fbv4je` row whose payload unwraps to a
/// `garturlres` pair. Rows reorder and null rows trail — both are
/// normal, not errors. Pure.
fn parse_batchexecute(text: &str) -> Option<String> {
    let start = text.find('[')?;
    let rows: Vec<serde_json::Value> = serde_json::from_str(&text[start..]).ok()?;
    for row in rows {
        let cells = match row.as_array() {
            Some(cells) => cells,
            None => continue,
        };
        let head = cells.first().and_then(|v| v.as_str()).unwrap_or("");
        let rpc = cells.get(1).and_then(|v| v.as_str()).unwrap_or("");
        if head != "wrb.fr" && rpc != "Fbv4je" {
            continue;
        }
        let payload = match cells.get(2) {
            Some(payload) => payload,
            None => continue,
        };
        let inner: Vec<serde_json::Value> = match payload {
            serde_json::Value::String(s) => match serde_json::from_str(s) {
                Ok(inner) => inner,
                Err(_) => continue,
            },
            serde_json::Value::Array(items) => items.clone(),
            _ => continue,
        };
        if inner.first().and_then(|v| v.as_str()) != Some("garturlres") {
            continue;
        }
        if let Some(url) = inner.get(1).and_then(|v| v.as_str()) {
            return Some(url.to_string());
        }
    }
    None
}

/// One Google News link into its publisher URL, or a short machine
/// code (`bad-url`, `timeout`, `bad-status`, `no-signature`,
/// `no-decoded-url`, `failed`).
#[tauri::command]
pub async fn news_decode_url(link: String) -> Result<String, String> {
    if fetchable_url(&link).is_none() {
        return Err("bad-url".into());
    }
    let art_id = article_id(&link).ok_or_else(|| "bad-url".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(NEWS_TIMEOUT_SECS))
        .build()
        .map_err(|_| "failed".to_string())?;
    let page = client
        .get(params_page_url(&art_id))
        .send()
        .await
        .map_err(|e| transport_code(&e))?;
    if !page.status().is_success() {
        return Err("bad-status".into());
    }
    let html = page.text().await.map_err(|e| transport_code(&e))?;
    if html.len() > MAX_PARAMS_BYTES {
        return Err("too-large".into());
    }
    let (sig, ts) = parse_signature(&html).ok_or_else(|| "no-signature".to_string())?;
    let res = client
        .post(BATCHEXECUTE_URL)
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=UTF-8",
        )
        .body(batchexecute_body(&art_id, &ts, &sig))
        .send()
        .await
        .map_err(|e| transport_code(&e))?;
    if !res.status().is_success() {
        return Err("bad-status".into());
    }
    let text = res.text().await.map_err(|e| transport_code(&e))?;
    parse_batchexecute(&text).ok_or_else(|| "no-decoded-url".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn article_id_reads_all_three_url_shapes() {
        assert_eq!(
            article_id("https://news.google.com/rss/articles/CBMabc?oc=5").as_deref(),
            Some("CBMabc")
        );
        assert_eq!(
            article_id("https://news.google.com/articles/CBMabc").as_deref(),
            Some("CBMabc")
        );
        assert_eq!(
            article_id("https://news.google.com/read/CBMabc?hl=en-US").as_deref(),
            Some("CBMabc")
        );
        assert!(article_id("https://example.com/rss/articles/CBMabc").is_none());
        assert!(article_id("https://news.google.com/rss/CBMabc").is_none());
        assert!(article_id("https://news.google.com/rss/articles/").is_none());
        assert!(article_id("not a url").is_none());
    }

    #[test]
    fn params_page_url_pins_us_defaults() {
        assert_eq!(
            params_page_url("CBMabc"),
            "https://news.google.com/rss/articles/CBMabc?hl=en-US&gl=US&ceid=US%3Aen"
        );
    }

    #[test]
    fn batchexecute_body_matches_the_reference_builder_byte_for_byte() {
        // Expected bytes generated by the reference implementation's
        // own builder (build_batchexecute_body([("0", "ARTID",
        // "1790714349", "SGVAL")])) — the independent oracle, never
        // hand-copied.
        let expected = "f.req=%5B%5B%5B%22Fbv4je%22%2C%22%5B%5C%22garturlreq%5C%22%2C%5B%5B%5C%22X%5C%22%2C%5C%22X%5C%22%2C%5B%5C%22X%5C%22%2C%5C%22X%5C%22%5D%2Cnull%2Cnull%2C1%2C1%2C%5C%22US%3Aen%5C%22%2Cnull%2C1%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C0%2C1%5D%2C%5C%22X%5C%22%2C%5C%22X%5C%22%2C1%2C%5B1%2C1%2C1%5D%2C1%2C1%2Cnull%2C0%2C0%2Cnull%2C0%5D%2C%5C%22ARTID%5C%22%2C1790714349%2C%5C%22SGVAL%5C%22%5D%22%2Cnull%2C%220%22%5D%5D%5D";
        assert_eq!(batchexecute_body("ARTID", "1790714349", "SGVAL"), expected);
        // Non-numeric timestamps ride as strings, like the reference
        // (double-escaped: the inner JSON string sits inside the
        // envelope string).
        assert!(
            batchexecute_body("ARTID", "soon", "SGVAL").contains("%5C%22soon%5C%22")
        );
    }

    #[test]
    fn parse_signature_reads_both_attributes() {
        let html = r#"<c-wiz><div jscontroller="x" data-n-a-sg="SG9" data-n-a-ts="12345" data-n-dnlg="false"></div></c-wiz>"#;
        assert_eq!(
            parse_signature(html),
            Some(("SG9".to_string(), "12345".to_string()))
        );
        assert!(parse_signature("<html>no attrs</html>").is_none());
        assert!(parse_signature(r#"<div data-n-a-sg="SG9"></div>"#).is_none());
    }

    #[test]
    fn parse_batchexecute_unwraps_the_live_success_shape() {
        // Captured live 2026-09-29 (French feed, lanouvellerepublique).
        let live = ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",\"[\\\"garturlres\\\",\\\"https://www.lanouvellerepublique.fr/tours/direct-greve-dans-la-fonction-publique-blocus-des-lycees-suivez-une-journee-de-mobilisation-dans-le-centre-ouest-1790663930\\\",1]\",null,null,null,\"0\"],[\"di\",47],[\"af.httprm\",46,\"5553043709330761208\",32]]";
        assert_eq!(
            parse_batchexecute(live).as_deref(),
            Some("https://www.lanouvellerepublique.fr/tours/direct-greve-dans-la-fonction-publique-blocus-des-lycees-suivez-une-journee-de-mobilisation-dans-le-centre-ouest-1790663930")
        );
        // Null payloads (soft failures) and error rows yield nothing.
        let null_row = ")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",null,null,null,[3],\"0\"],[\"di\",46]]";
        assert!(parse_batchexecute(null_row).is_none());
        let er_row = ")]}'\n\n[[\"er\",null,null,null,null,400,null,null,null,3],[\"di\",4]]";
        assert!(parse_batchexecute(er_row).is_none());
        assert!(parse_batchexecute("not json {{{").is_none());
        assert!(parse_batchexecute("").is_none());
    }
}
