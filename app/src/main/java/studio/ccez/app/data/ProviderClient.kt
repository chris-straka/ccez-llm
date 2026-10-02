package studio.ccez.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSources
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.MAX_CALLS_PER_ROUND
import studio.ccez.app.domain.MAX_TOOL_ROUNDS
import studio.ccez.app.domain.resolveThinkingId
import studio.ccez.app.domain.thinkingFor
import studio.ccez.app.domain.TokenUsage
import studio.ccez.app.domain.WireToolCall
import studio.ccez.app.domain.fetchToolDefinition
import studio.ccez.app.domain.parseFetchCall
import kotlin.coroutines.resumeWithException

/**
 * OpenAI-compatible chat client (DeepSeek, Muse Spark, custom endpoints).
 * POST {baseUrl}/chat/completions with SSE streaming; thinking level is
 * sent only when the provider knob exists, else omitted (parity with
 * providers/thinking.ts + openai-compat.ts).
 */
data class ChatRequest(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
    val messages: List<Map<String, String>>,
    val thinking: String? = null,
    /** JPEG data URLs appended as image_url parts to the last message. */
    val images: List<String> = emptyList(),
    /** Offer the fetch_url tool on the first streaming turn (parity with openai-compat.ts). */
    val tools: Boolean = true,
    /** Prepended system message (base + thinking hint + reply-lang suffix); blank sends none. */
    val systemPrompt: String = "",
    /** Provider id for the thinking table (thinkingFor parity). */
    val providerId: String = "muse",
)

data class ChatCompletion(
    val content: String,
    val usage: TokenUsage? = null,
    val toolCalls: List<WireToolCall> = emptyList(),
)

/** HTTP failures with their status, so the turn loop can fall back on 400. */
class ProviderHttpError(val status: Int, message: String) : RuntimeException(message)

/** One wire message in a tool-loop history (assistant tool_calls + tool results included). */
private data class WireMsg(
    val role: String,
    val content: Any?,
    val toolCalls: List<WireToolCall> = emptyList(),
    val toolCallId: String? = null,
) {
    fun toMap(): Map<String, Any?> {
        val map = mutableMapOf<String, Any?>("role" to role, "content" to content)
        if (toolCalls.isNotEmpty()) {
            map["tool_calls"] = toolCalls.map {
                mapOf(
                    "id" to it.id,
                    "type" to "function",
                    "function" to mapOf("name" to it.name, "arguments" to it.arguments),
                )
            }
        }
        toolCallId?.let { map["tool_call_id"] = it }
        return map
    }
}

class OpenAiCompatClient(private val http: OkHttpClient = OkHttpClient()) {
    fun buildRequest(req: ChatRequest): Request {
        val wireMessages: List<Any> = req.messages.mapIndexed { i, m ->
            if (i == req.messages.lastIndex && req.images.isNotEmpty()) {
                mapOf(
                    "role" to (m["role"] ?: "user"),
                    "content" to (
                        listOf(mapOf("type" to "text", "text" to (m["content"] ?: ""))) +
                            req.images.map { url ->
                                mapOf("type" to "image_url", "image_url" to mapOf("url" to url))
                            }
                    ),
                )
            } else m
        }
        return buildRawRequest(req.baseUrl, req.apiKey, req.model, req.thinking, wireMessages, stream = true, tools = req.tools, systemPrompt = req.systemPrompt, providerId = req.providerId)
    }

    private fun buildRawRequest(
        baseUrl: String,
        apiKey: String,
        model: String,
        thinking: String?,
        wireMessages: List<Any?>,
        stream: Boolean,
        tools: Boolean,
        systemPrompt: String = "",
        providerId: String = "muse",
    ): Request {
        val withSystem = if (systemPrompt.isBlank()) wireMessages
        else listOf(mapOf("role" to "system", "content" to systemPrompt)) + wireMessages
        val bodyMap = mutableMapOf<String, Any?>(
            "model" to model,
            "messages" to withSystem,
            "stream" to stream,
        )
        if (tools) {
            bodyMap["tools"] = listOf(fetchToolDefinition())
            bodyMap["tool_choice"] = "auto"
        }
        val support = thinkingFor(providerId, model)
        val rung = resolveThinkingId(support, thinking)
        for ((k, v) in support.wireFields(rung)) bodyMap[k] = v
        val json = buildJson(bodyMap)
        return Request.Builder()
            .url(baseUrl.trimEnd('/') + "/chat/completions")
            .header("Authorization", "Bearer $apiKey")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
    }

