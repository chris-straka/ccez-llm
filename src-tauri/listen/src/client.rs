//! YouTube over plain HTTPS, the way its own apps ask: no yt-dlp, no
//! JavaScript player, nothing to install, so the same code runs on
//! the Mac and the phone.
//!
//! A session is the visitor id and web client version read off the
//! home page (YouTube answers anonymous API calls without one with a
//! bot check). Track lists come from the visionOS client, whose audio
//! URLs need no signature solving or proof-of-origin token; search and
//! channel pages come from the web client.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::Result;

const API: &str = "https://www.youtube.com/youtubei/v1";
/// googlevideo refuses the visionOS client's own Safari agent on
/// media; a desktop Chrome agent downloads fine.
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const VISION_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
/// Web client version when the home page doesn't say (it always has).
const WEB_VERSION_FALLBACK: &str = "2.20261008.01.00";
const SESSION_TTL: Duration = Duration::from_secs(6 * 3600);
/// Media arrives in ranged pieces: googlevideo throttles long single
/// reads, and a piece that fails retries alone.
const CHUNK: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
struct Session {
    visitor: String,
    web_version: String,
    at: Instant,
}

pub struct Yt {
    http: reqwest::Client,
    session: Mutex<Option<Session>>,
}

/// Find `"KEY":"value"` in the home page's config blob.
fn config_value(page: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let start = page.find(&needle)? + needle.len();
    let end = page[start..].find('"')?;
    let v = &page[start..start + end];
    (!v.is_empty()).then(|| v.to_string())
}

fn net(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "listen-timeout".into()
    } else {
        "listen-network".into()
    }
}

impl Default for Yt {
    fn default() -> Self {
        Self::new()
    }
}

