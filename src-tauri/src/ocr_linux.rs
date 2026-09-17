//! Linux on-device OCR through an installed Tesseract CLI.
//!
//! Linux ships no OS text-recognition API, so this drives the binary
//! distributions themselves package (`tesseract`), local, free, and
//! offline — the same "use what's on the system" rule as the espeak
//! fallback in `tts_linux.rs`. No model downloads, no network, no new
//! crates: `std::process` only, so this file compiles and unit-tests
//! on any host.
//!
//! Shared contract with `ocr.rs`: `ocr_supported` (true when the binary
//! exists), `ocr_recognize` (stdout text lines through
//! [`super::ocr::shape_result`]). Tesseract's stdout mode reports no
//! confidence, so lines are reported as 1.0 (documented, matching the
//! Windows bridge). When the binary — or every requested language's
//! traineddata — is missing, recognition fails with a message the
//! frontend fallback regex already routes ("no on-device OCR").

#![allow(dead_code)] // Linux-first shim: everything runs through std::process.
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Tesseract code for a BCP-47 tag from
/// [`super::ocr::recognition_languages`]. Cantonese has no dedicated
/// traineddata on most distros; Traditional Chinese is the closest
/// installed pack. Pure and unit-tested.
pub fn tesseract_code_for(tag: &str) -> &'static str {
    match tag.trim() {
        "zh-Hans" | "cmn" => "chi_sim",
        "zh-Hant" | "yue-Hant" | "yue-Hans" => "chi_tra",
        "ja-JP" => "jpn",
        "ko-KR" => "kor",
        "en-US" => "eng",
        "fr-FR" => "fra",
        "de-DE" => "deu",
        "es-ES" => "spa",
        "it-IT" => "ita",
        "pt-BR" => "por",
        "ru-RU" => "rus",
        "uk-UA" => "ukr",
        // Modeled scripts the frontend can now request (mirroring the
        // expanded `recognition_languages`): distro packs gate at
        // `usable_codes`, so an unmapped tag still lands on English.
        "ar-SA" => "ara",
        "cs-CZ" => "ces",
        "da-DK" => "dan",
        "id-ID" => "ind",
        "ms-MY" => "msa",
        "nb-NO" => "nor",
        "nl-NL" => "nld",
        "pl-PL" => "pol",
        "ro-RO" => "ron",
        "sv-SE" => "swe",
        "th-TH" => "tha",
        "tr-TR" => "tur",
        "vi-VT" => "vie",
        _ => "eng",
    }
}

/// Requested tags → installed Tesseract codes, in request order,
/// deduplicated. Codes with no installed traineddata are dropped; when
/// nothing usable remains, English is kept if installed (better a
/// wrong-script attempt than a refusal), else the list is empty and the
/// caller reports missing language data. Pure and unit-tested.
pub fn usable_codes(requested: &[String], installed: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for tag in requested {
        let code = tesseract_code_for(tag).to_string();
        if installed.iter().any(|lang| lang == &code) && !out.contains(&code) {
            out.push(code);
        }
    }
    if out.is_empty() && installed.iter().any(|lang| lang == "eng") {
        out.push("eng".to_string());
    }
    out
}

/// Parse `tesseract --list-langs` stdout: one code per line under a
/// `List of available languages (...)` header. Pure and unit-tested.
pub fn parse_list_langs(output: &str) -> Vec<String> {
    output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("List of "))
        .map(str::to_string)
        .collect()
}

fn command_present(binary: &str) -> bool {
    Command::new(binary)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn installed_langs() -> Vec<String> {
    static CACHED: OnceLock<Vec<String>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            Command::new("tesseract")
                .arg("--list-langs")
                .stdin(Stdio::null())
                .output()
                .ok()
                .filter(|out| out.status.success())
                .map(|out| parse_list_langs(&String::from_utf8_lossy(&out.stdout)))
                .unwrap_or_default()
        })
        .clone()
}

