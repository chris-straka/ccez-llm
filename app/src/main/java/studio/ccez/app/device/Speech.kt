package studio.ccez.app.device

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Real Android TextToSpeech speaker (replaces tts_android.rs + Tts.kt bridge).
 * Word tracking rides utterance onRangeStart (API 26+; minSdk here is 29).
 */
class AndroidSpeaker(private val context: Context) : Speaker {
    private var tts: TextToSpeech? = null
    private var init: Boolean? = null

    private suspend fun ensure(): TextToSpeech {
        tts?.let { if (init == true) return it }
        return suspendCancellableCoroutine { cont ->
            var engine: TextToSpeech? = null
            engine = TextToSpeech(context.applicationContext) { status ->
                val ready = engine
                init = status == TextToSpeech.SUCCESS
                if (status == TextToSpeech.SUCCESS && ready != null) cont.resume(ready)
                else {
                    engine?.shutdown()
                    if (cont.isActive) cont.resumeWithException(RuntimeException("TextToSpeech init failed: $status"))
                }
            }
            tts = engine
            cont.invokeOnCancellation { engine?.shutdown(); tts = null; init = null }
        }
    }

    override suspend fun inventory(): List<VoiceInfo> {
        val engine = runCatching { ensure() }.getOrNull() ?: return emptyList()
        return engine.voices.orEmpty().map { v ->
            VoiceInfo(v.name, "${v.name} (${v.locale})", v.locale.toLanguageTag())
        }.sortedBy { it.name }
    }

    override suspend fun speak(text: String, onWord: (Int, Int) -> Unit, lang: String) {
        val locale = if (lang.isBlank()) Locale.getDefault()
        else runCatching { Locale.forLanguageTag(lang) }.getOrDefault(Locale.getDefault())
        speakInternal(text, locale, onWord)
    }

    override suspend fun speakWord(text: String, lang: String) {
        val locale = runCatching { Locale.forLanguageTag(lang) }.getOrDefault(Locale.getDefault())
        speakInternal(text, locale) { _, _ -> }
    }

    private suspend fun speakInternal(text: String, locale: Locale, onWord: (Int, Int) -> Unit) {
        val engine = ensure()
        val id = UUID.randomUUID().toString()
        return suspendCancellableCoroutine { cont ->
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) = Unit
                override fun onDone(utteranceId: String?) {
                    if (utteranceId == id && cont.isActive) cont.resume(Unit)
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    if (utteranceId == id && cont.isActive) cont.resumeWithException(RuntimeException("speak failed"))
                }

                override fun onError(utteranceId: String?, errorCode: Int) = onError(utteranceId)
                override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                    if (utteranceId == id) onWord(start, end)
                }
            })
            runCatching { engine.language = locale }
            val rc = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
            if (rc != TextToSpeech.SUCCESS && cont.isActive) {
                cont.resumeWithException(RuntimeException("speak rejected: $rc"))
            }
            cont.invokeOnCancellation { engine.stop() }
        }
    }

    override fun stop() {
        tts?.stop()
    }
}

/**
 * Real SpeechRecognizer dictation (replaces the dictate_* Rust modules).
 * Requires RECORD_AUDIO (already in the manifest); throws honestly when
 * recognition is unavailable or the user denies the mic.
 */
class AndroidDictator(private val context: Context) : Dictator {
    override suspend fun listen(): String {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            throw UnsupportedOperationException("speech recognition unavailable on this device")
        }
        return suspendCancellableCoroutine { cont ->
            val recognizer = SpeechRecognizer.createSpeechRecognizer(context.applicationContext)
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            }
            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    recognizer.destroy()
                    if (cont.isActive) cont.resume(text)
                }

                override fun onError(error: Int) {
                    recognizer.destroy()
                    if (cont.isActive) cont.resumeWithException(RuntimeException("dictation error: $error"))
                }

                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            recognizer.startListening(intent)
            cont.invokeOnCancellation {
                runCatching {
                    recognizer.cancel()
                    recognizer.destroy()
                }
            }
        }
    }
}
