package studio.ccez.app

import android.app.Activity
import android.content.Context
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/**
 * On-device chat driver for the Rust bridge (`ondevice.rs`), backed by
 * the ML Kit GenAI Prompt API over the AICore system app (Gemini Nano).
 *
 * This CORRECTS the earlier MediaPipe LLM Inference pick (maintenance
 * mode): no weights ship in the APK, no model file is managed here, and
 * no API key exists anywhere — Gemini Nano is keyless. The device
 * (Galaxy S24 and its class: Pixel 8+, S24+, AICore app installed)
 * owns the model; this object only checks availability, kicks off the
 * system-managed download, and runs prompts.
 *
 * Both entries block the caller and return JSON strings (same trick as
 * `Tts.voices`, dodging JNI exception plumbing):
 * - [status] -> `{"state": <ready|downloading|unavailable|error>,
 *   "reason"?: <no-model|unsupported|stale-aicore|failed>,
 *   "downloadedBytes"?: <bytes so far, downloading only>}`. DOWNLOADABLE reports
 *   unavailable/no-model AND starts the download in the background, so
 *   the next polls read downloading, then ready — "reconnect once,
 *   then it works offline".
 * - [generate] -> `{"text": ...}` or `{"reason": <no-model|
 *   downloading|unsupported|stale-aicore|too-long|failed>}`. Reason codes stay
 *   inside the set the TS seam already maps to toast copy; a missing
 *   model errors, never reroutes to a cloud provider.
 *
 * Threading: the Rust commands run on Tauri worker threads, so the
 * suspend ML Kit calls run in [runBlocking] right on the calling
 * thread — never the UI thread. Only one generation runs at a time
 * (the Rust side also guards with an atomic); a download watcher is
 * fire-and-forget on Dispatchers.IO.
 *
 * Download progress: the API reports bytes downloaded but no total,
 * so no 0..1 fraction exists — [status] reports `downloadedBytes`
 * while DOWNLOADING and the UI renders whole megabytes ("48 MB so
 * far"), never a fabricated percent.
 *
 * CODE-ONLY, UNVERIFIED ON DEVICE (no device ran in this harness;
 * the Kotlin compiles locally — see the report). Pinned to
 * `com.google.mlkit:genai-prompt:1.0.0-beta2`, NOT beta3/4: beta3's
 * default ModelConfig requests AICore feature 648, which no shipping
 * AICore provides (606 FEATURE_NOT_FOUND on-device; upstream
 * googlesamples/mlkit issue 1061). beta4 ships
 * Kotlin 2.3 metadata, which needs kotlin-gradle-plugin 2.3 — and 2.3
 * turns Tauri's own bundled `kotlinOptions` script into a hard error
 * (fixed upstream in tauri#15694, unreleased). beta3 reads cleanly
 * under KGP 2.2.21. Against the [official get-started
 * guide](https://developers.google.com/ml-kit/genai/prompt/android/get-started)
 * (beta4): `Generation.getClient()`, `checkStatus()` ->
 * [FeatureStatus], `download()` Flow<[DownloadStatus]>, and
 * `generateContent(generateContentRequest(TextPart) {
 * maxOutputTokens })` are taken straight from that page — except the
 * response read: beta3 has no response-level `.text`, so this reads
 * `candidates.firstOrNull()?.text`. The beta surface may have drifted;
 * re-check the page before the first device run.
 * `DownloadStatus`/`FeatureStatus` live in `genai.common` (not
 * `genai.prompt`).
 */
object OnDevice {
    private lateinit var appContext: Context

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Guard so repeated status polls start only one download watcher. */
    private val downloadWatch = AtomicBoolean(false)

    /** Bytes downloaded so far (no API total exists); read by [status]. */
    private val downloadedBytes = AtomicLong(0)

    /** AICore Prompt client; first use binds it (may throw: no AICore). */
    private val client by lazy { Generation.getClient() }

    /** Prompt input cap: the API takes 4000 tokens (~3000 English
     * words); 12000 chars is the conservative truncation guard. */
    private const val MAX_PROMPT_CHARS = 12000

    private const val STATUS_TIMEOUT_MS = 30_000L
    private const val GENERATE_TIMEOUT_MS = 300_000L

