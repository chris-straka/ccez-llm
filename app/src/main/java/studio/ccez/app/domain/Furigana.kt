package studio.ccez.app.domain

import com.atilika.kuromoji.ipadic.Tokenizer

/**
 * Japanese furigana via Kuromoji IPADIC — the native equivalent of the
 * Tauri lindera-wasm worker. The dictionary loads lazily on first use
 * (never at startup) and conversions are cached, so repeated renders
 * never re-tokenize. Tokenizer access is synchronized; call off the
 * main thread (the ViewModel converts in its scope).
 */
class FuriganaEngine {
    private val lock = Any()
    @Volatile private var tokenizer: Tokenizer? = null
    private val cache = mutableMapOf<String, List<AidSegment>>()

    private fun tokenizer(): Tokenizer {
        tokenizer?.let { return it }
        return synchronized(lock) {
            tokenizer ?: Tokenizer().also { tokenizer = it }
        }
    }

    fun segments(text: String): List<AidSegment> {
        synchronized(cache) { cache[text]?.let { return it } }
        val out = synchronized(lock) {
            tokenizer().tokenize(text).map { token ->
                val reading = token.reading?.let { katakanaToHiragana(it) }
                val surface = token.surface
                if (needsReading(surface, reading)) AidSegment(surface, reading)
                else AidSegment(surface, null)
            }
        }
        synchronized(cache) {
            if (cache.size > 500) cache.clear()
            cache[text] = out
        }
        return out
    }

    fun clear() {
        synchronized(cache) { cache.clear() }
    }
}

/**
 * Furigana for one line: kana lines read Japanese, Han-only lines defer
 * to the reply-language tiebreak (classifyAidLine parity). Lines owned
 * by another aid pass through as single unannotated segments.
 */
fun furiganaLine(engine: FuriganaEngine, line: String, preferred: LocalAid? = null): List<AidSegment> {
    if (classifyAidLine(line, preferred) != LocalAid.FURIGANA) return listOf(AidSegment(line, null))
    return engine.segments(line)
}

/**
 * One selection-popup run: a Han slice with its word-context reading,
 * or plain text (okurigana repeats uncolored).
 */
data class AnnotatedRun(val text: String, val reading: String? = null)

/**
 * Split converter segments into selection-popup runs (desktop
 * annotatedRuns parity): Han slices of a token carry that token's
 * reading, kana and unread segments pass through plain. Null when no
 * run carries a reading — kana-only selections show no popup.
 */
fun annotatedRuns(segments: List<AidSegment>): List<AnnotatedRun>? {
    val out = mutableListOf<AnnotatedRun>()
    var found = false
    fun plain(text: String) {
        if (text.isEmpty()) return
        val last = out.lastOrNull()
        if (last != null && last.reading == null) out[out.lastIndex] = last.copy(text = last.text + text)
        else out += AnnotatedRun(text, null)
    }
    for (seg in segments) {
        val reading = seg.reading
        if (reading.isNullOrEmpty()) {
            plain(seg.surface)
            continue
        }
        var i = 0
        while (i < seg.surface.length) {
            val han = isHanChar(seg.surface[i])
            var j = i + 1
            while (j < seg.surface.length && isHanChar(seg.surface[j]) == han) j++
            val slice = seg.surface.substring(i, j)
            if (han) {
                out += AnnotatedRun(slice, reading)
                found = true
            } else {
                plain(slice)
            }
            i = j
        }
    }
    return if (found) out else null
}
