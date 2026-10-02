package studio.ccez.app.device

import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import android.content.Context
import java.io.ByteArrayInputStream

/**
 * PDF text extraction via pdfbox-android (attachExtract.ts parity).
 * Call [init] once (it loads the bundled glyph assets); extraction
 * is CPU-bound, so callers stay on Dispatchers.IO.
 */
object PdfText {
    @Volatile private var ready = false

    fun init(context: Context) {
        if (ready) return
        synchronized(this) {
            if (!ready) {
                PDFBoxResourceLoader.init(context.applicationContext)
                ready = true
            }
        }
    }

    fun extract(pdfBytes: ByteArray): String = extractDocument(pdfBytes)

    /** Pure pdfbox path (init-independent): unit tests exercise this directly. */
    internal fun extractDocument(pdfBytes: ByteArray): String {
        val doc = PDDocument.load(ByteArrayInputStream(pdfBytes))
        try {
            return PDFTextStripper().getText(doc)?.trim().orEmpty()
        } finally {
            doc.close()
        }
    }
}
