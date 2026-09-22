//! Native macOS text-to-speech via `AVSpeechSynthesizer`.
//!
//! Pure-Rust bindings through `objc2` — no Objective-C is written anywhere
//! in this project. Apple's premium/Siri-quality voices live behind this API;
//! the browser's `speechSynthesis` only sees the compact voice set, which is
//! why web speech sounds robotic in comparison.
//!
//! Design: a worker thread queues requests, but the synthesizer itself is
//! owned by the main thread. `AVSpeechSynthesizer` delivers delegate
//! callbacks (word boundaries, finish/cancel) on the main runloop — a
//! worker-owned synthesizer plays audio fine but its callbacks never fire,
//! so the UI stuck "speaking" after the audio ended. Tauri commands only
//! enqueue requests; progress returns to the frontend as `tts-word` /
//! `tts-done` window events tagged with a per-utterance id, so a stale
//! cancel can never reset the voice UI of newer speech.
//!
//! Compiled only on macOS. Every other platform gets stubs that report
//! "unsupported", and the frontend hides the engine toggle unless
//! `tts_supported` is true.

use tauri::AppHandle;

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod imp {
    use std::cell::RefCell;
    use std::sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc::{Receiver, Sender, channel},
    };
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{ClassType, MainThreadMarker, define_class, msg_send};
    use objc2_natural_language::NLLanguageRecognizer;
    use objc2_avf_audio::{
        AVSpeechBoundary, AVSpeechSynthesizer, AVSpeechSynthesizerDelegate, AVSpeechSynthesisVoice,
        AVSpeechUtterance,
    };
    use objc2_foundation::{
        NSDictionary, NSRange, NSUserDefaults, NSObject, NSObjectProtocol, NSString,
    };
    use tauri::{AppHandle, Emitter};

    /// Payload for `tts-word`: which utterance and which UTF-16 range of its
    /// text is being spoken (same units as `NSString` offsets).
    #[derive(Clone, serde::Serialize)]
    struct WordEvent {
        id: u64,
        location: u64,
        length: u64,
    }

    /// Payload for `tts-done`. `finished=false` means the utterance was
    /// stopped midway (Skip) rather than spoken to the end.
    #[derive(Clone, serde::Serialize)]
    struct DoneEvent {
        id: u64,
        finished: bool,
    }

    /// One installed system voice, as seen by `AVSpeechSynthesisVoice`.
    /// `quality`: 1 = default, 2 = enhanced, 3 = premium.
    #[derive(Clone, serde::Serialize)]
    pub struct NativeVoice {
        id: String,
        name: String,
        lang: String,
        quality: i64,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    // SAFETY: stateless delegate — no ivars, no shared mutation. Emission
    // goes through the thread-safe `AppHandle`.
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "CcezTtsDelegate"]
        struct TtsDelegate;

        unsafe impl NSObjectProtocol for TtsDelegate {}

        unsafe impl AVSpeechSynthesizerDelegate for TtsDelegate {
            #[unsafe(method(speechSynthesizer:willSpeakRangeOfSpeechString:utterance:))]
            unsafe fn speech_synthesizer_will_speak_range(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                character_range: NSRange,
                _utterance: &AVSpeechUtterance,
            ) {
                // The utterance id rides a side channel: the worker stamps
                // CURRENT_ID before speaking, and speech is strictly serial
                // (each speak stops the previous utterance first).
                if let Some(app) = APP.get() {
                    let _ = app.emit(
                        "tts-word",
                        WordEvent {
                            id: CURRENT_ID.load(Ordering::SeqCst),
                            location: character_range.location as u64,
                            length: character_range.length as u64,
                        },
                    );
                }
            }

            #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
            unsafe fn speech_synthesizer_did_finish(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                _utterance: &AVSpeechUtterance,
            ) {
                let id = CURRENT_ID.load(Ordering::SeqCst);
                eprintln!("[tts] done id={id} finished=true");
                if let Some(app) = APP.get() {
                    let _ = app.emit("tts-done", DoneEvent { id, finished: true });
                }
            }

            #[unsafe(method(speechSynthesizer:didCancelSpeechUtterance:))]
            unsafe fn speech_synthesizer_did_cancel(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                _utterance: &AVSpeechUtterance,
            ) {
                let id = CURRENT_ID.load(Ordering::SeqCst);
                eprintln!("[tts] done id={id} finished=false");
                if let Some(app) = APP.get() {
                    let _ = app.emit("tts-done", DoneEvent { id, finished: false });
                }
            }
        }
    );

    static CURRENT_ID: AtomicU64 = AtomicU64::new(0);

    enum Cmd {
        Speak {
            id: u64,
            text: String,
            lang: String,
            voice: Option<String>,
        },
        Stop,
        Voices(Sender<Vec<NativeVoice>>),
    }

    struct Engine {
        tx: Sender<Cmd>,
    }

    fn engine(app: &AppHandle) -> &'static Engine {
        ENGINE.get_or_init(|| {
            let _ = APP.set(app.clone());
            let (tx, rx) = channel::<Cmd>();
            std::thread::Builder::new()
                .name("ccez-tts".into())
                .spawn(move || worker(rx))
                .expect("TTS worker thread");
            Engine { tx }
        })
    }

    /// Best installed voice for a BCP-47 tag: exact locale wins, otherwise
    /// the primary-language prefix. Higher quality wins outright
    /// (premium > enhanced > default); exact-score ties defer to the Siri
    /// family (`com.apple.eloquence.*`) over legacy compact/novelty voices —
    /// without this, a tie falls to registry order (usually Samantha).
    ///
    /// Deliberately NOT `voiceWithLanguage` for the tie-break: that API
    /// returns the compact default (Samantha for en-US — verified Sep 2026
    /// against 207 installed voices on the dev Mac), i.e. the robotic voice
    /// this bridge exists to avoid. The eloquence personas are the
    /// downloadable Siri voices and the best `AVSpeech` exposes for English
    /// (no premium/enhanced English voice exists in the registry).
    fn pick_voice(lang: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            let voices = AVSpeechSynthesisVoice::speechVoices();
            let target = NSString::from_str(&lang.to_lowercase());
            let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
            let exact_primary = NSString::from_str(&primary);
            let prefix = NSString::from_str(&format!("{primary}-"));
            let prefix_under = NSString::from_str(&format!("{primary}_"));
            let mut best_score = i64::MIN;
            let mut tied: Vec<Retained<AVSpeechSynthesisVoice>> = Vec::new();
            for voice in voices.iter() {
                let vlower = voice.language().lowercaseString();
                let exact = vlower.isEqualToString(&target);
                let related = exact
                    || vlower.isEqualToString(&exact_primary)
                    || vlower.hasPrefix(&prefix)
                    || vlower.hasPrefix(&prefix_under);
                if !related {
                    continue;
                }
                let score = voice.quality().0 as i64 + if exact { 10 } else { 0 };
                if score > best_score {
                    best_score = score;
                    tied.clear();
                    tied.push(voice.clone());
                } else if score == best_score {
                    tied.push(voice.clone());
                }
            }
            // Single winner (the common case: an outright premium/enhanced
            // pick like Majed) or no eloquence among the ties: first wins.
            let mut winner: Option<Retained<AVSpeechSynthesisVoice>> = None;
            let mut winner_eloquence = false;
            for voice in tied {
                let eloquent = voice.identifier().to_string().contains(".eloquence.");
                if winner.is_none() || (eloquent && !winner_eloquence) {
                    winner = Some(voice);
                    winner_eloquence = eloquent;
                }
            }
            winner
        }
    }

    fn installed_voices() -> Vec<NativeVoice> {
        unsafe {
            AVSpeechSynthesisVoice::speechVoices()
                .iter()
                .map(|voice| {
                    let string = |s: Retained<NSString>| s.to_string();
                    NativeVoice {
                        id: string(voice.identifier()),
                        name: string(voice.name()),
                        lang: string(voice.language()),
                        quality: voice.quality().0 as i64,
                    }
                })
                .collect()
        }
    }

    // The synthesizer and its delegate, owned by the main thread (only
    // `run_on_main_thread` closures touch this). `AVSpeech` delivers
    // delegate callbacks on the main runloop; the pair is retained here for
    // the app's lifetime (`delegate` is a weak reference).
    thread_local! {
        static MAIN_STATE: RefCell<Option<(Retained<AVSpeechSynthesizer>, Retained<TtsDelegate>)>> =
            const { RefCell::new(None) };
    }

    /// Run `f` with the main-thread synthesizer, creating it on first use.
    /// Call only from inside `run_on_main_thread`.
    fn with_main_synth(f: impl FnOnce(&AVSpeechSynthesizer)) {
        MAIN_STATE.with(|state| {
            if state.borrow().is_none() {
                unsafe {
                    let synth = AVSpeechSynthesizer::new();
                    let delegate: Retained<TtsDelegate> = msg_send![TtsDelegate::class(), new];
                    synth.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                    *state.borrow_mut() = Some((synth, delegate));
                }
            }
            if let Some((synth, _)) = state.borrow().as_ref() {
                f(synth);
            }
        });
    }

    /// An explicitly chosen installed voice by registry identifier (the
    /// settings voice picker). None when it is not installed anymore.
    fn voice_by_id(id: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            for voice in AVSpeechSynthesisVoice::speechVoices().iter() {
                if voice.identifier().to_string() == id {
                    return Some(voice.clone());
                }
            }
            None
        }
    }

    /// Locale and persona name out of a system voice id like
    /// `com.apple.voice.premium.en-GB.Malcolm` (locale `en-GB`, name
    /// `Malcolm`). Pure: the registry lookup below stays in the caller.
    fn split_system_id(id: &str) -> (Option<String>, Option<String>) {
        let mut rev = id.split('.').rev();
        let name = rev.next().filter(|s| !s.is_empty()).map(|s| s.to_string());
        let locale = rev
            .next()
            .filter(|s| s.contains('-') || s.contains('_'))
            .map(|s| s.to_string());
        (locale, name)
    }

    /// Installed voice with this persona name in this primary language
    /// (`Malcolm` for `en`), or None. Premium/neural System Voice ids
    /// (`com.apple.voice.*`) are never in the AVSpeech registry, so the
    /// exact-id lookup misses and this keeps the same person instead of
    /// falling through to registry order.
    fn voice_by_name(name: &str, primary: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            for voice in AVSpeechSynthesisVoice::speechVoices().iter() {
                if !voice.name().to_string().eq_ignore_ascii_case(name) {
                    continue;
                }
                let owned = voice.clone();
                if voice_primary(&owned) == primary {
                    return Some(owned);
                }
            }
            None
        }
    }

    /// Primary language of an installed voice (`en` for `en-US`).
    fn voice_primary(voice: &AVSpeechSynthesisVoice) -> String {
        unsafe {
            voice
                .language()
                .to_string()
                .split(['-', '_'])
                .next()
                .unwrap_or("")
                .to_lowercase()
        }
    }

    /// Identify the language of a text sample (`NLLanguageRecognizer`).
    /// None when the sample is too short to classify or the recognizer is
    /// uncertain — callers fall back to script detection. Stateless class
    /// call; runs on the invoke handler thread.
    pub fn identify_lang(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        // No length floor: single words ("dissoudre", "neigeait") are
        // exactly what the recognizer is for — it returns nil itself
        // when the sample is too short to call, and callers fall back
        // the same way. A floor here stranded every lone word on the
        // seed voice.
        unsafe {
            let ns = NSString::from_str(trimmed);
            NLLanguageRecognizer::dominantLanguageForString(&ns).map(|id| id.to_string())
        }
    }

    /// The user's own System Voice for a language (Read & Speak → System
    /// Voice), as a registry identifier. macOS keeps it in the
    /// `com.apple.Accessibility` suite under
    /// `SpokenContentDefaultVoiceSelectionsByLanguage`, keyed by primary
    /// language (`boundLanguage`; Mandarin binds as `cmn`, not `zh`).
    /// Undocumented storage: any shape change here (or a neural Siri voice
    /// that `AVSpeech` cannot see) simply yields None and the quality
    /// ranking below takes over — never an error.
    fn system_voice_id(ctx: &str, lang: &str) -> Option<String> {
        unsafe {
            let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
            let mut candidates = vec![primary.as_str()];
            if primary == "zh" {
                candidates.push("cmn");
            }
            let Some(mtm) = MainThreadMarker::new() else {
                eprintln!("[tts] {ctx}: system voice lookup: no main-thread marker");
                return None;
            };
            let suite = NSString::from_str("com.apple.Accessibility");
            let Some(defaults) = NSUserDefaults::initWithSuiteName(mtm.alloc(), Some(&suite))
            else {
                eprintln!("[tts] {ctx}: system voice lookup: cannot open Accessibility suite");
                return None;
            };
            let key = NSString::from_str("SpokenContentDefaultVoiceSelectionsByLanguage");
            let Some(all) = defaults.dictionaryForKey(&key) else {
                // Benign by design (see above): no per-language System Voice
                // configured, so the quality ranking below auto-picks — speech
                // still goes out, just not via a system entry.
                eprintln!("[tts] {ctx}: no per-language System Voice set, auto-picking installed voice");
                return None;
            };
            for candidate in candidates {
                let ckey = NSString::from_str(candidate);
                if let Some(entry) = all.objectForKey(&ckey) {
                    // Untyped dictionary: `DowncastTarget` only covers the
                    // default type parameters, and the lookup below takes
                    // any object key.
                    let Some(dict) = entry.downcast_ref::<NSDictionary>() else {
                        eprintln!("[tts] {ctx}: system voice lookup: entry for {candidate} is not a dictionary");
                        continue;
                    };
                    let vkey = NSString::from_str("voiceId");
                    let any: Option<Retained<AnyObject>> = msg_send![dict, objectForKey: &*vkey];
                    if let Some(any) = any {
                        if let Some(voice) = any.downcast_ref::<NSString>() {
                            return Some(voice.to_string());
                        }
                        eprintln!("[tts] {ctx}: system voice lookup: voiceId for {candidate} is not a string");
                    } else {
                        eprintln!("[tts] {ctx}: system voice lookup: no voiceId for {candidate}");
                    }
                }
            }
            eprintln!("[tts] {ctx} lang={lang}: no system voice entry");
            None
        }
    }

    /// Voice pick shared by live speech and offline render, so a
    /// downloaded file sounds like the readback it came from. Priority:
    /// explicit picker (for its own language family) > the user's System
    /// Voice for the language (exact id, else same persona by name, else
    /// the system locale) > best installed voice for the language. A
    /// picked voice never reads another language: highlights and words
    /// detected as German get a German voice, not the English pick.
    /// Empty saved ids mean auto-pick, same as None.
    fn choose_voice(
        ctx: &str,
        lang: &str,
        voice: Option<&str>,
    ) -> Option<(Retained<AVSpeechSynthesisVoice>, &'static str)> {
        unsafe {
            let requested = voice.filter(|v| !v.is_empty());
            let req_primary = lang
                .split(['-', '_'])
                .next()
                .unwrap_or(lang)
                .to_lowercase();
            let explicit = match requested.and_then(voice_by_id) {
                Some(v) if voice_primary(&v) == req_primary => Some(v),
                Some(v) => {
                    // Routine, not an error: the saved voice belongs to
                    // another language, so the pick below falls through to
                    // the System Voice / best installed voice as designed.
                    eprintln!(
                        "[tts] {ctx} lang={lang}: saved voice {} ({}) is another language — auto-picking instead",
                        v.identifier().to_string(),
                        voice_primary(&v),
                    );
                    None
                }
                None => {
                    if requested.is_some() {
                        eprintln!(
                            "[tts] {ctx} lang={lang}: saved voice not installed, using system/auto"
                        );
                    }
                    None
                }
            };
            let systematic = system_voice_id(ctx, lang);
            explicit
                .map(|v| (v, "explicit"))
                .or_else(|| {
                    let id = systematic.as_deref()?;
                    if let Some(v) = voice_by_id(id) {
                        return Some((v, "system"));
                    }
                    // Premium/neural System Voice ids (`com.apple.voice.*`,
                    // e.g. Malcolm) are never in the AVSpeech registry, so
                    // the exact lookup misses: try the same persona by name,
                    // then the system locale, staying inside the message's
                    // language family. Without this the pick degrades to
                    // registry order (Eddy over Jamie).
                    let (sys_locale, sys_name) = split_system_id(id);
                    if let Some(wanted) = sys_name {
                        if let Some(v) = voice_by_name(&wanted, &req_primary) {
                            eprintln!(
                                "[tts] {ctx} lang={lang}: system voice {id} not in registry, using same persona {}",
                                v.identifier().to_string(),
                            );
                            return Some((v, "system"));
                        }
                    }
                    if let Some(locale) = sys_locale {
                        let locale_primary = locale
                            .split(['-', '_'])
                            .next()
                            .unwrap_or("")
                            .to_lowercase();
                        if locale_primary == req_primary {
                            if let Some(v) = pick_voice(&locale) {
                                eprintln!(
                                    "[tts] {ctx} lang={lang}: system voice {id} not in registry, picking for system locale {locale}"
                                );
                                return Some((v, "system-locale"));
                            }
                        }
                    }
                    eprintln!(
                        "[tts] {ctx} lang={lang}: system voice {id} not in registry, auto-picking instead"
                    );
                    None
                })
                .or_else(|| pick_voice(lang).map(|v| (v, "auto")))
        }
    }

    /// Speech rate for a BCP-47 lang: Mandarin at the default rate
    /// rushes past learners, so Chinese reads slightly slower. Every
    /// other language keeps the shared default. Pure and unit-tested.
    fn speech_rate_for(lang: &str) -> f32 {
        let primary = lang
            .split(['-', '_'])
            .next()
            .unwrap_or(lang)
            .to_lowercase();
        if primary == "zh" || primary == "cmn" {
            0.45
        } else {
            0.5
        }
    }

    /// Utterance with the shared voice pick and the shared rate, for
    /// speech and render alike. `ctx` tags the `tauri dev` log lines
    /// (`speak id=7`, `render`). One line per utterance in the terminal:
    /// the fastest way to confirm which installed voice a complaint is
    /// about.
    fn build_utterance(
        text: &str,
        lang: &str,
        voice: Option<&str>,
        ctx: &str,
    ) -> Retained<AVSpeechUtterance> {
        unsafe {
            let ns = NSString::from_str(text);
            let utterance = AVSpeechUtterance::speechUtteranceWithString(&ns);
            match choose_voice(ctx, lang, voice) {
                Some((picked, origin)) => {
                    eprintln!(
                        "[tts] {ctx} lang={lang} voice={} ({}, {origin})",
                        picked.identifier().to_string(),
                        picked.name().to_string(),
                    );
                    utterance.setVoice(Some(&picked));
                }
                None => {
                    eprintln!(
                        "[tts] {ctx} lang={lang}: no installed voice matches, using synthesizer default"
                    );
                }
            }
            utterance.setRate(speech_rate_for(lang));
            utterance
        }
    }

    fn speak_on_main(app: &AppHandle, id: u64, text: String, lang: String, voice: Option<String>) {
        let _ = app.run_on_main_thread(move || {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                CURRENT_ID.store(id, Ordering::SeqCst);
                let utterance =
                    build_utterance(&text, &lang, voice.as_deref(), &format!("speak id={id}"));
                synth.speakUtterance(&utterance);
            });
        });
    }

    fn stop_on_main(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            });
        });
    }




    fn worker(rx: Receiver<Cmd>) {
        // The worker only queues: speech runs on the main thread (see
        // MAIN_STATE), and voice inventory is a plain registry read.
        for cmd in rx {
            match cmd {
                Cmd::Speak { id, text, lang, voice } => {
                    if let Some(app) = APP.get() {
                        speak_on_main(app, id, text, lang, voice);
                    }
                }
                Cmd::Stop => {
                    if let Some(app) = APP.get() {
                        stop_on_main(app);
                    }
                }
                Cmd::Voices(reply) => {
                    let _ = reply.send(installed_voices());
                }
            }
        }
    }

    /// Render `text` to an audio file with the shared voice pick, so a
    /// downloaded lesson file sounds like the readback it came from.
    /// macOS-only (uses `block2`, a macOS-only dependency): iOS gets
    /// the stub below. Blocks the invoke handler — not the main
    /// thread — until the trailing zero-length buffer arrives or the
    /// deadline passes. The file lands in the system temp dir and the
    /// command returns its path.
    #[cfg(target_os = "macos")]
    pub fn save_speech(
        app: &AppHandle,
        text: String,
        lang: String,
        voice: Option<String>,
    ) -> Result<String, String> {
        use block2::RcBlock;
        use objc2::rc::Allocated;
        use objc2::runtime::AnyObject;
        use objc2_avf_audio::{AVAudioBuffer, AVAudioFile, AVAudioPCMBuffer};
        use objc2_foundation::NSURL;
        use std::ptr::NonNull;

        if text.trim().is_empty() {
            return Err("nothing to save".into());
        }
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        let ctx = format!("render id={id}");
        let out_path =
            std::env::temp_dir().join(format!("ccez-speech-{id}.m4a"));
        /// One-way ownership transfer across threads: the pointer
        /// carries an extra retain, and exactly one thread ever
        /// touches the object (raw pointers are neither Send nor
        /// Sync, so this states the handoff explicitly).
        struct SendPtr<T>(*mut T);
        // SAFETY: constructed only with an owned extra retain, and
        // received exactly once by the single writing thread.
        unsafe impl<T> Send for SendPtr<T> {}
        // Buffers cross from the synthesizer's callback queue to the
        // invoke thread below as retained pointers. Each pointer
        // carries one extra retain, released by `from_raw` after
        // writing.
        let (tx, rx) = channel::<SendPtr<AVAudioBuffer>>();
        // Handoff for the created audio file (same deal — only the
        // invoke thread ever touches it) or the setup error.
        let (setup_tx, setup_rx) = channel::<Result<SendPtr<AVAudioFile>, String>>();
        let deadline_chars = text.len();
        let main_ctx = ctx.clone();
        let main_path = out_path.clone();
        app.run_on_main_thread(move || {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                let Some((picked, origin)) =
                    choose_voice(&main_ctx, &lang, voice.as_deref())
                        .or_else(|| pick_voice(&lang).map(|v| (v, "auto")))
                else {
                    let _ =
                        setup_tx.send(Err(format!("no installed voice for {lang}")));
                    return;
                };
                eprintln!(
                    "[tts] {main_ctx} file voice={} ({}, {origin})",
                    picked.identifier().to_string(),
                    picked.name().to_string(),
                );
                let utterance = build_utterance(
                    &text,
                    &lang,
                    Some(&picked.identifier().to_string()),
                    &main_ctx,
                );
                // The voice's own settings describe the buffer format
                // below (the documented pairing for this method).
                let settings = picked.audioFileSettings();
                let url = NSURL::fileURLWithPath(&NSString::from_str(
                    &main_path.to_string_lossy(),
                ));
                let allocated: Allocated<AVAudioFile> =
                    msg_send![AVAudioFile::class(), alloc];
                let file = match AVAudioFile::initForWriting_settings_error(allocated, &url, &settings) {
                    Ok(file) => file,
                    Err(error) => {
                        let _ = setup_tx.send(Err(format!(
                            "could not create audio file: {}",
                            error.localizedDescription().to_string()
                        )));
                        return;
                    }
                };
                let block = RcBlock::new(move |buffer: NonNull<AVAudioBuffer>| {
                    let raw =
                        Retained::retain(buffer.as_ptr()).map(Retained::into_raw);
                    if let Some(ptr) = raw {
                        let _ = tx.send(SendPtr(ptr));
                    }
                });
                synth.writeUtterance_toBufferCallback(&utterance, RcBlock::as_ptr(&block));
                // The synthesizer copied the block; dropping ours only
                // releases our own retain (same rule as dictate_macos).
                drop(block);
                let _ = setup_tx.send(Ok(SendPtr(Retained::into_raw(file))));
            });
        })
        .map_err(|e| format!("speech render failed to start: {e:?}"))?;
        let SendPtr(raw_file) = setup_rx
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "timed out creating the audio file".to_string())??;
        let file: Retained<AVAudioFile> = unsafe { Retained::from_raw(raw_file) }
            .ok_or_else(|| "audio file handoff failed".to_string())?;
        // Rendering runs faster than realtime, but lesson audio can be
        // long: scale the ceiling with the text, generous either way.
        let deadline = std::time::Instant::now()
            + Duration::from_secs(120)
                .max(Duration::from_millis(
                    (deadline_chars as u64).saturating_mul(100),
                ))
                .min(Duration::from_secs(600));
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                let _ = app.run_on_main_thread(|| {
                    with_main_synth(|synth| unsafe {
                        synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                    });
                });
                return Err("timed out rendering speech to a file".into());
            }
            let SendPtr(ptr) = rx
                .recv_timeout(remaining)
                .map_err(|_| "speech render ended without audio".to_string())?;
            let audio: Retained<AVAudioBuffer> = unsafe { Retained::from_raw(ptr) }
                .ok_or_else(|| "audio buffer handoff failed".to_string())?;
            let obj: &AnyObject = &audio;
            let Some(pcm) = obj.downcast_ref::<AVAudioPCMBuffer>() else {
                return Err("unexpected audio buffer type".into());
            };
            if unsafe { pcm.frameLength() } == 0 {
                // Trailing empty buffer: synthesis is complete.
                break;
            }
            unsafe { file.writeFromBuffer_error(pcm) }.map_err(|e| {
                e.localizedDescription().to_string()
            })?;
        }
        eprintln!("[tts] {ctx}: saved {}", out_path.to_string_lossy());
        Ok(out_path.to_string_lossy().into_owned())
    }

    /// File export needs `block2`, a macOS-only dependency: iOS
    /// reports unsupported instead of carrying a second render path.
    #[cfg(target_os = "ios")]
    pub fn save_speech(
        _app: &AppHandle,
        _text: String,
        _lang: String,
        _voice: Option<String>,
    ) -> Result<String, String> {
        Err("saving speech to a file requires macOS".into())
    }

    pub fn supported() -> bool {
        true
    }

    pub fn speak(
        app: &AppHandle,
        text: String,
        lang: String,
        voice: Option<String>,
    ) -> Result<u64, String> {
        if text.trim().is_empty() {
            return Ok(0);
        }
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        engine(app)
            .tx
            .send(Cmd::Speak { id, text, lang, voice })
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn stop(app: &AppHandle) -> Result<(), String> {
        engine(app).tx.send(Cmd::Stop).map_err(|e| e.to_string())
    }

    pub fn voices(app: &AppHandle) -> Result<Vec<NativeVoice>, String> {
        let (tx, rx) = channel();
        engine(app)
            .tx
            .send(Cmd::Voices(tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())
    }

    #[cfg(test)]
    mod system_id_tests {
        use super::{identify_lang, speech_rate_for, split_system_id};

        #[test]
        fn short_samples_reach_the_recognizer() {
            // No length floor (the 0.5.3 field notes: lone words like
            // "dissoudre" never reached Apple at all): the
            // recognizer's own verdict decides — nil when IT is
            // uncertain — instead of a hardcoded None. This Mac reads
            // "dissoudre" as English; that is Apple's call, surfaced
            // instead of masked. Device-dependent by nature: a future
            // OS verdict change fails loudly here for re-examination.
            assert_eq!(identify_lang(""), None);
            assert_eq!(identify_lang("   "), None);
            for word in ["dissoudre", "neigeait", "dissous"] {
                assert!(identify_lang(word).is_some(), "{word}");
            }
        }

        #[test]
        fn chinese_rate_slower_than_default() {
            assert!(speech_rate_for("zh-CN") < speech_rate_for("en-US"));
            assert_eq!(speech_rate_for("zh-CN"), 0.45);
            assert_eq!(speech_rate_for("zh-TW"), 0.45);
            assert_eq!(speech_rate_for("cmn"), 0.45);
            assert_eq!(speech_rate_for("en-US"), 0.5);
            assert_eq!(speech_rate_for("ja"), 0.5);
        }

        #[test]
        fn splits_premium_system_id() {
            let (locale, name) = split_system_id("com.apple.voice.premium.en-GB.Malcolm");
            assert_eq!(locale.as_deref(), Some("en-GB"));
            assert_eq!(name.as_deref(), Some("Malcolm"));
        }

        #[test]
        fn splits_eloquence_system_id() {
            let (locale, name) = split_system_id("com.apple.eloquence.en-US.Eddy");
            assert_eq!(locale.as_deref(), Some("en-US"));
            assert_eq!(name.as_deref(), Some("Eddy"));
        }

        #[test]
        fn rejects_garbage_gracefully() {
            assert_eq!(split_system_id(""), (None, None));
            let (locale, name) = split_system_id("not-a-voice-id");
            assert_eq!(locale, None);
            assert_eq!(name.as_deref(), Some("not-a-voice-id"));
        }
    }

}


/// Does this build speak through the native engine? Always true on macOS,
/// always false elsewhere — the frontend gates the toggle on this.
#[tauri::command]
pub fn tts_supported() -> bool {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::supported();
    #[cfg(target_os = "android")]
    return super::tts_android::supported();
    #[cfg(target_os = "windows")]
    return super::tts_windows::tts_supported();
    #[cfg(target_os = "linux")]
    return super::tts_linux::tts_supported();
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    )))]
    return false;
}

