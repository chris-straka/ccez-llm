//! The drill's whole backend surface, behind the app's `listen_*`
//! commands on every platform: search, channel pages, per-video
//! language availability, and fetching one track with its captions.
//! Everything is cached on disk under one private directory; nothing
//! is ever published.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use futures_util::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::client::Yt;
use crate::youtube::{
    audio_source, base_lang, caption_url, channel_id_of, channel_page, channel_url,
    playability_error, search_entries, storyboard, valid_video_id, video_info, video_source,
    CaptionKind, ChannelPage, Entry, Storyboard, VideoInfo,
};
use crate::Result;

/// Availability rarely changes: a day's cache keeps browsing instant.
const INFO_TTL: Duration = Duration::from_secs(12 * 3600);
/// Media URLs expire after a few hours; fetch with a fresh response.
const URL_TTL: Duration = Duration::from_secs(3600);
const LIST_TTL: Duration = Duration::from_secs(3600);
/// Parallel player requests for one `videos` call.
const PROBE_WORKERS: usize = 6;

/// A fetched track: where the audio sits, plus the captions document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fetched {
    pub info: VideoInfo,
    #[serde(skip)]
    pub audio_path: PathBuf,
    pub audio_mime: String,
    /// The json3 caption document, verbatim (the app parses it).
    pub captions: String,
    pub caption_kind: CaptionKind,
    /// Still frames for the clips, when YouTube has them.
    pub storyboard: Option<Storyboard>,
}

pub struct Listen {
    cache: PathBuf,
    yt: Yt,
}

fn valid_lang(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 16
        && lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn fresh(path: &Path, ttl: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < ttl)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    write_atomic(path, &serde_json::to_vec(value).map_err(|e| e.to_string())?)
}

