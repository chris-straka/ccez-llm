package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

// NOTE: pdfbox-android carries Android statics, so the PDF round-trip
// lives in androidTest (PdfDeviceTest), not here.
class ExtractTest {
    @Test fun `docx round-trips paragraphs`() {
        val bytes = makeTestDocx(listOf("Hello", "World & <friends>"))
        assertEquals("Hello\nWorld & <friends>", extractDocxText(bytes))
    }

    @Test fun `docx rejects non-docx zips`() {
        try {
            extractDocxText("not a zip".toByteArray())
            fail("expected throw")
        } catch (e: Exception) {
            assertTrue(e is IllegalArgumentException || e is java.util.zip.ZipException)
        }
    }

}
