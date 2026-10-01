//! Linux text-to-speech via the OS speech stack over CLI.
//!
//! Shared contract (mirrors the macOS bridge in `tts.rs`): the Tauri
//! commands `tts_supported`, `tts_speak` (returns the utterance id
//! immediately), `tts_stop`, and `tts_voices`. Progress returns to the
//! frontend as `tts-done` window events tagged with the utterance id.
//!
//! Backend, in preference order (all free, offline, no bundled models):
//! 1. Speech Dispatcher (`spd-say`) — the freedesktop OS speech service;
//!    the user's configured output module/voice speaks, so this honours
//!    the desktop's own voice setup with no app-side voice management.
//! 2. `espeak-ng` (or legacy `espeak`) — direct synthesis fallback where
//!    Speech Dispatcher is absent.
//!
//! Differences from macOS, by design: neither CLI reports word
//! boundaries, so no `tts-word` events are emitted (sentence-level
//! progress until `tts-done`), and no quality tiers exist (quality 1).
//! An explicit settings voice id is honoured only where the backend
//! accepts a voice name (`espeak-ng -v`); on Speech Dispatcher the
//! desktop-configured voice wins and the id is ignored.
//!
//! Threading: one worker thread owns the single running child. A newer
//! `tts_speak` kills the current child (its waiter reports
//! `finished=false` under the old id, which the frontend ignores) and
//! `tts_stop` kills it the same way. `tts_voices` shells out
//! synchronously on the worker.
//!
//! Platform gating follows `dictate_windows.rs`: the runtime lives in
//! `imp` behind `cfg(target_os = "linux")` (it is plain `std::process`
//! code with no OS-only dependencies). Every other platform gets
//! commands that report "requires Linux". The pure mapping helpers
//! below compile everywhere and are unit-tested on any host.

#![allow(dead_code)] // Linux-only shim: stubs compile everywhere, real code runs on Linux.
use tauri::AppHandle;

// Off-Apple builds share the stub `NativeVoice` shape from `tts.rs`
// (macOS/iOS have the real `imp` instead, which is private — the stub
// below only types the never-constructed Err signatures there).
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
use super::tts::imp::NativeVoice;
#[cfg(any(target_os = "macos", target_os = "ios"))]
#[derive(Clone, serde::Serialize)]
pub struct NativeVoice {
    id: String,
    name: String,
    lang: String,
    quality: i64,
}

/// Speech backend in preference order (see the module docs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    SpeechDispatcher,
    EspeakNg,
    Espeak,
}

/// Pick the backend from binary availability: Speech Dispatcher first,
/// then `espeak-ng`, then legacy `espeak`. None means no Linux speech
/// stack is installed. Pure.
pub fn pick_backend(spd_say: bool, espeak_ng: bool, espeak: bool) -> Option<Backend> {
    if spd_say {
        Some(Backend::SpeechDispatcher)
    } else if espeak_ng {
        Some(Backend::EspeakNg)
    } else if espeak {
        Some(Backend::Espeak)
    } else {
        None
    }
}

impl Backend {
    /// CLI program for this backend. Pure.
    pub fn program(&self) -> &'static str {
        match self {
            Backend::SpeechDispatcher => "spd-say",
            Backend::EspeakNg => "espeak-ng",
            Backend::Espeak => "espeak",
        }
    }

    /// Speak argv (excluding argv[0]) for `text` in `lang`. Pure:
    /// `spd-say -l <lang>` routes the configured module voice by
    /// language; espeak takes an `-v` voice name (see
    /// [`espeak_voice_for`]), overridden by an explicit settings voice.
    /// Both carry the Voice speed multiplier (`rate`, 1.0 = normal):
    /// `spd-say -r` and espeak `-s` (see [`spd_rate`] /
    /// [`espeak_speed`]).
    pub fn speak_argv(
        &self,
        lang: &str,
        voice: Option<&str>,
        rate: f32,
        text: &str,
    ) -> Vec<String> {
        match self {
            Backend::SpeechDispatcher => {
                let _ = voice;
                vec![
                    "-l".into(),
                    lang.into(),
                    "-r".into(),
                    spd_rate(rate).to_string(),
                    text.into(),
                ]
            }
            Backend::EspeakNg | Backend::Espeak => {
                let pick = voice
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| espeak_voice_for(lang));
                vec![
                    "-v".into(),
                    pick,
                    "-s".into(),
                    espeak_speed(rate).to_string(),
                    text.into(),
                ]
            }
        }
    }
}