fn cache_key(s: &str) -> String {
    // FNV-1a: stable across runs, no extra dependency.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// Keep what the picker reads (a player response is ~300 KB).
fn slim_player(full: &Value) -> Value {
    let mut out = serde_json::Map::new();
    for key in [
        "playabilityStatus",
        "videoDetails",
        "captions",
        "storyboards",
    ] {
        if let Some(v) = full.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    let audio: Vec<Value> = full
        .pointer("/streamingData/adaptiveFormats")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|f| {
                    f.get("mimeType")
                        .and_then(Value::as_str)
                        .is_some_and(|m| m.starts_with("audio/"))
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    // Plus the picture formats the drill can show (a handful).
    let video: Vec<Value> = crate::youtube::video_formats(full)
        .into_iter()
        .cloned()
        .collect();
    let formats: Vec<Value> = audio.into_iter().chain(video).collect();
    out.insert(
        "streamingData".into(),
        serde_json::json!({ "adaptiveFormats": formats }),
    );
    Value::Object(out)
}

/// Per-video async lock so a prefetch and a tap never download twice.
fn video_lock(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let map = LOCKS.get_or_init(Default::default);
    let mut map = map.lock().unwrap_or_else(|p| p.into_inner());
    map.entry(key.to_string()).or_default().clone()
}

fn ext_for(mime: &str) -> &'static str {
    match mime {
        "audio/webm" => "webm",
        _ => "m4a",
    }
}

impl Listen {
    pub fn new(cache: impl Into<PathBuf>) -> Self {
        Self {
            cache: cache.into(),
            yt: Yt::new(),
        }
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache
    }

    /// A player response no older than `ttl` (slimmed, on disk).
    async fn player(&self, id: &str, ttl: Duration) -> Result<Value> {
        if !valid_video_id(id) {
            return Err("listen-bad-id".into());
        }
        let path = self.cache.join("player").join(format!("{id}.json"));
        if fresh(&path, ttl) {
            if let Some(v) = read_json(&path) {
                return Ok(v);
            }
        }
        let slim = slim_player(&self.yt.player(id).await?);
        // Refusals aren't cached: a bot check passes on the next try.
        if playability_error(&slim).as_deref() != Some("listen-bot-check") {
            write_json(&path, &slim)?;
        }
        Ok(slim)
    }

    /// One video's availability in `lang`.
    pub async fn video(&self, id: &str, lang: &str) -> Result<VideoInfo> {
        if !valid_lang(lang) {
            return Err("listen-bad-lang".into());
        }
        let player = self.player(id, INFO_TTL).await?;
        if let Some(code) = playability_error(&player) {
            if code == "listen-bot-check" {
                return Err(code);
            }
        }
        Ok(video_info(&player, lang))
    }

    /// Several at once, a few in parallel; a failed one is left out.
    pub async fn videos(&self, ids: &[String], lang: &str) -> Vec<VideoInfo> {
        let ids: Vec<String> = ids
            .iter()
            .filter(|id| valid_video_id(id))
            .take(30)
            .cloned()
            .collect();
        let results: Vec<Result<VideoInfo>> = stream::iter(ids)
            .map(|id| async move { self.video(&id, lang).await })
            .buffered(PROBE_WORKERS)
            .collect()
            .await;
        results.into_iter().filter_map(|r| r.ok()).collect()
    }

    /// A channel's latest uploads (newest first).
    pub async fn channel(&self, input: &str, limit: usize) -> Result<ChannelPage> {
        let url = channel_url(input).ok_or("listen-bad-channel")?;
        let path = self
            .cache
            .join("lists")
            .join(format!("channel-{}.json", cache_key(&url)));
        let page: ChannelPage = match read_json(&path).filter(|_| fresh(&path, LIST_TTL)) {
            Some(page) => page,
            None => {
                let id = match channel_id_of(&url) {
                    Some(id) => id.to_string(),
                    None => self.yt.resolve_channel(&url).await?,
                };
                let page = channel_page(&self.yt.channel_videos(&id).await?);
                write_json(&path, &page)?;
                page
            }
        };
        if page.videos.is_empty() {
            // Shorts-only and podcast-only channels have no videos tab.
            return Err("listen-no-videos".into());
        }
        Ok(ChannelPage {
            videos: page.videos.into_iter().take(limit.clamp(1, 50)).collect(),
            ..page
        })
    }

    /// YouTube search: `kind` "video" or "channel".
    pub async fn search(&self, query: &str, kind: &str, limit: usize) -> Result<Vec<Entry>> {
        let q = query.trim();
        if q.is_empty() || q.chars().count() > 200 {
            return Err("listen-bad-query".into());
        }
        let kind = if kind == "channel" {
            "channel"
        } else {
            "video"
        };
        let path = self
            .cache
            .join("lists")
            .join(format!("search-{}.json", cache_key(&format!("{kind}|{q}"))));
        let rows: Vec<Entry> = match read_json(&path).filter(|_| fresh(&path, LIST_TTL)) {
            Some(rows) => rows,
            None => {
                let rows = search_entries(&self.yt.search(q, kind).await?, kind);
                write_json(&path, &rows)?;
                rows
            }
        };
        Ok(rows.into_iter().take(limit.clamp(1, 50)).collect())
    }

    fn media_dir(&self, id: &str, lang: &str) -> PathBuf {
        self.cache.join("media").join(id).join(base_lang(lang))
    }

    /// Download the `lang` track of `id` and its captions (once; later
    /// calls read the cache).
    pub async fn fetch(&self, id: &str, lang: &str) -> Result<Fetched> {
        if !valid_lang(lang) || !valid_video_id(id) {
            return Err("listen-bad-id".into());
        }
        let dir = self.media_dir(id, lang);
        let lock = video_lock(&format!("{id}/{}", base_lang(lang)));
        let _guard = lock.lock().await;
        let meta_path = dir.join("meta.json");
        let captions_path = dir.join("captions.json3");
        if let Some(mut done) = read_json::<Fetched>(&meta_path) {
            let audio = dir.join(format!("audio.{}", ext_for(&done.audio_mime)));
            if audio.is_file() {
                if let Ok(captions) = std::fs::read_to_string(&captions_path) {
                    done.audio_path = audio;
                    done.captions = captions;
                    return Ok(done);
                }
            }
        }
        let player = self.player(id, URL_TTL).await?;
        match self.download(lang, &dir, &player).await {
            // A stream URL YouTube turned down (or a cut-short download):
            // ask for a fresh player response once and try again.
            Err(e) if e == "listen-http-403" || e == "listen-download-failed" => {
                let fresh = self.player(id, Duration::ZERO).await?;
                self.download(lang, &dir, &fresh).await
            }
            done => done,
        }
    }

    /// `fetch`'s download half: the track and captions `player` points
    /// at, into `dir`, plus the meta that marks it done.
    async fn download(&self, lang: &str, dir: &Path, player: &Value) -> Result<Fetched> {
        if let Some(code) = playability_error(player) {
            return Err(code);
        }
        let meta_path = dir.join("meta.json");
        let captions_path = dir.join("captions.json3");
        let info = video_info(player, lang);
        let audio = info.audio.clone().ok_or("listen-no-track")?;
        let captions = info.captions.clone().ok_or("listen-no-captions")?;
        let (url, len) = audio_source(player, &audio).ok_or("listen-no-track")?;
        let cap_url = caption_url(player, &captions).ok_or("listen-no-captions")?;
        let doc = self.yt.text(&cap_url).await?;
        if !doc.trim_start().starts_with('{') {
            return Err("listen-no-captions".into());
        }
        let audio_path = dir.join(format!("audio.{}", ext_for(&audio.mime)));
        self.yt.download(&url, len, &audio_path).await?;
        write_atomic(&captions_path, doc.as_bytes())?;
        let fetched = Fetched {
            info,
            audio_path,
            audio_mime: audio.mime.clone(),
            captions: String::new(),
            caption_kind: captions.kind,
            storyboard: storyboard(player),
        };
        write_json(&meta_path, &fetched)?;
        Ok(Fetched {
            captions: doc,
            ..fetched
        })
    }

    /// The video's picture for the drill (no sound: the drill plays
    /// the language track beside it), downloaded once into the media
    /// cache. A cached player from before pictures were kept, or a
    /// stream URL YouTube turns down, re-asks for a fresh player once.
    pub async fn video_path(&self, id: &str) -> Result<PathBuf> {
        if !valid_video_id(id) {
            return Err("listen-bad-id".into());
        }
        let path = self.cache.join("media").join(id).join("video.mp4");
        let lock = video_lock(&format!("{id}/video"));
        let _guard = lock.lock().await;
        if path.is_file() {
            return Ok(path);
        }
        let player = self.player(id, URL_TTL).await?;
        let player = if video_source(&player).is_some() {
            player
        } else {
            self.player(id, Duration::ZERO).await?
        };
        if let Some(code) = playability_error(&player) {
            return Err(code);
        }
        let (url, len) = video_source(&player).ok_or("listen-no-video")?;
        match self.yt.download(&url, len, &path).await {
            Err(e) if e == "listen-http-403" || e == "listen-download-failed" => {
                let fresh = self.player(id, Duration::ZERO).await?;
                let (url, len) = video_source(&fresh).ok_or("listen-no-video")?;
                self.yt.download(&url, len, &path).await?;
            }
            done => done?,
        }
        Ok(path)
    }

    /// Where a fetched track's audio sits (call after `fetch`).
    pub async fn audio_path(&self, id: &str, lang: &str) -> Result<PathBuf> {
        Ok(self.fetch(id, lang).await?.audio_path)
    }
}
