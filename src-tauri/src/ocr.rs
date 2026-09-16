//! On-device OCR for learners (macOS): Vision text recognition via `objc2`.
//!
//! Pure-Rust bindings through `objc2` — no Objective-C is written anywhere
//! in this project, same rule as the TTS bridge in `tts.rs` (which is why
//! there is no Swift sidecar and no `objc2-vision` hand-written wrapper:
//! the generated `objc2-vision` bindings are used directly).
//!
//! Why this fits the standing rules: Vision text recognition runs fully
//! on-device (free forever, no paid account, offline-first — unlike the
//! network-based `SFSpeechRecognizer` path in `dictate_macos.rs`) and the
//! recognized text is handed back as plain selectable text, so it flows
//! into the existing pinyin/furigana pipeline (`src/lib/pinyin.ts`,
//! `src/lib/furigana.ts`) with no new rendering path.
//!
//! Design: `ocr_recognize` takes a base64 image (data URL or raw) plus an
//! optional BCP-47 language hint, runs one synchronous
//! `VNRecognizeTextRequest` (accurate level, language correction on) on
//! the invoke thread, and returns the top candidate per observation,
//! shaped by [`shape_result`]. No completion-handler block is needed:
//! `performRequests` is synchronous and the request's `results` are read
//! right after it returns.
//!
//! Vision needs no entitlement and no Info.plist usage-description key:
//! reading pixels the user already attached is not a privacy-gated
//! capability (unlike the mic / speech-recognition keys documented in
//! `dictate_macos.rs`), so there is nothing to add to the bundle.
//!
//! On-device OCR on every desktop OS: macOS Vision (`imp` below),
//! Windows WinRT OCR (`ocr_windows.rs`), and Linux Tesseract
//! (`ocr_linux.rs`). Every other platform gets stubs that report
//! "unsupported", and the frontend hides/gates the UI on
//! `ocr_supported`.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// One recognized text line: the top candidate and its confidence in
/// `[0.0, 1.0]` (1.0 is most confident).
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct OcrLine {
    pub text: String,
    pub confidence: f32,
}

/// Shaped recognition result. `text` is the lines joined with `\n` (what
/// the composer inserts); `confidence` is the mean line confidence, or
/// 0.0 when nothing was recognized.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct OcrOutput {
    pub text: String,
    pub lines: Vec<OcrLine>,
    pub confidence: f32,
}

/// Cap accepted image payloads: composer images are downscaled JPEGs
/// (hundreds of KB), so 32 MB is generous without letting a pasted blob
/// exhaust memory before Vision even sees it.
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;

/// Strip a `data:<mime>;base64,` prefix, returning the raw base64.
/// Anything else (already-raw base64, or a non-base64 data URL which the
/// decoder below will reject) passes through untouched. Pure.
pub fn split_data_url(input: &str) -> &str {
    let trimmed = input.trim();
    if let Some(comma) = trimmed.find(',') {
        let (head, tail) = trimmed.split_at(comma);
        if head.starts_with("data:") && head.ends_with(";base64") {
            return &tail[1..];
        }
    }
    trimmed
}

/// Vision `recognitionLanguages` for a BCP-47 hint. Chinese maps to both
/// script variants (a photo rarely declares its script), Cantonese to its
/// pair; anything unknown or missing falls back to English alone, except
/// the no-hint default which covers the learner case (English plus the
/// two CJK scripts) instead of guessing wrong. Pure and unit-tested.
pub fn recognition_languages(hint: Option<&str>) -> Vec<String> {
    let primary = hint
        .unwrap_or("")
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .trim()
        .to_lowercase();
    if primary.is_empty() {
        // Order is load-bearing: Vision runs the first recognition
        // language as its primary script model, and a Latin-only model
        // never reports CJK observations at all. Probed on-device (Sep
        // 2026): en-US first read English perfectly and returned zero
        // Japanese lines from a trilingual image; ja-JP first reads
        // Japanese, English, and Chinese (occasional kanji-variant
        // misreads), while zh-led drops kana outright. So the learner
        // default leads CJK — English still reads through it.
        return ["ja-JP", "zh-Hans", "zh-Hant", "en-US"]
            .iter()
            .map(|s| s.to_string())
            .collect();
    }
    let mapped: &[&str] = match primary.as_str() {
        "zh" | "cmn" => &["zh-Hans", "zh-Hant"],
        "yue" => &["yue-Hant", "yue-Hans"],
        "ja" => &["ja-JP"],
        "ko" => &["ko-KR"],
        "en" => &["en-US"],
        "fr" => &["fr-FR"],
        "de" => &["de-DE"],
        "es" => &["es-ES"],
        "it" => &["it-IT"],
        "pt" => &["pt-BR"],
        "ru" => &["ru-RU"],
        "uk" => &["uk-UA"],
        _ => &["en-US"],
    };
    mapped.iter().map(|s| s.to_string()).collect()
}

