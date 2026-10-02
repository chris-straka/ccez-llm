package studio.ccez.app.domain

/**
 * Pinyin readings for Chinese text (pinyin.ts parity).
 *
 * The Tauri app uses pinyin-pro (contextual polyphones) per character.
 * The native equivalent is android.icu Transliterator "Han-Latin"
 * (built into Android, verified on-device to emit tone-marked syllables),
 * applied per character so readings always align 1:1. Per-character
 * lookup has no cross-char context — a documented step down from
 * pinyin-pro's polyphone resolution — and results are cached.
 */
fun interface PinyinReader {
    /** Tone-marked syllable for one Hanzi, or null when it has none. */
    fun reading(char: Char): String?
}

/** Script-segment gate: any kana run makes this Japanese, never pinyin. */
fun containsKana(text: String): Boolean =
    text.any { it in '\u3040'..'\u309F' || it in '\u30A0'..'\u30FF' }

private val HAN_CHAR = Regex("\\p{Script=Han}")

fun isHanChar(c: Char): Boolean = HAN_CHAR.matches(c.toString())

/** Per-character ruby segments; kana-bearing text passes through unannotated. */
fun pinyinSegments(text: String, reader: PinyinReader): List<AidSegment> {
    if (containsKana(text)) return listOf(AidSegment(text, null))
    if (text.isEmpty()) return emptyList()
    return text.map { char ->
        val reading = if (isHanChar(char)) reader.reading(char)?.takeIf { it != char.toString() } else null
        AidSegment(char.toString(), reading)
    }
}

/**
 * Pinyin for one line, gated exactly like the Tauri path: lines the
 * classifier owns convert, kana lines and other aids' lines pass
 * through as single unannotated segments.
 */
fun pinyinLine(text: String, reader: PinyinReader, preferred: LocalAid? = null): List<AidSegment> {
    if (classifyAidLine(text, preferred) != LocalAid.PINYIN) return listOf(AidSegment(text, null))
    return pinyinSegments(text, reader)
}
