//! Reading YouTube's own API (InnerTube) responses. Pure: no network,
//! no files. `client.rs` fetches the documents.
//!
//! Audio: a player response lists every audio track. Multi-language
//! videos tag each format with `audioTrack` (its language id such as
//! "fr-FR.10", `audioIsDefault` on the original) and an `xtags` URL
//! parameter whose `acont` says original, dubbed (creator dub) or
//! dubbed-auto (YouTube's synthetic voice). Single-track videos carry
//! no tag; their language is the language of YouTube's speech
//! recognition track. Native audio in the language wins over a dub.
//!
//! Captions: YouTube's speech recognition of the picked track
//! (`kind: "asr"` in its language) first: word timings and
//! punctuation. Uploaded subtitles in the language come next (cue
//! timings). Translations never qualify: they aren't in the list.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioKind {
    /// The video's original audio is in the target language.
    Native,
    /// A dubbed track (creator dub or YouTube auto-dub).
    Dub,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioPick {
    pub kind: AudioKind,
    /// The track's own tag ("fr-FR"), or the spoken language.
    pub lang: String,
    pub itag: u32,
    /// `audioTrack.id` ("fr-FR.10") on multi-track videos.
    pub track: Option<String>,
    /// "audio/mp4" or "audio/webm".
    pub mime: String,
    /// Auto-dub (YouTube's synthetic voice) rather than a creator dub.
    pub auto: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptionKind {
    /// Speech recognition of the track itself: word timings.
    Asr,
    /// Uploaded subtitles: cue timings.
    Uploaded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptionPick {
    /// The caption track's `vssId` ("a.fr", ".fr").
    pub key: String,
    pub kind: CaptionKind,
}

/// Video summary the app shows and the drill needs; `audio`/`captions`
/// are None when the language isn't available (the app says so).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub channel_url: String,
    pub duration: f64,
    pub thumbnail: String,
    /// Original audio language as YouTube reports it.
    pub original_lang: Option<String>,
    pub audio: Option<AudioPick>,
    pub captions: Option<CaptionPick>,
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

/// YouTube's storyboard: sprite sheets of `rows` x `columns` frames,
/// one frame every `1 / fps` seconds, each sheet covering `duration`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Storyboard {
    pub width: u32,
    pub height: u32,
    pub rows: u32,
    pub columns: u32,
    pub fps: f64,
    pub sheets: Vec<Sheet>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sheet {
    pub url: String,
    pub duration: f64,
}

/// Lowercased primary subtag with YouTube's legacy aliases folded:
/// "fr-FR" → "fr", "iw" → "he", "nb" → "no".
pub fn base_lang(tag: &str) -> String {
    let base = tag
        .split(['-', '_', '.'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match base.as_str() {
        "iw" => "he".into(),
        "nb" | "nn" => "no".into(),
        "in" => "id".into(),
        "ji" => "yi".into(),
        "fil" => "tl".into(),
        _ => base,
    }
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> &'a str {
    let mut cur = v;
    for key in path {
        match cur.get(key) {
            Some(next) => cur = next,
            None => return "",
        }
    }
    cur.as_str().unwrap_or("")
}

/// Every object under `key`, depth first, anywhere in `doc`.
fn find_all<'a>(doc: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match doc {
        Value::Object(map) => {
            for (k, v) in map {
                if k == key {
                    out.push(v);
                }
                find_all(v, key, out);
            }
        }
        Value::Array(items) => {
            for v in items {
                find_all(v, key, out);
            }
        }
        _ => {}
    }
}

/// Text of a `{simpleText}` or `{runs: [{text}]}` node.
fn text_of(node: &Value) -> String {
    if let Some(s) = node.get("simpleText").and_then(Value::as_str) {
        return s.to_string();
    }
    if let Some(s) = node.get("content").and_then(Value::as_str) {
        return s.to_string();
    }
    node.get("runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn https(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("//") {
        format!("https://{rest}")
    } else if let Some(rest) = url.strip_prefix("http://") {
        format!("https://{rest}")
    } else {
        url.to_string()
    }
}

/// The largest thumbnail in a `{thumbnails: [...]}` or `{sources}` list.
fn best_thumb(node: &Value) -> String {
    let list = node
        .get("thumbnails")
        .or_else(|| node.get("sources"))
        .and_then(Value::as_array);
    list.and_then(|a| {
        a.iter()
            .max_by_key(|t| t.get("width").and_then(Value::as_u64).unwrap_or(0))
            .and_then(|t| t.get("url").and_then(Value::as_str))
    })
    .map(https)
    .unwrap_or_default()
}

/// "8:31" / "1:02:03" → seconds; 0 when unreadable.
pub fn parse_clock(s: &str) -> f64 {
    let mut total = 0.0;
    for part in s.trim().split(':') {
        match part.trim().parse::<u32>() {
            Ok(n) => total = total * 60.0 + n as f64,
            Err(_) => return 0.0,
        }
    }
    total
}

// ---- Player: tracks, captions, storyboard ----

fn audio_formats(player: &Value) -> Vec<&Value> {
    player
        .pointer("/streamingData/adaptiveFormats")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|f| str_at(f, &["mimeType"]).starts_with("audio/"))
                // Dynamic-range-compressed duplicates: same audio, skip.
                .filter(|f| f.get("isDrc").and_then(Value::as_bool) != Some(true))
                .collect()
        })
        .unwrap_or_default()
}

