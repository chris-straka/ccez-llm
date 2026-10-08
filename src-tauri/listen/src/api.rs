//! The drill's whole backend surface, shared by the desktop shell
//! (Tauri commands) and the `ccez-listen` server (phone and web):
//! search, channel pages, per-video language availability, and
//! fetching one track with its captions. Everything is cached on disk
//! under one private directory; nothing is ever published.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::pick::{base_lang, video_info, CaptionKind, VideoInfo};
use crate::ytdlp::{run, RunError};

const PROBE_TTL: Duration = Duration::from_secs(12 * 3600);
const LIST_TTL: Duration = Duration::from_secs(3600);
const PROBE_DEADLINE: Duration = Duration::from_secs(60);
const LIST_DEADLINE: Duration = Duration::from_secs(90);
const FETCH_DEADLINE: Duration = Duration::from_secs(15 * 60);
/// Parallel probes for one `videos` call (each is one yt-dlp process).
const PROBE_WORKERS: usize = 6;

pub type Result<T> = std::result::Result<T, String>;

fn err(e: RunError) -> String {
    e.to_string()
}

/// One list row: a video (search, channel page) or a channel (search).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    /// "video" or "channel".
    pub kind: String,
    /// Video id, or the channel URL for channels.
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_url: String,
    pub duration: f64,
    pub thumbnail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChannelPage {
    pub name: String,
    pub url: String,
    pub videos: Vec<Entry>,
}

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
}

pub struct Listen {
    cache: PathBuf,
}

/// YouTube video ids: 11 url-safe characters.
pub fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_lang(lang: &str) -> bool {
    !lang.is_empty()
        && lang.len() <= 16
        && lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// A channel reference into its canonical videos-tab URL: "@handle",
/// a youtube.com channel URL (any tab), or a bare handle. Anything
/// else (other hosts, odd schemes) is refused.
pub fn channel_videos_url(input: &str) -> Option<String> {
    let s = input.trim().trim_end_matches('/');
    if s.is_empty() || s.contains(char::is_whitespace) {
        return None;
    }
    let path = if let Some(rest) = s
        .strip_prefix("https://")
        .or_else(|| s.strip_prefix("http://"))
    {
        let (host, path) = rest.split_once('/')?;
        let host = host.to_ascii_lowercase();
        if !(host == "youtube.com" || host.ends_with(".youtube.com")) {
            return None;
        }
        path.to_string()
    } else if let Some(handle) = s.strip_prefix('@') {
        format!("@{handle}")
    } else {
        format!("@{s}")
    };
    let mut parts: Vec<&str> = path.split(['?', '#']).next()?.split('/').collect();
    // Drop a trailing tab (/videos, /featured, /streams…).
    let head_len = match parts.first() {
        Some(p) if p.starts_with('@') => 1,
        Some(&"channel") | Some(&"c") | Some(&"user") => 2,
        _ => return None,
    };
    if parts.len() < head_len {
        return None;
    }
    parts.truncate(head_len);
    let head = parts.join("/");
    if !head
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"@/-_.%".contains(&b))
    {
        return None;
    }
    Some(format!("https://www.youtube.com/{head}/videos"))
}

fn fresh(path: &Path, ttl: Duration) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < ttl)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
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

/// Keep only what `video_info` reads (a full probe is ~1 MB).
fn slim_probe(full: &Value) -> Value {
    let keep = [
        "id",
        "title",
        "channel",
        "channel_url",
        "uploader_url",
        "duration",
        "thumbnail",
        "language",
    ];
    let mut out = serde_json::Map::new();
    for k in keep {
        if let Some(v) = full.get(k) {
            out.insert(k.into(), v.clone());
        }
    }
    let fkeep = [
        "format_id",
        "format_note",
        "language",
        "language_preference",
        "ext",
        "acodec",
        "vcodec",
        "abr",
        "tbr",
        "protocol",
    ];
    let formats: Vec<Value> = full
        .get("formats")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|f| f.get("vcodec").and_then(Value::as_str) == Some("none"))
                .map(|f| {
                    let mut m = serde_json::Map::new();
                    for k in fkeep {
                        if let Some(v) = f.get(k) {
                            m.insert(k.into(), v.clone());
                        }
                    }
                    Value::Object(m)
                })
                .collect()
        })
        .unwrap_or_default();
    out.insert("formats".into(), Value::Array(formats));
    for field in ["subtitles", "automatic_captions"] {
        let keys: serde_json::Map<String, Value> = full
            .get(field)
            .and_then(Value::as_object)
            .map(|m| {
                m.keys()
                    .map(|k| (k.clone(), Value::Array(vec![])))
                    .collect()
            })
            .unwrap_or_default();
        out.insert(field.into(), Value::Object(keys));
    }
    Value::Object(out)
}

