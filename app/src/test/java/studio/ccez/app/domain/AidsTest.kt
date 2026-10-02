package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class AidsTest {
    @Test fun `detect scripts in priority order`() {
        assertEquals(listOf(AidScript.ZH), detectScripts("中文测试"))
        assertEquals(listOf(AidScript.JA), detectScripts("日本語テスト"))
        assertEquals(listOf(AidScript.AR), detectScripts("مرحبا بالعالم"))
        assertEquals(listOf(AidScript.AR, AidScript.JA), detectScripts("مرحبا、日本語テスト"))
        assertTrue(detectScripts("plain english").isEmpty())
        // Kana wins over Han: Japanese kanji are not Chinese.
        assertEquals(listOf(AidScript.JA), detectScripts("読む"))
    }

    @Test fun `code never summons aids`() {
        // Callers detect over stripCodeForDetection (Tauri button contract):
        // raw Han inside code still classifies, stripped text detects nothing.
        assertEquals(listOf(AidScript.ZH), detectScripts("```\n中文\n```"))
        assertTrue(detectScripts(stripCodeForDetection("```\n中文\n```")).isEmpty())
        assertTrue(detectScripts(stripCodeForDetection("use `中文` here")).isEmpty())
        assertEquals("use  here", stripCodeForDetection("use `中文` here"))
    }

    @Test fun `classify lines with reply tiebreak`() {
        assertEquals(LocalAid.FURIGANA, classifyAidLine("かな mixed 漢字"))
        assertEquals(LocalAid.PINYIN, classifyAidLine("纯中文"))
        assertEquals(LocalAid.FURIGANA, classifyAidLine("纯中文", LocalAid.FURIGANA))
        assertNull(classifyAidLine("hello"))
        assertTrue(hasAmbiguousAidLine("纯中文\nhello"))
        assertFalse(hasAmbiguousAidLine("かな"))
    }

    @Test fun `reply pill owns kanji-only lines`() {
        assertEquals(LocalAid.FURIGANA, preferredLocalAid("ja"))
        assertEquals(LocalAid.PINYIN, preferredLocalAid("zh"))
        assertEquals(LocalAid.PINYIN, preferredLocalAid("yue"))
        assertNull(preferredLocalAid("fr"))
        assertNull(preferredLocalAid(null))
        assertEquals("ja", hanOverlayLangFor("読む"))
        assertEquals("zh", hanOverlayLangFor("读"))
    }

    @Test fun `tashkeel splice keeps other lines identical`() {
        val original = "hello\nمرحبا\nbye"
        val spliced = spliceAidResult(original, aidTargetLines(original), "مَرْحَبًا")
        assertEquals("hello\nمَرْحَبًا\nbye", spliced)
        assertNull(spliceAidResult(original, listOf(1), "one\ntwo"))
        assertEquals(listOf(1), aidTargetLines(original))
        val (role, instruction) = tashkeelMessages("x")[0]
        assertEquals("system", role)
        assertTrue(instruction.contains("one line per input line"))
    }

    @Test fun `katakana converts to hiragana`() {
        assertEquals("あいうえお", katakanaToHiragana("アイウエオ"))
        assertEquals("きょうと", katakanaToHiragana("キョウト"))
        assertEquals("が", katakanaToHiragana("ガ"))
        assertEquals("abc", katakanaToHiragana("abc"))
    }

    @Test fun `dual-aid segments own their lines`() {
        val pinyin = object : PinyinReader {
            override fun reading(char: Char): String? = if (char == '中') "zhōng" else null
        }
        val engine = FuriganaEngine()
        val both = aidSegmentsFor("中文\n日本語テスト\n```\n中文\n```\nplain", setOf(LocalAid.PINYIN, LocalAid.FURIGANA), null, pinyin, engine)
        // Pinyin line: per-char readings.
        assertEquals("zhōng", both[0].reading)
        // Furigana line carries readings; code + plain lines stay bare.
        assertTrue(both.dropWhile { it.surface != "\n" }.drop(1).takeWhile { it.surface != "\n" }.any { it.reading != null })
        // The fenced 中文 rides after its fence plus a newline separator.
        val codeSeg = both.dropWhile { it.surface != "```" }.drop(2).first()
        assertEquals("中文", codeSeg.surface)
        assertNull(codeSeg.reading)
        // Single aid pins only its own lines.
        val pinyinOnly = aidSegmentsFor("中文\nかな", setOf(LocalAid.PINYIN), null, pinyin, engine)
        assertEquals("zhōng", pinyinOnly[0].reading)
        assertNull(pinyinOnly.last().reading)
        // No pins: whole content, one segment.
        assertEquals(listOf(AidSegment("x\ny")), aidSegmentsFor("x\ny", emptySet(), null, pinyin, engine))
    }

    @Test fun `reading need follows han and difference`() {
        assertTrue(needsReading("漢", "カン"))
        assertFalse(needsReading("かな", "カナ"))
        assertFalse(needsReading("漢", null))
        assertFalse(needsReading("漢", "漢"))
    }
}
