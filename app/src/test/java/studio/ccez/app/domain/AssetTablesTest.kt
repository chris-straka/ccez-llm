package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.zip.GZIPInputStream

/**
 * The real shipped tables parse and answer (guards the TS→JSON→gzip
 * conversion; fixtures alone would not catch a corrupt asset).
 */
class AssetTablesTest {
    private fun asset(name: String): String {
        val file = File("src/main/assets/$name")
        assertTrue("missing asset: ${file.absolutePath}", file.exists())
        GZIPInputStream(file.inputStream()).use { return it.bufferedReader().readText() }
    }

    private val tables by lazy {
        InspectTables.load(asset("unihan.json.gz"), asset("cjkdecomp.json.gz"))
    }

    @Test fun `full tables load at Tauri scale`() {
        assertEquals(20992, tables.unihan.size)
        assertEquals(3078, tables.decomp.size)
    }

    @Test fun `real entries read end to end`() {
        val yi = tables.getInspectData("一")
        assertEquals(1, yi.strokeCount)
        assertEquals("一", yi.radical)
        assertEquals("yī", yi.mandarin)
        val tong = tables.getInspectData("通")
        assertEquals(listOf("辶", "甬"), tong.components)
        assertEquals("辶", tong.radical)
        assertEquals("On/Kun: tsuu,tsu,tou | tooru,kayou,toori", onKunLine(tong.japaneseOn, tong.japaneseKun))
        assertEquals(2, tables.decomposeTree("通").children.size)
    }
}
