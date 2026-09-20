package studio.ccez.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.common.GenAiException
import com.google.mlkit.genai.prompt.GenerationConfig
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.ModelConfig
import com.google.mlkit.genai.prompt.ModelPreference
import com.google.mlkit.genai.prompt.ModelReleaseStage
import java.util.concurrent.Executors
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
 *   "variant"?: <winning config name, ready only>,
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

    /**
     * Config variants, probed in order: null is the library default
     * (requests AICore feature 636); the explicit ModelConfigs request
     * sibling features for the same Nano model (FULL/FAST x
     * STABLE/PREVIEW). AICore names features per config, and ships
     * different subsets per device — so the probe walks the list and
     * pins the first config AICore answers for. [status] owns
     * discovery; [generate] reuses the winner.
     */
    private data class ConfigVariant(val name: String, val config: ModelConfig?)

    private fun modelConfig(preference: Int, stage: Int): ModelConfig {
        return ModelConfig.builder().apply {
            setPreference(preference)
            setReleaseStage(stage)
        }.build()
    }

    private val configVariants = listOf(
        ConfigVariant("default", null),
        ConfigVariant(
            "full-stable",
            modelConfig(ModelPreference.FULL, ModelReleaseStage.STABLE),
        ),
        ConfigVariant(
            "full-preview",
            modelConfig(ModelPreference.FULL, ModelReleaseStage.PREVIEW),
        ),
        ConfigVariant(
            "fast-stable",
            modelConfig(ModelPreference.FAST, ModelReleaseStage.STABLE),
        ),
        ConfigVariant(
            "fast-preview",
            modelConfig(ModelPreference.FAST, ModelReleaseStage.PREVIEW),
        ),
    )

    private val variantExecutor = Executors.newSingleThreadExecutor()

    /** Winner of the last probe walk (default until one answers). */
    @Volatile
    private var activeVariant: ConfigVariant = configVariants[0]

    private val clients = mutableMapOf<String, GenerativeModel>()

    /** AICore Prompt client for a variant; first use binds it. */
    @Synchronized
    private fun clientFor(variant: ConfigVariant): GenerativeModel {
        return clients.getOrPut(variant.name) {
            if (variant.config == null) Generation.getClient()
            else Generation.getClient(
                GenerationConfig.Builder().apply {
                    setModelConfig(variant.config)
                    setWorkerExecutor(variantExecutor)
                }.build(),
            )
        }
    }

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
    // 240 chars: the error class AND the full AICore feature number
    // (606 names it — at 160 the id truncates to "Feature 63…", which
    // cannot distinguish library versions).
    private fun detailOf(e: Exception): String {
        return e.toString().replace(Regex("\\s+"), " ").take(240)
    }

    private fun json(
        state: String,
        reason: String?,
        downloaded: Long? = null,
        detail: String? = null,
        variant: String? = null,
    ): String {
        val o = JSONObject().put("state", state)
        if (reason != null) o.put("reason", reason)
        if (detail != null) o.put("detail", detail)
        if (downloaded != null) o.put("downloadedBytes", downloaded)
        if (variant != null) o.put("variant", variant)
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
        val client = clientFor(activeVariant)
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

    /**
     * Readiness as JSON (blocks the caller briefly; never throws).
     * Walks the config variants in order and pins the first one
     * AICore answers for: a 606 (feature unknown to this AICore)
     * moves to the next config, as does a known-but-unsupported
     * verdict. Anything else aborts with the real error. All-606
     * reads stale-aicore; any known unsupported reads unsupported.
     * The winning variant name rides the ready payload so the
     * settings note can say which config answered.
     */
    @JvmStatic
    fun status(): String {
        return try {
            runBlocking {
                withTimeout(STATUS_TIMEOUT_MS) {
                    var sawUnsupported = false
                    walk@ for (variant in configVariants) {
                        val code = try {
                            clientFor(variant).checkStatus()
                        } catch (e: Exception) {
                            if (e is GenAiException && e.errorCode == 606) continue@walk
                            return@withTimeout json(
                                "error",
                                failureReason(e),
                                detail = detailOf(e),
                            )
                        }
                        when (code) {
                            FeatureStatus.AVAILABLE -> {
                                activeVariant = variant
                                return@withTimeout json(
                                    "ready",
                                    null,
                                    variant = variant.name,
                                )
                            }
                            FeatureStatus.DOWNLOADING -> {
                                activeVariant = variant
                                return@withTimeout json(
                                    "downloading",
                                    null,
                                    downloadedBytes.get(),
                                )
                            }
                            FeatureStatus.DOWNLOADABLE -> {
                                activeVariant = variant
                                kickDownloadOnce()
                                return@withTimeout json("unavailable", "no-model")
                            }
                            else -> sawUnsupported = true
                        }
                    }
                    if (sawUnsupported) json("unavailable", "unsupported")
                    else json("error", "stale-aicore")
                }
            }
        } catch (e: Exception) {
            json("error", failureReason(e), detail = detailOf(e))
        }
    }

    /**
     * One completion as JSON (blocks the caller; never throws).
     * Runs on the probe walk's winner — [status] owns discovery, so a
     * send never re-walks.
     */
    @JvmStatic
    fun generate(prompt: String, maxTokens: Int): String {
        if (prompt.isBlank()) return json("error", "failed")
        if (prompt.length > MAX_PROMPT_CHARS) return json("error", "too-long")
        val cap = maxTokens.coerceIn(1, 4096)
        val client = clientFor(activeVariant)
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

    /**
     * Open AI Core's Play Store page (the `market:` scheme first, the
     * https page as fallback) for the Rust bridge
     * (`ondevice_open_aicore_page`). AI Core is a hidden system
     * component — unsearchable in the store — so the error copy points
     * here instead of naming a search. Returns "" on success or an
     * error message, never null. Started from the application context,
     * so it needs NEW_TASK.
     */
    @JvmStatic
    fun openAicorePage(): String {
        if (!::appContext.isInitialized) return "bridge not initialized"
        val targets = listOf(
            "market://details?id=com.google.android.aicore",
            "https://play.google.com/store/apps/details?id=com.google.android.aicore",
        )
        return try {
            val pm = appContext.packageManager
            for (target in targets) {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(target)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                if (
                    pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
                        .isNotEmpty()
                ) {
                    appContext.startActivity(intent)
                    return ""
                }
            }
            "no store app found"
        } catch (_: Exception) {
            "could not open the store app"
        }
    }
}
