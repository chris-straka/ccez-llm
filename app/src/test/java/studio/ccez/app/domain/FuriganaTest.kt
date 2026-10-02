package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class FuriganaTest {
    private val engine = FuriganaEngine()

    @Test fun `kanji get hiragana readings`() {
        val segs = engine.segments("日本語")
        assertTrue(segs.any { it.reading != null })
        val first = segs.first { it.surface == "日本語" || it.surface == "日本" }
        assertNotNull(first.reading)
        assertFalse(first.reading!!.any { it in 'ァ'..'ヶ' })
    }

    @Test fun `kana passes through unannotated`() {
        val segs = engine.segments("あいうえお")
        assertTrue(segs.all { it.reading == null })
    }

    @Test fun `line ownership gates conversion`() {
        assertEquals(listOf(AidSegment("纯中文", null)), furiganaLine(engine, "纯中文"))
        assertEquals(listOf(AidSegment("纯中文", null)), furiganaLine(engine, "纯中文", LocalAid.PINYIN))
        assertTrue(furiganaLine(engine, "日本語テスト", LocalAid.PINYIN).any { it.reading != null })
        assertTrue(furiganaLine(engine, "plain").single().reading == null)
    }

    @Test fun `conversions are cached`() {
        val a = engine.segments("東京")
        val b = engine.segments("東京")
        assertSame(a, b)
    }

    @Test fun `mixed token splits into han runs plus plain okurigana`() {
        val runs = annotatedRuns(
            listOf(AidSegment("食べる", "たべる"), AidSegment("春", "はる")),
        )
        assertEquals(
            listOf(AnnotatedRun("食", "たべる"), AnnotatedRun("べる"), AnnotatedRun("春", "はる")),
            runs,
        )
    }

    @Test fun `kana-only selections show no popup`() {
        assertNull(annotatedRuns(listOf(AidSegment("あいう", null), AidSegment("テスト", null))))
    }

    @Test fun `unread segments pass through`() {
        assertNull(annotatedRuns(listOf(AidSegment("日本語", null))))
    }
}