/// Does this build recognize text on-device? True when Tesseract is
/// installed (language packs gate individual requests, not support).
pub fn ocr_supported() -> bool {
    command_present("tesseract")
}

/// Recognize text in raw image bytes with the installed subset of
/// `languages` (BCP-47). Returns stdout lines for the caller to shape.
pub fn ocr_recognize(
    bytes: &[u8],
    languages: &[String],
) -> Result<Vec<(String, f32)>, String> {
    if !command_present("tesseract") {
        return Err("no on-device OCR on this machine (install tesseract for offline text recognition)".into());
    }
    let codes = usable_codes(languages, &installed_langs());
    if codes.is_empty() {
        return Err("no on-device OCR language data installed (tesseract has no usable traineddata for these languages)".into());
    }
    let mut child = Command::new("tesseract")
        .arg("stdin")
        .arg("stdout")
        .arg("-l")
        .arg(codes.join("+"))
        .arg("--psm")
        .arg("6")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("text recognition failed to start: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(bytes)
            .map_err(|e| format!("text recognition failed: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("text recognition failed: {e}"))?;
    if !output.status.success() {
        return Err("text recognition failed on this image".into());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| (line.to_string(), 1.0))
        .collect())
}

#[cfg(test)]
mod tesseract_tests {
    use super::{parse_list_langs, tesseract_code_for, usable_codes};

    #[test]
    fn maps_vision_tags_to_tesseract_codes() {
        assert_eq!(tesseract_code_for("zh-Hans"), "chi_sim");
        assert_eq!(tesseract_code_for("zh-Hant"), "chi_tra");
        assert_eq!(tesseract_code_for("yue-Hant"), "chi_tra");
        assert_eq!(tesseract_code_for("ja-JP"), "jpn");
        assert_eq!(tesseract_code_for("en-US"), "eng");
        assert_eq!(tesseract_code_for("fr-FR"), "fra");
        assert_eq!(tesseract_code_for("xx"), "eng");
    }

    #[test]
    fn maps_expanded_script_tags_to_tesseract_codes() {
        assert_eq!(tesseract_code_for("ar-SA"), "ara");
        assert_eq!(tesseract_code_for("th-TH"), "tha");
        assert_eq!(tesseract_code_for("vi-VT"), "vie");
        assert_eq!(tesseract_code_for("tr-TR"), "tur");
        assert_eq!(tesseract_code_for("pl-PL"), "pol");
        assert_eq!(tesseract_code_for("cs-CZ"), "ces");
        assert_eq!(tesseract_code_for("id-ID"), "ind");
        assert_eq!(tesseract_code_for("ms-MY"), "msa");
        assert_eq!(tesseract_code_for("nb-NO"), "nor");
    }

    #[test]
    fn parses_list_langs_skipping_header() {
        assert_eq!(
            parse_list_langs("List of available languages (4):\nchi_sim\nchi_tra\neng\njpn\n"),
            vec!["chi_sim", "chi_tra", "eng", "jpn"]
        );
        assert!(parse_list_langs("").is_empty());
    }

    #[test]
    fn keeps_requested_subset_falls_back_to_english() {
        let installed = vec!["eng".to_string(), "jpn".to_string()];
        assert_eq!(
            usable_codes(
                &["zh-Hans".to_string(), "ja-JP".to_string()],
                &installed
            ),
            vec!["jpn".to_string()]
        );
        // English fallback only when nothing requested is installed.
        assert_eq!(
            usable_codes(&["zh-Hans".to_string()], &installed),
            vec!["eng".to_string()]
        );
        assert!(usable_codes(&["zh-Hans".to_string()], &[]).is_empty());
        // Requested and installed: exact order, deduplicated.
        assert_eq!(
            usable_codes(
                &["en-US".to_string(), "ja-JP".to_string(), "en-US".to_string()],
                &installed
            ),
            vec!["eng".to_string(), "jpn".to_string()]
        );
    }
}
