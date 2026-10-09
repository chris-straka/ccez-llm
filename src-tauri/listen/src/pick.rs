//! Which audio track and which captions a drill uses, read from
//! `yt-dlp -J` output. Pure: no processes, no files.
//!
//! Audio: the video's own audio when it is already in the target
//! language (a native channel), else a dub (creator dubs and YouTube
//! auto-dubs both arrive as extra audio-only formats tagged with a
//! language; their `format_note` says "dubbed" or "dubbed-auto" on at
//! least the HLS variants). Native wins over a dub.
//!
//! Captions: YouTube's speech recognition of that exact track
//! (`<lang>-orig` under automatic captions: word timings and
//! punctuation) first, then uploaded subtitles in the language (cue
//! timings). Auto-translated captions (`fr` translated from English)
//! never qualify: their words are not what the dub says.

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
    /// The track's own tag ("fr-FR").
    pub lang: String,
    /// yt-dlp format id to download ("139-4", or "140").
    pub format_id: String,
    pub ext: String,
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
    /// yt-dlp `--sub-langs` key ("fr-FR-orig", "fr").
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

/// Lowercased primary subtag with YouTube's legacy aliases folded:
/// "fr-FR" → "fr", "iw" → "he", "nb" → "no".
pub fn base_lang(tag: &str) -> String {
    let base = tag
        .split(['-', '_'])
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

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn is_audio_only(f: &Value) -> bool {
    str_field(f, "vcodec") == "none" && !matches!(str_field(f, "acodec"), "" | "none")
}

fn note_is_dub(f: &Value) -> bool {
    str_field(f, "format_note")
        .to_ascii_lowercase()
        .contains("dubbed")
}

fn note_is_auto_dub(f: &Value) -> bool {
    str_field(f, "format_note")
        .to_ascii_lowercase()
        .contains("dubbed-auto")
}

/// Bitrate for ranking; HLS variants report none and rank last.
fn abr(f: &Value) -> f64 {
    f.get("abr")
        .and_then(Value::as_f64)
        .or_else(|| f.get("tbr").and_then(Value::as_f64))
        .unwrap_or(f64::MAX)
}

/// Download-friendly rank: plain HTTPS before HLS; m4a (plays in
/// every webview, Safari included) before webm; then the smallest
/// bitrate at or above 40 kbps (speech needs no more), then any.
fn format_rank(f: &Value) -> (u8, u8, u8, u64) {
    let hls = str_field(f, "protocol").contains("m3u8") as u8;
    let not_m4a = (str_field(f, "ext") != "m4a") as u8;
    let rate = abr(f);
    let too_thin = (rate < 40.0) as u8;
    (hls, not_m4a, too_thin, (rate * 1000.0) as u64)
}

/// Pick the audio track for `target` (an app language code like "fr").
pub fn pick_audio(info: &Value, target: &str) -> Option<AudioPick> {
    let want = base_lang(target);
    let all: Vec<&Value> = info
        .get("formats")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let formats: Vec<&Value> = all.iter().copied().filter(|f| is_audio_only(f)).collect();
    // The dub notes sit on the HLS variants, which report no acodec:
    // read them off every format in the language.
    let tagged: Vec<&Value> = all
        .iter()
        .copied()
        .filter(|f| base_lang(str_field(f, "language")) == want)
        .collect();
    let original = info.get("language").and_then(Value::as_str).map(base_lang);
    let in_lang: Vec<&Value> = formats
        .iter()
        .copied()
        .filter(|f| base_lang(str_field(f, "language")) == want)
        .collect();
    let lang_is_dub = tagged.iter().any(|f| note_is_dub(f))
        || in_lang
            .iter()
            .any(|f| f.get("language_preference").and_then(Value::as_i64) == Some(-1));
    let native = original.as_deref() == Some(want.as_str()) && !lang_is_dub;

    // Native audio: tagged formats in the language, or (single-track
    // videos often carry no language tag) every audio format.
    let candidates: Vec<&Value> = if native {
        if in_lang.is_empty() {
            formats
                .iter()
                .copied()
                .filter(|f| str_field(f, "language").is_empty())
                .collect()
        } else {
            in_lang.clone()
        }
    } else {
        in_lang.clone()
    };
    let best = candidates.iter().min_by_key(|f| format_rank(f))?;
    // Prefer zh-Hans over zh-Hant (or the exact tag asked for) when a
    // base language carries several tracks.
    let best = if want == "zh" {
        let exact: Vec<&&Value> = candidates
            .iter()
            .filter(|f| {
                let l = str_field(f, "language");
                l.eq_ignore_ascii_case(target) || l.eq_ignore_ascii_case("zh-Hans")
            })
            .collect();
        exact
            .into_iter()
            .min_by_key(|f| format_rank(f))
            .unwrap_or(best)
    } else {
        best
    };
    let lang = match str_field(best, "language") {
        "" => original.clone().unwrap_or(want.clone()),
        l => l.to_string(),
    };
    Some(AudioPick {
        kind: if native {
            AudioKind::Native
        } else {
            AudioKind::Dub
        },
        format_id: str_field(best, "format_id").to_string(),
        ext: str_field(best, "ext").to_string(),
        auto: !native && tagged.iter().any(|f| note_is_auto_dub(f)),
        lang,
    })
}

fn caption_keys(info: &Value, field: &str) -> Vec<String> {
    info.get(field)
        .and_then(Value::as_object)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

/// Pick captions that transcribe the picked track.
pub fn pick_captions(info: &Value, audio: &AudioPick) -> Option<CaptionPick> {
    let want = base_lang(&audio.lang);
    let auto = caption_keys(info, "automatic_captions");
    let uploaded = caption_keys(info, "subtitles");
    let exact_orig = format!("{}-orig", audio.lang);
    // ASR of this track: "fr-orig" (dub or native; some tracks key it
    // by the full tag, "fr-FR-orig").
    if let Some(key) = auto
        .iter()
        .find(|k| k.eq_ignore_ascii_case(&exact_orig))
        .or_else(|| {
            auto.iter()
                .find(|k| k.ends_with("-orig") && base_lang(k) == want)
        })
    {
        return Some(CaptionPick {
            key: key.clone(),
            kind: CaptionKind::Asr,
        });
    }
    // Uploaded subtitles in the language: written for this audio by the
    // creator (dub studios ship them with the dub).
    if let Some(key) = uploaded
        .iter()
        .find(|k| k.eq_ignore_ascii_case(&audio.lang))
        .or_else(|| uploaded.iter().find(|k| base_lang(k) == want))
    {
        return Some(CaptionPick {
            key: key.clone(),
            kind: CaptionKind::Uploaded,
        });
    }
    // Native audio without "-orig": the plain auto key is then the ASR
    // of the original track, not a translation.
    if audio.kind == AudioKind::Native {
        if let Some(key) = auto
            .iter()
            .find(|k| base_lang(k) == want && !k.contains("-orig"))
        {
            return Some(CaptionPick {
                key: key.clone(),
                kind: CaptionKind::Asr,
            });
        }
    }
    None
}

/// Summarize a `yt-dlp -J` document for one target language.
pub fn video_info(info: &Value, target: &str) -> VideoInfo {
    let audio = pick_audio(info, target);
    let captions = audio.as_ref().and_then(|a| pick_captions(info, a));
    let channel_url = match str_field(info, "channel_url") {
        "" => str_field(info, "uploader_url"),
        u => u,
    };
    VideoInfo {
        id: str_field(info, "id").to_string(),
        title: str_field(info, "title").to_string(),
        channel: str_field(info, "channel").to_string(),
        channel_url: channel_url.to_string(),
        duration: info.get("duration").and_then(Value::as_f64).unwrap_or(0.0),
        thumbnail: str_field(info, "thumbnail").to_string(),
        original_lang: info
            .get("language")
            .and_then(Value::as_str)
            .map(str::to_string),
        audio,
        captions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/tests/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn base_lang_folds_regions_and_aliases() {
        assert_eq!(base_lang("fr-FR"), "fr");
        assert_eq!(base_lang("zh-Hans"), "zh");
        assert_eq!(base_lang("iw"), "he");
        assert_eq!(base_lang("nb-NO"), "no");
        assert_eq!(base_lang(""), "");
    }

    #[test]
    fn auto_dub_picks_the_plain_m4a_track_and_its_own_asr() {
        let info = fixture("pakman-autodub");
        let v = video_info(&info, "fr");
        let audio = v.audio.expect("French dub");
        assert_eq!(audio.kind, AudioKind::Dub);
        assert!(audio.auto);
        assert_eq!(audio.lang, "fr-FR");
        assert_eq!(audio.format_id, "139-4");
        assert_eq!(audio.ext, "m4a");
        let captions = v.captions.expect("captions");
        assert_eq!(captions.key, "fr-orig");
        assert_eq!(captions.kind, CaptionKind::Asr);
    }

    #[test]
    fn every_language_follows_the_target() {
        let info = fixture("pakman-autodub");
        for (target, tag) in [("de", "de-DE"), ("es", "es-US"), ("ja", "ja"), ("he", "iw")] {
            let audio = pick_audio(&info, target).unwrap_or_else(|| panic!("{target}"));
            assert_eq!(audio.lang, tag);
            assert_eq!(audio.kind, AudioKind::Dub);
        }
    }

    #[test]
    fn the_original_language_is_native_audio() {
        let info = fixture("pakman-autodub");
        let v = video_info(&info, "en");
        let audio = v.audio.unwrap();
        assert_eq!(audio.kind, AudioKind::Native);
        assert!(!audio.auto);
        assert_eq!(v.captions.unwrap().key, "en-orig");
    }

    #[test]
    fn creator_dub_falls_back_to_uploaded_subtitles() {
        let info = fixture("mrbeast-creatordub");
        let v = video_info(&info, "fr");
        let audio = v.audio.unwrap();
        assert_eq!(audio.kind, AudioKind::Dub);
        assert!(!audio.auto);
        let captions = v.captions.unwrap();
        assert_eq!(captions.kind, CaptionKind::Uploaded);
        assert_eq!(captions.key, "fr");
    }

    #[test]
    fn no_track_in_the_language_means_none() {
        let info = fixture("destiny-english");
        let v = video_info(&info, "fr");
        assert!(v.audio.is_none());
        assert!(v.captions.is_none());
        assert!(video_info(&info, "en").audio.is_some());
    }

    #[test]
    fn single_track_native_video_without_language_tags() {
        let info = serde_json::json!({
            "id": "x", "language": "fr",
            "formats": [
                {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 130.0, "protocol": "https"},
                {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "abr": 129.0, "protocol": "https"},
                {"format_id": "139", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "abr": 48.0, "protocol": "https"}
            ],
            "automatic_captions": {"fr": [], "en": []}
        });
        let v = video_info(&info, "fr");
        let audio = v.audio.unwrap();
        assert_eq!(audio.kind, AudioKind::Native);
        assert_eq!(audio.format_id, "139");
        assert_eq!(audio.lang, "fr");
        assert_eq!(v.captions.unwrap().key, "fr");
    }
}
