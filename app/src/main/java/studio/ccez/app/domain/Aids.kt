package studio.ccez.app.domain

/** Scripts with reading aids (reading.ts parity). */
enum class AidScript { ZH, JA, AR }

val SCRIPT_LABEL = mapOf(AidScript.ZH to "中文", AidScript.JA to "日本語", AidScript.AR to "العربية")
val AID_LABEL = mapOf(AidScript.ZH to "pinyin", AidScript.JA to "furigana", AidScript.AR to "tashkeel")

/** Locally computed aids (Tauri LocalAid). */
enum class LocalAid { PINYIN, FURIGANA }

private val KANA_RE = Regex("[\\u3040-\\u309F\\u30A0-\\u30FF]")
private val HAN_RE = Regex("\\p{Script=Han}", RegexOption.IGNORE_CASE)
private val ARABIC_RE = Regex("[\\u0600-\\u06FF\\u0750-\\u077F]")

data class CodedLine(val line: String, val code: Boolean)

/** Fenced code never converts: readings inside code are noise. */
fun codeAwareLines(text: String): List<CodedLine> {
    val out = mutableListOf<CodedLine>()
    var fenced = false
    for (line in text.split("\n")) {
        if (Regex("^\\s*```").containsMatchIn(line)) {
            fenced = !fenced
            out.add(CodedLine(line, true))
            continue
        }
        out.add(CodedLine(line, fenced))
    }
    return out
}

/** Detection text: fenced code out, inline code spans read as empty. */
fun stripCodeForDetection(text: String): String =
    codeAwareLines(text).filter { !it.code }
        .joinToString("\n") { it.line.replace(Regex("`[^`\n]*`"), "") }

/** Arabic first (distinct block), then kana, then Han. */
fun detectScripts(text: String): List<AidScript> {
    val scripts = mutableListOf<AidScript>()
    if (ARABIC_RE.containsMatchIn(text)) scripts.add(AidScript.AR)
    if (KANA_RE.containsMatchIn(text)) scripts.add(AidScript.JA)
    if (text.split("\n").any { line -> HAN_RE.containsMatchIn(line) && !KANA_RE.containsMatchIn(line) }) {
        scripts.add(AidScript.ZH)
    }
    return scripts
}

fun detectScript(text: String): AidScript? = detectScripts(text).firstOrNull()

/**
 * Which local aid owns one line: kana reads Japanese, Han-only is
 * ambiguous (reply language breaks the tie, Chinese wins by default).
 */
fun classifyAidLine(line: String, preferred: LocalAid? = null): LocalAid? {
    if (KANA_RE.containsMatchIn(line)) return LocalAid.FURIGANA
    if (HAN_RE.containsMatchIn(line)) return preferred ?: LocalAid.PINYIN
    return null
}

/** True when the text holds a Han-only line no script test can own. */
fun hasAmbiguousAidLine(text: String): Boolean =
    text.split("\n").any { line -> HAN_RE.containsMatchIn(line) && !KANA_RE.containsMatchIn(line) }

/** Reply-language pill's local aid: Japanese owns kanji-only lines. */
fun preferredLocalAid(code: String?): LocalAid? = when (code) {
    "ja" -> LocalAid.FURIGANA
    "zh", "yue" -> LocalAid.PINYIN
    else -> null
}

/** Kana present = Japanese, else Chinese default. */
fun hanOverlayLangFor(text: String): String = if (KANA_RE.containsMatchIn(text)) "ja" else "zh"

// ---- Model-assisted aids (tashkeel) ----

const val TASHKEEL_INSTRUCTION =
    "Add full Arabic diacritics (tashkeel) to the following text. " +
        "Reply with the vocalized text only, one line per input line, no explanations."

/** Lines carrying Arabic script: the only lines tashkeel may touch. */
fun aidTargetLines(text: String): List<Int> =
    text.split("\n").mapIndexedNotNull { i, line -> if (ARABIC_RE.containsMatchIn(line)) i else null }

/**
 * Splice vocalized lines back, replacing only Arabic lines so other
 * paragraphs stay byte-identical. Null when the shape doesn't fit.
 */
fun spliceAidResult(original: String, indexes: List<Int>, result: String): String? {
    val out = result.split("\n")
    if (out.size != indexes.size) return null
    val lines = original.split("\n").toMutableList()
    indexes.forEachIndexed { k, lineIdx ->
        val replacement = out[k]
        if (lineIdx < lines.size) lines[lineIdx] = replacement
    }
    return lines.joinToString("\n")
}

/** Provider messages for the tashkeel aid call. */
fun tashkeelMessages(text: String): List<Pair<String, String>> =
    listOf("system" to TASHKEEL_INSTRUCTION, "user" to text)

// ---- Segments for ruby rendering ----

/** One render unit: surface text plus an optional reading above it. */
data class AidSegment(val surface: String, val reading: String? = null)

/** Katakana (＋゛゜) to hiragana, for furigana display. */
fun katakanaToHiragana(input: String): String {
    val out = StringBuilder()
    var i = 0
    while (i < input.length) {
        val c = input[i]
        when {
            c in 'ァ'..'ヶ' -> out.append((c.code - 0x60).toChar())
            c == 'ヵ' -> out.append('か')
            c == 'ヶ' -> out.append('け')
            c == 'ヴ' -> out.append('う').append('゛')
            c == '・' || c == 'ー' -> out.append(c)
            else -> out.append(c)
        }
        i += 1
    }
    return out.toString()
}

/** True when the token needs no reading (kana, digits, or reading == surface). */
fun needsReading(surface: String, reading: String?): Boolean {
    if (reading.isNullOrEmpty()) return false
    if (!HAN_RE.containsMatchIn(surface)) return false
    return reading != surface
}

/**
 * Message segments for a pinned aid set. Dual-aid rendering applies
 * each aid only to its own lines (classifyAidLine ownership); code
 * lines and unowned lines stay plain. Newlines ride as separator
 * segments so renderers can break rows.
 */
fun aidSegmentsFor(
    content: String,
    aids: Set<LocalAid>,
    preferred: LocalAid?,
    pinyin: PinyinReader,
    furigana: FuriganaEngine,
): List<AidSegment> {
    if (aids.isEmpty()) return listOf(AidSegment(content))
    val out = mutableListOf<AidSegment>()
    codeAwareLines(content).forEachIndexed { li, coded ->
        if (li > 0) out.add(AidSegment("\n"))
        val line = coded.line
        if (coded.code || line.isEmpty()) {
            out.add(AidSegment(line))
            return@forEachIndexed
        }
        val owner = classifyAidLine(line, preferred)
        out.addAll(
            when {
                owner == LocalAid.PINYIN && LocalAid.PINYIN in aids -> pinyinLine(line, pinyin, preferred)
                owner == LocalAid.FURIGANA && LocalAid.FURIGANA in aids -> furiganaLine(furigana, line, preferred)
                else -> listOf(AidSegment(line))
            },
        )
    }
    return out
}
