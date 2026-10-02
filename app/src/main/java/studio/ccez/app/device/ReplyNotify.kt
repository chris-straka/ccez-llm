package studio.ccez.app.device

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import studio.ccez.app.MainActivity

/**
 * Reply-ready ping (studyMedia.ts reply-notification slice): when a
 * reply finishes while the app is backgrounded, a permission-gated
 * notification carries its head. Silent when foregrounded, silent for
 * failures and empty bodies. Never throws into callers.
 */

/** Fixed id so a fresh ping replaces the stale one instead of stacking. */
const val REPLY_NOTIFICATION_ID = 4201

/** The shade dismisses the ping on its own — pings never clutter. */
const val REPLY_NOTIFICATION_TIMEOUT_MS = 30_000L

const val REPLY_NOTIFICATION_CHANNEL = "replies"

/** Single-line head of a finished reply, truncated with an ellipsis. */
fun replyPreview(text: String, maxChars: Int = 160): String {
    val flat = text.replace(Regex("\\s+"), " ").trim()
    if (flat.length <= maxChars) return flat
    return flat.take(maxChars - 1).trimEnd() + "…"
}

/**
 * Whether a finished reply earns a ping: the setting is on and the
 * app is backgrounded. Pure and unit-tested.
 */
fun shouldNotifyReply(notificationsOn: Boolean, appForeground: Boolean): Boolean =
    notificationsOn && !appForeground

/** Process foreground flag, flipped by MainActivity's start/stop. */
object AppForeground {
    @Volatile var isForeground: Boolean = true
        private set

    fun enter() {
        isForeground = true
    }

    fun exit() {
        isForeground = false
    }
}

/** Reply-ping contract; the no-op keeps unit tests hermetic. */
interface ReplyNotifier {
    fun notifyReply(title: String, preview: String)
    fun cancelReply()
}

class NoopReplyNotifier : ReplyNotifier {
    override fun notifyReply(title: String, preview: String) { /* no-op */ }
    override fun cancelReply() { /* no-op */ }
}

class AndroidReplyNotifier(private val appContext: Context) : ReplyNotifier {
    override fun notifyReply(title: String, preview: String) {
        runCatching {
            if (preview.isBlank()) return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ActivityCompat.checkSelfPermission(
                    appContext,
                    Manifest.permission.POST_NOTIFICATIONS,
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                return
            }
            val manager = appContext.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        REPLY_NOTIFICATION_CHANNEL,
                        "Replies",
                        NotificationManager.IMPORTANCE_DEFAULT,
                    ),
                )
            }
            val open = PendingIntent.getActivity(
                appContext,
                0,
                Intent(appContext, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val ping = NotificationCompat.Builder(appContext, REPLY_NOTIFICATION_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle(title)
                .setContentText(preview)
                .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setTimeoutAfter(REPLY_NOTIFICATION_TIMEOUT_MS)
                .build()
            manager.notify(REPLY_NOTIFICATION_ID, ping)
        }
    }

    override fun cancelReply() {
        runCatching {
            appContext.getSystemService(NotificationManager::class.java)
                ?.cancel(REPLY_NOTIFICATION_ID)
        }
    }
}