/// `spd-say -r` value (-100..100, 0 is the default) for the Voice
/// speed multiplier (1.0 = normal, clamped 0.5x–1.5x upstream).
/// Pure: out-of-range multipliers saturate at the rails, never a
/// panic (`as` casts saturate; NaN reads as 0). Unit-tested.
pub fn spd_rate(rate: f32) -> i32 {
    (((rate - 1.0) * 100.0).round() as i32).clamp(-100, 100)
}

/// `espeak-ng`/`espeak` `-s` words-per-minute for the Voice speed
/// multiplier: 175 is espeak's default pace. Pure (floored at 1 so a
/// wild multiplier never formats a non-positive speed). Unit-tested.
pub fn espeak_speed(rate: f32) -> i32 {
    ((175.0 * rate).round() as i32).max(1)
}

/// `espeak-ng`/`espeak` voice name for a BCP-47 lang: the primary
/// subtag, lowercased, with the two CJK aliases espeak expects
/// (`zh`/`cmn` → `zh` Mandarin; espeak has no `cmn`). Anything else
/// passes through — espeak falls back to its default voice for unknown
/// names rather than failing. Pure and unit-tested.
pub fn espeak_voice_for(lang: &str) -> String {
    let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
    match primary.as_str() {
        "zh" | "cmn" => "zh".into(),
        _ => primary,
    }
}

/// Candidate executable paths for `name` out of a `PATH`-style string.
/// Pure (no filesystem access): the caller keeps the first candidate
/// that exists and is executable. Unit-tested.
pub fn candidate_paths(name: &str, path_env: &str) -> Vec<std::path::PathBuf> {
    path_env
        .split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| std::path::PathBuf::from(dir).join(name))
        .collect()
}

/// One inventoried voice: registry id, display name, BCP-47 lang.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FoundVoice {
    pub id: String,
    pub name: String,
    pub lang: String,
}

/// Parse `espeak-ng --voices` (or `espeak --voices`) table output.
/// Rows look like ` 5  en       M  english              en` (priority,
/// language, age/gender, voice name, file); the header line and
/// short/garbled rows are skipped. Lenient by design: voice tables
/// differ across espeak versions, and a missed row only hides a picker
/// entry — speech itself is unaffected. Pure and unit-tested.
pub fn parse_espeak_voices(output: &str) -> Vec<FoundVoice> {
    let mut out = Vec::new();
    for line in output.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 4 || cols[0].parse::<u32>().is_err() {
            continue;
        }
        let lang = cols[1].replace('_', "-");
        let name = cols[3].to_string();
        if name.is_empty() {
            continue;
        }
        out.push(FoundVoice {
            id: name.clone(),
            name,
            lang,
        });
    }
    out
}

/// Whether `s` looks like a BCP-47-ish language tag (2–3 letter
/// primary, optional `-`/`_` + subtags): guards the whitespace-row
/// parse below against mistaking a multi-word voice name for a
/// `name lang` pair. Pure and unit-tested.
pub fn looks_like_lang_tag(s: &str) -> bool {
    let (primary, rest) = match s.split_once(['-', '_']) {
        Some((p, r)) => (p, Some(r)),
        None => (s, None),
    };
    if !(2..=3).contains(&primary.len()) || !primary.bytes().all(|b| b.is_ascii_alphabetic()) {
        return false;
    }
    match rest {
        None => true,
        Some(r) => {
            !r.is_empty()
                && r.split(['-', '_'])
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_alphanumeric()))
        }
    }
}

/// Parse `spd-say --list-synthesis-voices` output. The exact layout
/// varies across Speech Dispatcher versions, so this is deliberately
/// forgiving: `name|lang` rows first, else whitespace rows whose first
/// token is the voice name with an optional second-token language
/// (only when it looks like a language tag — otherwise the whole line
/// is the name). Lines yielding no name are dropped; a missing
/// language becomes `und` (selectable by explicit id, never
/// auto-picked). Pure and unit-tested against the documented shape,
/// not a live daemon.
pub fn parse_spd_voices(output: &str) -> Vec<FoundVoice> {
    let mut out = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((name, lang)) = line.split_once('|') {
            let name = name.trim().to_string();
            if name.is_empty() {
                continue;
            }
            let lang = lang.trim();
            out.push(FoundVoice {
                id: name.clone(),
                name,
                lang: if lang.is_empty() {
                    "und".into()
                } else {
                    lang.into()
                },
            });
            continue;
        }
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.is_empty() || cols[0].starts_with('-') {
            continue;
        }
        let (name, lang) = match cols.as_slice() {
            [first, second, ..] if looks_like_lang_tag(second) => {
                (first.to_string(), second.to_string())
            }
            _ => (line.to_string(), "und".into()),
        };
        out.push(FoundVoice {
            id: name.clone(),
            name,
            lang,
        });
    }
    out
}

