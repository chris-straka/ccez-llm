package studio.ccez.app.domain

/**
 * Speakable-text contracts (voice.ts parity): sentence chunking with
 * per-sentence voices, markdown reduced to plain speech, and
 * display-ready dictation errors. Everything here is pure so the
 * 1300-case web suite's behavior pins port over directly.
 */

/** Split text into speakable sentences (keeps delimiters, drops empties). */
fun splitSentences(text: String): List<String> {
    val out = mutableListOf<String>()
    // Line by line: collapsing newlines first would fuse an English
    // line and a Japanese line into one utterance in a single voice.
    for (line in text.split("\n")) {
        val cleaned = line.replace(Regex("\\s+"), " ").trim()
        if (cleaned.isEmpty()) continue
        val matches = Regex("[^.!?…。！？；\n]+[.!?…。！？；]+[\"»”’)]?|\\S[^.!?…。！？；]*$").findAll(cleaned)
        val parts = matches.map { it.value }.toList().ifEmpty { listOf(cleaned) }
        for (part in parts) {
            val trimmed = part.trim()
            if (trimmed.isNotEmpty()) out.add(trimmed)
        }
    }
    return out
}

/** Reduce reply markdown to speakable plain text. */
fun speechText(markdown: String): String {
    val noFences = Regex("```[\\s\\S]*?```").replace(markdown, " ")
    val noLinks = Regex("!?\\[[^\\]]*\\]\\([^)]*\\)").replace(noFences, " ")
    val noMedia = noLinks
        .replace("[Pasted an image]", " ")
        .replace(Regex("\\[Pasted \\d+ chars\\]"), "pasted content")
        .replace("[Pasted image]", "pasted image")
    return noMedia.split("\n")
        .joinToString("\n") { line ->
            line.replace(Regex("^#{1,6}\\s+"), "")
                .replace(Regex("^>\\s?"), "")
                .replace(Regex("^[-*]\\s+"), "")
        }
        .replace(Regex("[*_`~|]"), "")
        .replace(Regex("[ \\t]+"), " ")
        .replace(Regex("\n{2,}"), "\n")
        .trim()
}

/**
 * Script-run key for one character: Latin letters report "latin"; kana
 * and Han share "han" (a kanji mid-Japanese must not split the run);
 * every other non-Latin script keeps its own key; anything scriptless
 * (space, punctuation, digits, emoji) reports "other" for callers to
 * glue onto the current run.
 */
fun scriptRunKey(ch: Char): String {
    if (Character.UnicodeScript.of(ch.code) == Character.UnicodeScript.LATIN) return "latin"
    val lang = ttsLangFor(ch.toString(), "")
    if (lang == "ja-JP" || lang == "zh-CN") return "han"
    return if (lang.isEmpty()) "other" else lang
}

/**
 * Split one sentence into maximal script runs: Latin breaks runs,
 * kana/Han share one, every other non-Latin script breaks on change,
 * scriptless characters glue onto the current run.
 */
fun splitScriptRuns(sentence: String): List<String> {
    val runs = mutableListOf<String>()
    val current = StringBuilder()
    var key = ""
    fun flush() {
        val trimmed = current.toString().trim()
        if (trimmed.isNotEmpty()) runs.add(trimmed)
        current.clear()
        key = ""
    }
    for (ch in sentence) {
        val next = scriptRunKey(ch)
        if (next == "other") {
            current.append(ch)
            continue
        }
        if (key.isEmpty()) {
            key = next
            current.append(ch)
        } else if (next == key) {
            current.append(ch)
        } else {
            flush()
            key = next
            current.append(ch)
        }
    }
    flush()
    return runs
}

/**
 * Locale for one sentence: a directly-detected non-Chinese script wins;
 * undetected is the fallback; a Chinese fragment only counts when it is
 * a complete terminated sentence (mid-highlight fragments fall back to
 * the surrounding voice).
 */
fun sentenceSpeechLang(sentence: String, fallbackLang: String): String {
    val direct = ttsLangFor(sentence, "")
    if (direct.isNotEmpty() && direct != "zh-CN") return direct
    if (direct.isEmpty()) return fallbackLang
    return if (Regex("[.!?…。！？；\"»”’」』）)\\]]$").containsMatchIn(sentence.trim())) direct else fallbackLang
}

/**
 * Translation-gloss halves ("miteinander = with each other"): the
 * first top-level "=" whose sides both hold letters. "==", "=>",
 * "!=", "<=", ">=" stay whole, so code and math never split.
 */
