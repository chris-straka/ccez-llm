package studio.ccez.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import java.io.File

/**
 * In-app update installer for the Rust bridge (`update_android.rs`).
 *
 * The Tauri updater plugin is desktop-only, so Android downloads the
 * release APK into the app cache (Rust streams it) and hands it here:
 * [installApk] fires the system package installer for it. Everything
 * runs on the main thread; [init] runs from `MainActivity.onCreate`,
 * so Rust never passes contexts through JNI.
 */
object Update {
    private lateinit var appContext: Context

    private external fun nativeInit(activity: Activity)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    /**
     * Fire the system installer for a downloaded APK.
     *
     * Returns `"installing"` once the installer opens, or
     * `"needs-approval"` when installs from this app are not allowed
     * yet — the unknown-sources page opens alongside, so the user
     * allows it once and taps Install again. Anything else is an
     * error message — never null (the bridge has no null path).
     */
    @JvmStatic
    fun installApk(path: String): String {
        // canRequestPackageInstalls needs API 26; the install intent
        // carries the check on older releases.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val allowed = try {
                appContext.packageManager.canRequestPackageInstalls()
            } catch (_: Exception) {
                false
            }
            if (!allowed) {
                return try {
                    val settings = Intent(
                        android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES
                    ).apply {
                        data = Uri.parse("package:${appContext.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    appContext.startActivity(settings)
                    "needs-approval"
                } catch (e: Exception) {
                    "could not open install-permission settings: ${e.message}"
                }
            }
        }
        return try {
            val file = File(path)
            if (!file.isFile) return "downloaded update is missing"
            val uri = FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.fileprovider",
                file
            )
            val install = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            appContext.startActivity(install)
            "installing"
        } catch (e: Exception) {
            "installer did not start: ${e.message}"
        }
    }
}
