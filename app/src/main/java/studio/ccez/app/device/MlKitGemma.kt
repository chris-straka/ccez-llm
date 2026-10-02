package studio.ccez.app.device

import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * On-device Gemma chat via the ML Kit GenAI Prompt API over the AICore
 * system app (Gemini Nano) — the native port of OnDevice.kt + ondevice.rs.
 * Keyless: the device owns the model. DOWNLOADABLE kicks the
 * system-managed download in the background so later polls read
 * downloading, then ready. The API reports bytes but no total, so callers
 * render whole megabytes, never a fabricated percent.
 */
class MlKitGemmaChat : OnDeviceChat {
    private val client by lazy { Generation.getClient() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val downloadWatch = AtomicBoolean(false)
    private val downloadedBytes = AtomicLong(0)

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

    override suspend fun status(): OnDeviceStatus = try {
        withTimeout(STATUS_TIMEOUT_MS) {
            when (client.checkStatus()) {
                FeatureStatus.AVAILABLE -> OnDeviceStatus.Ready
                FeatureStatus.DOWNLOADING -> OnDeviceStatus.Downloading(downloadedBytes.get())
                FeatureStatus.DOWNLOADABLE -> {
                    kickDownloadOnce()
                    OnDeviceStatus.NoModel
                }
                else -> OnDeviceStatus.Unsupported
            }
        }
    } catch (e: Exception) {
        OnDeviceStatus.Error(e.message ?: "failed")
    }

    override suspend fun chat(prompt: String): String {
        val text = prompt.trim().take(MAX_PROMPT_CHARS)
        require(text.isNotEmpty()) { "empty prompt" }
        return withTimeout(GENERATE_TIMEOUT_MS) {
            when (client.checkStatus()) {
                FeatureStatus.AVAILABLE -> {}
                FeatureStatus.DOWNLOADING -> throw IllegalStateException("model still downloading")
                FeatureStatus.DOWNLOADABLE -> {
                    kickDownloadOnce()
                    throw IllegalStateException("model not downloaded yet")
                }
                else -> throw UnsupportedOperationException("on-device model unsupported here")
            }
            // beta3 has no response-level `.text`: read the first candidate.
            val reply = client.generateContent(
                generateContentRequest(TextPart(text)) { maxOutputTokens = MAX_OUTPUT_TOKENS },
            ).candidates.firstOrNull()?.text
            if (reply.isNullOrEmpty()) throw RuntimeException("empty on-device reply")
            reply
        }
    }

    companion object {
        private const val MAX_PROMPT_CHARS = 12000
        private const val MAX_OUTPUT_TOKENS = 1024
        private const val STATUS_TIMEOUT_MS = 30_000L
        private const val GENERATE_TIMEOUT_MS = 300_000L
    }
}
