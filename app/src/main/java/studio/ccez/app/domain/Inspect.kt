package studio.ccez.app.domain

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Inspect: single-character Han (kanji/hanzi) lookup data.
 *
 * Fully offline, fully data-driven (no hand-curated entries): splits
 * from the generated cjk-decomp subset plus readings, definitions,
 * stroke counts, and Kangxi radicals from the generated Unihan bundle.
 * Mirrors inspect.ts; tables load from gzipped JSON assets (converted
 * from the generated TS, never hand-edited).
 */
@Serializable
data class UnihanEntry(
    val d: String? = null,
    val m: String? = null,
    val on: String? = null,
    val kun: String? = null,
    val t: String? = null,
    val rs: String? = null,
)

/** One inspected character: everything the overlay shows. */
data class InspectData(
    val char: String,
    /** Immediate components (empty when the vendored subset lacks it). */
    val components: List<String>,
    /** Total stroke count (Unihan kTotalStrokes), or null when missing. */
    val strokeCount: Int?,
    /** Kangxi radical character (Unihan kRSUnicode), or null. */
    val radical: String?,
    /** Residual strokes after the radical (kRSUnicode), or null. */
    val radicalRest: Int?,
    /** Short gloss (Unihan kDefinition), or null. */
    val definition: String?,
    /** Hanyu pinyin with tone marks (Unihan kMandarin), or null. */
    val mandarin: String?,
    /** Space-separated on readings (Unihan kJapaneseOn), or null. */
    val japaneseOn: String?,
    /** Space-separated kun readings (Unihan kJapaneseKun), or null. */
    val japaneseKun: String?,
)

/** One character and its immediate components. */
data class ComponentEntry(val char: String, val components: List<String>)

/** One node of a recursive decomposition tree (depth-capped). */
data class DecompNode(val char: String, val children: List<DecompNode>)

private val lenientJson = Json { ignoreUnknownKeys = true }

/** Parsed tables; load once from assets, inject JSON strings in tests. */
class InspectTables(
    val unihan: Map<String, UnihanEntry>,
    val decomp: Map<String, List<String>>,
) {
    companion object {
        fun load(unihanJson: String, decompJson: String): InspectTables = InspectTables(
            unihan = lenientJson.decodeFromString(unihanJson),
            decomp = lenientJson.decodeFromString(decompJson),
        )
    }

    /**
     * Immediate components for one character, or null when unknown.
     * Splits come solely from the vendored cjk-decomp subset.
     */
    fun decomposeChar(ch: String): ComponentEntry? {
        val data = decomp[ch]
        if (data.isNullOrEmpty()) return null
        return ComponentEntry(ch, data.toList())
    }

    /**
     * Recursive decomposition up to `depth` levels (default 2, like the
     * mdbg.net word panel: 通 → 辶 + 甬 → 用 + …). Single-child and
     * cyclic splits stop as leaves so the tree always terminates.
     */
    fun decomposeTree(ch: String, depth: Int = 2, seen: List<String> = emptyList()): DecompNode {
        if (depth <= 0 || ch in seen) return DecompNode(ch, emptyList())
        val entry = decomposeChar(ch)
        if (entry == null || entry.components.size < 2) return DecompNode(ch, emptyList())
        val next = seen + ch
        return DecompNode(ch, entry.components.map { decomposeTree(it, depth - 1, next) })
    }

    /**
     * Decompose the Han characters in a text selection, in order,
     * deduped. Non-Han characters are skipped. Unknown Han characters
     * are reported with an empty component list.
     */
    fun decomposeText(text: String): List<ComponentEntry> {
        val seen = mutableSetOf<String>()
        val out = mutableListOf<ComponentEntry>()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            val ch = String(Character.toChars(cp))
            i += Character.charCount(cp)
            if (!isHanChar(ch) || ch in seen) continue
            seen.add(ch)
            out.add(decomposeChar(ch) ?: ComponentEntry(ch, emptyList()))
        }
        return out
    }

    /** Offline lookup for one character (components + count + radical + definition + readings). */
    fun getInspectData(char: String): InspectData {
        val trimmed = char.trim()
        val entry = unihan[trimmed]
        val components = decomposeChar(trimmed)?.components ?: emptyList()
        val strokes = entry?.t?.toIntOrNull()
        val kangxi = parseKangxi(entry?.rs)
        return InspectData(
            char = trimmed,
            components = components,
            strokeCount = strokes,
            radical = kangxi?.radical,
            radicalRest = kangxi?.rest,
            definition = entry?.d,
            mandarin = entry?.m,
            japaneseOn = entry?.on,
            japaneseKun = entry?.kun,
        )
    }
}