/// A format's track language ("fr-FR"), when the video has several.
fn track_lang(f: &Value) -> Option<String> {
    let id = str_at(f, &["audioTrack", "id"]);
    let lang = id.split('.').next().unwrap_or("");
    (!lang.is_empty()).then(|| lang.to_string())
}

/// The track's audio content tag: "original", "dubbed",
/// "dubbed-auto", "descriptive"… ("" on single-track videos).
fn acont(f: &Value) -> String {
    let url = str_at(f, &["url"]);
    let from_url = url
        .split(['?', '&'])
        .find_map(|p| p.strip_prefix("xtags="))
        .map(|x| x.replace("%3D", "=").replace("%3A", ":"))
        .and_then(|x| {
            x.split(':')
                .find_map(|kv| kv.strip_prefix("acont=").map(str::to_string))
        });
    if let Some(tag) = from_url {
        return tag;
    }
    let track = f.get("audioTrack");
    match track {
        Some(t) if t.get("isAutoDubbed").and_then(Value::as_bool) == Some(true) => {
            "dubbed-auto".into()
        }
        Some(t) if t.get("audioIsDefault").and_then(Value::as_bool) == Some(true) => {
            "original".into()
        }
        Some(_) => "dubbed".into(),
        None => String::new(),
    }
}

