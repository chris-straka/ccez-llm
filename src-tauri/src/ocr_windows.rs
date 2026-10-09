//! Windows on-device OCR via WinRT `Windows.Media.Ocr`.
//!
//! Shared contract with `ocr.rs`: `ocr_supported` (true — the API ships
//! with Windows 10 1809+; a missing language pack surfaces at recognize
//! time, not here), `ocr_recognize` (top candidate per line through
//! [`super::ocr::shape_result`]). No word-boundary or confidence data:
//! WinRT exposes neither per line, so confidence is reported as 1.0
//! (documented, not faked per-word — there is exactly one candidate).
//!
//! Platform gating follows `tts_windows.rs`: the engine lives in `imp`
//! behind `cfg(target_os = "windows")`; every other platform gets
//! functions that report "requires Windows". Pure helpers compile
//! everywhere and are unit-tested on any host.

#![allow(dead_code)] // Windows-only shim: stubs compile everywhere, real code runs on Windows.

/// Guidance when no requested language has an installed OCR pack.
/// Pure (the frontend fallback regex matches "not supported").
pub fn missing_pack_message(languages: &[String]) -> String {
    format!(
        "on-device OCR is not supported for these languages here ({}). Install the OCR language pack in Settings > Time & Language > Language & region.",
        languages.join(", ")
    )
}

/// Does this build recognize text on-device? Always true on Windows
/// (WinRT OCR ships with the OS; per-language packs gate recognize).
pub fn ocr_supported() -> bool {
    #[cfg(target_os = "windows")]
    return imp::supported();
    #[cfg(not(target_os = "windows"))]
    return false;
}

/// Recognize text in raw image bytes with the first installed language
/// in `languages` (BCP-47, as produced by
/// [`super::ocr::recognition_languages`]). Returns top candidates shaped
/// by the caller.
pub fn ocr_recognize(bytes: &[u8], languages: &[String]) -> Result<Vec<(String, f32)>, String> {
    #[cfg(target_os = "windows")]
    return imp::recognize(bytes, languages);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (bytes, languages);
        return Err("on-device OCR requires Windows".into());
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::{
        core::HSTRING,
        Globalization::Language,
        Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    use super::missing_pack_message;

    pub fn supported() -> bool {
        true
    }

    fn stream_for(bytes: &[u8]) -> Result<InMemoryRandomAccessStream, String> {
        let stream =
            InMemoryRandomAccessStream::new().map_err(|e| format!("image stream failed: {e:?}"))?;
        let writer = DataWriter::CreateDataWriter(&stream)
            .map_err(|e| format!("image stream failed: {e:?}"))?;
        writer
            .WriteBytes(bytes)
            .map_err(|e| format!("image stream failed: {e:?}"))?;
        writer
            .StoreAsync()
            .map_err(|e| format!("image stream failed: {e:?}"))?
            .get()
            .map_err(|e| format!("image stream failed: {e:?}"))?;
        writer
            .DetachStream()
            .map_err(|e| format!("image stream failed: {e:?}"))?;
        Ok(stream)
    }

    fn bitmap_for(bytes: &[u8]) -> Result<SoftwareBitmap, String> {
        let stream = stream_for(bytes)?;
        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e| format!("that image could not be decoded: {e:?}"))?
            .get()
            .map_err(|e| format!("that image could not be decoded: {e:?}"))?;
        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| format!("that image could not be decoded: {e:?}"))?
            .get()
            .map_err(|e| format!("that image could not be decoded: {e:?}"))?;
        // Gray8 is the engine's preferred input; conversion also
        // normalizes the exotic pixel formats phone cameras produce.
        SoftwareBitmap::Convert(&bitmap, BitmapPixelFormat::Gray8)
            .map_err(|e| format!("that image could not be decoded: {e:?}"))
    }

    fn engine_for(languages: &[String]) -> Result<OcrEngine, String> {
        for tag in languages {
            let language = Language::CreateLanguage(&HSTRING::from(tag.as_str()))
                .map_err(|e| format!("language tag rejected: {e:?}"))?;
            if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                return Ok(engine);
            }
        }
        Err(missing_pack_message(languages))
    }

    pub fn recognize(bytes: &[u8], languages: &[String]) -> Result<Vec<(String, f32)>, String> {
        let bitmap = bitmap_for(bytes)?;
        let engine = engine_for(languages)?;
        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| format!("text recognition failed: {e:?}"))?
            .get()
            .map_err(|e| format!("text recognition failed: {e:?}"))?;
        let mut out = Vec::new();
        let lines = result
            .Lines()
            .map_err(|e| format!("text recognition failed: {e:?}"))?;
        for line in lines.into_iter() {
            let words = line
                .Words()
                .map_err(|e| format!("text recognition failed: {e:?}"))?;
            let mut text = String::new();
            for word in words.into_iter() {
                let part = word
                    .Text()
                    .map_err(|e| format!("text recognition failed: {e:?}"))?
                    .to_string();
                if !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(&part);
            }
            // WinRT exposes no per-line confidence: exactly one
            // candidate exists, so it is reported as 1.0.
            out.push((text, 1.0));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod pack_message_tests {
    use super::missing_pack_message;

    #[test]
    fn names_languages_and_matches_frontend_fallback() {
        let message = missing_pack_message(&["zh-Hans".to_string(), "en-US".to_string()]);
        assert!(message.contains("zh-Hans"));
        // The frontend routes on /requires macos|not supported|no on-device ocr/i.
        assert!(message.to_lowercase().contains("not supported"));
    }
}