/// Shape raw top-candidates into an [`OcrOutput`]: trim, drop empties,
/// join with newlines, average the confidence. Pure and unit-tested.
pub fn shape_result(candidates: Vec<(String, f32)>) -> OcrOutput {
    let lines: Vec<OcrLine> = candidates
        .into_iter()
        .map(|(text, confidence)| (text.trim().to_string(), confidence))
        .filter(|(text, _)| !text.is_empty())
        .map(|(text, confidence)| OcrLine { text, confidence })
        .collect();
    let text = lines
        .iter()
        .map(|line| line.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let confidence = if lines.is_empty() {
        0.0
    } else {
        lines.iter().map(|line| line.confidence).sum::<f32>() / lines.len() as f32
    };
    OcrOutput {
        text,
        lines,
        confidence,
    }
}

/// Decode a base64 image payload (data URL or raw) into bytes. Pure
/// apart from the error strings, which are user-facing by design.
fn decode_image(input: &str) -> Result<Vec<u8>, String> {
    let raw = split_data_url(input);
    if raw.is_empty() {
        return Err("no image data to recognize".into());
    }
    let bytes = BASE64
        .decode(raw)
        .map_err(|_| "that image is not valid base64".to_string())?;
    if bytes.is_empty() {
        return Err("no image data to recognize".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("that image is too large to recognize (32 MB limit)".into());
    }
    Ok(bytes)
}

/// Does this build recognize text on-device? True on macOS (Vision),
/// Windows (WinRT OCR), and Linux with Tesseract installed — the
/// frontend gates the OCR affordance on this.
#[tauri::command]
pub fn ocr_supported() -> bool {
    #[cfg(target_os = "macos")]
    return imp::supported();
    #[cfg(target_os = "windows")]
    return super::ocr_windows::ocr_supported();
    #[cfg(target_os = "linux")]
    return super::ocr_linux::ocr_supported();
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return false;
}

/// Recognize text in a base64 image (data URL or raw). `lang` is a BCP-47
/// hint for the recognition languages (see [`recognition_languages`]);
/// None takes the learner default. Returns the shaped text, or `Err`
/// when the image is bad, nothing was found, or the platform has no
/// on-device OCR.
#[tauri::command]
pub fn ocr_recognize(image: String, lang: Option<String>) -> Result<OcrOutput, String> {
    let bytes = decode_image(&image)?;
    let languages = recognition_languages(lang.as_deref());
    #[cfg(target_os = "macos")]
    let candidates = imp::recognize(&bytes, &languages)?;
    #[cfg(target_os = "windows")]
    let candidates = super::ocr_windows::ocr_recognize(&bytes, &languages)?;
    #[cfg(target_os = "linux")]
    let candidates = super::ocr_linux::ocr_recognize(&bytes, &languages)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (bytes, languages);
        return Err("on-device OCR is not supported on this platform".into());
    }
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        if candidates.iter().all(|(text, _)| text.trim().is_empty()) {
            return Err("no text found in this image".into());
        }
        Ok(shape_result(candidates))
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use objc2::msg_send;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::ClassType;
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
    use objc2_vision::{
        VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
    };

    pub fn supported() -> bool {
        true
    }

    /// Run one accurate-level `VNRecognizeTextRequest` over `image_bytes`
    /// and return the top candidate per observation, in reading order.
    /// Synchronous: `performRequests` returns once the request finishes.
    pub fn recognize(
        image_bytes: &[u8],
        languages: &[String],
    ) -> Result<Vec<(String, f32)>, String> {
        unsafe {
            let data = NSData::from_vec(image_bytes.to_vec());
            let options =
                NSDictionary::<NSString, AnyObject>::from_slices::<NSString>(&[], &[]);
            let alloc: Allocated<VNImageRequestHandler> =
                msg_send![VNImageRequestHandler::class(), alloc];
            let handler = VNImageRequestHandler::initWithData_options(alloc, &data, &options);

            let req_alloc: Allocated<VNRecognizeTextRequest> =
                msg_send![VNRecognizeTextRequest::class(), alloc];
            let request = VNRecognizeTextRequest::init(req_alloc);
            request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
            request.setUsesLanguageCorrection(true);
            let owned: Vec<Retained<NSString>> = languages
                .iter()
                .map(|lang| NSString::from_str(lang))
                .collect();
            let refs: Vec<&NSString> = owned.iter().map(|s| &**s).collect();
            request.setRecognitionLanguages(&NSArray::from_slice(&refs));

            // `performRequests` takes the base class: upcast through
            // VNImageBasedRequest to VNRequest.
            let base: Retained<VNRequest> =
                request.clone().into_super().into_super();
            let requests = NSArray::from_slice(&[&*base]);
            handler.performRequests_error(&requests).map_err(|err| {
                format!("text recognition failed: {}", err.localizedDescription())
            })?;

            let mut out = Vec::new();
            if let Some(observations) = request.results() {
                for observation in observations.iter() {
                    let candidates = observation.topCandidates(1);
                    let mut iter = candidates.iter();
                    if let Some(top) = iter.next() {
                        out.push((top.string().to_string(), top.confidence()));
                    }
                }
            }
            Ok(out)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_image, recognition_languages, shape_result, split_data_url, OcrOutput};

    #[test]
    fn data_url_prefix_strips_to_raw_base64() {
        assert_eq!(
            split_data_url("data:image/jpeg;base64,aGVsbG8="),
            "aGVsbG8="
        );
        assert_eq!(
            split_data_url("  data:image/png;base64,aGVsbG8=  "),
            "aGVsbG8="
        );
    }

    #[test]
    fn raw_base64_and_other_urls_pass_through() {
        assert_eq!(split_data_url("aGVsbG8="), "aGVsbG8=");
        // Not a base64 data URL: leave it for the decoder to reject.
        assert_eq!(split_data_url("data:text/plain,hello"), "data:text/plain,hello");
        assert_eq!(split_data_url(""), "");
    }

    #[test]
    fn language_hints_map_to_vision_codes() {
        assert_eq!(recognition_languages(Some("zh-CN")), vec!["zh-Hans", "zh-Hant"]);
        assert_eq!(recognition_languages(Some("cmn")), vec!["zh-Hans", "zh-Hant"]);
        assert_eq!(recognition_languages(Some("yue-HK")), vec!["yue-Hant", "yue-Hans"]);
        assert_eq!(recognition_languages(Some("ja-JP")), vec!["ja-JP"]);
        assert_eq!(recognition_languages(Some("ko")), vec!["ko-KR"]);
        assert_eq!(recognition_languages(Some("fr-FR")), vec!["fr-FR"]);
        assert_eq!(recognition_languages(Some("en-US")), vec!["en-US"]);
    }

    #[test]
    fn missing_or_unknown_hint_falls_back() {
        // No hint: the learner default covers English + CJK scripts,
        // CJK-led (Vision runs the first language as its primary
        // script model — English-first returned zero CJK).
        assert_eq!(
            recognition_languages(None),
            vec!["ja-JP", "zh-Hans", "zh-Hant", "en-US"]
        );
        assert_eq!(
            recognition_languages(Some("   ")),
            vec!["ja-JP", "zh-Hans", "zh-Hant", "en-US"]
        );
        // Unknown language: English alone, never an invalid Vision code.
        assert_eq!(recognition_languages(Some("xx")), vec!["en-US"]);
        assert_eq!(recognition_languages(Some("ar-SA")), vec!["en-US"]);
    }

    #[test]
    fn result_shaping_trims_drops_empties_and_averages() {
        let shaped = shape_result(vec![
            ("  你好 ".into(), 0.9),
            ("   ".into(), 0.1),
            ("世界".into(), 0.7),
        ]);
        assert_eq!(shaped.text, "你好\n世界");
        assert_eq!(shaped.lines.len(), 2);
        assert!((shaped.confidence - 0.8).abs() < 1e-6);
    }

    #[test]
    fn empty_candidates_shape_to_empty_output() {
        let shaped = shape_result(vec![]);
        assert_eq!(shaped.text, "");
        assert!(shaped.lines.is_empty());
        assert_eq!(shaped.confidence, 0.0);
    }

    #[test]
    fn output_payload_uses_text_lines_confidence_keys() {
        let value = serde_json::to_value(shape_result(vec![("hi".into(), 0.5)]))
            .expect("payload serializes");
        assert_eq!(value["text"], serde_json::json!("hi"));
        assert_eq!(value["lines"][0]["text"], serde_json::json!("hi"));
        assert_eq!(value["confidence"], serde_json::json!(0.5));
        // Compile-time pin: the frontend matches exactly these keys.
        let _: OcrOutput = serde_json::from_value(value).expect("payload round-trips");
    }

    #[test]
    fn image_decode_rejects_garbage_and_empties() {
        assert!(decode_image("").is_err());
        assert!(decode_image("data:image/png;base64,").is_err());
        assert!(decode_image("!!!not-base64!!!").is_err());
        // Valid base64 decodes (data URL or raw alike).
        assert_eq!(decode_image("aGk=").unwrap(), b"hi");
        assert_eq!(
            decode_image("data:image/jpeg;base64,aGk=").unwrap(),
            b"hi"
        );
    }
}
