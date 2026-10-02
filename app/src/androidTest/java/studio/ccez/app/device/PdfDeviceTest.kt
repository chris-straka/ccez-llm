package studio.ccez.app.device

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

/**
 * PDF round-trip on-device (pdfbox-android needs Android statics, so
 * this cannot run on the JVM): generate a page, extract it back.
 */
@RunWith(AndroidJUnit4::class)
class PdfDeviceTest {
    @Test fun pdfbox_round_trips_generated_page() {
        PdfText.init(ApplicationProvider.getApplicationContext())
        val doc = PDDocument()
        try {
            val page = PDPage()
            doc.addPage(page)
            PDPageContentStream(doc, page).use { stream ->
                stream.beginText()
                stream.setFont(PDType1Font.HELVETICA, 12f)
                stream.newLineAtOffset(50f, 700f)
                stream.showText("Hello PDF world")
                stream.endText()
            }
            val out = ByteArrayOutputStream()
            doc.save(out)
            assertTrue(PdfText.extract(out.toByteArray()).contains("Hello PDF world"))
        } finally {
            doc.close()
        }
    }
}
