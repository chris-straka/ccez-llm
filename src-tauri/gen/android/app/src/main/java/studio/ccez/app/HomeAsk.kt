package studio.ccez.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/**
 * Questions asked from the phone's home screen (ccez-launcher's Ask,
 * owner 2026-11-18: "an AI chat that I can do right on the home screen").
 * The launcher binds here and holds no key and no model code: this app
 * answers with its own DeepSeek route and keeps every exchange in its own
 * history (`home-asks.json`, taken into its chats by `home_asks_take`).
 *
 * Only apps holding `studio.ccez.app.permission.ASK_FROM_HOME` may bind:
 * signed like this app, or with a certificate listed in
 * `home_ask_known_certs` (the launcher's).
 *
 * Messages (a Messenger, so the two apps share no code):
 * - in  [ASK]: `id` (Long), `chat` (the thread's id), `messages` (JSON
 *   array of `{role, content}`, the whole thread with the new question last).
 * - out [DELTA] `id`, `text` (the next piece); [DONE] `id`, `text` (all of
 *   it), `cited` (JSON array of addresses); [FAILED] `id`, `text` (in words).
 */
class AskService : Service() {
    private val pool = Executors.newFixedThreadPool(2)
    private val messenger = Messenger(object : Handler(Looper.getMainLooper()) {
        override fun handleMessage(m: Message) {
            if (m.what != HomeAsk.ASK) return
            val reply = m.replyTo ?: return
            val b = m.data
            val id = b.getLong("id")
            val chat = b.getString("chat").orEmpty()
            val messages = b.getString("messages").orEmpty()
            pool.execute { HomeAsk.answer(applicationContext, id, chat, messages, reply) }
        }
    })

    override fun onBind(intent: Intent): IBinder = messenger.binder

    override fun onDestroy() {
        pool.shutdownNow()
        super.onDestroy()
    }
}

object HomeAsk {
    const val ASK = 1
    const val DELTA = 2
    const val DONE = 3
    const val FAILED = 4

    private const val TAG = "CcezHomeAsk"
    /** registry.ts: DeepSeek with a key, and keyless through the Mac (DEEPSEEK_MAC_URL). */
    private const val API_URL = "https://api.deepseek.com"
    private const val MAC_URL = "https://z.tailfe37c2.ts.net:8448/ai/deepseek"
    /** deepseek.ts DEEPSEEK_MODEL. */
    private const val MODEL = "deepseek-flash"
    private const val FILE = "home-asks.json"
    private val ID = Regex("^[A-Za-z0-9-]{1,64}$")
    private val fileLock = Any()

