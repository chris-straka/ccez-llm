package studio.ccez.app

import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * The Muse key from ccez-keys, the owner's one holder of it (ccez-keys
 * docs/keyring.md). Asked each time it's needed (a call into the
 * keyboard, a few ms), held only in memory, so a new key there is the
 * key here at once. Copied from ccez-tube (data/Keyring.kt).
 */
object Keyring {
    private val uri = Uri.parse("content://uk.ccez.keys.keyring")

    sealed interface Answer {
        data class Key(val key: String, val version: Int) : Answer
        /** Allowed yet? The owner says, on ccez-keys' screen ([approve]). */
        data object Approve : Answer
        /** "none" (no key there for it), "denied", "locked" (before first unlock), "missing" (no ccez-keys). */
        data class No(val why: String) : Answer
    }

    /** Off the main thread. */
    fun key(ctx: Context, provider: String = "muse"): Answer = try {
        val b = ctx.contentResolver.call(uri, "key", provider, null)
        when (val s = b?.getString("status")) {
            "ok" -> b.getString("key")?.let { Answer.Key(it, b.getInt("version")) } ?: Answer.No("none")
            "approve" -> Answer.Approve
            else -> Answer.No(s ?: "missing")
        }
    } catch (_: IllegalArgumentException) {
        Answer.No("missing") // no such provider: ccez-keys isn't installed (or is too old)
    } catch (_: SecurityException) {
        Answer.No("denied")
    } catch (_: Exception) {
        Answer.No("missing")
    }

    /** ccez-keys' yes/no screen, started for a result (it reads who asked from that). */
    fun approve(): Intent = Intent().setClassName("uk.ccez.keys", "uk.ccez.keys.keyring.Approve")
}
