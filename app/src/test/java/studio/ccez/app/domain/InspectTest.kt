package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

private const val MINI_UNIHAN = """{
"一":{"d":"one; a, an; alone","m":"yī","on":"ICHI ITSU","kun":"HITOTSU","t":"1","rs":"1.0"},
"丁":{"d":"male adult","m":"dīng","on":"TEI","kun":"HINOTO","t":"2","rs":"1.1"},
"通":{"d":"go through","m":"tōng","on":"TSUU","kun":"TOORU","t":"10","rs":"162.7"},
"亜":{"d":"Asia","m":"yà","on":"A","kun":"","t":"7","rs":"7.5"}
}"""
private const val MINI_DECOMP = """{"一":["㇐"],"通":["辶","甬"],"甬":["用"],"丁":["㇐","㇚"]}"""

class InspectTest {
    private val tables = InspectTables.load(MINI_UNIHAN, MINI_DECOMP)

    @Test fun `lookup returns components, count, radical, gloss, readings`() {
        val data = tables.getInspectData("一")
        assertEquals("一", data.char)
        assertEquals(listOf("㇐"), data.components)
        assertEquals(1, data.strokeCount)
        assertEquals("一", data.radical)
        assertEquals(0, data.radicalRest)
        assertEquals("one; a, an; alone", data.definition)
        assertEquals("yī", data.mandarin)
        assertEquals("ICHI ITSU", data.japaneseOn)
        assertEquals("HITOTSU", data.japaneseKun)
    }

    @Test fun `dictionary-form radical renders the learner shape`() {
        val data = tables.getInspectData("通")
        assertEquals("辶", data.radical)
        assertEquals(7, data.radicalRest)
        assertEquals(10, data.strokeCount)
        assertEquals(listOf("辶", "甬"), data.components)
    }

    @Test fun `missing entries read honestly null`() {
        val data = tables.getInspectData("龘")
        assertEquals("龘", data.char)
        assertTrue(data.components.isEmpty())
        assertNull(data.strokeCount)
        assertNull(data.radical)
        assertNull(data.definition)
    }

    @Test fun `trees terminate on cycles and singletons`() {
        val tree = tables.decomposeTree("通")
        assertEquals("通", tree.char)
        assertEquals(2, tree.children.size)
        assertEquals("甬", tree.children[1].char)
        // Single-component splits stop as leaves.
        assertTrue(tree.children[1].children.isEmpty())
        // Single-component splits stop as leaves.
        assertTrue(tables.decomposeTree("一").children.isEmpty())
        assertTrue(tables.decomposeTree("龘").children.isEmpty())
    }

    @Test fun `decompose text dedupes and skips non-han`() {
        val out = tables.decomposeText("通a通一")
        assertEquals(listOf("通", "一"), out.map { it.char })
        assertEquals(listOf("辶", "甬"), out[0].components)
    }

    @Test fun `kangxi parses dotted values only`() {
        assertEquals(KangxiParse("一", 0), parseKangxi("1.0"))
        assertEquals(KangxiParse("辶", 7), parseKangxi("162.7"))
        assertNull(parseKangxi(null))
        assertNull(parseKangxi("149"))
        assertNull(parseKangxi("0.5"))
        assertNull(parseKangxi("215.0"))
    }

    @Test fun `single han chars gate the inspect button`() {
        assertTrue(isSingleHanChar("一"))
        assertFalse(isSingleHanChar("一二"))
        assertFalse(isSingleHanChar("あ"))
        assertFalse(isSingleHanChar("a"))
        assertFalse(isSingleHanChar("  "))
        assertTrue(shouldShowInspect("一", true))
        assertFalse(shouldShowInspect("一二", true))
        assertFalse(shouldShowInspect("一", false))
    }

    @Test fun `inspect locale reads the picked-from paragraph`() {
        assertEquals("ja", inspectLangFor("日", "今日は日本語です"))
        assertEquals("zh", inspectLangFor("日", "这是中文"))
        assertEquals("zh", inspectLangFor("日", ""))
    }

    @Test fun `on-kun lines join lowercase readings`() {
        assertEquals("On/Kun: ichi,itsu | hitotsu", onKunLine("ICHI ITSU", "HITOTSU"))
        assertEquals("On/Kun: tei", onKunLine("TEI", ""))
        assertNull(onKunLine("", ""))
        assertNull(onKunLine(null, null))
    }

    @Test fun `stroke steps clamp without wrapping`() {
        assertEquals(1, clampStrokeStep(0, 10))
        assertEquals(10, clampStrokeStep(99, 10))
        assertEquals(3, clampStrokeStep(3, 10))
        assertEquals(1, clampStrokeStep(5, 0))
    }
}