/// Speak `text` with the best installed voice for `lang` (BCP-47), or the
/// explicit registry identifier in `voice` (the settings voice picker).
/// Without an explicit voice, auto-pick prefers the user's System Voice for
/// the language (Read & Speak → System Voice) when it resolves to an
/// installed voice, else the highest-quality installed voice.
/// Returns immediately with the utterance id; progress arrives as
/// `tts-word` / `tts-done` events carrying that id.
#[tauri::command]
pub fn tts_speak(
    app: AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<u64, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::speak(&app, text, lang, voice);
    #[cfg(target_os = "android")]
    return super::tts_android::speak(&app, text, lang, voice);
    #[cfg(target_os = "windows")]
    return super::tts_windows::tts_speak(app, text, lang, voice);
    #[cfg(target_os = "linux")]
    return super::tts_linux::tts_speak(app, text, lang, voice);
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    )))]
    {
        let _ = (app, text, lang, voice);
        return Err("native TTS requires macOS or iOS".into());
    }
}

/// Stop any in-progress native speech immediately.
#[tauri::command]
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::stop(&app);
    #[cfg(target_os = "android")]
    return super::tts_android::stop(&app);
    #[cfg(target_os = "windows")]
    return super::tts_windows::tts_stop(app);
    #[cfg(target_os = "linux")]
    return super::tts_linux::tts_stop(app);
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    )))]
    {
        let _ = app;
        return Err("native TTS requires macOS or iOS".into());
    }
}

