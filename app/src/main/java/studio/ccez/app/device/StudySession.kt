package studio.ccez.app.device

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Study-session haptics (studyMedia.ts slice): a short tick on send.
 * Silent on devices without a vibrator; never throws into UI.
 */
fun vibrateTick(context: Context, millis: Long = 20L) {
    vibratePattern(context, longArrayOf(0, millis))
}

/**
 * Delete thump (studyMedia "done" beat parity): unmistakable against
 * the single ticks of opens and folds. Every delete path shares it.
 */
fun vibrateDone(context: Context) {
    vibratePattern(context, longArrayOf(0, 110, 60, 110, 60, 110))
}

/**
 * Denial buzz (studyMedia "no" beat parity): refused actions buzz an
 * error instead of ticking success.
 */
fun vibrateDenial(context: Context) {
    vibratePattern(context, longArrayOf(0, 50, 70, 50))
}

private fun vibratePattern(context: Context, pattern: LongArray) {
    runCatching {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        } ?: return
        if (!vibrator.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }
}