fn caption_tracks(player: &Value) -> Vec<&Value> {
    player
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

/// The original audio's language: the default track's tag, else the
/// language YouTube's speech recognition heard.
pub fn original_lang(player: &Value) -> Option<String> {
    let formats = audio_formats(player);
    if let Some(lang) = formats
        .iter()
        .find(|f| acont(f) == "original")
        .and_then(|f| track_lang(f))
    {
        return Some(lang);
    }
    caption_tracks(player)
        .into_iter()
        .find(|c| str_at(c, &["kind"]) == "asr")
        .map(|c| str_at(c, &["languageCode"]).to_string())
        .filter(|l| !l.is_empty())
}

fn bitrate(f: &Value) -> u64 {
    f.get("averageBitrate")
        .or_else(|| f.get("bitrate"))
        .and_then(Value::as_u64)
        .unwrap_or(u64::MAX)
}

/// Download-friendly rank: mp4 (plays in every webview, Safari
/// included) before webm, then the smallest bitrate at or above
/// 40 kbps (speech needs no more), then any.
fn format_rank(f: &Value) -> (u8, u8, u64) {
    let not_mp4 = !str_at(f, &["mimeType"]).starts_with("audio/mp4") as u8;
    let rate = bitrate(f);
    (not_mp4, (rate < 40_000) as u8, rate)
}

/// Pick the audio track for `target` (an app language code like "fr").
pub fn pick_audio(player: &Value, target: &str) -> Option<AudioPick> {
    let want = base_lang(target);
    let formats = audio_formats(player);
    let original = original_lang(player);
    let native = original.as_deref().map(base_lang).as_deref() == Some(want.as_str());
    let candidates: Vec<&Value> = if native {
        // The original track: untagged formats on a single-track video.
        formats
            .iter()
            .copied()
            .filter(|f| matches!(acont(f).as_str(), "" | "original"))
            .collect()
    } else {
        let dubs: Vec<&Value> = formats
            .iter()
            .copied()
            .filter(|f| {
                track_lang(f).is_some_and(|l| base_lang(&l) == want)
                    && matches!(acont(f).as_str(), "dubbed" | "dubbed-auto")
            })
            .collect();
        // A creator dub beats YouTube's synthetic voice.
        if dubs.iter().any(|f| acont(f) == "dubbed") {
            dubs.into_iter().filter(|f| acont(f) == "dubbed").collect()
        } else {
            dubs
        }
    };
    // zh: the exact tag asked for, else Simplified, when several exist.
    let exact: Vec<&Value> = candidates
        .iter()
        .copied()
        .filter(|f| {
            track_lang(f).is_some_and(|l| {
                l.eq_ignore_ascii_case(target)
                    || (want == "zh" && l.eq_ignore_ascii_case("zh-Hans"))
            })
        })
        .collect();
    let pool = if want == "zh" && !exact.is_empty() {
        exact
    } else {
        candidates
    };
    let best = pool.into_iter().min_by_key(|f| format_rank(f))?;
    let lang = track_lang(best)
        .or_else(|| original.clone())
        .unwrap_or(want);
    Some(AudioPick {
        kind: if native {
            AudioKind::Native
        } else {
            AudioKind::Dub
        },
        itag: best.get("itag").and_then(Value::as_u64).unwrap_or(0) as u32,
        track: best
            .pointer("/audioTrack/id")
            .and_then(Value::as_str)
            .map(str::to_string),
        mime: str_at(best, &["mimeType"])
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_string(),
        auto: !native && acont(best) == "dubbed-auto",
        lang,
    })
}

/// Pick captions that transcribe the picked track.
pub fn pick_captions(player: &Value, audio: &AudioPick) -> Option<CaptionPick> {
    let want = base_lang(&audio.lang);
    let tracks: Vec<&Value> = caption_tracks(player)
        .into_iter()
        .filter(|c| base_lang(str_at(c, &["languageCode"])) == want)
        .collect();
    if let Some(c) = tracks.iter().find(|c| str_at(c, &["kind"]) == "asr") {
        return Some(CaptionPick {
            key: str_at(c, &["vssId"]).to_string(),
            kind: CaptionKind::Asr,
        });
    }
    // Uploaded subtitles in the language: written for this audio by the
    // creator (dub studios ship them with the dub). The exact tag first.
    let uploaded: Vec<&Value> = tracks
        .into_iter()
        .filter(|c| str_at(c, &["kind"]).is_empty())
        .collect();
    uploaded
        .iter()
        .find(|c| str_at(c, &["languageCode"]).eq_ignore_ascii_case(&audio.lang))
        .or_else(|| uploaded.first())
        .map(|c| CaptionPick {
            key: str_at(c, &["vssId"]).to_string(),
            kind: CaptionKind::Uploaded,
        })
}

/// Why a player response can't be drilled, as an app error code.
pub fn playability_error(player: &Value) -> Option<String> {
    let status = str_at(player, &["playabilityStatus", "status"]);
    if status == "OK" {
        return None;
    }
    let reason = str_at(player, &["playabilityStatus", "reason"]).to_ascii_lowercase();
    Some(if reason.contains("bot") {
        "listen-bot-check".into()
    } else {
        "listen-unavailable".into()
    })
}

/// Summarize a player response for one target language.
pub fn video_info(player: &Value, target: &str) -> VideoInfo {
    let details = player.get("videoDetails").unwrap_or(&Value::Null);
    let duration = str_at(details, &["lengthSeconds"])
        .parse::<f64>()
        .unwrap_or(0.0);
    // Live streams and premieres have no fixed audio to cut.
    let playable = playability_error(player).is_none() && duration > 0.0;
    let audio = playable.then(|| pick_audio(player, target)).flatten();
    let captions = audio.as_ref().and_then(|a| pick_captions(player, a));
    let channel_id = str_at(details, &["channelId"]);
    VideoInfo {
        id: str_at(details, &["videoId"]).to_string(),
        title: str_at(details, &["title"]).to_string(),
        channel: str_at(details, &["author"]).to_string(),
        channel_url: if channel_id.is_empty() {
            String::new()
        } else {
            format!("https://www.youtube.com/channel/{channel_id}")
        },
        duration,
        thumbnail: details.get("thumbnail").map(best_thumb).unwrap_or_default(),
        original_lang: original_lang(player),
        audio,
        captions,
    }
}

/// The picked track's download URL and size in bytes (0 = unknown).
/// Picture-only formats the drill can show: H.264 in MP4, which every
/// webview the app runs in decodes (AV1 and VP9 are not everywhere),
/// at most 480p.
pub fn video_formats(player: &Value) -> Vec<&Value> {
    player
        .pointer("/streamingData/adaptiveFormats")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter(|f| {
                    let mime = str_at(f, &["mimeType"]);
                    mime.starts_with("video/mp4") && mime.contains("avc1")
                })
                .filter(|f| f.get("height").and_then(Value::as_u64).unwrap_or(0) <= 480)
                .collect()
        })
        .unwrap_or_default()
}

