//! Word timings for listening drills from Apple's speech recognizer
//! (`SFSpeechRecognizer`): one piece of the track at a time, read
//! straight from the cached audio file (`AVAudioFile`) and handed over
//! as one buffer. The recognizer runs on the device when the
//! language's dictation model is installed and Dictation is on, and on
//! Apple's servers otherwise.
//!
//! Pure-Rust bindings through `objc2-speech`; no Objective-C or Swift.
//! Every other platform gets `listen-heard-unsupported`, and the drill
//! keeps its pause-matched times.

#![allow(dead_code)] // macOS-only: the helpers compile everywhere, run on macOS.
use std::path::PathBuf;

use ccez_listen::HeardWord;

/// Regions to prefer when a drill names only a language.
const HOME_REGION: &[(&str, &str)] = &[
    ("en", "US"),
    ("es", "ES"),
    ("pt", "BR"),
    ("zh", "CN"),
    ("ja", "JP"),
    ("ko", "KR"),
    ("ar", "SA"),
    ("he", "IL"),
    ("sv", "SE"),
    ("da", "DK"),
    ("nb", "NO"),
    ("uk", "UA"),
];

/// The recognizer locale for a drill language among `supported`
/// identifiers (`fr_FR` or `fr-FR`): the exact tag, else the language's
/// home region, else any region of it. Pure.
pub fn pick_locale<'a>(lang: &str, supported: &'a [String]) -> Option<&'a String> {
    let norm = |s: &str| s.replace('_', "-").to_ascii_lowercase();
    let want = norm(lang.trim());
    let base = want.split('-').next().unwrap_or_default().to_string();
    if base.is_empty() {
        return None;
    }
    let region = HOME_REGION
        .iter()
        .find(|(l, _)| *l == base)
        .map(|(_, r)| r.to_ascii_lowercase())
        .unwrap_or_else(|| base.clone());
    let home = format!("{base}-{region}");
    let mut sorted: Vec<&String> = supported.iter().collect();
    sorted.sort();
    sorted
        .iter()
        .find(|s| norm(s) == want)
        .or_else(|| sorted.iter().find(|s| norm(s) == home))
        .or_else(|| {
            sorted
                .iter()
                .find(|s| norm(s).split('-').next() == Some(base.as_str()))
        })
        .copied()
}

/// What the recognizer heard between `start` and `end` seconds of the
/// audio at `path`, in seconds from `start`.
pub fn recognize(
    path: PathBuf,
    lang: &str,
    start: f64,
    end: f64,
) -> Result<Vec<HeardWord>, String> {
    #[cfg(target_os = "macos")]
    return imp::recognize(&path, lang, start, end);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, lang, start, end);
        Err("listen-heard-unsupported".into())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::path::Path;
    use std::sync::mpsc::channel;
    use std::sync::Mutex;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::AllocAnyThread;
    use objc2_avf_audio::{AVAudioFile, AVAudioPCMBuffer};
    use objc2_foundation::{NSBundle, NSError, NSLocale, NSOperationQueue, NSString, NSURL};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognizer,
        SFSpeechRecognizerAuthorizationStatus,
    };

    use super::{pick_locale, HeardWord};

    /// Asking for recognition without this Info.plist key kills the
    /// process; the dev binary embeds it (build.rs), bundles merge
    /// `Info.plist`.
    fn check_usage_description() -> Result<(), String> {
        let key = NSString::from_str("NSSpeechRecognitionUsageDescription");
        match NSBundle::mainBundle().objectForInfoDictionaryKey(&key) {
            Some(_) => Ok(()),
            None => Err("listen-heard-unsupported".into()),
        }
    }

    /// `Ok` once recognition is allowed; the first call shows the
    /// system's prompt and waits for the answer.
    fn ensure_authorized() -> Result<(), String> {
        let status = unsafe { SFSpeechRecognizer::authorizationStatus() };
        if status == SFSpeechRecognizerAuthorizationStatus::Authorized {
            return Ok(());
        }
        if status != SFSpeechRecognizerAuthorizationStatus::NotDetermined {
            return Err("listen-heard-denied".into());
        }
        let (tx, rx) = channel();
        let block = RcBlock::new(move |s: SFSpeechRecognizerAuthorizationStatus| {
            let _ = tx.send(s);
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&block) };
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(SFSpeechRecognizerAuthorizationStatus::Authorized) => Ok(()),
            _ => Err("listen-heard-denied".into()),
        }
    }

    fn recognizer(lang: &str) -> Result<objc2::rc::Retained<SFSpeechRecognizer>, String> {
        let ids: Vec<String> = unsafe { SFSpeechRecognizer::supportedLocales() }
            .iter()
            .map(|l| l.localeIdentifier().to_string())
            .collect();
        let id = pick_locale(lang, &ids).ok_or("listen-heard-unsupported")?;
        let locale = NSLocale::localeWithLocaleIdentifier(&NSString::from_str(id));
        let rec =
            unsafe { SFSpeechRecognizer::initWithLocale(SFSpeechRecognizer::alloc(), &locale) }
                .ok_or("listen-heard-unsupported")?;
        if !unsafe { rec.isAvailable() } {
            return Err("listen-heard-unavailable".into());
        }
        Ok(rec)
    }

    /// One recognition at a time: a second task in the same process
    /// ends the first with "no speech" (1110).
    static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

    pub fn recognize(
        path: &Path,
        lang: &str,
        start: f64,
        end: f64,
    ) -> Result<Vec<HeardWord>, String> {
        let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|p| p.into_inner());
        check_usage_description()?;
        ensure_authorized()?;
        let rec = recognizer(lang)?;
        unsafe {
            // Results arrive on this queue, never the main thread's.
            rec.setQueue(&NSOperationQueue::new());
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            let file = AVAudioFile::initForReading_error(AVAudioFile::alloc(), &url)
                .map_err(|e| format!("listen-heard: {}", e.localizedDescription()))?;
            let format = file.processingFormat();
            let rate = format.sampleRate();
            let first = (start * rate) as i64;
            let frames = (((end - start) * rate) as i64).clamp(0, (file.length() - first).max(0));
            file.setFramePosition(first);
            let buffer = AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(
                AVAudioPCMBuffer::alloc(),
                &format,
                frames as u32,
            )
            .ok_or("listen-heard: no buffer")?;
            file.readIntoBuffer_frameCount_error(&buffer, frames as u32)
                .map_err(|e| format!("listen-heard: {}", e.localizedDescription()))?;

            let request = SFSpeechAudioBufferRecognitionRequest::new();
            request.setShouldReportPartialResults(false);
            request.appendAudioPCMBuffer(&buffer);
            request.endAudio();
            let (tx, rx) = channel::<Result<Vec<HeardWord>, String>>();
            let handler = RcBlock::new(
                move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                    if let Some(error) = error.as_ref() {
                        // 1110: nothing was said (music, silence).
                        let quiet = error.code() == 1110;
                        let _ = tx.send(if quiet {
                            Ok(Vec::new())
                        } else {
                            Err(format!("listen-heard: {} {}", error.domain(), error.code()))
                        });
                        return;
                    }
                    let Some(result) = result.as_ref() else {
                        return;
                    };
                    if !result.isFinal() {
                        return;
                    }
                    let words = result
                        .bestTranscription()
                        .segments()
                        .iter()
                        .map(|s| HeardWord {
                            text: s.substring().to_string(),
                            start: s.timestamp(),
                            end: s.timestamp() + s.duration(),
                        })
                        .collect();
                    let _ = tx.send(Ok(words));
                },
            );
            let task = rec.recognitionTaskWithRequest_resultHandler(&request, &handler);
            let heard = rx.recv_timeout(Duration::from_secs(180));
            if heard.is_err() {
                task.cancel();
            }
            heard.map_err(|_| "listen-heard: timed out".to_string())?
        }
    }
}

