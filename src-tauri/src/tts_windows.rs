//! Windows text-to-speech via SAPI 5 (`ISpeechVoice` automation).
//!
//! Shared contract (mirrors the macOS bridge in `tts.rs`): the Tauri
//! commands `tts_supported` (always true here — SAPI ships in-box),
//! `tts_speak` (returns the utterance id immediately), `tts_stop`, and
//! `tts_voices` (installed SAPI voice tokens). Progress returns to the
//! frontend as `tts-done` window events tagged with the utterance id, so
//! a stale cancel can never reset the voice UI of newer speech.
//!
//! Differences from macOS, by design: SAPI word-boundary events are not
//! plumbed, so no `tts-word` events are emitted — the frontend simply
//! shows sentence-level progress until `tts-done`. SAPI exposes no
//! quality tiers either, so every inventoried voice reports quality 1.
//!
//! Threading: one worker thread owns the single `ISpeechVoice` (STA
//! apartment, created there). Async speech returns immediately; the
//! worker polls `RunningState` while draining the command channel, so
//! `tts_stop` (purge) and a newer `tts_speak` (purge + replace) take
//! effect mid-utterance. Stopping mid-utterance reports `finished=false`.
//!
//! Platform gating follows `dictate_windows.rs`: the SAPI engine lives
//! in `imp` behind `cfg(target_os = "windows")`. Every other platform
//! gets commands that report "requires Windows". The pure mapping
//! helpers below compile everywhere and are unit-tested on any host.

#![allow(dead_code)] // Windows-only shim: stubs compile everywhere, real code runs on Windows.
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

/// Payload for `tts-done`. `finished=false` means the utterance was
/// stopped midway (Skip / replaced) rather than spoken to the end —
/// same shape as the macOS bridge, so the frontend matches by id.
#[derive(Clone, serde::Serialize, Debug, PartialEq)]
pub struct DoneEvent {
    pub id: u64,
    pub finished: bool,
}

/// Parse a SAPI voice `Language` attribute (`"409"`, hex LCID) into a
/// numeric LCID. Pure: anything unparseable is None, never a panic.
pub fn parse_lcid_hex(attr: &str) -> Option<u32> {
    u32::from_str_radix(attr.trim(), 16).ok()
}

/// BCP-47 tag for a numeric LCID, covering the locales SAPI voices
/// commonly ship. Pure: unknown LCIDs are None (callers inventory the
/// voice as `und` rather than guessing).
pub fn lcid_to_bcp47(lcid: u32) -> Option<&'static str> {
    Some(match lcid {
        0x401 => "ar-SA",
        0x405 => "cs-CZ",
        0x406 => "da-DK",
        0x407 => "de-DE",
        0x807 => "de-CH",
        0xc07 => "de-AT",
        0x408 => "el-GR",
        0x409 => "en-US",
        0x809 => "en-GB",
        0xc09 => "en-AU",
        0x1009 => "en-CA",
        0x1409 => "en-NZ",
        0x1809 => "en-IE",
        0x1c09 => "en-ZA",
        0x4009 => "en-IN",
        0x40a => "es-ES",
        0x80a => "es-MX",
        0x40b => "fi-FI",
        0x40c => "fr-FR",
        0x80c => "fr-BE",
        0xc0c => "fr-CA",
        0x100c => "fr-CH",
        0x40d => "he-IL",
        0x439 => "hi-IN",
        0x40e => "hu-HU",
        0x421 => "id-ID",
        0x410 => "it-IT",
        0x411 => "ja-JP",
        0x412 => "ko-KR",
        0x43e => "ms-MY",
        0x413 => "nl-NL",
        0x414 => "nb-NO",
        0x415 => "pl-PL",
        0x416 => "pt-BR",
        0x816 => "pt-PT",
        0x418 => "ro-RO",
        0x419 => "ru-RU",
        0x41b => "sk-SK",
        0x41d => "sv-SE",
        0x41e => "th-TH",
        0x41f => "tr-TR",
        0x422 => "uk-UA",
        0x42a => "vi-VN",
        0x804 => "zh-CN",
        0x404 => "zh-TW",
        0xc04 => "zh-HK",
        _ => return None,
    })
}