/// The drill's picture: the H.264 format nearest 360p (small enough to
/// fetch beside the audio, sharp enough for a centered clip), as its
/// URL and byte length. None when YouTube offers no plain URL.
pub fn video_source(player: &Value) -> Option<(String, u64)> {
    let best = video_formats(player).into_iter().min_by_key(|f| {
        let h = f.get("height").and_then(Value::as_u64).unwrap_or(0) as i64;
        (h - 360).abs()
    })?;
    let url = str_at(best, &["url"]);
    if !url.starts_with("https://") {
        return None;
    }
    let len = str_at(best, &["contentLength"]).parse().unwrap_or(0);
    Some((url.to_string(), len))
}

pub fn audio_source(player: &Value, pick: &AudioPick) -> Option<(String, u64)> {
    let f = audio_formats(player).into_iter().find(|f| {
        f.get("itag").and_then(Value::as_u64) == Some(pick.itag as u64)
            && f.pointer("/audioTrack/id").and_then(Value::as_str) == pick.track.as_deref()
    })?;
    let url = str_at(f, &["url"]);
    if !url.starts_with("https://") {
        return None;
    }
    let len = str_at(f, &["contentLength"]).parse().unwrap_or(0);
    Some((url.to_string(), len))
}

/// The picked captions as a json3 document URL.
pub fn caption_url(player: &Value, pick: &CaptionPick) -> Option<String> {
    let c = caption_tracks(player)
        .into_iter()
        .find(|c| str_at(c, &["vssId"]) == pick.key)?;
    let base = str_at(c, &["baseUrl"]);
    let base = if base.starts_with('/') {
        format!("https://www.youtube.com{base}")
    } else {
        base.to_string()
    };
    if !base.starts_with("https://") {
        return None;
    }
    let kept: Vec<&str> = base.split('&').filter(|p| !p.starts_with("fmt=")).collect();
    Some(format!("{}&fmt=json3", kept.join("&")))
}