/// Does this build speak through the native engine? True on Linux when
/// a speech backend is installed (see [`pick_backend`]).
pub fn tts_supported() -> bool {
    #[cfg(target_os = "linux")]
    return imp::supported();
    #[cfg(not(target_os = "linux"))]
    return false;
}

/// Speak `text` (see `tts.rs` for the shared contract). Returns the
/// utterance id; completion arrives as `tts-done`.
pub fn tts_speak(
    app: AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
    rate: f32,
) -> Result<u64, String> {
    #[cfg(target_os = "linux")]
    return imp::speak(&app, text, lang, voice, rate);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, text, lang, voice, rate);
        return Err("native TTS requires Linux".into());
    }
}

/// Stop any in-progress native speech immediately.
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::stop(&app);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        return Err("native TTS requires Linux".into());
    }
}

/// List installed voices (quality is always 1 — neither CLI reports
/// tiers; see the module docs).
pub fn tts_voices(app: AppHandle) -> Result<Vec<NativeVoice>, String> {
    #[cfg(target_os = "linux")]
    return imp::voices(&app);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        return Err("native TTS requires Linux".into());
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{channel, Receiver, Sender},
        OnceLock,
    };
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};

    use super::{
        candidate_paths, parse_espeak_voices, parse_spd_voices, pick_backend, Backend, NativeVoice,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    /// Payload for `tts-done` — same wire shape as every other bridge.
    #[derive(Clone, serde::Serialize)]
    struct DoneEvent {
        id: u64,
        finished: bool,
    }

    enum Cmd {
        Speak {
            id: u64,
            text: String,
            lang: String,
            voice: Option<String>,
            rate: f32,
        },
        Stop,
        Voices(Sender<Result<Vec<NativeVoice>, String>>),
    }

    struct Engine {
        tx: Sender<Cmd>,
    }

    fn engine(app: &AppHandle) -> &'static Engine {
        ENGINE.get_or_init(|| {
            let _ = APP.set(app.clone());
            let (tx, rx) = channel::<Cmd>();
            std::thread::Builder::new()
                .name("ccez-tts-linux".into())
                .spawn(move || worker(rx))
                .expect("Linux TTS worker thread");
            Engine { tx }
        })
    }

    fn have_program(name: &str) -> bool {
        let path_env = std::env::var("PATH").unwrap_or_default();
        candidate_paths(name, &path_env).iter().any(|p| {
            std::fs::metadata(p)
                .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        })
    }

    fn detect() -> Option<Backend> {
        pick_backend(
            have_program("spd-say"),
            have_program("espeak-ng"),
            have_program("espeak"),
        )
    }

    fn missing_stack() -> String {
        "no Linux speech backend found (install Speech Dispatcher for the `spd-say` CLI, or espeak-ng)".to_string()
    }

    fn emit_done(id: u64, finished: bool) {
        if let Some(app) = APP.get() {
            let _ = app.emit("tts-done", DoneEvent { id, finished });
        }
    }

    /// Run one utterance to completion, draining control commands while
    /// the child speaks. Returns the preempting Speak, if any.
    fn serve(
        rx: &Receiver<Cmd>,
        child: &mut std::process::Child,
        id: u64,
    ) -> Option<(u64, String, String, Option<String>, f32)> {
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Cmd::Stop) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    emit_done(id, false);
                    return None;
                }
                Ok(Cmd::Speak {
                    id: next,
                    text,
                    lang,
                    voice,
                    rate: next_rate,
                }) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    emit_done(id, false);
                    return Some((next, text, lang, voice, next_rate));
                }
                Ok(Cmd::Voices(reply)) => {
                    let _ = reply.send(list_voices());
                }
                Err(_) => match child.try_wait() {
                    Ok(Some(_)) => {
                        emit_done(id, true);
                        return None;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        emit_done(id, false);
                        return None;
                    }
                },
            }
        }
    }

    fn spawn_speak(
        backend: Backend,
        lang: &str,
        voice: Option<&str>,
        rate: f32,
        text: &str,
    ) -> std::io::Result<std::process::Child> {
        let argv = backend.speak_argv(lang, voice, rate, text);
        std::process::Command::new(backend.program())
            .args(&argv)
            .spawn()
    }

    fn list_voices() -> Result<Vec<NativeVoice>, String> {
        let backend = detect().ok_or_else(missing_stack)?;
        let found = match backend {
            Backend::SpeechDispatcher => {
                let out = std::process::Command::new("spd-say")
                    .arg("--list-synthesis-voices")
                    .output()
                    .map_err(|e| format!("voice inventory failed: {e}"))?;
                if !out.status.success() {
                    // Older/newer daemons may not know this flag: an
                    // empty inventory (picker hidden) beats an error —
                    // speech itself is unaffected.
                    return Ok(Vec::new());
                }
                parse_spd_voices(&String::from_utf8_lossy(&out.stdout))
            }
            Backend::EspeakNg | Backend::Espeak => {
                let out = std::process::Command::new(backend.program())
                    .arg("--voices")
                    .output()
                    .map_err(|e| format!("voice inventory failed: {e}"))?;
                if !out.status.success() {
                    return Ok(Vec::new());
                }
                parse_espeak_voices(&String::from_utf8_lossy(&out.stdout))
            }
        };
        Ok(found
            .into_iter()
            .map(|v| NativeVoice {
                id: v.id,
                name: v.name,
                lang: v.lang,
                quality: 1,
            })
            .collect())
    }

    fn worker(rx: Receiver<Cmd>) {
        for cmd in &rx {
            match cmd {
                Cmd::Speak {
                    id,
                    text,
                    lang,
                    voice,
                    rate,
                } => {
                    let Some(backend) = detect() else {
                        eprintln!("[tts] speak id={id}: {}", missing_stack());
                        emit_done(id, false);
                        continue;
                    };
                    let mut child = match spawn_speak(backend, &lang, voice.as_deref(), rate, &text)
                    {
                        Ok(child) => child,
                        Err(e) => {
                            eprintln!("[tts] speak id={id} lang={lang}: spawn failed: {e}");
                            emit_done(id, false);
                            continue;
                        }
                    };
                    eprintln!("[tts] speak id={id} lang={lang} backend={backend:?}");
                    let mut next = serve(&rx, &mut child, id);
                    while let Some((id, text, lang, voice, rate)) = next {
                        let Some(backend) = detect() else {
                            emit_done(id, false);
                            next = None;
                            continue;
                        };
                        match spawn_speak(backend, &lang, voice.as_deref(), rate, &text) {
                            Ok(mut child) => {
                                next = serve(&rx, &mut child, id);
                            }
                            Err(e) => {
                                eprintln!("[tts] speak id={id} lang={lang}: spawn failed: {e}");
                                emit_done(id, false);
                                next = None;
                            }
                        }
                    }
                }
                Cmd::Stop => {}
                Cmd::Voices(reply) => {
                    let _ = reply.send(list_voices());
                }
            }
        }
    }

    pub fn supported() -> bool {
        detect().is_some()
    }

    pub fn speak(
        app: &AppHandle,
        text: String,
        lang: String,
        voice: Option<String>,
        rate: f32,
    ) -> Result<u64, String> {
        if text.trim().is_empty() {
            return Ok(0);
        }
        if detect().is_none() {
            return Err(missing_stack());
        }
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        engine(app)
            .tx
            .send(Cmd::Speak {
                id,
                text,
                lang,
                voice,
                rate,
            })
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn stop(app: &AppHandle) -> Result<(), String> {
        // Killing nothing is harmless; ignore a dead worker — stopping
        // must never throw from UI teardown paths.
        let _ = engine(app).tx.send(Cmd::Stop);
        Ok(())
    }

    pub fn voices(app: &AppHandle) -> Result<Vec<NativeVoice>, String> {
        let (reply_tx, reply_rx) = channel();
        engine(app)
            .tx
            .send(Cmd::Voices(reply_tx))
            .map_err(|e| e.to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod linux_tts_tests {
    use super::{
        candidate_paths, espeak_speed, espeak_voice_for, parse_espeak_voices, parse_spd_voices,
        pick_backend, spd_rate, Backend,
    };

    #[test]
    fn backend_prefers_speech_dispatcher() {
        assert_eq!(
            pick_backend(true, true, true),
            Some(Backend::SpeechDispatcher)
        );
        assert_eq!(pick_backend(false, true, true), Some(Backend::EspeakNg));
        assert_eq!(pick_backend(false, false, true), Some(Backend::Espeak));
        assert_eq!(pick_backend(false, false, false), None);
        assert_eq!(Backend::SpeechDispatcher.program(), "spd-say");
        assert_eq!(Backend::EspeakNg.program(), "espeak-ng");
    }

    #[test]
    fn speak_argv_routes_by_backend() {
        assert_eq!(
            Backend::SpeechDispatcher.speak_argv("de-DE", Some("ignored"), 1.0, "Hallo"),
            vec!["-l", "de-DE", "-r", "0", "Hallo"]
        );
        assert_eq!(
            Backend::EspeakNg.speak_argv("en-US", None, 1.0, "hi"),
            vec!["-v", "en", "-s", "175", "hi"]
        );
        assert_eq!(
            Backend::EspeakNg.speak_argv("zh-CN", None, 1.0, "ni hao"),
            vec!["-v", "zh", "-s", "175", "ni hao"]
        );
        // An explicit settings voice overrides the language-derived one.
        assert_eq!(
            Backend::EspeakNg.speak_argv("en-US", Some("english-mb-en1"), 1.0, "hi"),
            vec!["-v", "english-mb-en1", "-s", "175", "hi"]
        );
    }

    #[test]
    fn speak_argv_carries_voice_speed() {
        assert_eq!(spd_rate(1.0), 0);
        assert_eq!(spd_rate(0.5), -50);
        assert_eq!(spd_rate(1.5), 50);
        assert_eq!(spd_rate(3.0), 100);
        assert_eq!(spd_rate(-1.0), -100);
        assert_eq!(spd_rate(f32::NAN), 0);
        assert_eq!(espeak_speed(1.0), 175);
        assert_eq!(espeak_speed(0.5), 88);
        assert_eq!(espeak_speed(1.5), 263);
        assert_eq!(espeak_speed(f32::NAN), 1);
        assert_eq!(
            Backend::SpeechDispatcher.speak_argv("de-DE", None, 0.5, "Hallo"),
            vec!["-l", "de-DE", "-r", "-50", "Hallo"]
        );
        assert_eq!(
            Backend::EspeakNg.speak_argv("en-US", None, 1.5, "hi"),
            vec!["-v", "en", "-s", "263", "hi"]
        );
    }

    #[test]
    fn espeak_voice_maps_cjk_aliases() {
        assert_eq!(espeak_voice_for("en-US"), "en");
        assert_eq!(espeak_voice_for("zh-CN"), "zh");
        assert_eq!(espeak_voice_for("cmn"), "zh");
        assert_eq!(espeak_voice_for("ja-JP"), "ja");
    }

    #[test]
    fn candidates_come_from_path_entries() {
        let paths = candidate_paths("spd-say", "/usr/bin:/bin:");
        assert_eq!(
            paths,
            vec![
                std::path::PathBuf::from("/usr/bin/spd-say"),
                std::path::PathBuf::from("/bin/spd-say"),
            ]
        );
        assert!(candidate_paths("spd-say", "").is_empty());
    }

    #[test]
    fn espeak_table_parses_and_skips_header() {
        let sample = "Pty Language Age/Gender VoiceName          File\n 5  en       M  english              en\n 5  zh       -  Mandarin             zh\nshort\n";
        let voices = parse_espeak_voices(sample);
        assert_eq!(voices.len(), 2);
        assert_eq!(voices[0].name, "english");
        assert_eq!(voices[0].lang, "en");
        assert_eq!(voices[1].lang, "zh");
    }

    #[test]
    fn spd_inventory_parses_pipe_rows_and_defaults_lang() {
        let sample = "Festival American English|en-US\nSome Voice\nkal en-US\n";
        let voices = parse_spd_voices(sample);
        assert_eq!(voices.len(), 3);
        assert_eq!(voices[0].lang, "en-US");
        assert_eq!(voices[1].name, "Some Voice");
        assert_eq!(voices[1].lang, "und");
        assert_eq!(voices[2].name, "kal");
        assert_eq!(voices[2].lang, "en-US");
    }

    #[test]
    fn lang_tag_guard_rejects_names() {
        assert!(super::looks_like_lang_tag("en"));
        assert!(super::looks_like_lang_tag("en-US"));
        assert!(super::looks_like_lang_tag("zh"));
        assert!(!super::looks_like_lang_tag("Voice"));
        assert!(!super::looks_like_lang_tag("english"));
        assert!(!super::looks_like_lang_tag("en-"));
        assert!(!super::looks_like_lang_tag("e"));
    }
}