/// BCP-47 tag for a raw SAPI `Language` attribute (`"409"` →
/// `Some("en-US")`). Pure: unknown or malformed attributes are None.
pub fn bcp47_from_lcid_attr(attr: &str) -> Option<&'static str> {
    lcid_to_bcp47(parse_lcid_hex(attr)?)
}

/// SAPI speech rate (-10..10, 0 is the default) for a BCP-47 lang:
/// Mandarin at the default rate rushes past learners, so Chinese reads
/// slightly slower — the same rule as macOS `speech_rate_for`, mapped
/// onto the SAPI scale. Pure and unit-tested.
pub fn sapi_rate_for(lang: &str) -> i32 {
    let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
    if primary == "zh" || primary == "cmn" {
        -2
    } else {
        0
    }
}

/// SAPI speech rate for a speak request: the per-language base from
/// [`sapi_rate_for`] plus the Voice speed multiplier (1.0 = normal,
/// clamped 0.5x–1.5x upstream) mapped linearly onto ±5 steps. Pure:
/// out-of-range multipliers saturate at the SAPI −10..10 rails, never
/// a panic (`as` casts saturate; NaN reads as 0). Unit-tested.
pub fn sapi_speak_rate(lang: &str, rate: f32) -> i32 {
    let steps = ((rate - 1.0) * 10.0).round() as i32;
    (sapi_rate_for(lang) + steps).clamp(-10, 10)
}

/// Pick the voice token id for a speak request out of the inventoried
/// `(id, lang)` pairs. Priority: the explicit settings voice (exact
/// inventoried id) > exact locale (`en-GB` for `en-GB`) >
/// primary-language prefix (`en-*` for `en`). None means "keep the
/// default voice". Pure.
pub fn select_token(
    tokens: &[(String, String)],
    lang: &str,
    voice: Option<&str>,
) -> Option<String> {
    if let Some(wanted) = voice.filter(|v| !v.is_empty()) {
        if let Some(hit) = tokens.iter().find(|(id, _)| id == wanted) {
            return Some(hit.0.clone());
        }
    }
    let wanted = lang.trim().to_lowercase();
    if let Some(hit) = tokens.iter().find(|(_, l)| l.to_lowercase() == wanted) {
        return Some(hit.0.clone());
    }
    let primary = wanted.split(['-', '_']).next().unwrap_or(&wanted);
    tokens
        .iter()
        .find(|(_, l)| {
            let n = l.to_lowercase();
            n == *primary || n.starts_with(&format!("{primary}-"))
        })
        .map(|(id, _)| id.clone())
}

/// Does this build speak through the native engine? Always true on
/// Windows (SAPI ships in-box) — the frontend gates the toggle on this.
pub fn tts_supported() -> bool {
    #[cfg(target_os = "windows")]
    return imp::supported();
    #[cfg(not(target_os = "windows"))]
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
    #[cfg(target_os = "windows")]
    return imp::speak(&app, text, lang, voice, rate);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, text, lang, voice, rate);
        return Err("native TTS requires Windows".into());
    }
}

/// Stop any in-progress native speech immediately.
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return imp::stop(&app);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("native TTS requires Windows".into());
    }
}

