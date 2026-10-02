package studio.ccez.app.domain

/**
 * Word-tap speech (reading.ts slice): word expansion plus per-word
 * voice locale. A long-press on a message word reads just that word;
 * long-press on open space reads the whole message (same mapping as
 * the web right-click handler). Offsets are UTF-16 units, like the
 * DOM offsets the web contract was written against.
 */
private val WORD_BREAK =
    Regex("[\\s，。！？、；：「」『』（）［］【】《》〈〉…—–·,.!?;:\"'()\\[\\]{}<>・、。؟؛،«»‹›„“”‘’\\n\\r\\t]")

fun isWordChar(char: Char?): Boolean =
    char != null && !WORD_BREAK.matches(char.toString())

/** Expand `offset` to the full word (maximal run of word chars). */
fun extractWordAt(text: String, offset: Int): String {
    if (offset < 0 || offset >= text.length || !isWordChar(text[offset])) return ""
    var start = offset
    while (start > 0 && isWordChar(text[start - 1])) start--
    var end = offset
    while (end < text.length && isWordChar(text[end])) end++
    return text.substring(start, end)
}

/** Script priority mirrors SCRIPT_LOCALE order (kana before Han). */
private fun scriptLang(script: Character.UnicodeScript): String? = when (script) {
    Character.UnicodeScript.ARABIC -> "ar-SA"
    Character.UnicodeScript.HIRAGANA,
    Character.UnicodeScript.KATAKANA -> "ja-JP"
    Character.UnicodeScript.HANGUL -> "ko-KR"
    Character.UnicodeScript.HAN -> "zh-CN"
    Character.UnicodeScript.CYRILLIC -> "ru-RU"
    Character.UnicodeScript.GREEK -> "el-GR"
    Character.UnicodeScript.HEBREW -> "he-IL"
    Character.UnicodeScript.THAI -> "th-TH"
    Character.UnicodeScript.DEVANAGARI -> "hi-IN"
    Character.UnicodeScript.ARMENIAN -> "hy-AM"
    Character.UnicodeScript.GEORGIAN -> "ka-GE"
    else -> null
}

private val SCRIPT_PRIORITY = listOf(
    "ar-SA", "ja-JP", "ko-KR", "zh-CN", "ru-RU", "el-GR",
    "he-IL", "th-TH", "hi-IN", "hy-AM", "ka-GE",
)

/**
 * BCP-47 voice locale for a word. Non-Latin scripts resolve by Unicode
 * script (first hit in web priority order wins, so kana+kanji mixes
 * read Japanese); Latin-script words use `fallback`.
 */
fun ttsLangFor(word: String, fallback: String = "en-US"): String {
    val hits = mutableSetOf<String>()
    var i = 0
    while (i < word.length) {
        val cp = word.codePointAt(i)
        scriptLang(Character.UnicodeScript.of(cp))?.let { hits.add(it) }
        i += Character.charCount(cp)
    }
    return SCRIPT_PRIORITY.firstOrNull { it in hits } ?: fallback
}

/**
 * Whether `text` carries Hanyu pinyin tone marks (caron vowels, the
 * u-umlaut series). Toned pinyin is unambiguously Mandarin; toneless
 * stays genuinely ambiguous Latin and is left alone.
 */
fun hasPinyinTones(text: String): Boolean =
    Regex("[ǎǍǐǏǒǑǔǓěĚǖǘǚǜǕǗǙǛ]").containsMatchIn(text)
