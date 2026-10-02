package studio.ccez.app.device

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Biometric gate for API keys. Keys are already encrypted at rest
 * (Keystore AES/GCM); this adds a user-presence check before the
 * app reads them — once per process, then memory-cached until the
 * process dies. Devices without enrolled biometrics skip silently
 * (the Keystore layer still holds).
 */
enum class BioStatus { READY, NO_HARDWARE, NONE_ENROLLED, UNAVAILABLE }

fun biometricStatus(ctx: Context): BioStatus = when (
    BiometricManager.from(ctx).canAuthenticate(
        Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL,
    )
) {
    BiometricManager.BIOMETRIC_SUCCESS -> BioStatus.READY
    BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> BioStatus.NO_HARDWARE
    BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> BioStatus.NONE_ENROLLED
    else -> BioStatus.UNAVAILABLE
}

/** Pure gate decision: prompt only when required, possible, and not yet unlocked. */
fun needsKeyPrompt(requireBiometric: Boolean, status: BioStatus, unlocked: Boolean): Boolean =
    requireBiometric && status == BioStatus.READY && !unlocked

/**
 * Honest warning when the lock is on but the device cannot honor it:
 * keys stay readable with no presence check. Null when the setting is
 * off or the device can actually prompt.
 */
fun biometricGapWarning(requireBiometric: Boolean, status: BioStatus): String? {
    if (!requireBiometric || status == BioStatus.READY) return null
    return when (status) {
        BioStatus.NONE_ENROLLED ->
            "Biometric lock is on, but nothing is enrolled — keys open with no check. " +
                "Enroll a biometric or device credential to protect them."
        BioStatus.NO_HARDWARE, BioStatus.UNAVAILABLE ->
            "Biometric lock is on, but this device cannot prompt — keys open with no check."
        BioStatus.READY -> null
    }
}

/** One system biometric/device-credential prompt. False on cancel, failure, or dismiss. */
suspend fun biometricAuth(activity: FragmentActivity, title: String): Boolean =
    suspendCancellableCoroutine { cont ->
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle("Unlock API keys for this session")
            .setAllowedAuthenticators(
                Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL,
            )
            .build()
        var settled = false
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (!settled) {
                        settled = true
                        if (cont.isActive) cont.resume(true)
                    }
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (!settled) {
                        settled = true
                        if (cont.isActive) cont.resume(false)
                    }
                }

                override fun onAuthenticationFailed() {
                    // Finger moved too fast etc: keep the dialog up, no settle.
                }
            },
        )
        cont.invokeOnCancellation { runCatching { prompt.cancelAuthentication() } }
        prompt.authenticate(info)
    }
