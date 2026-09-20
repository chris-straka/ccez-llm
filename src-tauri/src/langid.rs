//! Offline language identification for platforms without Apple's
//! `NLLanguageRecognizer` (everything off macOS/iOS, where
//! `tts_identify_lang` has no recognizer to call).
//!
//! Same contract as the macOS recognizer path: a BCP-47-ish tag, or
//! None when the sample is too short or unscorable — callers fall back
//! to script detection. Fully offline (a small stop-word scorer, no
//! downloads, no new crates). The TypeScript copy in
//! `src/lib/langId.ts` covers the browser preview; the word lists here
//! deliberately match it so shell and preview agree.
//!
//! Pure and unit-tested on any host.
//!
//! Decision (Sep 2026): WIRED UP, not dead code — `tts_identify_lang`
//! in `tts.rs` calls `identify_lang_offline` on every non-Apple target,
//! and `MIN_WORDS` / `MIN_SCORE` / the helpers are all used below. The
//! module still compiles on macOS/iOS (so its unit tests run on the
//! dev host), where nothing calls it — hence the Apple-only allow.

//! Non-Apple shim: compiled everywhere, called off macOS/iOS.
#![cfg_attr(any(target_os = "macos", target_os = "ios"), allow(dead_code))]

/// Minimum Latin tokens before a sample counts as classifiable.
pub const MIN_WORDS: usize = 10;
/// Minimum winning stop-word hits before a sample counts as identified.
pub const MIN_SCORE: usize = 2;

/// Shared function words vote in every list they belong to (que, la,
/// un, entre, mais, …) — the majority decides. Kept OUT are one-list
/// words colliding with another list's core (an/am/im/is/was/do/we/
/// on/sur/no/ma/si/da/su/mi/tu, war/hat/alle/rond/door/via/plus/
/// will/son). Must match src/lib/langId.ts so shell and preview agree.
const STOP_WORDS: &[(&str, &[&str])] = &[
    (
        "en-US",
        &[
            "the", "and", "that", "have", "with", "this", "from", "they", "would", "there",
            "are", "you", "your", "yours", "our", "ours", "them", "their", "theirs",
            "it", "its", "were", "has", "had", "shall", "should", "can", "cannot",
            "could", "must", "may", "might", "does", "did", "done", "each", "other",
            "such", "than", "then", "these", "those", "when", "where", "which",
            "while", "who", "whom", "whose", "because", "about", "into", "over",
            "under", "between", "both", "few", "more", "most", "some", "only",
            "own", "same", "too", "very", "often", "always", "never", "every",
            "all", "to", "for", "not", "what", "out", "here", "how", "why", "now",
        ],
    ),
    (
        "fr-FR",
        &[
            "les", "des", "une", "que", "est", "dans", "pour", "vous", "avec", "pas",
            "la", "le", "un", "du", "au", "aux", "et", "sont", "ont", "fait",
            "tout", "tous", "toute", "toutes", "cette", "ces", "ses", "mes",
            "leur", "leurs", "notre", "votre", "mon", "sous", "suis", "sommes",
            "êtes", "où", "ça", "mais", "entre",
        ],
    ),
    (
        "de-DE",
        &[
            "der", "die", "und", "den", "von", "mit", "ist", "das", "sich", "nicht",
            "eine", "einer", "einem", "einen", "eines", "ein", "auch", "noch",
            "nur", "schon", "sehr", "mehr", "oder", "aber", "wenn", "dann",
            "weil", "wird", "werden", "sind", "haben", "hatte", "hatten",
            "wurde", "wurden", "kein", "keine", "keiner", "keinen", "dieser",
            "diese", "dieses", "diesen", "diesem", "jeder", "jede", "jedes",
            "jeden", "allem", "aller", "alles", "beim", "zum", "zur", "vom",
            "aus", "bei", "nach", "durch", "gegen", "ohne", "zwischen", "bis",
            "zu", "vor", "hinter", "neben", "seit", "statt", "trotz", "während",
            "wegen", "für", "über", "dich", "euch", "uns",
        ],
    ),
    (
        "es-ES",
        &[
            "los", "las", "una", "que", "está", "para", "con", "por", "como", "pero",
            "dónde", "cuándo", "cómo", "qué", "cuál",
            "la", "un", "el", "unos", "unas", "sino", "aunque", "porque", "donde",
            "cuando", "están", "este", "esta", "estos", "estas", "eso", "esa",
            "aquí", "muy", "también", "siempre", "nunca", "más", "menos",
            "hasta", "desde", "sobre", "contra", "según", "durante", "mediante",
            "hacia", "tras", "bajo", "entre", "mes", "del", "al", "poco", "cosa",
        ],
    ),
    (
        "it-IT",
        &[
            "che", "una", "della", "sono", "come", "più", "anche", "nostra", "questo", "molto",
            "la", "le", "un", "uno", "di", "dello", "degli", "delle", "del", "al",
            "dal", "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nello",
            "nella", "nei", "negli", "nelle", "sul", "sullo", "sulla", "sui",
            "sugli", "sulle", "non", "quando", "è", "ho", "hai", "dove", "perché", "poiché",
            "mentre", "tanto", "troppo", "poco", "tutto", "tutti", "ogni",
            "questa", "questi", "queste", "quello", "quella", "stesso", "stessa",
            "sopra", "sotto", "dentro", "fuori", "senza", "contro", "verso",
            "durante", "secondo", "oltre", "attraverso", "lungo", "presso",
            "circa", "quasi", "forse", "sempre", "mai", "già", "ancora",
            "appena", "insieme", "meno", "bene", "cosa", "niente", "nulla",
            "qualcosa", "qualcuno", "altro", "altra", "altri", "altre",
        ],
    ),
    (
        "pt-PT",
        &[
            "que", "uma", "para", "com", "não", "como", "mais", "seus", "entre", "muito",
            "ao", "aos", "numa", "este", "esta", "estes", "estas", "esse", "essa",
            "isso", "isto", "aquele", "aquela", "aquilo", "menos", "desde", "sobre",
            "nunca", "sempre", "tanto", "quando", "porque", "tudo", "todos",
            "todas", "todo", "toda", "cada", "qual", "quais", "onde", "pois", "é", "são", "está", "estão",
            "embora", "também", "ainda", "já", "até", "tão", "segundo",
            "durante", "através", "sem",
        ],
    ),
    (
        "nl-NL",
        &[
            "van", "het", "een", "dat", "die", "voor", "met", "zijn", "niet", "ook",
            "ik", "wij", "jullie", "zij", "ze", "mij", "jou", "jouw", "hem",
            "haar", "hen", "hun", "ons", "dit", "deze", "daar", "waar", "wanneer",
            "hoe", "één", "waarom", "omdat", "terwijl", "maar", "dus", "toch", "wel",
            "te", "geen", "nooit", "altijd", "soms", "vaak", "alleen", "samen",
            "tussen", "zonder", "naar", "uit", "tegen", "tijdens", "volgens",
            "wegens", "dankzij", "ondanks", "behalve", "naast", "boven", "onder",
            "langs", "tenzij", "zodat", "zodra", "voordat", "nadat", "totdat",
            "alsof", "evenals", "mits", "zelfs", "zelf", "elkaar",
        ],
    ),
];

fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'
        | '\u{AC00}'..='\u{D7AF}' | '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}')
}

fn is_latin_word_char(c: char) -> bool {
    c.is_alphabetic() && !('\u{3040}'..='\u{30FF}').contains(&c) && !is_cjk(c)
}

/// BCP-47 tag for `text`, or None when it cannot be told apart.
/// Non-Latin scripts resolve by script block (Japanese kana, Han,
/// Hangul, Arabic); Latin scripts go through the stop-word scorer.
pub fn identify_lang_offline(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().any(|c| ('\u{3040}'..='\u{30FF}').contains(&c)) {
        return Some("ja-JP".to_string());
    }
    if trimmed.chars().any(|c| ('\u{AC00}'..='\u{D7AF}').contains(&c)) {
        return Some("ko-KR".to_string());
    }
    if trimmed
        .chars()
        .any(|c| matches!(c, '\u{0600}'..='\u{06FF}' | '\u{0750}'..='\u{077F}'))
    {
        return Some("ar-SA".to_string());
    }
    if trimmed.chars().any(|c| matches!(c,
        '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}'))
    {
        return Some("zh-CN".to_string());
    }
    let tokens: Vec<String> = trimmed
        .to_lowercase()
        .split(|c: char| !is_latin_word_char(c))
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if tokens.len() < MIN_WORDS {
        return None;
    }
    let mut best: Option<&str> = None;
    let mut best_score = 0;
    for (lang, words) in STOP_WORDS {
        let mut score = 0;
        for word in *words {
            score += tokens.iter().filter(|t| t.as_str() == *word).count();
        }
        if score > best_score {
            best_score = score;
            best = Some(lang);
        }
    }
    if best_score < MIN_SCORE {
        return None;
    }
    best.map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::identify_lang_offline;

    #[test]
    fn resolves_scripts_without_statistics() {
        assert_eq!(
            identify_lang_offline("日本語を勉強しています").as_deref(),
            Some("ja-JP")
        );
        assert_eq!(
            identify_lang_offline("我正在学习中文").as_deref(),
            Some("zh-CN")
        );
        assert_eq!(identify_lang_offline("hi"), None);
    }

    #[test]
    fn tells_french_from_english() {
        let french = "Les enfants jouent dans le jardin avec leurs amis pour fêter la fin de lannée";
        let english =
            "The children have played with their friends and they would come back from there";
        assert_eq!(identify_lang_offline(french).as_deref(), Some("fr-FR"));
        assert_eq!(identify_lang_offline(english).as_deref(), Some("en-US"));
    }

    #[test]
    fn rejects_short_and_scoreless_samples() {
        assert_eq!(identify_lang_offline(""), None);
        assert_eq!(identify_lang_offline("hi there"), None);
        assert_eq!(
            identify_lang_offline("lorem ipsum dolor sit amet consectetur adipiscing"),
            None
        );
    }

    #[test]
    fn identifies_conversational_sentences() {
        // Real reply sentences: the extended lists catch function
        // words the ten-word core misses.
        assert_eq!(
            identify_lang_offline("Great picks these are all very natural German constructions indeed").as_deref(),
            Some("en-US")
        );
        assert_eq!(
            identify_lang_offline("Der Hund und die Katze sind nicht von hier mit den anderen aus der Stadt").as_deref(),
            Some("de-DE")
        );
        assert_eq!(
            identify_lang_offline("Je ne sais pas où est la gare parce que je suis perdu ici").as_deref(),
            Some("fr-FR")
        );
    }
}