    /** Answers one question, streaming back to [reply]; saves the exchange when done. */
    fun answer(ctx: Context, id: Long, chat: String, messagesJson: String, reply: Messenger) {
        val thread = runCatching { JSONArray(messagesJson) }.getOrNull()
        if (!ID.matches(chat) || thread == null || thread.length() == 0) {
            send(reply, FAILED, id) { putString("text", "That question didn't arrive whole.") }
            return
        }
        // The key ccez-keys keeps, held only for this call; without one, the
        // Mac's ccez-words adds its own (tailnet only).
        val key = (Keyring.key(ctx) as? Keyring.Answer.Key)?.key
        val base = if (key != null) API_URL else MAC_URL
        val body = JSONObject()
            .put("model", MODEL)
            .put("stream", true)
            .put("messages", request(thread))
            // DeepSeek's own web search and page reading (deepseek.ts DEEPSEEK_WEB_TOOLS).
            .put("tools", JSONArray().put(JSONObject().put("type", "deepseek_web_search")).put(JSONObject().put("type", "deepseek_read_url")))
        val text = StringBuilder()
        val cited = LinkedHashSet<String>()
        try {
            val c = URL("$base/chat/completions").openConnection() as HttpURLConnection
            c.requestMethod = "POST"
            c.connectTimeout = 10_000
            c.readTimeout = 90_000
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Accept", "text/event-stream")
            if (key != null) c.setRequestProperty("Authorization", "Bearer $key")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = c.responseCode
            if (code !in 200..299) {
                val err = c.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                Log.w(TAG, "HTTP $code from ${if (key != null) "DeepSeek" else "the Mac"}: ${err.take(200)}")
                send(reply, FAILED, id) { putString("text", failure(code, key != null)) }
                return
            }
            c.inputStream.bufferedReader().useLines { lines ->
                for (line in lines) {
                    val data = line.removePrefix("data:").trim()
                    if (!line.startsWith("data:") || data.isEmpty()) continue
                    if (data == "[DONE]") break
                    val delta = runCatching { JSONObject(data).getJSONArray("choices").getJSONObject(0).optJSONObject("delta") }.getOrNull() ?: continue
                    delta.optJSONArray("annotations")?.let { a ->
                        for (i in 0 until a.length()) a.optJSONObject(i)?.optJSONObject("url_citation")?.optString("url")?.takeIf { it.isNotEmpty() }?.let(cited::add)
                    }
                    val piece = delta.optString("content")
                    if (piece.isNotEmpty() && !delta.isNull("content")) {
                        text.append(piece)
                        send(reply, DELTA, id) { putString("text", piece) }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "ask failed: ${e.javaClass.simpleName}: ${e.message}")
            send(reply, FAILED, id) {
                putString("text", if (key != null) "No connection to DeepSeek." else "No connection to the Mac (DeepSeek through ccez-words).")
            }
            return
        }
        if (text.isBlank()) {
            send(reply, FAILED, id) { putString("text", "DeepSeek sent no answer.") }
            return
        }
        val answer = tidy(text.toString())
        save(ctx, chat, thread, answer, cited.toList())
        send(reply, DONE, id) {
            putString("text", answer)
            putString("cited", JSONArray(cited.toList()).toString())
        }
    }

    /**
     * DeepSeek leaves a space where its citation marks were ("the
     * population ."): closed up before full stops and commas only (French
     * spaces before ! ? : ; on purpose).
     */
    fun tidy(text: String): String = text.replace(Regex("[ \\u00A0]+([.,])(?=\\s|$)"), "$1").trim()

    /** The thread as DeepSeek takes it, with a line on where it was asked. */
    private fun request(thread: JSONArray): JSONArray {
        val out = JSONArray().put(
            JSONObject().put("role", "system").put(
                "content",
                "The owner asks from their phone's home screen: answer in a few short sentences, plain text without markdown, in the language they ask in.",
            ),
        )
        for (i in 0 until thread.length()) {
            val m = thread.optJSONObject(i) ?: continue
            val role = m.optString("role")
            if (role == "user" || role == "assistant") out.put(JSONObject().put("role", role).put("content", m.optString("content")))
        }
        return out
    }

    private fun failure(code: Int, withKey: Boolean): String = when {
        code == 401 || code == 403 -> if (withKey) "DeepSeek refused the key in ccez-keys." else "The Mac refused the request."
        code == 402 -> "The DeepSeek account is out of credit."
        code == 429 -> "DeepSeek is busy: try again in a moment."
        code >= 500 -> if (withKey) "DeepSeek had a problem ($code)." else "The Mac or DeepSeek had a problem ($code)."
        else -> "DeepSeek said no ($code)."
    }

    private fun send(to: Messenger, what: Int, id: Long, fill: Bundle.() -> Unit) {
        val m = Message.obtain(null, what)
        m.data = Bundle().apply { putLong("id", id); fill() }
        runCatching { to.send(m) }.onFailure { Log.w(TAG, "the asking app went away") }
    }

    /**
     * The thread with its answer, saved for this app's history: the whole
     * thread each time (the window keeps the longer of what it has and this).
     */
    fun save(ctx: Context, chat: String, thread: JSONArray, answer: String, cited: List<String>) {
        synchronized(fileLock) {
            val file = File(ctx.dataDir, FILE)
            val root = runCatching { JSONObject(file.readText()) }.getOrNull() ?: JSONObject()
            val chats = root.optJSONArray("chats") ?: JSONArray()
            val messages = JSONArray()
            for (i in 0 until thread.length()) {
                val m = thread.optJSONObject(i) ?: continue
                messages.put(JSONObject().put("role", m.optString("role")).put("content", m.optString("content")))
            }
            messages.put(JSONObject().put("role", "assistant").put("content", answer).put("cited", JSONArray(cited)))
            var created = System.currentTimeMillis()
            val kept = JSONArray()
            for (i in 0 until chats.length()) {
                val c = chats.optJSONObject(i) ?: continue
                if (c.optString("id") == chat) created = c.optLong("createdAt", created) else kept.put(c)
            }
            kept.put(JSONObject().put("id", chat).put("createdAt", created).put("messages", messages))
            root.put("chats", kept)
            val tmp = File(ctx.dataDir, "$FILE.tmp")
            tmp.writeText(root.toString())
            if (!tmp.renameTo(file)) Log.w(TAG, "couldn't save the exchange")
        }
    }
}