/// List installed SAPI voices (quality is always 1 — SAPI exposes no
/// tiers; see the module docs).
pub fn tts_voices(app: AppHandle) -> Result<Vec<NativeVoice>, String> {
    #[cfg(target_os = "windows")]
    return imp::voices(&app);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("native TTS requires Windows".into());
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{channel, Receiver, Sender},
        OnceLock,
    };
    use std::time::Duration;

    use tauri::{AppHandle, Emitter};
    use windows::core::BSTR;
    use windows::Win32::Media::Speech::{
        ISpeechObjectToken, ISpeechVoice, SRSEIsSpeaking, SVSFPurgeBeforeSpeak, SVSFlagsAsync,
        SpVoice,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };

    use super::{sapi_speak_rate, select_token, DoneEvent, NativeVoice};

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static ENGINE: OnceLock<EngineResult> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

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

    struct EngineResult {
        tx: Option<Sender<Cmd>>,
        init_err: Option<String>,
    }

    fn engine(app: &AppHandle) -> &'static EngineResult {
        ENGINE.get_or_init(|| {
            let _ = APP.set(app.clone());
            let (tx, rx) = channel::<Cmd>();
            let (init_tx, init_rx) = channel::<Result<(), String>>();
            std::thread::Builder::new()
                .name("ccez-tts-win".into())
                .spawn(move || worker(rx, init_tx))
                .expect("Windows TTS worker thread");
            match init_rx.recv_timeout(Duration::from_secs(10)) {
                Ok(Ok(())) => EngineResult {
                    tx: Some(tx),
                    init_err: None,
                },
                Ok(Err(e)) => EngineResult {
                    tx: None,
                    init_err: Some(e),
                },
                Err(_) => EngineResult {
                    tx: None,
                    init_err: Some("speech engine did not start (SAPI unavailable?)".into()),
                },
            }
        })
    }

    /// Stable identity for one SAPI voice token: `(id, name, lang)`.
    /// The automation `ISpeechObjectToken` exposes no token id
    /// (`GetId` exists only on the raw `ISpObjectToken`), so the id is
    /// the token description (`Microsoft David - English (United
    /// States)`), suffixed with the language when known. Deterministic
    /// per installed voice — the settings picker stores it opaquely.
    /// A token whose description is missing is skipped; one whose
    /// `Language` attribute is missing or unknown keeps lang `und`
    /// (still selectable by explicit id, never auto-picked).
    fn describe_token(token: &ISpeechObjectToken) -> Option<(String, String, String)> {
        unsafe {
            let name = token
                .GetDescription(0)
                .map(|b| b.to_string())
                .unwrap_or_default();
            if name.trim().is_empty() {
                return None;
            }
            let lang = token
                .GetAttribute(&BSTR::from("Language"))
                .ok()
                .and_then(|a| super::bcp47_from_lcid_attr(&a.to_string()))
                .unwrap_or("und")
                .to_string();
            let id = if lang == "und" {
                name.clone()
            } else {
                format!("{name} [{lang}]")
            };
            Some((id, name, lang))
        }
    }

    /// Current SAPI voice tokens as `(id, lang)` pairs, for
    /// [`select_token`].
    fn inventory(voice: &ISpeechVoice) -> Vec<(String, String)> {
        unsafe {
            let empty = BSTR::from("");
            let Ok(tokens) = voice.GetVoices(&empty, &empty) else {
                return Vec::new();
            };
            let Ok(count) = tokens.Count() else {
                return Vec::new();
            };
            let mut out = Vec::new();
            for i in 0..count {
                let Ok(token) = tokens.Item(i) else {
                    continue;
                };
                if let Some((id, _, lang)) = describe_token(&token) {
                    out.push((id, lang));
                }
            }
            out
        }
    }

    fn inventory_public(voice: &ISpeechVoice) -> Vec<NativeVoice> {
        unsafe {
            let empty = BSTR::from("");
            let Ok(tokens) = voice.GetVoices(&empty, &empty) else {
                return Vec::new();
            };
            let Ok(count) = tokens.Count() else {
                return Vec::new();
            };
            let mut out = Vec::new();
            for i in 0..count {
                let Ok(token) = tokens.Item(i) else {
                    continue;
                };
                if let Some((id, name, lang)) = describe_token(&token) {
                    out.push(NativeVoice {
                        id,
                        name,
                        lang,
                        quality: 1,
                    });
                }
            }
            out
        }
    }

    fn apply_voice(voice: &ISpeechVoice, token_id: &str) {
        unsafe {
            let empty = BSTR::from("");
            let Ok(tokens) = voice.GetVoices(&empty, &empty) else {
                return;
            };
            let Ok(count) = tokens.Count() else {
                return;
            };
            for i in 0..count {
                let Ok(token): Result<ISpeechObjectToken, _> = tokens.Item(i) else {
                    continue;
                };
                if describe_token(&token).is_some_and(|(id, _, _)| id == token_id) {
                    let _ = voice.putref_Voice(&token);
                    return;
                }
            }
        }
    }

    /// Purge the SAPI queue: speaking an empty string with the purge
    /// flag is the documented SAPI stop. Best-effort by design.
    fn purge(voice: &ISpeechVoice) {
        unsafe {
            let _ = voice.Speak(&BSTR::from(""), SVSFPurgeBeforeSpeak);
        }
    }

    fn is_speaking(voice: &ISpeechVoice) -> bool {
        unsafe {
            voice
                .Status()
                .and_then(|s| s.RunningState())
                .map(|state| state.0 == SRSEIsSpeaking.0)
                .unwrap_or(false)
        }
    }

    fn emit_done(id: u64, finished: bool) {
        if let Some(app) = APP.get() {
            let _ = app.emit("tts-done", DoneEvent { id, finished });
        }
    }

    /// Serve one utterance to completion: poll `RunningState` while
    /// draining control commands. Returns the next Speak to serve
    /// (a newer utterance preempted this one), or None.
    fn serve(
        voice: &ISpeechVoice,
        rx: &Receiver<Cmd>,
        id: u64,
        text: String,
        lang: String,
        voice_pick: Option<String>,
        rate: f32,
    ) -> Option<(u64, String, String, Option<String>, f32)> {
        // A newer speak replaces the current audio: purge first so the
        // tails never overlap, then select the voice for this language.
        purge(voice);
        let pick = select_token(&inventory(voice), &lang, voice_pick.as_deref());
        if let Some(token_id) = pick {
            apply_voice(voice, &token_id);
        }
        unsafe {
            let _ = voice.SetRate(sapi_speak_rate(&lang, rate));
            if voice
                .Speak(&BSTR::from(text.as_str()), SVSFlagsAsync)
                .is_err()
            {
                eprintln!("[tts] speak id={id} lang={lang}: SAPI rejected the text");
                emit_done(id, false);
                return None;
            }
        }
        eprintln!("[tts] speak id={id} lang={lang}");
        loop {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(Cmd::Stop) => {
                    purge(voice);
                    emit_done(id, false);
                    return None;
                }
                Ok(Cmd::Speak {
                    id: next,
                    text,
                    lang,
                    voice: voice_pick,
                    rate: next_rate,
                }) => {
                    purge(voice);
                    emit_done(id, false);
                    return Some((next, text, lang, voice_pick, next_rate));
                }
                Ok(Cmd::Voices(reply)) => {
                    let _ = reply.send(Ok(inventory_public(voice)));
                }
                Err(_) => {
                    if !is_speaking(voice) {
                        emit_done(id, true);
                        return None;
                    }
                }
            }
        }
    }

    fn worker(rx: Receiver<Cmd>, init_tx: Sender<Result<(), String>>) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        struct Uninit;
        impl Drop for Uninit {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _uninit = Uninit;

        let synth: ISpeechVoice = unsafe {
            match CoCreateInstance(&SpVoice, None, CLSCTX_ALL) {
                Ok(v) => v,
                Err(e) => {
                    let _ = init_tx.send(Err(format!(
                        "Windows speech engine unavailable ({e}). SAPI ships with Windows — \
                         check Settings → Time & language → Speech for installed voices."
                    )));
                    return;
                }
            }
        };
        let _ = init_tx.send(Ok(()));
        // Idle loop: only Speak leaves it; Stop/Voices outside an
        // utterance are no-ops (Stop) or served immediately (Voices).
        // (`synth` is the SAPI voice; the `voice` inside Speak is the
        // requested voice id — different bindings, hence the names.)
        for cmd in &rx {
            match cmd {
                Cmd::Speak {
                    id,
                    text,
                    lang,
                    voice,
                    rate,
                } => {
                    let mut next = serve(&synth, &rx, id, text, lang, voice, rate);
                    while let Some((id, text, lang, voice, rate)) = next {
                        next = serve(&synth, &rx, id, text, lang, voice, rate);
                    }
                }
                Cmd::Stop => {}
                Cmd::Voices(reply) => {
                    let _ = reply.send(Ok(inventory_public(&synth)));
                }
            }
        }
    }

    pub fn supported() -> bool {
        true
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
        let engine = engine(app);
        match (&engine.tx, &engine.init_err) {
            (Some(tx), _) => {
                let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
                tx.send(Cmd::Speak {
                    id,
                    text,
                    lang,
                    voice,
                    rate,
                })
                .map_err(|e| e.to_string())?;
                Ok(id)
            }
            (None, err) => Err(err
                .clone()
                .unwrap_or_else(|| "Windows speech engine unavailable".into())),
        }
    }

    pub fn stop(app: &AppHandle) -> Result<(), String> {
        let engine = engine(app);
        if let Some(tx) = &engine.tx {
            // The worker may be between utterances; a purge with nothing
            // queued is harmless, and a missing worker means silence.
            let _ = tx.send(Cmd::Stop);
        }
        Ok(())
    }

    pub fn voices(app: &AppHandle) -> Result<Vec<NativeVoice>, String> {
        let engine = engine(app);
        let tx = engine.tx.as_ref().ok_or_else(|| {
            engine
                .init_err
                .clone()
                .unwrap_or_else(|| "Windows speech engine unavailable".into())
        })?;
        let (reply_tx, reply_rx) = channel();
        tx.send(Cmd::Voices(reply_tx)).map_err(|e| e.to_string())?;
        reply_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod windows_tts_tests {
    use super::{
        bcp47_from_lcid_attr, lcid_to_bcp47, parse_lcid_hex, sapi_rate_for, sapi_speak_rate,
        select_token, DoneEvent,
    };

    #[test]
    fn lcid_hex_parses_and_maps() {
        assert_eq!(parse_lcid_hex("409"), Some(0x409));
        assert_eq!(parse_lcid_hex(" 809 "), Some(0x809));
        assert_eq!(parse_lcid_hex("xyz"), None);
        assert_eq!(lcid_to_bcp47(0x409), Some("en-US"));
        assert_eq!(lcid_to_bcp47(0x411), Some("ja-JP"));
        assert_eq!(lcid_to_bcp47(0x804), Some("zh-CN"));
        assert_eq!(lcid_to_bcp47(0x9999), None);
        assert_eq!(bcp47_from_lcid_attr("409"), Some("en-US"));
        assert_eq!(bcp47_from_lcid_attr("nope"), None);
    }

    #[test]
    fn chinese_rate_slower_than_default() {
        assert!(sapi_rate_for("zh-CN") < sapi_rate_for("en-US"));
        assert_eq!(sapi_rate_for("zh-CN"), -2);
        assert_eq!(sapi_rate_for("cmn"), -2);
        assert_eq!(sapi_rate_for("en-US"), 0);
        assert_eq!(sapi_rate_for("ja"), 0);
    }

    #[test]
    fn speak_rate_adds_speed_to_language_base() {
        assert_eq!(sapi_speak_rate("en-US", 1.0), 0);
        assert_eq!(sapi_speak_rate("en-US", 0.5), -5);
        assert_eq!(sapi_speak_rate("en-US", 1.5), 5);
        assert_eq!(sapi_speak_rate("zh-CN", 1.0), -2);
        assert_eq!(sapi_speak_rate("zh-CN", 0.5), -7);
        assert_eq!(sapi_speak_rate("zh-CN", 1.5), 3);
        // Out-of-range multipliers saturate at the SAPI rails.
        assert_eq!(sapi_speak_rate("en-US", 3.0), 10);
        assert_eq!(sapi_speak_rate("en-US", -1.0), -10);
        assert_eq!(sapi_speak_rate("en-US", f32::NAN), 0);
    }

    #[test]
    fn voice_pick_prefers_explicit_then_exact_then_primary() {
        let tokens = vec![
            ("tok-en".to_string(), "en-US".to_string()),
            ("tok-gb".to_string(), "en-GB".to_string()),
            ("tok-de".to_string(), "de-DE".to_string()),
        ];
        assert_eq!(
            select_token(&tokens, "fr-FR", Some("tok-de")),
            Some("tok-de".to_string())
        );
        assert_eq!(
            select_token(&tokens, "en-GB", None),
            Some("tok-gb".to_string())
        );
        assert_eq!(
            select_token(&tokens, "en-AU", None),
            Some("tok-en".to_string())
        );
        assert_eq!(select_token(&tokens, "fr-FR", None), None);
        assert_eq!(select_token(&tokens, "fr-FR", Some("")), None);
    }

    #[test]
    fn done_event_uses_finished_key_shape() {
        // Same wire shape as the macOS bridge: the frontend matches
        // `tts-done` on exactly these keys.
        let value = serde_json::to_value(DoneEvent {
            id: 7,
            finished: true,
        })
        .expect("payload serializes");
        assert_eq!(value, serde_json::json!({"id": 7, "finished": true}));
    }
}