#[cfg(test)]
mod tests {
    use super::pick_locale;

    /// The real recognizer on a cached French drill (asks for speech
    /// permission the first time):
    /// `CCEZ_LISTEN_CACHE=<cache>/listen CCEZ_LISTEN_VIDEO=<id> cargo test
    /// --lib hears_a_cached_track -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn hears_a_cached_track() {
        use tauri::async_runtime::{block_on, spawn};
        let cache = std::env::var("CCEZ_LISTEN_CACHE").expect("CCEZ_LISTEN_CACHE");
        let id: &'static str = Box::leak(
            std::env::var("CCEZ_LISTEN_VIDEO")
                .expect("CCEZ_LISTEN_VIDEO")
                .into(),
        );
        let listen: &'static ccez_listen::Listen =
            Box::leak(Box::new(ccez_listen::Listen::new(cache)));
        let hear = move |n| async move {
            listen
                .heard(id, "fr", n, |audio, start, end| {
                    super::recognize(audio, "fr", start, end)
                })
                .await
        };
        block_on(async {
            // Two pieces asked for at once both come back heard.
            let (first, second) = (spawn(hear(0)), spawn(hear(1)));
            let first = first.await.unwrap().unwrap();
            let second = second.await.unwrap().unwrap();
            assert!(first.words.len() > 50, "{}", first.words.len());
            assert!(second.words.len() > 50, "{}", second.words.len());
            assert_eq!(first.end, second.start);
            assert!(second.words[0].start >= second.start - 0.05);
            assert!(second.words.last().unwrap().end <= second.end + 0.05);
            // The second time it's read back from the cache.
            let started = std::time::Instant::now();
            let again = hear(0).await.unwrap();
            assert!(started.elapsed().as_millis() < 500);
            assert_eq!(again.words, first.words);
        });
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_language_finds_its_home_region() {
        let supported = ids(&[
            "fr_CA", "fr_FR", "fr_CH", "en_GB", "en_US", "ja_JP", "pt_PT", "pt_BR",
        ]);
        assert_eq!(
            pick_locale("fr", &supported).map(String::as_str),
            Some("fr_FR")
        );
        assert_eq!(
            pick_locale("en", &supported).map(String::as_str),
            Some("en_US")
        );
        assert_eq!(
            pick_locale("ja", &supported).map(String::as_str),
            Some("ja_JP")
        );
        assert_eq!(
            pick_locale("pt", &supported).map(String::as_str),
            Some("pt_BR")
        );
    }

    #[test]
    fn an_exact_tag_wins_and_unknown_languages_have_none() {
        let supported = ids(&["fr-CA", "fr-FR", "de-AT", "de-DE"]);
        assert_eq!(
            pick_locale("fr-CA", &supported).map(String::as_str),
            Some("fr-CA")
        );
        assert_eq!(
            pick_locale("de", &supported).map(String::as_str),
            Some("de-DE")
        );
        assert_eq!(
            pick_locale("de-CH", &supported).map(String::as_str),
            Some("de-DE")
        );
        assert_eq!(pick_locale("xx", &supported), None);
        assert_eq!(pick_locale("", &supported), None);
    }
}