/// The largest storyboard level in a player response.
/// Spec: `base|w#h#count#cols#rows#interval#name#sigh|…`, one level per
/// part after the base; `$L` is the level, `$N` its name, `$M` the sheet.
pub fn storyboard(player: &Value) -> Option<Storyboard> {
    let spec = str_at(
        player,
        &["storyboards", "playerStoryboardSpecRenderer", "spec"],
    );
    let mut parts = spec.split('|');
    let base = https(parts.next()?);
    if !base.starts_with("https://") {
        return None;
    }
    let duration = str_at(player, &["videoDetails", "lengthSeconds"])
        .parse::<f64>()
        .ok()
        .filter(|d| *d > 0.0)?;
    parts
        .enumerate()
        .filter_map(|(level, part)| {
            let f: Vec<&str> = part.split('#').collect();
            if f.len() != 8 {
                return None;
            }
            let num = |i: usize| f[i].parse::<u32>().ok().filter(|n| *n > 0);
            let (width, height, count, columns, rows) =
                (num(0)?, num(1)?, num(2)?, num(3)?, num(4)?);
            let per_sheet = columns * rows;
            let sheets = count.div_ceil(per_sheet);
            let sheet_secs = duration * per_sheet as f64 / count as f64;
            let url = base.replace("$L", &level.to_string()).replace("$N", f[6]);
            Some(Storyboard {
                width,
                height,
                rows,
                columns,
                fps: count as f64 / duration,
                sheets: (0..sheets)
                    .map(|j| Sheet {
                        url: format!("{}&sigh={}", url.replace("$M", &j.to_string()), f[7]),
                        duration: sheet_secs.min(duration - j as f64 * sheet_secs),
                    })
                    .collect(),
            })
        })
        // A single-frame level ("default") is no help per clip.
        .filter(|b| b.sheets.len() > 1 || b.rows * b.columns > 1)
        .max_by_key(|b| b.width)
}

// ---- Lists: search, channel pages ----

