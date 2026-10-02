package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

private class FakePinyin(private val map: Map<Char, String>) : PinyinReader {
    override fun reading(char: Char): String? = map[char]
}

class PinyinTest {
    private val reader = FakePinyin(mapOf('中' to "zhōng", '文' to "wén", '读' to "dú"))

    @Test fun `hanzi annotate, rest passes through`() {
        val segs = pinyinSegments("中文hi！", reader)
        assertEquals(
            listOf(
                AidSegment("中", "zhōng"),
                AidSegment("文", "wén"),
                AidSegment("h", null),
                AidSegment("i", null),
                AidSegment("！", null),
            ),
            segs,
        )
    }

    @Test fun `unknown hanzi stays bare`() {
        assertEquals(listOf(AidSegment("龍", null)), pinyinSegments("龍", reader))
    }

    @Test fun `kana anywhere disables pinyin`() {
        // pinyin-pro happily returns Chinese for Japanese kanji — never annotate those.
        val segs = pinyinSegments("読む", reader)
        assertEquals(1, segs.size)
        assertNull(segs.single().reading)
        assertTrue(pinyinSegments("", reader).isEmpty())
    }

    @Test fun `line gate mirrors classifier`() {
        assertEquals(listOf(AidSegment("纯中文x", null)), pinyinLine("纯中文x", reader, LocalAid.FURIGANA))
        assertEquals(3, pinyinLine("中文！", reader).size)
        assertEquals(listOf(AidSegment("hello", null)), pinyinLine("hello", reader))
    }

    @Test fun `han detection`() {
        assertTrue(isHanChar('中'))
        assertFalse(isHanChar('あ'))
        assertFalse(isHanChar('a'))
        assertTrue(containsKana("かな"))
        assertFalse(containsKana("中文"))
    }
}