/// Render `text` to an audio file with the same voice pick as live
/// speech (macOS `AVSpeechSynthesizer` file export, Android
/// `synthesizeToFile` into the app cache). Returns the saved path.
/// Lesson-audio export for spaced-repetition decks; reuses the TTS
/// bridges, new command. The Android path is code-only, unverified
/// on device.
#[tauri::command]
pub fn tts_save_speech(
    app: AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return imp::save_speech(&app, text, lang, voice);
    #[cfg(target_os = "android")]
    return super::tts_android::save_to_file(&app, text, lang, voice);
    #[cfg(not(any(target_os = "macos", target_os = "android")))]
    {
        let _ = (app, text, lang, voice);
        return Err("saving speech to a file is not supported on this platform".into());
    }
}

/// Identify the language of a text sample for highlight-to-speak in Latin
/// scripts, where script detection cannot tell French from English.
/// Returns a BCP-47-ish tag, or null when the recognizer is uncertain
/// (callers fall back to script detection, then the offline scorer).
#[tauri::command]
pub fn tts_identify_lang(text: String) -> Option<String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::identify_lang(&text);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        // No `NLLanguageRecognizer` off Apple platforms: the offline
        // stop-word scorer answers instead (same contract — None when
        // the sample is too short or unscorable).
        return super::langid::identify_lang_offline(&text);
    }
}


/// List installed system voices with their quality tiers.
#[tauri::command]
pub fn tts_voices(app: AppHandle) -> Result<Vec<imp::NativeVoice>, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return imp::voices(&app);
    #[cfg(target_os = "android")]
    return super::tts_android::voices(&app);
    #[cfg(target_os = "windows")]
    return super::tts_windows::tts_voices(app);
    #[cfg(target_os = "linux")]
    return super::tts_linux::tts_voices(app);
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "android",
        target_os = "windows",
        target_os = "linux"
    )))]
    {
        let _ = app;
        return Err("native TTS requires macOS or iOS".into());
    }
}

// The stub build has no `imp` module; the error type must still name a
// concrete serializable type. (Android/Windows/Linux reuse the stub
// shape and fill it from their engines; hence pub(crate).)
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub(crate) mod imp {
    #[derive(Clone, serde::Serialize)]
    pub struct NativeVoice {
        pub id: String,
        pub name: String,
        pub lang: String,
        pub quality: i64,
    }
}
