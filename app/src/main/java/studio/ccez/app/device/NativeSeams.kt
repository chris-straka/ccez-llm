package studio.ccez.app.device

/**
 * Native seams that replace the Rust backend on Android.
 * Each has a no-op/fake for tests plus a real impl wired in MainActivity.
 * Mirrors: tts_android.rs, dictate (SpeechRecognizer), ocr.rs (ML Kit),
 * ondevice.rs (AICore/GenAI), fetch.rs (OkHttp stays in data layer).
 */

/** Android TextToSpeech wrapper contract (word tracking via utterance ranges). */
interface Speaker {
    suspend fun inventory(): List<VoiceInfo>
    /** One utterance in `lang` (BCP-47; blank follows the engine default). */
    suspend fun speak(text: String, onWord: (Int, Int) -> Unit, lang: String = "")
    /** One word in its own script locale (word-tap speech); default ignores the locale. */
    suspend fun speakWord(text: String, lang: String) {
        speak(text, { _, _ -> }, lang)
    }
    fun stop()
}
data class VoiceInfo(val id: String, val name: String, val locale: String)

/** SpeechRecognizer dictation contract. */
fun interface Dictator {
    suspend fun listen(): String
}

/** ML Kit text-recognition contract (images -> text for attachments). */
fun interface OcrReader {
    suspend fun recognize(imageBytes: ByteArray): String
}

/** On-device ML Kit readiness + one-shot chat (ML Kit GenAI / AICore). */
sealed interface OnDeviceStatus {
    data object Unsupported : OnDeviceStatus
    /** Model weights absent; a background download was kicked. */
    data object NoModel : OnDeviceStatus
    /** Download in flight; bytes so far (no API total exists). */
    data class Downloading(val bytesDownloaded: Long = 0) : OnDeviceStatus
    data object Ready : OnDeviceStatus
    data class Error(val message: String) : OnDeviceStatus
}
interface OnDeviceChat {
    suspend fun status(): OnDeviceStatus
    suspend fun chat(prompt: String): String
}

/** Fakes keep unit tests hermetic. */
class FakeSpeaker : Speaker {
    override suspend fun inventory(): List<VoiceInfo> = emptyList()
    override suspend fun speak(text: String, onWord: (Int, Int) -> Unit, lang: String) { /* no-op */ }
    override fun stop() { /* no-op */ }
}
class FakeDictator : Dictator {
    override suspend fun listen(): String = ""
}
class FakeOcr : OcrReader {
    override suspend fun recognize(imageBytes: ByteArray): String = ""
}
class FakeOnDevice(private val status: OnDeviceStatus = OnDeviceStatus.Unsupported) : OnDeviceChat {
    override suspend fun status(): OnDeviceStatus = status
    override suspend fun chat(prompt: String): String = throw UnsupportedOperationException("on-device unavailable")
}
