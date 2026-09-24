package studio.ccez.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground-service claim for native turns (`turn_service.rs`).
 *
 * While at least one turn is live, the app runs a `dataSync`
 * foreground service — the quietest notice Android allows (MIN
 * importance: no status-bar icon, no buzz, shade-only) — so a
 * backgrounded app is far less likely to be killed before the reply
 * lands. When the last turn settles, Rust calls [keeperStop] and
 * the service stops itself.
 *
 * Everything service-side runs on the main thread and returns at
 * once; Rust never passes contexts through JNI ([init] runs from
 * `MainActivity.onCreate`, same pattern as the Tts/Secrets bridges).
 * A service failure never fails a turn: the runner already survives
 * WebView suspension on process life alone.
 */
private const val TAG = "CcezTurns"
object TurnSvc {
    private lateinit var appContext: Context

    private external fun nativeInit(activity: Activity)

    private var retiredOldChannel = false

    fun init(activity: Activity) {
        appContext = activity.applicationContext
        nativeInit(activity)
        // Retire the old loud channel: it is never referenced by a
        // foreground service (the notice moved to QUIET_CHANNEL_ID),
        // so deleting it here is allowed — and any refusal throws
        // only inside this try, never into callers. Runs at every
        // launch from MainActivity, long before any turn can claim
        // the service.
        if (!retiredOldChannel) {
            retiredOldChannel = true
            try {
                val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    // Literal, not the companion const: that id belongs
                    // to TurnService's scope, not this object's.
                    manager.deleteNotificationChannel("ccez-turns")
                }
            } catch (_: Exception) {
            }
        }
    }

    /** First live turn: start (or reaffirm) the foreground service. */
    @JvmStatic
    fun keeperStart() {
        try {
            val context = appContext
            val intent = Intent(context, TurnService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            android.util.Log.d(TAG, "keeperStart: service intent sent")
        } catch (e: Exception) {
            // A failed claim must never fail the turn, but it must be
            // visible: without the service there is no shade notice and
            // no background protection.
            android.util.Log.e(TAG, "keeperStart failed: ${e.message}")
        }
    }

    /** Last settled turn: stop the service if it is up. */
    @JvmStatic
    fun keeperStop() {
        try {
            val context = appContext
            val stopped = context.stopService(Intent(context, TurnService::class.java))
            android.util.Log.d(TAG, "keeperStop: stopService returned $stopped")
        } catch (e: Exception) {
            android.util.Log.e(TAG, "keeperStop failed: ${e.message}")
        }
    }
}

/**
 * The service itself: stateless, exists only to hold the foreground
 * claim while turns run. Not sticky — if the system does kill us, a
 * restart would serve nothing: the turn files say streaming, and the
 * page auto-resumes those with dots on return.
 */
class TurnService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        android.util.Log.d(TAG, "TurnService.onCreate")
        postNotice("create")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Reaffirm the foreground state on every start (a second turn
        // starting while one runs re-sends the intent).
        android.util.Log.d(TAG, "TurnService.onStartCommand startId=$startId")
        postNotice("start")
        return START_NOT_STICKY
    }

    /** Build-and-post with its own log line: a silent failure here is
    the missing-notice bug, so the outcome is always recorded. */
    private fun postNotice(phase: String) {
        try {
            val notification = buildNotification()
            startForegroundTyped(notification)
            android.util.Log.d(TAG, "notice posted ($phase)")
        } catch (e: Exception) {
            android.util.Log.e(TAG, "notice post failed ($phase): ${e.message}")
        }
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // A fresh id: importance freezes at creation, so the old
            // (louder) channel can never become quiet — it retires in
            // TurnSvc.init instead. Deleting here would crash: this
            // channel backs a live foreground service.
            val channel = NotificationChannel(
                QUIET_CHANNEL_ID,
                "Replies",
                NotificationManager.IMPORTANCE_MIN
            )
            manager.createNotificationChannel(channel)
        }
        val builder = NotificationCompat.Builder(this, QUIET_CHANNEL_ID)
            .setContentTitle("Reply coming…")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setShowWhen(false)
        return builder.build()
    }

    private fun startForegroundTyped(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            super.startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            super.startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val CHANNEL_ID = "ccez-turns"
        private const val QUIET_CHANNEL_ID = "ccez-turns-quiet"
        private const val NOTIFICATION_ID = 41
    }
}
