package studio.ccez.app.device

import android.icu.text.Transliterator
import studio.ccez.app.domain.PinyinReader

/**
 * Pinyin via the platform ICU Transliterator (no downloads, no keys).
 * Per-character lookup keeps readings aligned 1:1; an in-memory cache
 * keeps long messages cheap. Verified on-device: Han-Latin emits
 * tone-marked syllables (中 → zhōng) and passes non-Han through.
 */
class IcuPinyinReader : PinyinReader {
    private val lock = Any()
    @Volatile private var transliterator: Transliterator? = null
    private val cache = mutableMapOf<Char, String?>()

    private fun transliterator(): Transliterator? {
        transliterator?.let { return it }
        return synchronized(lock) {
            transliterator ?: runCatching { Transliterator.getInstance("Han-Latin") }.getOrNull()
                .also { transliterator = it }
        }
    }

    override fun reading(char: Char): String? {
        synchronized(cache) { if (cache.containsKey(char)) return cache[char] }
        val t = transliterator()
        val out = if (t == null) null else runCatching {
            t.transliterate(char.toString()).trim().takeIf { it.isNotEmpty() && it != char.toString() }
        }.getOrNull()
        synchronized(cache) {
            if (cache.size > 2000) cache.clear()
            cache[char] = out
        }
        return out
    }
}