fn video_entry(v: &Value) -> Option<Entry> {
    let id = str_at(v, &["videoId"]);
    if id.len() != 11 {
        return None;
    }
    let duration = parse_clock(&text_of(v.get("lengthText").unwrap_or(&Value::Null)));
    // No length: live or upcoming, nothing to drill.
    if duration <= 0.0 {
        return None;
    }
    let owner = v
        .pointer("/ownerText/runs/0")
        .or_else(|| v.pointer("/shortBylineText/runs/0"));
    let channel = owner
        .and_then(|o| o.get("text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let channel_url = owner
        .and_then(|o| o.pointer("/navigationEndpoint/browseEndpoint"))
        .map(|b| {
            let handle = str_at(b, &["canonicalBaseUrl"]);
            if handle.starts_with('/') {
                format!("https://www.youtube.com{handle}")
            } else {
                format!(
                    "https://www.youtube.com/channel/{}",
                    str_at(b, &["browseId"])
                )
            }
        })
        .unwrap_or_default();
    Some(Entry {
        kind: "video".into(),
        id: id.to_string(),
        title: text_of(v.get("title").unwrap_or(&Value::Null)),
        channel,
        channel_url,
        duration,
        thumbnail: v.get("thumbnail").map(best_thumb).unwrap_or_default(),
    })
}

fn channel_entry(c: &Value) -> Option<Entry> {
    let id = str_at(c, &["channelId"]);
    if id.is_empty() {
        return None;
    }
    let handle = str_at(
        c,
        &["navigationEndpoint", "browseEndpoint", "canonicalBaseUrl"],
    );
    let url = if handle.starts_with("/@") {
        format!("https://www.youtube.com{handle}")
    } else {
        format!("https://www.youtube.com/channel/{id}")
    };
    let title = text_of(c.get("title").unwrap_or(&Value::Null));
    Some(Entry {
        kind: "channel".into(),
        id: url.clone(),
        title: title.clone(),
        channel: title,
        channel_url: url,
        duration: 0.0,
        thumbnail: c.get("thumbnail").map(best_thumb).unwrap_or_default(),
    })
}

/// Rows of a search response.
pub fn search_entries(doc: &Value, kind: &str) -> Vec<Entry> {
    let (key, row): (&str, fn(&Value) -> Option<Entry>) = if kind == "channel" {
        ("channelRenderer", channel_entry)
    } else {
        ("videoRenderer", video_entry)
    };
    let mut found = Vec::new();
    find_all(doc, key, &mut found);
    let mut seen = std::collections::HashSet::new();
    found
        .into_iter()
        .filter_map(row)
        .filter(|e| seen.insert(e.id.clone()))
        .collect()
}

/// A channel's Videos tab (browse response).
pub fn channel_page(doc: &Value) -> ChannelPage {
    let meta = doc
        .pointer("/metadata/channelMetadataRenderer")
        .unwrap_or(&Value::Null);
    let name = str_at(meta, &["title"]).to_string();
    let url = match str_at(meta, &["vanityChannelUrl"]) {
        "" => format!(
            "https://www.youtube.com/channel/{}",
            str_at(meta, &["externalId"])
        ),
        u => https(u),
    };
    let mut videos = Vec::new();
    let mut lockups = Vec::new();
    find_all(doc, "lockupViewModel", &mut lockups);
    for l in lockups {
        if str_at(l, &["contentType"]) != "LOCKUP_CONTENT_TYPE_VIDEO" {
            continue;
        }
        let id = str_at(l, &["contentId"]);
        let image = l.pointer("/contentImage/thumbnailViewModel");
        let mut badges = Vec::new();
        if let Some(img) = image {
            find_all(img, "thumbnailBadgeViewModel", &mut badges);
        }
        let duration = badges
            .iter()
            .map(|b| parse_clock(str_at(b, &["text"])))
            .find(|d| *d > 0.0)
            .unwrap_or(0.0);
        if id.len() != 11 || duration <= 0.0 {
            continue;
        }
        videos.push(Entry {
            kind: "video".into(),
            id: id.to_string(),
            title: str_at(
                l,
                &["metadata", "lockupMetadataViewModel", "title", "content"],
            )
            .to_string(),
            channel: name.clone(),
            channel_url: url.clone(),
            duration,
            thumbnail: image
                .and_then(|i| i.get("image"))
                .map(best_thumb)
                .unwrap_or_default(),
        });
    }
    // Older layouts still send plain video renderers.
    if videos.is_empty() {
        let mut found = Vec::new();
        find_all(doc, "videoRenderer", &mut found);
        find_all(doc, "gridVideoRenderer", &mut found);
        videos = found
            .into_iter()
            .filter_map(video_entry)
            .map(|mut e| {
                e.channel = name.clone();
                e.channel_url = url.clone();
                e
            })
            .collect();
    }
    ChannelPage { name, url, videos }
}

/// A channel reference into its canonical URL: "@handle", a
/// youtube.com channel URL (any tab), or a bare handle. Anything else
/// (other hosts, odd schemes) is refused.
pub fn channel_url(input: &str) -> Option<String> {
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
    Some(format!("https://www.youtube.com/{head}"))
}

/// A `/channel/UC…` URL's id, which browses without a lookup.
pub fn channel_id_of(url: &str) -> Option<&str> {
    let id = url.strip_prefix("https://www.youtube.com/channel/")?;
    (id.len() == 24 && id.starts_with("UC")).then_some(id)
}

/// YouTube video ids: 11 url-safe characters.
pub fn valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod tests {

    #[test]
    fn picks_h264_nearest_360p_with_a_plain_url() {
        let f = |itag: u32, mime: &str, h: u64, url: &str| serde_json::json!({ "itag": itag, "mimeType": mime, "height": h, "contentLength": "1000", "url": url });
        let avc = "video/mp4; codecs=\"avc1.4D401E\"";
        let player = serde_json::json!({ "streamingData": { "adaptiveFormats": [
            f(137, avc, 1080, "https://v/1080"),
            f(135, avc, 480, "https://v/480"),
            f(134, avc, 360, "https://v/360"),
            f(243, "video/webm; codecs=\"vp9\"", 360, "https://v/vp9"),
            f(396, "video/mp4; codecs=\"av01.0.01M.08\"", 360, "https://v/av1"),
            f(133, avc, 240, "https://v/240"),
            f(140, "audio/mp4; codecs=\"mp4a.40.2\"", 0, "https://a/140")
        ] } });
        assert_eq!(video_source(&player), Some(("https://v/360".into(), 1000)));
        // Over 480p never qualifies; no plain URL means no picture.
        assert_eq!(video_formats(&player).len(), 3);
        let ciphered = serde_json::json!({ "streamingData": { "adaptiveFormats": [
            serde_json::json!({ "itag": 134, "mimeType": avc, "height": 360, "signatureCipher": "s=…" })
        ] } });
        assert_eq!(video_source(&ciphered), None);
    }

    use super::*;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn auto_dub_picks_the_french_track_and_its_own_recognition() {
        let p = fixture("player-pakman-autodub");
        let info = video_info(&p, "fr");
        assert_eq!(info.title, "Trump says the UNTHINKABLE about DEADLY PLAGUE");
        assert_eq!(info.channel, "David Pakman");
        assert_eq!(info.duration, 521.0);
        assert_eq!(info.original_lang.as_deref(), Some("en-US"));
        let audio = info.audio.expect("french audio");
        assert_eq!(audio.kind, AudioKind::Dub);
        assert!(audio.auto);
        assert_eq!(audio.lang, "fr-FR");
        assert_eq!(audio.track.as_deref(), Some("fr-FR.10"));
        assert_eq!(audio.itag, 139);
        assert_eq!(audio.mime, "audio/mp4");
        let caps = info.captions.expect("captions");
        assert_eq!(
            caps,
            CaptionPick {
                key: "a.fr".into(),
                kind: CaptionKind::Asr
            }
        );
        assert!(audio_source(&p, &audio).is_some_and(|(u, len)| u.contains("itag=139") && len > 0));
        assert!(caption_url(&p, &caps)
            .is_some_and(|u| u.contains("lang=fr") && u.ends_with("&fmt=json3")));
    }

    #[test]
    fn the_original_language_is_native_not_a_dub() {
        let p = fixture("player-pakman-autodub");
        let audio = pick_audio(&p, "en").expect("english");
        assert_eq!(audio.kind, AudioKind::Native);
        assert!(!audio.auto);
        assert_eq!(audio.track.as_deref(), Some("en-US.4"));
        assert_eq!(
            pick_captions(&p, &audio).map(|c| c.key).as_deref(),
            Some("a.en")
        );
    }

    #[test]
    fn single_track_video_is_native_in_its_recognized_language() {
        let p = fixture("player-france24-native");
        let info = video_info(&p, "fr");
        assert_eq!(info.original_lang.as_deref(), Some("fr"));
        let audio = info.audio.expect("native french");
        assert_eq!(audio.kind, AudioKind::Native);
        assert_eq!(audio.track, None);
        assert_eq!(audio.lang, "fr");
        assert_eq!(info.captions.map(|c| c.kind), Some(CaptionKind::Asr));
    }

    #[test]
    fn no_track_in_the_language_means_no_audio() {
        let p = fixture("player-english-only");
        // Uploaded German subtitles exist, but no German audio.
        let info = video_info(&p, "de");
        assert_eq!(info.audio, None);
        assert_eq!(info.captions, None);
        assert!(video_info(&p, "en").audio.is_some());
    }

    #[test]
    fn storyboard_takes_the_largest_level() {
        let board = storyboard(&fixture("player-pakman-autodub")).expect("storyboard");
        assert_eq!((board.width, board.height), (160, 90));
        assert_eq!((board.rows, board.columns), (5, 5));
        assert_eq!(board.sheets.len(), 5);
        assert!(board.sheets[0]
            .url
            .starts_with("https://i.ytimg.com/sb/ujQZH4qyEgQ/storyboard3_L2/M0.jpg"));
        assert!(board.sheets[0].url.contains("&sigh="));
        assert!((board.fps - 106.0 / 521.0).abs() < 1e-9);
    }

    #[test]
    fn search_rows_for_videos_and_channels() {
        let videos = search_entries(&fixture("search-videos"), "video");
        assert!(videos.len() >= 10);
        let v = &videos[0];
        assert_eq!(v.kind, "video");
        assert!(valid_video_id(&v.id));
        assert!(v.duration > 0.0);
        assert!(v.thumbnail.starts_with("https://"));
        assert!(v.channel_url.starts_with("https://www.youtube.com/"));
        let channels = search_entries(&fixture("search-channels"), "channel");
        let pakman = channels
            .iter()
            .find(|c| c.title == "David Pakman")
            .expect("pakman");
        assert_eq!(pakman.id, "https://www.youtube.com/@thedavidpakmanshow");
        assert!(pakman.thumbnail.starts_with("https://"));
    }

    #[test]
    fn channel_videos_tab() {
        let page = channel_page(&fixture("channel-videos"));
        assert_eq!(page.name, "David Pakman");
        assert_eq!(page.url, "https://www.youtube.com/@thedavidpakmanshow");
        assert_eq!(page.videos.len(), 12);
        let first = &page.videos[0];
        assert_eq!(first.id, "e0LNW8WIt3c");
        assert_eq!(first.duration, 511.0);
        assert!(!first.title.is_empty());
        assert_eq!(first.channel, "David Pakman");
    }

    #[test]
    fn channel_refs_normalize() {
        let want = "https://www.youtube.com/@thedavidpakmanshow";
        for input in [
            "@thedavidpakmanshow",
            "thedavidpakmanshow",
            "https://www.youtube.com/@thedavidpakmanshow/videos",
            "https://youtube.com/@thedavidpakmanshow/",
            "https://m.youtube.com/@thedavidpakmanshow?si=x",
        ] {
            assert_eq!(channel_url(input).as_deref(), Some(want), "{input}");
        }
        assert_eq!(
            channel_url("https://www.youtube.com/channel/UCvixJtaXuNdMPUGdOPcY8Ag/featured")
                .as_deref(),
            Some("https://www.youtube.com/channel/UCvixJtaXuNdMPUGdOPcY8Ag")
        );
        assert_eq!(channel_url("https://evil.example/@x"), None);
        assert_eq!(channel_url("two words"), None);
        assert_eq!(
            channel_id_of("https://www.youtube.com/channel/UCvixJtaXuNdMPUGdOPcY8Ag"),
            Some("UCvixJtaXuNdMPUGdOPcY8Ag")
        );
        assert_eq!(channel_id_of(want), None);
    }

    #[test]
    fn clock_text() {
        assert_eq!(parse_clock("8:31"), 511.0);
        assert_eq!(parse_clock("1:02:03"), 3723.0);
        assert_eq!(parse_clock("LIVE"), 0.0);
        assert_eq!(parse_clock(""), 0.0);
    }

    #[test]
    fn base_lang_folds_aliases() {
        assert_eq!(base_lang("fr-FR"), "fr");
        assert_eq!(base_lang("fr-FR.10"), "fr");
        assert_eq!(base_lang("iw"), "he");
        assert_eq!(base_lang("nb"), "no");
    }
}
