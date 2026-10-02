package studio.ccez.app.device

import android.content.Context
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resumeWithException

/**
 * On-device Latin OCR via ML Kit (replaces ocr.rs on Android). The
 * recognition model downloads on first use through Play services, so
 * the first call may take a while or fail offline — callers surface
 * that honestly instead of blocking the attach flow.
 */
class MlKitOcrReader(private val context: Context) : OcrReader {
    override suspend fun recognize(imageBytes: ByteArray): String =
        suspendCancellableCoroutine { cont ->
            val client = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            val image = runCatching {
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                    ?: throw IllegalArgumentException("Could not decode image bytes")
                InputImage.fromBitmap(bitmap, 0)
            }.getOrElse {
                if (cont.isActive) cont.resumeWithException(it)
                return@suspendCancellableCoroutine
            }
            val task = client.process(image)
            task.addOnSuccessListener { visionText ->
                client.close()
                if (cont.isActive) cont.resumeWith(Result.success(visionText.text))
            }
            task.addOnFailureListener { e ->
                client.close()
                if (cont.isActive) cont.resumeWithException(e)
            }
            cont.invokeOnCancellation { runCatching { client.close() } }
        }
}
