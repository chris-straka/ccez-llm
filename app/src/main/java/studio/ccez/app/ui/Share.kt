package studio.ccez.app.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent

/** Share chat Markdown through the system sheet; false when nothing handles it. */
fun shareMarkdown(context: Context, filename: String, text: String): Boolean {
    return try {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, filename)
            putExtra(Intent.EXTRA_TEXT, text)
        }
        context.startActivity(
            Intent.createChooser(send, "Share chat").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    } catch (_: Exception) {
        false
    }
}

/** Clipboard fallback for runtimes where a share target goes nowhere. */
fun copyMarkdown(context: Context, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
    clipboard.setPrimaryClip(ClipData.newPlainText("chat-export", text))
}