    suspend fun stream(req: ChatRequest, onToken: (String) -> Unit): ChatCompletion =
        streamOnce(req.baseUrl, req.apiKey, req.model, req.thinking, initialWire(req), stream = true, tools = req.tools, onToken = onToken, systemPrompt = req.systemPrompt, providerId = req.providerId)

    private fun initialWire(req: ChatRequest): MutableList<WireMsg> {
        val wire = req.messages.map { WireMsg(it["role"] ?: "user", it["content"] ?: "") }.toMutableList()
        if (req.images.isNotEmpty() && wire.isNotEmpty()) {
            val last = wire.last()
            wire[wire.lastIndex] = last.copy(
                content = listOf(mapOf("type" to "text", "text" to (last.content as? String ?: ""))) +
                    req.images.map { url ->
                        mapOf("type" to "image_url", "image_url" to mapOf("url" to url))
                    },
            )
        }
        return wire
    }

    /**
     * Model-driven lookup turn: the first request streams WITH tools, so
     * a no-fetch turn costs exactly one request. When the model calls
     * fetch_url, the calls run serially into the history and the answer
     * streams after (follow-up fetches ride capped non-streaming
     * rounds). Providers that reject `tools` fall back to a plain turn
     * once. Mirrors the stream() turn loop in openai-compat.ts.
     */
    suspend fun streamConversation(
        req: ChatRequest,
        fetchPage: suspend (String) -> String,
        onToken: (String) -> Unit,
    ): ChatCompletion {
        val history = initialWire(req)
        val wire = { history.map { it.toMap() } }
        val first = try {
            streamOnce(req.baseUrl, req.apiKey, req.model, req.thinking, history, stream = true, tools = req.tools, onToken = onToken, systemPrompt = req.systemPrompt, providerId = req.providerId)
        } catch (e: ProviderHttpError) {
            if (e.status != 400) throw e
            return streamOnce(req.baseUrl, req.apiKey, req.model, req.thinking, history, stream = true, tools = false, onToken = onToken, systemPrompt = req.systemPrompt, providerId = req.providerId)
        }
        var pending = executableCalls(first.toolCalls)
        if (pending.isEmpty()) return first
        var assistantText = first.content
        for (round in 0 until MAX_TOOL_ROUNDS) {
            history.add(WireMsg("assistant", assistantText, toolCalls = pending.map { it.raw }))
            for (entry in pending) {
                history.add(
                    WireMsg("tool", runFetch(entry.parsed.url, fetchPage), toolCallId = entry.parsed.id),
                )
            }
            // Follow-up fetches ride capped non-streaming rounds; the
            // answer itself always streams last.
            if (round + 1 >= MAX_TOOL_ROUNDS) break
            val follow = complete(req.baseUrl, req.apiKey, req.model, req.thinking, wire(), systemPrompt = req.systemPrompt, providerId = req.providerId)
            assistantText = follow.content
            pending = executableCalls(follow.toolCalls)
            if (pending.isEmpty()) break
        }
        return streamOnce(req.baseUrl, req.apiKey, req.model, req.thinking, history, stream = true, tools = false, onToken = onToken, systemPrompt = req.systemPrompt, providerId = req.providerId)
    }

    private data class ExecutableCall(val raw: WireToolCall, val parsed: studio.ccez.app.domain.FetchCall)

    private fun executableCalls(calls: List<WireToolCall>): List<ExecutableCall> =
        calls.mapNotNull { raw ->
            val parsed = parseFetchCall(raw.id, raw.name, raw.arguments) ?: return@mapNotNull null
            ExecutableCall(raw, parsed)
        }.take(MAX_CALLS_PER_ROUND)

