package studio.ccez.app.device

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import studio.ccez.app.domain.IMAGE_MAX_DIM
import studio.ccez.app.domain.fitDimensions
import studio.ccez.app.domain.inSampleSizeFor
import java.io.ByteArrayOutputStream

data class DownscaledImage(
    val jpeg: ByteArray,
    val width: Int,
    val height: Int,
    val dataUrl: String,
)

/** Display name for a picked document (falls back to the last path segment). */
fun displayName(context: Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
            c.getString(0)?.takeIf { it.isNotBlank() }?.let { return it }
        }
    }
    return uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "attachment"
}

/**
 * Downscale an image to a JPEG data URL (quality 0.85, max side
 * IMAGE_MAX_DIM), mirroring the Tauri canvas path. Throws honestly
 * when the image can't be decoded.
 */
fun downscaleImage(context: Context, uri: Uri, maxDim: Int = IMAGE_MAX_DIM): DownscaledImage {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val srcW = bounds.outWidth
    val srcH = bounds.outHeight
    require(srcW > 0 && srcH > 0) { "Could not decode image" }
    val opts = BitmapFactory.Options().apply { inSampleSize = inSampleSizeFor(srcW, srcH, maxDim) }
    val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        ?: throw IllegalArgumentException("Could not decode image")
    val (targetW, targetH) = fitDimensions(decoded.width, decoded.height)
    val scaled = Bitmap.createScaledBitmap(decoded, targetW, targetH, true)
    if (scaled !== decoded) decoded.recycle()
    val out = ByteArrayOutputStream()
    try {
        require(scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)) { "JPEG encode failed" }
        val jpeg = out.toByteArray()
        return DownscaledImage(
            jpeg = jpeg,
            width = targetW,
            height = targetH,
            dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(jpeg, Base64.NO_WRAP),
        )
    } finally {
        scaled.recycle()
    }
}

/** Read a text document, capped upstream by the caller (see MAX_FILE_CHARS). */
fun readTextDocument(context: Context, uri: Uri, maxChars: Int): String? {
    return runCatching {
        context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
            val buf = CharArray(maxChars + 1)
            val read = reader.read(buf)
            if (read < 0) "" else String(buf, 0, minOf(read, maxChars))
        }
    }.getOrNull()
}

/** Raw bytes for container formats (docx/PDF), capped so one file can't OOM the app. */
fun readBytesCapped(context: Context, uri: Uri, maxBytes: Int = 20 * 1024 * 1024): ByteArray? {
    return runCatching {
        context.contentResolver.openInputStream(uri)?.use { input ->
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            var total = 0
            while (true) {
                val read = input.read(buf)
                if (read < 0) break
                total += read
                if (total > maxBytes) throw IllegalArgumentException("File too large")
                out.write(buf, 0, read)
            }
            out.toByteArray()
        }
    }.getOrNull()
}
