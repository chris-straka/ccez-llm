package studio.ccez.app.domain

/**
 * KanjiVG stroke vector paths, fetched on demand per character.
 *
 * The KanjiVG project publishes one SVG per character at
 * `kanji/{5-digit-lowercase-hex-codepoint}.svg` (e.g. 04e00.svg for
 * 一). Each file's stroke paths carry ids ending `-sN` (1-based stroke
 * order). Nothing is bundled: a small in-memory cache holds what the
 * Inspect overlay asked for, and misses fall back to the schematic
 * stepper. CC BY-SA 3.0 (KanjiVG) — attribution lives in the overlay.
 */

/** KanjiVG file URL for one character (5-digit lowercase hex codepoint). */
fun kanjiSvgUrl(ch: String): String {
    val code = ch.codePointAt(0).toString(16).padStart(5, '0')
    return "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/$code.svg"
}

private val STROKE_PATH_RE = Regex(
    """<path[^>]*\bid="[^"]*-s(\d+)"[^>]*\bd="([^"]+)"|<path[^>]*\bd="([^"]+)"[^>]*\bid="[^"]*-s(\d+)"""",
)

/**
 * Stroke path data in `-sN` order, or null when the file is missing or
 * unparseable. Pure over the SVG text, so tests run fixture-only.
 */
fun extractStrokePaths(svg: String): List<String>? {
    val paths = mutableListOf<Pair<Int, String>>()
    for (m in STROKE_PATH_RE.findAll(svg)) {
        val n = (m.groups[1]?.value ?: m.groups[4]?.value)?.toIntOrNull()
        val d = m.groups[2]?.value ?: m.groups[3]?.value ?: ""
        if (n != null && d.isNotEmpty()) paths.add(n to d)
    }
    if (paths.isEmpty()) return null
    return paths.sortedBy { it.first }.map { it.second }
}

/**
 * Fetch (cached) stroke paths for one character. Never throws: misses
 * resolve null and the overlay keeps its schematic preview. Transport
 * is injected (`fetch` returns the SVG text or null).
 */
class StrokeCache(private val fetch: (String) -> String?) {
    private val cache = mutableMapOf<String, List<String>?>()

    @Synchronized
    fun pathsFor(ch: String): List<String>? {
        if (cache.containsKey(ch)) return cache[ch]
        val paths = try {
            fetch(kanjiSvgUrl(ch))?.let { extractStrokePaths(it) }
        } catch (_: Exception) {
            null
        }
        cache[ch] = paths
        return paths
    }

    @Synchronized
    fun clear() {
        cache.clear()
    }
}