    /**
     * One fetch call run to text. Page failures read as one-line
     * results (the model reports them in its reply); a user stop
     * still stops.
     */
    private suspend fun runFetch(url: String, fetchPage: suspend (String) -> String): String = try {
        fetchPage(url)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        e.message ?: "Page fetch failed."
    }

    private suspend fun streamOnce(
        baseUrl: String,
        apiKey: String,
        model: String,
        thinking: String?,
        history: List<WireMsg>,
        stream: Boolean,
        tools: Boolean,
        onToken: (String) -> Unit,
        systemPrompt: String = "",
        providerId: String = "muse",
    ): ChatCompletion = suspendCancellableCoroutine { cont ->
        val sb = StringBuilder()
        val slots = mutableListOf<Slot>()
        val request = buildRawRequest(
            baseUrl, apiKey, model, thinking, history.map { it.toMap() }, stream, tools,
            systemPrompt = systemPrompt, providerId = providerId,
        )
        val factory = EventSources.createFactory(http)
        val source: EventSource = factory.newEventSource(request, object : okhttp3.sse.EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (data == "[DONE]") return
                val (delta, calls) = parseStreamEvent(data)
                for ((index, callId, name, args) in calls) {
                    while (slots.size <= index) slots.add(Slot())
                    val slot = slots[index]
                    if (callId.isNotEmpty()) slot.id = callId
                    slot.name += name
                    slot.args += args
                }
                if (delta.isNotEmpty()) {
                    sb.append(delta)
                    onToken(delta)
                }
            }

            override fun onClosed(eventSource: EventSource) {
                if (cont.isActive) {
                    cont.resumeWith(
                        Result.success(
                            ChatCompletion(
                                sb.toString(),
                                toolCalls = slots.filter { it.id.isNotEmpty() }
                                    .map { WireToolCall(it.id, it.name, it.args) },
                            ),
                        ),
                    )
                }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                if (cont.isActive) {
                    val status = response?.code ?: -1
                    cont.resumeWithException(
                        ProviderHttpError(status, t?.message ?: "stream failed: $status"),
                    )
                }
            }
        })
        cont.invokeOnCancellation { source.cancel() }
    }

    private data class Slot(var id: String = "", var name: String = "", var args: String = "")

    /** One non-streaming turn (follow-up fetch rounds). */
    private suspend fun complete(
        baseUrl: String,
        apiKey: String,
        model: String,
        thinking: String?,
        wire: List<Map<String, Any?>>,
        systemPrompt: String = "",
        providerId: String = "muse",
    ): ChatCompletion = withContext(Dispatchers.IO) {
        val call = http.newCall(
            buildRawRequest(
                baseUrl, apiKey, model, thinking, wire, stream = false, tools = true,
                systemPrompt = systemPrompt, providerId = providerId,
            ),
        )
        currentCoroutineContext()[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { res ->
                val body = res.body?.string() ?: ""
                if (!res.isSuccessful) throw ProviderHttpError(res.code, "chat failed: ${res.code}")
                parseCompleteBody(body)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ProviderHttpError) {
            throw e
        } catch (e: Exception) {
            if (currentCoroutineContext()[Job]?.isActive == false) throw CancellationException("Reply stopped.")
            throw e
        }
    }

    /**
     * GET {baseUrl}/models → model ids (Model picker Refresh parity).
     * Throws ProviderHttpError on HTTP errors; garbage bodies yield an
     * empty list, never a throw.
     */
    suspend fun listModels(baseUrl: String, apiKey: String): List<String> = withContext(Dispatchers.IO) {
        // Auth header only when a key exists: keyless /models endpoints
        // 401 on a dangling empty Bearer token.
        val req = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/models")
            .get()
        if (apiKey.isNotBlank()) req.header("Authorization", "Bearer $apiKey")
        val call = http.newCall(req.build())
        currentCoroutineContext()[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { res ->
                val body = res.body?.string() ?: ""
                if (!res.isSuccessful) throw ProviderHttpError(res.code, "models failed: ${res.code}")
                parseModelIds(body)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: ProviderHttpError) {
            throw e
        } catch (e: Exception) {
            if (currentCoroutineContext()[Job]?.isActive == false) throw CancellationException("Refresh stopped.")
            throw e
        }
    }

    companion object {
        fun parseDelta(data: String): String = parseStreamEvent(data).first

        /** Model ids off a GET /models body. Never throws. */
        fun parseModelIds(body: String): List<String> = try {
            Json.parseToJsonElement(body).jsonObject
                .get("data")?.jsonArray?.mapNotNull { el ->
                    runCatching { el.jsonObject["id"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                } ?: emptyList()
        } catch (_: Exception) {
            emptyList()
        }

        /** One accumulated tool-call fragment off an SSE delta. */
        data class StreamCallDelta(val index: Int, val id: String, val name: String, val args: String)

        /** Text delta plus tool-call fragments off one SSE data frame. Never throws. */
        fun parseStreamEvent(data: String): Pair<String, List<StreamCallDelta>> = try {
            val delta = Json.parseToJsonElement(data).jsonObject
                .get("choices")?.jsonArray?.firstOrNull()?.jsonObject
                ?.get("delta")?.jsonObject ?: return "" to emptyList()
            val text = delta["content"]?.jsonPrimitive?.contentOrNull ?: ""
            val calls = delta["tool_calls"]?.jsonArray?.mapIndexedNotNull { i, el ->
                val obj = el.jsonObject
                val fn = obj["function"]?.jsonObject
                StreamCallDelta(
                    index = obj["index"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: i,
                    id = obj["id"]?.jsonPrimitive?.contentOrNull ?: "",
                    name = fn?.get("name")?.jsonPrimitive?.contentOrNull ?: "",
                    args = fn?.get("arguments")?.jsonPrimitive?.contentOrNull ?: "",
                )
            } ?: emptyList()
            text to calls
        } catch (_: Exception) {
            "" to emptyList()
        }

        /** Content plus tool calls off a non-streaming chat body. Never throws. */
        fun parseCompleteBody(body: String): ChatCompletion = try {
            val message = Json.parseToJsonElement(body).jsonObject
                .get("choices")?.jsonArray?.firstOrNull()?.jsonObject
                ?.get("message")?.jsonObject ?: return ChatCompletion("")
            val content = message["content"]?.jsonPrimitive?.contentOrNull ?: ""
            val calls = message["tool_calls"]?.jsonArray?.mapNotNull { el ->
                try {
                    val obj = el.jsonObject
                    val fn = obj["function"]?.jsonObject ?: return@mapNotNull null
                    WireToolCall(
                        id = obj["id"]?.jsonPrimitive?.content ?: return@mapNotNull null,
                        name = fn["name"]?.jsonPrimitive?.content ?: "",
                        arguments = fn["arguments"]?.jsonPrimitive?.contentOrNull ?: "",
                    )
                } catch (_: Exception) {
                    null
                }
            } ?: emptyList()
            ChatCompletion(content, toolCalls = calls)
        } catch (_: Exception) {
            ChatCompletion("")
        }

        private fun escapeJson(s: String): String =
            s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")

        private fun renderJson(v: Any?): String? = when (v) {
            null -> null
            is String -> "\"${escapeJson(v)}\""
            is Boolean, is Number -> v.toString()
            is Map<*, *> -> "{" + v.entries.mapNotNull { (k, vv) ->
                renderJson(vv)?.let { "\"${escapeJson(k.toString())}\":$it" }
            }.joinToString(",") + "}"
            is List<*> -> "[" + v.mapNotNull { renderJson(it) }.joinToString(",") + "]"
            else -> "\"${escapeJson(v.toString())}\""
        }

        private fun buildJson(map: Map<String, Any?>): String {
            val parts = map.entries.mapNotNull { (k, v) ->
                renderJson(v)?.let { "\"${escapeJson(k)}\":$it" }
            }
            return "{${parts.joinToString(",")}}"
        }
    }
}

/** Map domain messages to wire format (images omitted in v1; tracked for later). */
fun ChatMsg.toWire(): Map<String, String> = mapOf(
    "role" to when (role) {
        ChatMsg.Role.USER -> "user"
        ChatMsg.Role.ASSISTANT -> "assistant"
    },
    "content" to content,
)