/**
 * The 214 Kangxi radicals in number order (1-indexed): index 0 is
 * radical 1 (一), index 213 is radical 214 (龠). Static reference data.
 */
private const val KANGXI_RADICALS =
    "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠"

/**
 * Display forms for Kangxi radicals whose standard codepoint is not
 * the familiar shape: 辵 (162, the dictionary form) renders as 辶.
 */
private val RADICAL_DISPLAY = mapOf("辵" to "辶")

data class KangxiParse(val radical: String, val rest: Int)

/**
 * Parse a Unihan kRSUnicode value ("149.7") into its radical and
 * residual stroke count. Anything else yields null.
 */
fun parseKangxi(rs: String?): KangxiParse? {
    if (rs == null) return null
    val dot = rs.indexOf('.')
    if (dot < 0) return null
    val num = rs.substring(0, dot).toIntOrNull() ?: return null
    val rest = rs.substring(dot + 1).toIntOrNull() ?: return null
    if (num < 1 || num > 214) return null
    val raw = KANGXI_RADICALS[num - 1].toString()
    return KangxiParse(RADICAL_DISPLAY[raw] ?: raw, rest)
}

/** True for a Han (CJK unified / extension A) character. */
fun isHanChar(ch: String): Boolean =
    Regex("^[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]$").matches(ch)

private val INSPECT_KANA_RE = Regex("[\\u3040-\\u309F\\u30A0-\\u30FF]")
private val HAN_RUN_RE = Regex("[\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]")

/**
 * True when the reading guess is uncertain: the text holds Han but no
 * kana, so kanji and hanzi are indistinguishable and the overlay
 * offers a small JP/中文 toggle to flip a wrong prediction.
 */
fun isHanOverlayLangUncertain(text: String): Boolean =
    HAN_RUN_RE.containsMatchIn(text) && !INSPECT_KANA_RE.containsMatchIn(text)

/** True when the trimmed text is exactly one Han character. */
fun isSingleHanChar(text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.codePointCount(0, trimmed.length) != 1) return false
    return isHanChar(trimmed)
}

/**
 * Whether the Inspect button may appear for a highlight: the feature
 * toggle is on AND the highlight is a single Han character.
 */
fun shouldShowInspect(quote: String, enabled: Boolean): Boolean {
    if (!enabled) return false
    return isSingleHanChar(quote)
}

/**
 * Inspect's predicted reading locale for one highlighted character:
 * kana in the picked-from paragraph means Japanese, else Chinese.
 * Empty context falls back to the quote alone (always Chinese for a
 * lone Han char, with the overlay toggle left to correct it).
 */
fun inspectLangFor(quote: String, context: String): String {
    val text = if (context.trim().isEmpty()) quote else context
    return hanOverlayLangFor(text)
}

/** Lowercased comma-joined readings ("ICHI ITSU" → "ichi,itsu"). */
private fun joinReadings(raw: String?): String {
    if (raw.isNullOrEmpty()) return ""
    return raw.split(Regex("\\s+")).filter { it.isNotEmpty() }
        .joinToString(",") { it.lowercase() }
}

/**
 * One-line on/kun row ("On/Kun: ichi,itsu | hitor..."), or null when
 * the subset holds neither.
 */
fun onKunLine(japaneseOn: String?, japaneseKun: String?): String? {
    val parts = listOf(joinReadings(japaneseOn), joinReadings(japaneseKun))
        .filter { it.isNotEmpty() }
    if (parts.isEmpty()) return null
    return "On/Kun: ${parts.joinToString(" | ")}"
}

/** Clamp the manual stroke stepper to 1..total (never wraps, never autoplays). */
fun clampStrokeStep(step: Int, total: Int): Int = step.coerceIn(1, maxOf(total, 1))
