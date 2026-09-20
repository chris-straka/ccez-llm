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
 * foreground service — a persistent "working" notification, as
 * Android requires — so a backgrounded app is far less likely to be
 * killed before the reply lands. When the last turn settles, Rust
 * calls [keeperStop] and the service stops itself.
 *
 * Everything service-side runs on the main thread and returns at
 * once; Rust never passes contexts through JNI ([init] runs from
 * `MainActivity.onCreate`, same pattern as the Tts/Secrets bridges).
 * A service failure never fails a turn: the runner already survives
 * WebView suspension on process life alone.
 */
object TurnSvc {
    private lateinit var appContext: Context

    private external fun nativeInit(activity: Activity)

    fun init(activity: Activity) {
        appContext = activity.applicationContext
        nativeInit(activity)
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
        } catch (_: Exception) {
        }
    }

    /** Last settled turn: stop the service if it is up. */
    @JvmStatic
    fun keeperStop() {
        try {
            val context = appContext
            context.stopService(Intent(context, TurnService::class.java))
        } catch (_: Exception) {
        }
    }
}

/**
 * The service itself: stateless, exists only to hold the foreground
 * claim while turns run. Not sticky — if the system does kill us, a
 * restart would serve nothing (the turn files already say
 * interrupted), so there is nothing to resume.
 */
class TurnService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundTyped(buildNotification())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Reaffirm the foreground state on every start (a second turn
        // starting while one runs re-sends the intent).
        startForegroundTyped(buildNotification())
        return START_NOT_STICKY
    }

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Replies",
                NotificationManager.IMPORTANCE_LOW
            )
            manager.createNotificationChannel(channel)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Working on your reply")
            .setContentText("It will be ready when you return.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
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
        private const val NOTIFICATION_ID = 41
    }
}