fn thumb_of(e: &Value) -> String {
    if let Some(t) = e.get("thumbnail").and_then(Value::as_str) {
        return t.to_string();
    }
    // Flat entries carry a list; the last is the largest.
    e.get("thumbnails")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .rev()
                .find_map(|t| t.get("url").and_then(Value::as_str))
        })
        .map(|u| {
            if u.starts_with("//") {
                format!("https:{u}")
            } else {
                u.to_string()
            }
        })
        .unwrap_or_default()
}

fn s(e: &Value, k: &str) -> String {
    e.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

/// Rows out of a flat playlist document (channel tab or search page).
pub fn entries_of(doc: &Value) -> Vec<Entry> {
    let parent_channel = s(doc, "channel");
    let parent_url = s(doc, "channel_url");
    doc.get("entries")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|e| {
                    let ie = s(e, "ie_key");
                    let url = s(e, "url");
                    if ie == "YoutubeTab" || url.contains("/channel/") || url.contains("/@") {
                        let channel_url = match s(e, "channel_url") {
                            u if u.is_empty() => url.clone(),
                            u => u,
                        };
                        let name = match s(e, "channel") {
                            n if n.is_empty() => s(e, "title"),
                            n => n,
                        };
                        return Some(Entry {
                            kind: "channel".into(),
                            id: channel_url.clone(),
                            title: name.clone(),
                            channel: name,
                            channel_url,
                            duration: 0.0,
                            thumbnail: thumb_of(e),
                        });
                    }
                    let id = s(e, "id");
                    if !valid_video_id(&id) {
                        return None;
                    }
                    // Shorts have no dub tracks worth drilling and
                    // live/upcoming entries have no duration yet.
                    if url.contains("/shorts/") {
                        return None;
                    }
                    let channel = match s(e, "channel") {
                        c if c.is_empty() => parent_channel.clone(),
                        c => c,
                    };
                    let channel_url = match s(e, "channel_url") {
                        u if u.is_empty() => parent_url.clone(),
                        u => u,
                    };
                    Some(Entry {
                        kind: "video".into(),
                        id,
                        title: s(e, "title"),
                        channel,
                        channel_url,
                        duration: e.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
                        thumbnail: thumb_of(e),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Per-video lock so a prefetch and a click never download twice.
fn video_lock(key: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let map = LOCKS.get_or_init(Default::default);
    let mut map = map.lock().unwrap_or_else(|p| p.into_inner());
    map.entry(key.to_string()).or_default().clone()
}

fn percent_encode(q: &str) -> String {
    q.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Listen {
    pub fn new(cache: impl Into<PathBuf>) -> Self {
        Self {
            cache: cache.into(),
        }
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache
    }

    fn probe(&self, id: &str) -> Result<Value> {
        if !valid_video_id(id) {
            return Err("listen-bad-id".into());
        }
        let path = self.cache.join("probe").join(format!("{id}.json"));
        if fresh(&path, PROBE_TTL) {
            if let Some(v) = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
            {
                return Ok(v);
            }
        }
        let url = format!("https://www.youtube.com/watch?v={id}");
        let out = run(&["-J", "--", &url], None, PROBE_DEADLINE).map_err(err)?;
        let full: Value = serde_json::from_slice(&out).map_err(|e| e.to_string())?;
        let slim = slim_probe(&full);
        write_atomic(
            &path,
            &serde_json::to_vec(&slim).map_err(|e| e.to_string())?,
        )?;
        Ok(slim)
    }

    /// One video's availability in `lang`.
    pub fn video(&self, id: &str, lang: &str) -> Result<VideoInfo> {
        if !valid_lang(lang) {
            return Err("listen-bad-lang".into());
        }
        Ok(video_info(&self.probe(id)?, lang))
    }

    /// Several at once, in parallel; a failed probe is left out.
    pub fn videos(&self, ids: &[String], lang: &str) -> Vec<VideoInfo> {
        let ids: Vec<&String> = ids
            .iter()
            .filter(|id| valid_video_id(id))
            .take(30)
            .collect();
        let next = Mutex::new(0usize);
        let results: Mutex<Vec<(usize, VideoInfo)>> = Mutex::new(Vec::new());
        std::thread::scope(|scope| {
            for _ in 0..PROBE_WORKERS.min(ids.len()) {
                scope.spawn(|| loop {
                    let i = {
                        let mut n = next.lock().unwrap_or_else(|p| p.into_inner());
                        let i = *n;
                        *n += 1;
                        i
                    };
                    let Some(id) = ids.get(i) else { break };
                    if let Ok(info) = self.video(id, lang) {
                        results
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .push((i, info));
                    }
                });
            }
        });
        let mut out = results.into_inner().unwrap_or_default();
        out.sort_by_key(|(i, _)| *i);
        out.into_iter().map(|(_, v)| v).collect()
    }

    fn flat_list(&self, url: &str, limit: usize, ttl: Duration) -> Result<Value> {
        let path = self
            .cache
            .join("lists")
            .join(format!("{}.json", cache_key(url)));
        if fresh(&path, ttl) {
            if let Some(v) = std::fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
            {
                return Ok(v);
            }
        }
        let end = limit.to_string();
        let out = run(
            &["--flat-playlist", "-J", "--playlist-end", &end, "--", url],
            None,
            LIST_DEADLINE,
        )
        .map_err(err)?;
        let doc: Value = serde_json::from_slice(&out).map_err(|e| e.to_string())?;
        // Cache the rows only; flat documents carry bulky extras.
        let slim = serde_json::json!({
            "channel": doc.get("channel").cloned().unwrap_or(Value::Null),
            "channel_url": doc.get("channel_url").cloned().unwrap_or(Value::Null),
            "title": doc.get("title").cloned().unwrap_or(Value::Null),
            "entries": doc.get("entries").cloned().unwrap_or(Value::Array(vec![])),
        });
        write_atomic(
            &path,
            &serde_json::to_vec(&slim).map_err(|e| e.to_string())?,
        )?;
        Ok(slim)
    }

    /// A channel's latest uploads (newest first).
    pub fn channel(&self, input: &str, limit: usize) -> Result<ChannelPage> {
        let url = channel_videos_url(input).ok_or("listen-bad-channel")?;
        let doc = self.flat_list(&url, limit.clamp(1, 50), LIST_TTL)?;
        let name = match s(&doc, "channel") {
            n if n.is_empty() => s(&doc, "title").trim_end_matches(" - Videos").to_string(),
            n => n,
        };
        let canonical = match s(&doc, "channel_url") {
            u if u.is_empty() => url.trim_end_matches("/videos").to_string(),
            u => u,
        };
        Ok(ChannelPage {
            name,
            url: canonical,
            videos: entries_of(&doc),
        })
    }

    /// YouTube search: `kind` "channel" lists channels, anything else
    /// lists videos.
    pub fn search(&self, query: &str, kind: &str, limit: usize) -> Result<Vec<Entry>> {
        let q = query.trim();
        if q.is_empty() || q.len() > 200 {
            return Err("listen-bad-query".into());
        }
        let limit = limit.clamp(1, 30);
        let url = if kind == "channel" {
            // `sp=EgIQAg==` is YouTube's "Type: Channel" filter.
            format!(
                "https://www.youtube.com/results?search_query={}&sp=EgIQAg%253D%253D",
                percent_encode(q)
            )
        } else {
            format!("ytsearch{limit}:{q}")
        };
        let doc = self.flat_list(&url, limit, LIST_TTL)?;
        let want = if kind == "channel" {
            "channel"
        } else {
            "video"
        };
        Ok(entries_of(&doc)
            .into_iter()
            .filter(|e| e.kind == want)
            .collect())
    }

    /// Download the `lang` track of `id` and its captions (once; later
    /// calls read the cache).
    pub fn fetch(&self, id: &str, lang: &str) -> Result<Fetched> {
        let info = self.video(id, lang)?;
        let audio = info.audio.clone().ok_or("listen-no-track")?;
        let captions = info.captions.clone().ok_or("listen-no-captions")?;
        let dir = self.cache.join("media").join(id).join(base_lang(lang));
        let lock = video_lock(&format!("{id}/{}", base_lang(lang)));
        let _guard = lock.lock().unwrap_or_else(|p| p.into_inner());
        let audio_path = dir.join(format!("audio.{}", audio.ext));
        let caption_path = dir.join(format!("audio.{}.json3", captions.key));
        if !(audio_path.is_file() && caption_path.is_file()) {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let subs_flag = match captions.kind {
                CaptionKind::Asr => "--write-auto-subs",
                CaptionKind::Uploaded => "--write-subs",
            };
            let url = format!("https://www.youtube.com/watch?v={id}");
            run(
                &[
                    "-f",
                    &audio.format_id,
                    "-o",
                    "audio.%(ext)s",
                    subs_flag,
                    "--sub-langs",
                    &captions.key,
                    "--sub-format",
                    "json3",
                    "--no-part",
                    "--",
                    &url,
                ],
                Some(&dir),
                FETCH_DEADLINE,
            )
            .map_err(err)?;
        }
        if !audio_path.is_file() {
            return Err("listen-download-failed".into());
        }
        let captions_doc =
            std::fs::read_to_string(&caption_path).map_err(|_| "listen-no-captions".to_string())?;
        let audio_mime = match audio.ext.as_str() {
            "m4a" | "mp4" => "audio/mp4",
            "webm" => "audio/webm",
            "mp3" => "audio/mpeg",
            _ => "application/octet-stream",
        }
        .to_string();
        Ok(Fetched {
            info,
            audio_path,
            audio_mime,
            captions: captions_doc,
            caption_kind: captions.kind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_refs_normalize_to_the_videos_tab() {
        let want = "https://www.youtube.com/@thedavidpakmanshow/videos";
        for input in [
            "@thedavidpakmanshow",
            "thedavidpakmanshow",
            "https://www.youtube.com/@thedavidpakmanshow",
            "https://youtube.com/@thedavidpakmanshow/featured",
            "https://m.youtube.com/@thedavidpakmanshow/videos?view=0",
        ] {
            assert_eq!(channel_videos_url(input).as_deref(), Some(want), "{input}");
        }
        assert_eq!(
            channel_videos_url("https://www.youtube.com/channel/UCf9tieLnbbuMDL5Q6dOjERw")
                .as_deref(),
            Some("https://www.youtube.com/channel/UCf9tieLnbbuMDL5Q6dOjERw/videos")
        );
    }

    #[test]
    fn foreign_hosts_and_option_lookalikes_are_refused() {
        assert_eq!(channel_videos_url("https://evil.com/@x"), None);
        assert_eq!(channel_videos_url("--exec=rm"), None);
        assert_eq!(channel_videos_url("two words"), None);
        assert_eq!(
            channel_videos_url("https://www.youtube.com/watch?v=abc"),
            None
        );
    }

    #[test]
    fn video_ids_are_strict() {
        assert!(valid_video_id("ujQZH4qyEgQ"));
        assert!(!valid_video_id("ujQZH4qyEg"));
        assert!(!valid_video_id("--exec=rm -"));
    }

    #[test]
    fn flat_rows_split_videos_and_channels() {
        let doc = serde_json::json!({
            "channel": "Parent", "channel_url": "https://www.youtube.com/channel/P",
            "entries": [
                {"ie_key": "Youtube", "id": "ujQZH4qyEgQ", "url": "https://www.youtube.com/watch?v=ujQZH4qyEgQ",
                 "title": "T", "duration": 521.0, "thumbnails": [{"url": "a"}, {"url": "b"}]},
                {"ie_key": "Youtube", "id": "abcdefghijk", "url": "https://www.youtube.com/shorts/abcdefghijk", "title": "S"},
                {"ie_key": "YoutubeTab", "id": "UCx", "url": "https://www.youtube.com/channel/UCx", "title": "Chan",
                 "channel": "Chan", "channel_url": "https://www.youtube.com/channel/UCx"}
            ]
        });
        let rows = entries_of(&doc);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].kind, "video");
        assert_eq!(rows[0].channel, "Parent");
        assert_eq!(rows[0].thumbnail, "b");
        assert_eq!(rows[1].kind, "channel");
        assert_eq!(rows[1].id, "https://www.youtube.com/channel/UCx");
    }
}
