package studio.ccez.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Minimal TextToSpeech driver for the Rust bridge (`tts_android.rs`).
 *
 * Everything engine-side runs on the main thread — the engine needs a
 * Looper — so every entry posts there and returns at once. [init] runs
 * from `MainActivity.onCreate`, so the Rust side never passes contexts
 * through JNI. Completion (done / error / stopped) reports back through
 * [nativeOnTtsDone], implemented in Rust, which emits the `tts-done`
 * window event the frontend matches by utterance id.
 */
object Tts {
    private lateinit var appContext: Context
    private val main = Handler(Looper.getMainLooper())

    /** Main thread only. Null until the first speak initializes it. */
    private var engine: TextToSpeech? = null

    /**
     * Engine init is async (binds to the system service): [voices]
     * waits on this on its JNI thread before reading, otherwise the
     * first inventory lands empty and settings claims no voices are
     * installed. Never awaited on the main thread (the init callback
     * itself runs there).
     */
    @Volatile
    private var initOk = false
    private val initLatch = CountDownLatch(1)

    private val listener = object : UtteranceProgressListener() {
        override fun onStart(id: String) {}
        override fun onDone(id: String) {
            nativeOnTtsDone(id.toLongOrNull() ?: -1, null)
            settleFile(id)
        }
        override fun onError(id: String) {
            nativeOnTtsDone(id.toLongOrNull() ?: -1, "speech error")
            settleFile(id)
        }
        @Deprecated("Deprecated in Java")
        override fun onError(id: String, code: Int) {
            nativeOnTtsDone(id.toLongOrNull() ?: -1, "speech error $code")
            settleFile(id)
        }
        override fun onStop(id: String?, cancel: Boolean) {
            if (id != null) {
                nativeOnTtsDone(id.toLongOrNull() ?: -1, if (cancel) "canceled" else null)
                settleFile(id)
            }
        }
    }

    /**
     * File-export rendezvous: `saveToFile` parks one latch per
     * `file-<id>` utterance; the listener above releases it on
     * completion. Live-speech ids are numeric, so their `tts-done`
     * events already ignore these (`toLongOrNull` fails to -1).
     */
    private val fileLatches = java.util.concurrent.ConcurrentHashMap<String, CountDownLatch>()

    private fun settleFile(id: String) {
        fileLatches.remove(id)?.countDown()
    }

    /**
     * Speech-rate parity with the macOS bridge, where Mandarin reads
     * slightly slower for learners. Android rates multiply the engine
     * default (1.0); only Chinese deviates.
     */
    private fun tuneFor(tts: TextToSpeech, locale: Locale) {
        try {
            tts.setSpeechRate(if (locale.language == "zh") 0.9f else 1.0f)
        } catch (_: Exception) {
            // Engine default stands in; still speak.
        }
    }

    private external fun nativeOnTtsDone(id: Long, error: String?)

    private external fun nativeInit(activity: Activity)

    /** Called once from `MainActivity.onCreate` (UI thread). */
    @JvmStatic
    fun init(activity: Activity) {
        appContext = activity.applicationContext
        // Hand the JVM to Rust: VM + this class for later commands.
        nativeInit(activity)
    }

    private fun ensure() {
        if (engine != null) return
        initOk = false
        engine = TextToSpeech(appContext, { status ->
            initOk = status == TextToSpeech.SUCCESS
            engine?.setOnUtteranceProgressListener(listener)
            initLatch.countDown()
        })
    }

    /** A TTS engine is installed when something answers the data check. */
    @JvmStatic
    fun supported(): Boolean {
        if (!::appContext.isInitialized) return false
        val intent = Intent(TextToSpeech.Engine.ACTION_CHECK_TTS_DATA)
        return appContext.packageManager
            .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .isNotEmpty()
    }