impl Yt {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default();
        Self {
            http,
            session: Mutex::new(None),
        }
    }

    async fn session(&self, renew: bool) -> Result<Session> {
        if !renew {
            let held = self
                .session
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clone();
            if let Some(s) = held.filter(|s| s.at.elapsed() < SESSION_TTL) {
                return Ok(s);
            }
        }
        let page = self
            .http
            .get("https://www.youtube.com/")
            .header("User-Agent", CHROME_UA)
            .header("Accept-Language", "en-US,en;q=0.9")
            // Past the EU consent interstitial.
            .header("Cookie", "SOCS=CAI")
            .send()
            .await
            .map_err(net)?
            .text()
            .await
            .map_err(net)?;
        let session = Session {
            visitor: config_value(&page, "VISITOR_DATA").ok_or("listen-bot-check")?,
            web_version: config_value(&page, "INNERTUBE_CLIENT_VERSION")
                .unwrap_or_else(|| WEB_VERSION_FALLBACK.into()),
            at: Instant::now(),
        };
        *self.session.lock().unwrap_or_else(|p| p.into_inner()) = Some(session.clone());
        Ok(session)
    }

    async fn post(&self, path: &str, body: Value, ua: &str, visitor: &str) -> Result<Value> {
        let res = self
            .http
            .post(format!("{API}/{path}?prettyPrint=false"))
            .header("User-Agent", ua)
            .header("Content-Type", "application/json")
            .header("X-Goog-Visitor-Id", visitor)
            .header("Origin", "https://www.youtube.com")
            .body(body.to_string())
            .send()
            .await
            .map_err(net)?;
        if !res.status().is_success() {
            return Err(format!("listen-http-{}", res.status().as_u16()));
        }
        let bytes = res.bytes().await.map_err(net)?;
        serde_json::from_slice(&bytes).map_err(|_| "listen-bad-response".to_string())
    }

    fn web_context(s: &Session) -> Value {
        json!({ "client": {
            "clientName": "WEB",
            "clientVersion": s.web_version,
            "hl": "en",
            "visitorData": s.visitor,
        }})
    }

    /// One video's player response (tracks, captions, storyboard).
    pub async fn player(&self, id: &str) -> Result<Value> {
        let mut renew = false;
        loop {
            let s = self.session(renew).await?;
            let body = json!({
                "context": { "client": {
                    "clientName": "VISIONOS",
                    "clientVersion": "1.02",
                    "deviceMake": "Apple",
                    "deviceModel": "RealityDevice17,1",
                    "osName": "visionOS",
                    "osVersion": "26.5.23O471",
                    "hl": "en",
                    "visitorData": s.visitor,
                }},
                "videoId": id,
                "contentCheckOk": true,
                "racyCheckOk": true,
            });
            let doc = self.post("player", body, VISION_UA, &s.visitor).await?;
            // A stale visitor id meets the bot check: renew once.
            if !renew
                && crate::youtube::playability_error(&doc).as_deref() == Some("listen-bot-check")
            {
                renew = true;
                continue;
            }
            return Ok(doc);
        }
    }

    /// Search results; `params` picks the type filter.
    pub async fn search(&self, query: &str, kind: &str) -> Result<Value> {
        let s = self.session(false).await?;
        // Type filters: videos "EgIQAQ==", channels "EgIQAg==".
        let params = if kind == "channel" {
            "EgIQAg%3D%3D"
        } else {
            "EgIQAQ%3D%3D"
        };
        let body = json!({ "context": Self::web_context(&s), "query": query, "params": params });
        self.post("search", body, CHROME_UA, &s.visitor).await
    }

    /// A channel URL (handle, /c/, /user/) to its UC… id.
    pub async fn resolve_channel(&self, url: &str) -> Result<String> {
        let s = self.session(false).await?;
        let body = json!({ "context": Self::web_context(&s), "url": url });
        let doc = self
            .post("navigation/resolve_url", body, CHROME_UA, &s.visitor)
            .await?;
        doc.pointer("/endpoint/browseEndpoint/browseId")
            .and_then(Value::as_str)
            .filter(|id| id.starts_with("UC"))
            .map(str::to_string)
            .ok_or_else(|| "listen-bad-channel".to_string())
    }

    /// A channel's Videos tab.
    pub async fn channel_videos(&self, channel_id: &str) -> Result<Value> {
        let s = self.session(false).await?;
        let body = json!({
            "context": Self::web_context(&s),
            "browseId": channel_id,
            "params": "EgZ2aWRlb3PyBgQKAjoA",
        });
        self.post("browse", body, CHROME_UA, &s.visitor).await
    }

    pub async fn text(&self, url: &str) -> Result<String> {
        let res = self
            .http
            .get(url)
            .header("User-Agent", CHROME_UA)
            .send()
            .await
            .map_err(net)?;
        if !res.status().is_success() {
            return Err(format!("listen-http-{}", res.status().as_u16()));
        }
        res.text().await.map_err(net)
    }

    /// Download `url` (`len` bytes, 0 = unknown) to `dest`, in ranged
    /// pieces, through a temp file so a cut leaves nothing half-written.
    pub async fn download(&self, url: &str, len: u64, dest: &Path) -> Result<()> {
        use std::io::Write;
        if let Some(dir) = dest.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = dest.with_extension("part");
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut at = 0u64;
        loop {
            let end = at + CHUNK - 1;
            let mut tries = 0;
            let bytes = loop {
                let res = self
                    .http
                    .get(format!("{url}&range={at}-{end}"))
                    .header("User-Agent", CHROME_UA)
                    .send()
                    .await;
                match res {
                    Ok(r) if r.status().is_success() => match r.bytes().await {
                        Ok(b) => break b,
                        Err(e) if tries >= 2 => return Err(net(e)),
                        Err(_) => {}
                    },
                    Ok(r) if tries >= 2 || r.status().as_u16() == 403 => {
                        return Err(format!("listen-http-{}", r.status().as_u16()))
                    }
                    Err(e) if tries >= 2 => return Err(net(e)),
                    _ => {}
                }
                tries += 1;
            };
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            at += bytes.len() as u64;
            let short = (bytes.len() as u64) < CHUNK;
            if bytes.is_empty() || short || (len > 0 && at >= len) {
                break;
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        if at == 0 || (len > 0 && at < len) {
            let _ = std::fs::remove_file(&tmp);
            return Err("listen-download-failed".into());
        }
        std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_values_come_out_of_the_page() {
        let page = r#"ytcfg.set({"VISITOR_DATA":"Cgt4eXo%3D","INNERTUBE_CLIENT_VERSION":"2.20261008.01.00"});"#;
        assert_eq!(
            config_value(page, "VISITOR_DATA").as_deref(),
            Some("Cgt4eXo%3D")
        );
        assert_eq!(
            config_value(page, "INNERTUBE_CLIENT_VERSION").as_deref(),
            Some("2.20261008.01.00")
        );
        assert_eq!(config_value(page, "MISSING"), None);
    }
}