fun splitGlossHalves(sentence: String): Pair<String, String>? {
    // The match starts on the character before the "=" itself.
    val at = Regex("[^=!<>]=(?!=|>)").find(sentence)?.range?.first ?: return null
    val eq = at + 1
    val left = sentence.substring(0, eq).trim()
    val right = sentence.substring(eq + 1).trim()
    if (!Regex("[A-Za-zÀ-ÿ]").containsMatchIn(left)) return null
    if (!Regex("[A-Za-zÀ-ÿ]").containsMatchIn(right)) return null
    return left to right
}

/** One speakable run with its own voice locale. */
data class SpeechSegment(val text: String, val lang: String)

/**
 * Split text into per-sentence voice runs: every sentence resolves its
 * own locale, and a sentence whose script runs resolve to different
 * locales splits further (no break needed between halves).
 */
fun splitSpeechSegments(
    text: String,
    langForSentence: (String) -> String,
): List<SpeechSegment> {
    val out = mutableListOf<SpeechSegment>()
    for (sentence in splitSentences(text)) {
        // Gloss lines read each side in its own voice; same-voice
        // halves stay one utterance exactly as before.
        val gloss = splitGlossHalves(sentence)
        if (gloss != null) {
            val leftLang = langForSentence(gloss.first)
            val rightLang = langForSentence(gloss.second)
            if (leftLang == rightLang) {
                out.add(SpeechSegment(sentence, leftLang))
            } else {
                out.add(SpeechSegment(gloss.first, leftLang))
                out.add(SpeechSegment(gloss.second, rightLang))
            }
            continue
        }
        val runs = splitScriptRuns(sentence)
        if (runs.size < 2) {
            out.add(SpeechSegment(sentence, langForSentence(sentence)))
            continue
        }
        val langs = runs.map { langForSentence(it) }
        if (langs.all { it == langs[0] }) {
            out.add(SpeechSegment(sentence, langs[0]))
            continue
        }
        for (i in runs.indices) out.add(SpeechSegment(runs[i], langs[i]))
    }
    return out
}

/**
 * Language seed for the Latin-script sentences inside `text`
 * (nativeTts.ts latinSentencesLang parity): the recognizer only ever
 * sees the Latin sentences, so each keeps its own language; with no
 * Latin content the fallback rides through for Han-fragment
 * inheritance.
 */
fun latinSentencesLang(text: String, fallback: String): String {
    val latin = splitSentences(text)
        .filter { ttsLangFor(it, "").isEmpty() }
        .joinToString(" ")
        .trim()
    if (latin.isEmpty()) return fallback
    return quoteLangFor(latin, fallback)
}

/**
 * Per-sentence voice resolver for a whole utterance (nativeTts.ts
 * sentenceLangsFor parity): unambiguous scripts resolve from the
 * sentence itself, every Latin-script sentence gets its own
 * identification pass, and translation-gloss right halves read in
 * the gloss fallback (the user's own language) instead of the seed.
 */
fun sentenceLangsFor(
    text: String,
    fallback: String,
    glossFallback: String = fallback,
): (String) -> String {
    val latin = splitSentences(text).filter { ttsLangFor(it, "").isEmpty() }
    val seed = if (latin.isNotEmpty()) latinSentencesLang(text, fallback) else fallback
    val perSentence = mutableMapOf<String, String>()
    for (sentence in latin) {
        val gloss = splitGlossHalves(sentence)
        if (gloss != null) {
            perSentence[gloss.first] = quoteLangFor(gloss.first, seed)
            perSentence[gloss.second] = quoteLangFor(gloss.second, glossFallback)
        } else {
            perSentence[sentence] = quoteLangFor(sentence, seed)
        }
    }
    val cache = mutableMapOf<String, String>()
    return { sentence ->
        cache.getOrPut(sentence) {
            perSentence[sentence] ?: sentenceSpeechLang(sentence, seed)
        }
    }
}

/**
 * Android recognition failures are bare engine codes
 * ("dictation error: 7"): translate them before they reach a toast,
 * mirroring friendlyMicError's shape (specific hints, else passthrough).
 */
fun dictationHint(message: String): String {
    if (Regex("unavailable", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
        return "Speech recognition isn't available on this device."
    }
    if (Regex("dictation error: 9\\b|permission|denied|not-allowed", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
        return "Mic permission denied — allow the microphone and try again."
    }
    if (Regex("dictation error: 7\\b|no-match|no-speech", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
        return "Didn't catch anything — try again."
    }
    if (Regex("dictation error: (6|8)\\b|busy|timeout", RegexOption.IGNORE_CASE).containsMatchIn(message)) {
        return "Dictation timed out — try again."
    }
    return message
}
