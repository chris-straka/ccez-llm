package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

private const val FIXTURE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109">
<g id="kvg:StrokePaths_04e00">
<path id="kvg:04e00-s1" d="M10,50 L99,50"/>
<path d="M50,10 L50,99" id="kvg:04e00-s2"/>
</g></svg>"""

class KanjiVgTest {
    @Test fun `urls use five-digit lowercase hex`() {
        assertEquals(
            "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/04e00.svg",
            kanjiSvgUrl("一"),
        )
        assertEquals(
            "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/09f8d.svg",
            kanjiSvgUrl("龍"),
        )
    }

    @Test fun `stroke paths extract in sN order either attribute order`() {
        assertEquals(
            listOf("M10,50 L99,50", "M50,10 L50,99"),
            extractStrokePaths(FIXTURE_SVG),
        )
    }

    @Test fun `unparseable svgs yield null`() {
        assertNull(extractStrokePaths("<svg></svg>"))
        assertNull(extractStrokePaths("not xml"))
        assertNull(extractStrokePaths(""))
    }

    @Test fun `cache holds hits and misses without refetching`() {
        var calls = 0
        val cache = StrokeCache { url ->
            calls++
            if (url.endsWith("/04e00.svg")) FIXTURE_SVG else null
        }
        assertEquals(2, cache.pathsFor("一")?.size)
        assertEquals(2, cache.pathsFor("一")?.size)
        assertNull(cache.pathsFor("龘"))
        assertNull(cache.pathsFor("龘"))
        assertEquals(2, calls)
        cache.clear()
        assertEquals(2, cache.pathsFor("一")?.size)
        assertEquals(3, calls)
    }

    @Test fun `transport failures resolve null`() {
        val cache = StrokeCache { throw RuntimeException("offline") }
        assertNull(cache.pathsFor("一"))
    }
}