    private external fun nativeInit(activity: Activity)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    /**
     * One-line exception summary for the settings note (never a toast):
     * "failed" alone says nothing, so the native message rides along.
     */
    private fun detailOf(e: Exception): String {
        return e.toString().replace(Regex("\\s+"), " ").take(160)
    }

    private fun json(
        state: String,
        reason: String?,
        downloaded: Long? = null,
        detail: String? = null,
    ): String {
        val o = JSONObject().put("state", state)
        if (reason != null) o.put("reason", reason)
        if (detail != null) o.put("detail", detail)
        if (downloaded != null) o.put("downloadedBytes", downloaded)
        return o.toString()
    }

    /**
     * Best-effort download kick: collects the system download flow
     * until it reaches a terminal state, then releases the guard so a
     * later poll can retry after failures (e.g. airplane mode
     * mid-download surfaces as DownloadFailed; the next poll while
     * online restarts it).
     */
    private fun kickDownloadOnce() {
        if (!downloadWatch.compareAndSet(false, true)) return
        scope.launch {
            try {
                client.download().collect { status ->
                    when (status) {
                        is DownloadStatus.DownloadProgress ->
                            downloadedBytes.set(status.totalBytesDownloaded)
                        is DownloadStatus.DownloadCompleted -> downloadWatch.set(false)
                        is DownloadStatus.DownloadFailed -> downloadWatch.set(false)
                        else -> {}
                    }
                }
            } catch (_: Exception) {
                downloadWatch.set(false)
            }
        }
    }

    /**
     * 606 FEATURE_NOT_FOUND reads as `stale-aicore`: the installed
     * AICore doesn't serve the requested feature (outdated configs or
     * a lib/AICore mismatch) — a Play Store AI Core update or a
     * restart resolves it, never a retry of the same call.
     */
    private fun failureReason(e: Exception): String {
        return if (e is GenAiException && e.errorCode == 606) "stale-aicore"
        else "failed"
    }

    /** Readiness as JSON (blocks the caller briefly; never throws). */
    @JvmStatic
    fun status(): String {
        return try {
            runBlocking {
                withTimeout(STATUS_TIMEOUT_MS) {
                    when (client.checkStatus()) {
                        FeatureStatus.AVAILABLE -> json("ready", null)
                        FeatureStatus.DOWNLOADING ->
                            json("downloading", null, downloadedBytes.get())
                        FeatureStatus.DOWNLOADABLE -> {
                            kickDownloadOnce()
                            json("unavailable", "no-model")
                        }
                        else -> json("unavailable", "unsupported")
                    }
                }
            }
        } catch (e: Exception) {
            json("error", failureReason(e), detail = detailOf(e))
        }
    }

    /** One completion as JSON (blocks the caller; never throws). */
    @JvmStatic
    fun generate(prompt: String, maxTokens: Int): String {
        if (prompt.isBlank()) return json("error", "failed")
        if (prompt.length > MAX_PROMPT_CHARS) return json("error", "too-long")
        val cap = maxTokens.coerceIn(1, 4096)
        return try {
            runBlocking {
                withTimeout(GENERATE_TIMEOUT_MS) {
                    when (client.checkStatus()) {
                        FeatureStatus.AVAILABLE -> {}
                        FeatureStatus.DOWNLOADING -> return@withTimeout json("error", "downloading")
                        FeatureStatus.DOWNLOADABLE -> {
                            kickDownloadOnce()
                            return@withTimeout json("error", "no-model")
                        }
                        else -> return@withTimeout json("error", "unsupported")
                    }
                    val response = client.generateContent(
                        generateContentRequest(TextPart(prompt)) {
                            maxOutputTokens = cap
                        }
                    )
                    // beta2/3 have no response-level `.text`
                    // (that convenience arrived in beta4): read the
                    // first candidate's text instead.
                    val text = response.candidates.firstOrNull()?.text
                    if (text.isNullOrEmpty()) json("error", "failed")
                    else JSONObject().put("text", text).toString()
                }
            }
        } catch (e: Exception) {
            json("error", failureReason(e), detail = detailOf(e))
        }
    }
}
