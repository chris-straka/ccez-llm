package studio.ccez.app.device

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

/**
 * Live ML Kit Latin OCR against rendered text. Needs the on-device
 * model (Play services downloads it on first use, then it stays
 * cached); asserts loosely since OCR misreads glyphs (O→0).
 */
@RunWith(AndroidJUnit4::class)
class OcrDeviceTest {
    @Test fun ocr_reads_rendered_text() {
        val bitmap = Bitmap.createBitmap(600, 200, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        canvas.drawText(
            "Hello OCR 123", 40f, 120f,
            Paint().apply { color = Color.BLACK; textSize = 64f; isAntiAlias = true },
        )
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        val text = runBlocking {
            MlKitOcrReader(ApplicationProvider.getApplicationContext()).recognize(out.toByteArray())
        }
        assertTrue("expected greeting in [$text]", text.contains("Hello"))
    }
}