    /**
     * Open the system text-to-speech settings (preferred engine, voice
     * data) for the Rust bridge (`open_voice_settings`). Returns "" on
     * success or an error message — never null (the bridge has no null
     * path). Started from the application context, so it needs NEW_TASK;
     * falls back to the top-level Settings page when the TTS page is
     * missing on a vendor ROM.
     */
    @JvmStatic
    fun openTtsSettings(): String {
        return try {
            val intent = Intent("com.android.settings.TTS_SETTINGS").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            appContext.startActivity(intent)
            ""
        } catch (_: Exception) {
            try {
                val fallback =
                    Intent(android.provider.Settings.ACTION_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                appContext.startActivity(fallback)
                ""
            } catch (_: Exception) {
                "could not open text-to-speech settings"
            }
        }
    }

    /**
     * Queue [text] for speech, flushing anything in flight (Skip semantics).
     * Never blocks the caller; completion arrives via [nativeOnTtsDone].
     */
    @JvmStatic
    fun speak(text: String, lang: String, voiceName: String?, id: Long) {
        main.post {
            ensure()
            val tts = engine
            if (tts == null) {
                nativeOnTtsDone(id, "engine unavailable")
                return@post
            }
            val locale = try {
                Locale.forLanguageTag(lang)
            } catch (_: Exception) {
                Locale.getDefault()
            }
            try {
                if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) {
                    tts.language = locale
                }
            } catch (_: Exception) {
                // Engine default stands in; still speak.
            }
            tuneFor(tts, locale)
            if (voiceName != null) {
                try {
                    tts.voices?.firstOrNull { it.name == voiceName }?.let { tts.voice = it }
                } catch (_: Exception) {
                    // Named voice gone; engine default stands in.
                }
            }
            try {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), id.toString())
            } catch (_: Exception) {
                nativeOnTtsDone(id, "speak failed")
            }
        }
    }

    @JvmStatic
    fun stop() {
        main.post {
            try {
                engine?.stop()
            } catch (_: Exception) {
                // Already stopped or gone; nothing to report.
            }
        }
    }

    /**
     * Render [text] to a wav file in the app cache (lesson-audio
     * export), with the same locale/voice tuning as live speech.
     * Blocks the caller until the utterance completes (or two
     * minutes pass) and returns the absolute path, or "" on failure.
     * Code-only: unverified on device (no Android hardware ran it).
     */
    @JvmStatic
    fun saveToFile(text: String, lang: String, voiceName: String?, id: Long): String {
        val utterId = "file-$id"
        val latch = CountDownLatch(1)
        var path = ""
        main.post {
            try {
                ensure()
                val tts = engine
                if (tts == null) {
                    latch.countDown()
                    return@post
                }
                val locale = try {
                    Locale.forLanguageTag(lang)
                } catch (_: Exception) {
                    Locale.getDefault()
                }
                try {
                    if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) {
                        tts.language = locale
                    }
                } catch (_: Exception) {
                    // Engine default stands in; still render.
                }
                tuneFor(tts, locale)
                if (voiceName != null) {
                    try {
                        tts.voices?.firstOrNull { it.name == voiceName }?.let { tts.voice = it }
                    } catch (_: Exception) {
                        // Named voice gone; engine default stands in.
                    }
                }
                val file = java.io.File(appContext.cacheDir, "tts-$id.wav")
                path = file.absolutePath
                fileLatches[utterId] = latch
                val rc = tts.synthesizeToFile(text, null, file, utterId)
                if (rc != TextToSpeech.SUCCESS) {
                    fileLatches.remove(utterId)
                    latch.countDown()
                }
            } catch (_: Exception) {
                fileLatches.remove(utterId)
                latch.countDown()
            }
        }
        latch.await(120, TimeUnit.SECONDS)
        fileLatches.remove(utterId)
        return path
    }

    /**
     * Installed voices as newline-joined `name|bcp47|quality` rows
     * (quality 1 = engine default, else 0 — Android has no premium
     * tier). One string dodges array marshaling. Called rarely
     * (settings probe), so blocking the caller briefly is acceptable.
     */
    @JvmStatic
    fun voices(): String {
        main.post { ensure() }
        // The engine binds async: read only after onInit lands, or
        // the first call reports an empty inventory. This waits on
        // the JNI thread, never main.
        initLatch.await(4, TimeUnit.SECONDS)
        if (!initOk) return ""
        var text = ""
        val latch = CountDownLatch(1)
        main.post {
            try {
                val tts = engine
                val defaultName = try {
                    tts?.defaultVoice?.name
                } catch (_: Exception) {
                    null
                }
                text = tts?.voices
                    ?.map { voice ->
                        val tag = try {
                            voice.locale.toLanguageTag()
                        } catch (_: Exception) {
                            "und"
                        }
                        "${voice.name}|$tag|${if (voice.name == defaultName) 1 else 0}"
                    }
                    ?.joinToString("\n") ?: ""
            } catch (_: Exception) {
                text = ""
            } finally {
                latch.countDown()
            }
        }
        latch.await(4, TimeUnit.SECONDS)
        return text
    }
}
