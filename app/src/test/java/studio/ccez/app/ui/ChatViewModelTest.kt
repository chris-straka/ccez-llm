package studio.ccez.app.ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import studio.ccez.app.device.Dictator
import studio.ccez.app.device.Speaker
import studio.ccez.app.device.VoiceInfo
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatState
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.ServerSocket
import kotlin.concurrent.thread

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val main = StandardTestDispatcher()

    @Before fun setUp() { Dispatchers.setMain(main) }
    @After fun tearDown() { Dispatchers.resetMain() }
    @Test fun `import merges without duplicates`() {
        val vm = ChatViewModel()
        val a = Chat(messages = listOf(ChatMsg(role = ChatMsg.Role.USER, content = "a")))
        val b = Chat(messages = listOf(ChatMsg(role = ChatMsg.Role.USER, content = "b")))
        vm.importChats(listOf(a, b), b.id)
        assertEquals(2, vm.repo.current().chats.size)
        assertEquals(b.id, vm.repo.current().activeChatId)
        vm.importChats(listOf(a), a.id)
        assertEquals(2, vm.repo.current().chats.size)
        assertEquals(a.id, vm.repo.current().activeChatId)
    }

    @Test fun `import of nothing is a no-op`() {
        val vm = ChatViewModel()
        vm.importChats(emptyList(), null)
        assertTrue(vm.repo.current().chats.isEmpty())
    }

    @Test fun `send hold swaps the reply language per chat`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        // Nothing set, nothing stashed: no-op.
        assertEquals(ChatViewModel.ReplySwap.NoOp, vm.swapReplyLangHold(chat.id))
        // Set: stash it and drop to default.
        vm.setReplyLang(chat.id, "ja")
        assertEquals(ChatViewModel.ReplySwap.Applied(null, "ja"), vm.swapReplyLangHold(chat.id))
        assertNull(vm.repo.current().chats.find { it.id == chat.id }?.replyLang)
        // Unset: restore the stash.
        assertEquals(ChatViewModel.ReplySwap.Applied("ja", "ja"), vm.swapReplyLangHold(chat.id))
        assertEquals("ja", vm.repo.current().chats.find { it.id == chat.id }?.replyLang)
    }

    @Test fun `three-finger hold wipe leaves one blank chat`() {
        val vm = ChatViewModel()
        vm.repo.newChat()
        vm.repo.newChat()
        vm.clearChats()
        assertEquals(1, vm.repo.current().chats.size)
        assertEquals(vm.repo.current().chats[0].id, vm.repo.current().activeChatId)
    }

    @Test fun `annotations bake into send text then clear`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        assertEquals("hi", vm.buildSendText(chat.id, "hi"))
        vm.annotate(chat.id, studio.ccez.app.domain.ChatMsgId("m1"), "the quote", "why")
        vm.annotate(chat.id, studio.ccez.app.domain.ChatMsgId("m1"), "  ")
        assertEquals(1, vm.draftAnnotations(chat.id).size)
        assertEquals(
            "hi\n\nAnnotated selections:\n1. \"the quote\" — why",
            vm.buildSendText(chat.id, "hi"),
        )
        vm.unannotate(chat.id, vm.draftAnnotations(chat.id).single().id)
        assertTrue(vm.draftAnnotations(chat.id).isEmpty())
    }

    @Test fun `search docs cover messages and drafts`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        vm.repo.update { s -> studio.ccez.app.domain.appendMessage(s, chat.id, ChatMsg(role = ChatMsg.Role.USER, content = "solar panels")) }
        vm.annotate(chat.id, studio.ccez.app.domain.ChatMsgId("m9"), "lunar tides", "moon")
        val hits = studio.ccez.app.domain.querySearch(vm.searchDocs(), "moon")
        assertEquals(1, hits.size)
        assertEquals(studio.ccez.app.domain.SearchDoc.Kind.ANNOTATION, hits[0].doc.kind)
        assertEquals(1, studio.ccez.app.domain.querySearch(vm.searchDocs(), "solar").size)
    }

    @Test fun `export and tauri import round trip`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        vm.repo.update { s -> studio.ccez.app.domain.appendMessage(s, chat.id, ChatMsg(role = ChatMsg.Role.USER, content = "ping")) }
        val (name, md) = vm.exportMarkdown(chat.id)!!
        assertTrue(name.endsWith(".md"))
        assertTrue(md.contains("## You") && md.contains("ping"))
        assertNull(vm.exportMarkdown(studio.ccez.app.domain.ChatId("missing")))

        val vm2 = ChatViewModel()
        val (chats, keys) = vm2.importTauri(
            """{"chats": [{"id": "t1", "createdAt": 5, "messages": [{"id": "m", "role": "user", "content": "yo"}]}], "activeChatId": "t1"}""",
            """{"activeProviderId": "muse", "providers": {"muse": {"baseUrl": "u", "apiKey": "sekret", "model": "m"}}}""",
        )
        assertEquals(1 to 1, chats to keys)
        assertEquals("t1", vm2.repo.current().activeChatId?.value)
        assertEquals("sekret", vm2.getKey("muse"))
    }

    @Test fun `jump request is single-shot`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        assertNull(vm.consumeJump())
        vm.jumpToChat(chat.id, 3)
        assertEquals(chat.id to 3, vm.consumeJump())
        assertNull(vm.consumeJump())
    }

    @Test fun `chat options store and normalize`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        vm.setReplyLang(chat.id, "ja")
        vm.setChatVoice(chat.id, true)
        assertEquals("ja", vm.repo.current().activeChat!!.replyLang)
        assertEquals(true, vm.repo.current().activeChat!!.voice)
        vm.setReplyLang(chat.id, "  ")
        assertNull(vm.repo.current().activeChat!!.replyLang)
    }

    @Test fun `speak toggles and stops`() {
        val vm = ChatViewModel()
        val msg = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "hi")
        assertNull(vm.speaking.value)
        vm.speak(msg)
        main.scheduler.advanceUntilIdle()
        // FakeSpeaker returns immediately, so speaking already cleared.
        assertNull(vm.speaking.value)
        assertNull(vm.consumeAidError())
    }

    /** VM whose network serves one canned SSE reply per request, held on [gate]. */
    private fun gatedVm(gate: kotlinx.coroutines.CompletableDeferred<Unit>): ChatViewModel {
        val sse = "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n" +
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n"
        val http = okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            kotlinx.coroutines.runBlocking { gate.await() }
            okhttp3.Response.Builder()
                .request(chain.request())
                .protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(sse.toResponseBody("text/event-stream".toMediaType()))
                .build()
        }.build()
        return ChatViewModel(net = studio.ccez.app.data.OpenAiCompatClient(http))
    }

    /** Pump the scheduler until none of [ids] is sending (background threads deliver). */
    private suspend fun settle(vm: ChatViewModel, ids: List<studio.ccez.app.domain.ChatId>) {
        // Real clock: OkHttp delivers on its own threads, which the
        // virtual clock would outrun (10s virtual in microseconds).
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default.limitedParallelism(1)) {
            kotlinx.coroutines.withTimeout(10_000) {
                while (true) {
                    main.scheduler.advanceUntilIdle()
                    if (ids.none { vm.repo.current().sendingChatIds.contains(it) }) break
                    kotlinx.coroutines.delay(50)
                }
            }
        }
    }

    @Test fun `switching chats does not stop the in-flight reply`() =
        kotlinx.coroutines.test.runTest(main) {
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
            val vm = gatedVm(gate)
            vm.setKey("muse", "test-key")
            vm.ensureChat()
            val first = vm.repo.current().activeChatId!!
            vm.setDraft("hi")
            vm.send()
            // Let the send launch and block mid-stream on the gate.
            main.scheduler.advanceUntilIdle()
            // Switch away (and mint a chat) while the reply streams.
            vm.newChat()
            val second = vm.repo.current().chats.first { it.id != first }.id
            vm.selectChat(second)
            assertEquals(second, vm.repo.current().activeChatId)
            gate.complete(Unit)
            settle(vm, listOf(first))
            val a = vm.repo.current().chats.first { it.id == first }
            val reply = a.messages.last { it.role == ChatMsg.Role.ASSISTANT }
            assertEquals("hello", reply.content)
            assertNull(reply.error)
        }

    @Test fun `rerun in another chat does not stop the in-flight reply`() =
        kotlinx.coroutines.test.runTest(main) {
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
            val vm = gatedVm(gate)
            vm.setKey("muse", "test-key")
            vm.ensureChat()
            val first = vm.repo.current().activeChatId!!
            vm.setDraft("hi")
            vm.send()
            main.scheduler.advanceUntilIdle()
            // Second chat with a standing exchange, mid-stream in the first.
            vm.newChat()
            val second = vm.repo.current().chats.first { it.id != first }.id
            val q = ChatMsg(role = ChatMsg.Role.USER, content = "q")
            vm.repo.update { studio.ccez.app.domain.appendMessage(it, second, q) }
            val chatB = vm.repo.current().chats.first { it.id == second }
            vm.rerun(chatB, q.id)
            gate.complete(Unit)
            settle(vm, listOf(first, second))
            val a = vm.repo.current().chats.first { it.id == first }
            val replyA = a.messages.last { it.role == ChatMsg.Role.ASSISTANT }
            assertEquals("hello", replyA.content)
            assertNull(replyA.error)
            val b = vm.repo.current().chats.first { it.id == second }
            val replyB = b.messages.last { it.role == ChatMsg.Role.ASSISTANT }
            assertEquals("hello", replyB.content)
            assertNull(replyB.error)
        }

    @Test fun `stop halts only its own chat`() =
        kotlinx.coroutines.test.runTest(main) {
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
            val vm = gatedVm(gate)
            vm.setKey("muse", "test-key")
            vm.ensureChat()
            val first = vm.repo.current().activeChatId!!
            vm.setDraft("hi")
            vm.send()
            main.scheduler.advanceUntilIdle()
            vm.newChat()
            val second = vm.repo.current().chats.first { it.id != first }.id
            val q = ChatMsg(role = ChatMsg.Role.USER, content = "q")
            vm.repo.update { studio.ccez.app.domain.appendMessage(it, second, q) }
            vm.rerun(vm.repo.current().chats.first { it.id == second }, q.id)
            // Both streams started; stop only the second.
            main.scheduler.advanceUntilIdle()
            vm.stop(second)
            gate.complete(Unit)
            settle(vm, listOf(first, second))
            val a = vm.repo.current().chats.first { it.id == first }
            val replyA = a.messages.last { it.role == ChatMsg.Role.ASSISTANT }
            assertEquals("hello", replyA.content)
            assertNull(replyA.error)
            val b = vm.repo.current().chats.first { it.id == second }
            val replyB = b.messages.last { it.role == ChatMsg.Role.ASSISTANT }
            assertNotNull(replyB.error)
        }

    @Test fun `stop before first run leaves no stranded sending flag`() =
        kotlinx.coroutines.test.runTest(main) {
            val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
            val vm = gatedVm(gate)
            vm.setKey("muse", "test-key")
            vm.ensureChat()
            val first = vm.repo.current().activeChatId!!
            vm.setDraft("hi")
            vm.send()
            main.scheduler.advanceUntilIdle()
            vm.newChat()
            val second = vm.repo.current().chats.first { it.id != first }.id
            val q = ChatMsg(role = ChatMsg.Role.USER, content = "q")
            vm.repo.update { studio.ccez.app.domain.appendMessage(it, second, q) }
            vm.rerun(vm.repo.current().chats.first { it.id == second }, q.id)
            // Stop synchronously: the job never runs, so no shell is
            // appended — but the flag rerun set must still clear.
            vm.stop(second)
            gate.complete(Unit)
            settle(vm, listOf(first, second))
            assertFalse(vm.repo.current().sendingChatIds.contains(second))
            val b = vm.repo.current().chats.first { it.id == second }
            assertTrue(b.messages.none { it.role == ChatMsg.Role.ASSISTANT })
            val a = vm.repo.current().chats.first { it.id == first }
            assertEquals("hello", a.messages.last { it.role == ChatMsg.Role.ASSISTANT }.content)
        }

    @Test fun `scroll memory files restores and prunes per chat`() {
        val vm = ChatViewModel()
        val a = vm.repo.newChat().id
        val b = vm.repo.newChat().id
        // Nothing filed: the top, even for an empty list.
        assertEquals(0 to 0, vm.restoreScroll(a, 30))
        assertEquals(0 to 0, vm.restoreScroll(a, 0))
        // A filed position restores exactly.
        vm.saveScroll(a, 12, 40)
        assertEquals(12 to 40, vm.restoreScroll(a, 30))
        // Clamped to a shrunk list (offset dropped on clamp).
        assertEquals(4 to 0, vm.restoreScroll(a, 5))
        // Negative filings defend to the top.
        vm.saveScroll(b, -3, -9)
        assertEquals(0 to 0, vm.restoreScroll(b, 10))
        // Deleting prunes only that chat; wiping prunes all.
        vm.deleteChat(a)
        assertEquals(0 to 0, vm.restoreScroll(a, 30))
        vm.saveScroll(b, 7, 0)
        vm.clearChats()
        assertEquals(0 to 0, vm.restoreScroll(b, 30))
    }

    @Test fun `send without a key attaches the provider-named error`() {
        val vm = ChatViewModel()
        vm.setProvider("deepseek")
        vm.setDraft("hi")
        vm.send()
        main.scheduler.advanceUntilIdle()
        val chat = vm.repo.current().activeChat!!
        val assistant = chat.messages.last { it.role == ChatMsg.Role.ASSISTANT }
        assertEquals("Missing API key for DeepSeek", assistant.error)
        assertTrue(studio.ccez.app.domain.isMissingKeyError(assistant.error))
    }

    @Test fun `speakWord seeds identification from the message`() {
        val spoken = mutableListOf<Pair<String, String>>()
        val speaker = object : Speaker {
            override suspend fun inventory(): List<VoiceInfo> = emptyList()
            override suspend fun speak(text: String, onWord: (Int, Int) -> Unit, lang: String) {
                spoken.add(text to lang)
            }
            override fun stop() {}
        }
        val vm = ChatViewModel(speaker = speaker)
        val french = "Je ne sais pas où est la gare parce que je suis perdu ici"
        // An ASCII French word in a French message reads French, not the device locale.
        vm.speakWord("bonjour", french)
        main.scheduler.advanceUntilIdle()
        assertEquals(listOf("bonjour" to "fr-FR"), spoken)
        // Without context it keeps the device locale (old behavior).
        vm.speakWord("bonjour")
        main.scheduler.advanceUntilIdle()
        assertEquals("bonjour" to java.util.Locale.getDefault().toLanguageTag(), spoken.last())
        assertNull(vm.consumeAidError())
    }

    @Test fun `drawer delete mints a blank when the last chat goes`() {
        val vm = ChatViewModel()
        val only = vm.repo.newChat()
        vm.deleteChat(only.id)
        val after = vm.repo.current()
        assertEquals(1, after.chats.size)
        assertEquals(after.chats.single().id, after.activeChatId)

        val vm2 = ChatViewModel()
        val first = vm2.repo.newChat()
        val second = vm2.repo.newChat()
        vm2.deleteChat(first.id)
        val kept = vm2.repo.current()
        assertEquals(1, kept.chats.size)
        assertEquals(second.id, kept.activeChatId)
    }

    @Test fun `provider switch rejects unknown ids`() {
        val vm = ChatViewModel()
        assertEquals("muse", vm.providerId.value)
        vm.setProvider("deepseek")
        assertEquals("deepseek", vm.providerId.value)
        vm.setProvider("nope")
        assertEquals("deepseek", vm.providerId.value)
    }

    @Test fun `custom provider add validates and activates`() {
        val vm = ChatViewModel()
        assertEquals("Give the provider a name.", vm.addCustomProvider(" ", "https://x.ai/v1", "m"))
        assertTrue(vm.settings.value.customProviders.isEmpty())
        assertNull(vm.addCustomProvider("Proxy", "https://x.ai/v1/", "mx"))
        val customs = vm.settings.value.customProviders
        assertEquals(1, customs.size)
        assertEquals("custom-proxy", customs[0].id.value)
        assertEquals("https://x.ai/v1", customs[0].defaultBaseUrl)
        assertEquals("custom-proxy", vm.providerId.value)
        assertEquals("https://x.ai/v1", vm.settings.value.providers["custom-proxy"]?.baseUrl)
    }

    @Test fun `custom provider remove falls back to Muse`() {
        val vm = ChatViewModel()
        assertNull(vm.addCustomProvider("Proxy", "https://x.ai/v1", "mx"))
        vm.removeCustomProvider()
        assertTrue(vm.settings.value.customProviders.isEmpty())
        assertNull(vm.settings.value.providers["custom-proxy"])
        assertEquals("muse", vm.providerId.value)
    }

    @Test fun `three-finger step walks chats newest first`() {
        val vm = ChatViewModel()
        val older = vm.repo.newChat()
        val newer = vm.repo.newChat()
        assertEquals(newer.id, vm.repo.current().activeChatId)
        vm.stepChat(newer = false)
        assertEquals(older.id, vm.repo.current().activeChatId)
        vm.stepChat(newer = false)
        assertEquals(older.id, vm.repo.current().activeChatId)
        vm.stepChat(newer = true)
        assertEquals(newer.id, vm.repo.current().activeChatId)
        vm.stepChat(newer = true)
        assertEquals(newer.id, vm.repo.current().activeChatId)
    }

    @Test fun `pending note rewrites in place`() {
        val vm = ChatViewModel()
        val chat = vm.repo.newChat()
        val msg = ChatMsg(role = ChatMsg.Role.USER, content = "hello world")
        vm.annotate(chat.id, msg.id, "hello", "first")
        val ann = vm.annotations.value[chat.id]!!.single()
        vm.editAnnotation(chat.id, ann.id, "hello world", "second")
        val kept = vm.annotations.value[chat.id]!!.single()
        assertEquals(ann.id, kept.id)
        assertEquals("hello world", kept.quote)
        assertEquals("second", kept.comment)
    }

    @Test fun `pinch zoom multiplies snaps and clamps`() {
        val vm = ChatViewModel()
        assertEquals(1f, vm.settings.value.fontScale, 0.0001f)
        vm.pinchZoom(1.2f)
        assertEquals(1.2f, vm.settings.value.fontScale, 0.0001f)
        vm.pinchZoom(0.5f)
        assertEquals(0.6f, vm.settings.value.fontScale, 0.0001f)
        vm.pinchZoom(100f)
        assertEquals(8f, vm.settings.value.fontScale, 0.0001f)
        vm.pinchZoom(0f)
        assertEquals(8f, vm.settings.value.fontScale, 0.0001f)
    }

    @Test fun `switcher cycle wraps around`() {
        val vm = ChatViewModel()
        val older = vm.repo.newChat()
        val newer = vm.repo.newChat()
        vm.cycleChat(newer = true)
        assertEquals(older.id, vm.repo.current().activeChatId)
        vm.cycleChat(newer = false)
        assertEquals(newer.id, vm.repo.current().activeChatId)
    }

    @Test fun `remove ignores builtin providers`() {
        val vm = ChatViewModel()
        vm.setProvider("deepseek")
        vm.removeCustomProvider()
        assertEquals("deepseek", vm.providerId.value)
    }

    /** In-test OpenAI stub: records POST bodies, streams "Stub reply ok.". */
    private class StubServer : Closeable {
        val posts = java.util.Collections.synchronizedList(mutableListOf<String>())
        private val server = ServerSocket(0)
        val port: Int get() = server.localPort
        private val loop = thread(isDaemon = true) {
            while (!server.isClosed) {
                val sock = runCatching { server.accept() }.getOrNull() ?: break
                try {
                    // Byte-exact: Content-Length counts UTF-8 bytes and the
                    // wire body carries multibyte chars, so a char reader
                    // under-reads and deadlocks against the client timeout.
                    val input = sock.getInputStream()
                    fun readLine(): String? {
                        val line = ByteArrayOutputStream()
                        while (true) {
                            val b = input.read()
                            if (b < 0) return if (line.size() == 0) null else line.toString(Charsets.US_ASCII)
                            if (b == '\n'.code) break
                            if (b != '\r'.code) line.write(b)
                        }
                        return line.toString(Charsets.US_ASCII)
                    }
                    var contentLength = 0
                    while (true) {
                        val line = readLine() ?: break
                        if (line.isBlank()) break
                        if (line.startsWith("Content-Length:", ignoreCase = true)) {
                            contentLength = line.substringAfter(":").trim().toInt()
                        }
                    }
                    val body = input.readNBytes(contentLength)
                    posts += body.toString(Charsets.UTF_8)
                    // Same wire shape as the live stub (HTTP/1.0,
                    // close-delimited): Content-Length framing hangs
                    // okhttp-sse here, this parses exactly like prod.
                    val chunks = listOf("Stub ", "reply ", "ok.").joinToString("") {
                        "data: {\"choices\": [{\"delta\": {\"content\": \"$it\"}}]}\n\n"
                    } + "data: [DONE]\n\n"
                    val raw = chunks.toByteArray()
                    val head = "HTTP/1.0 200 OK\r\nContent-Type: text/event-stream\r\n\r\n"
                    sock.getOutputStream().write(head.toByteArray() + raw)
                    sock.getOutputStream().flush()
                } catch (_: Exception) {
                } finally {
                    runCatching { sock.close() }
                }
            }
        }

        override fun close() {
            runCatching { server.close() }
            loop.join(2000)
        }
    }

    private fun stubBackedVm(stub: StubServer, baseUrl: String? = null): ChatViewModel {
        val vm = ChatViewModel()
        assertNull(vm.addCustomProvider("Stub", baseUrl ?: "http://127.0.0.1:${stub.port}/v1", "stub"))
        vm.setKey("custom-stub", "k")
        return vm
    }

    private fun waitForPosts(stub: StubServer, count: Int, timeoutMs: Long = 10_000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (stub.posts.size < count && System.currentTimeMillis() < deadline) {
            Thread.sleep(50)
        }
    }

    /** Terminal reply state: last assistant carries content or an error. */
    private fun lastAssistant(vm: ChatViewModel): ChatMsg? =
        vm.repo.current().chats.singleOrNull()?.messages?.lastOrNull()
            ?.takeIf { it.role == ChatMsg.Role.ASSISTANT }

    private fun waitForReply(vm: ChatViewModel, timeoutMs: Long = 15_000) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val last = lastAssistant(vm)
            if (last != null && (last.content.isNotEmpty() || last.error != null)) return
            Thread.sleep(50)
        }
    }

    @Test fun `rerun regenerates the reply in place via stub`() {
        StubServer().use { stub ->
            val vm = stubBackedVm(stub)
            val user = ChatMsg(role = ChatMsg.Role.USER, content = "hi")
            val failed = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "", error = "boom")
            val chat = Chat(messages = listOf(user, failed))
            vm.repo.replace(ChatState(listOf(chat), chat.id))
            vm.rerun(chat, user.id)
            // The SSE client runs on real IO threads: pump Main to start
            // the launch, wait out the localhost round trip in real time,
            // then pump again to drain the resumed continuation.
            main.scheduler.advanceUntilIdle()
            waitForReply(vm)
            main.scheduler.advanceUntilIdle()
            assertEquals(1, stub.posts.size)
            assertTrue(stub.posts[0].contains("\"content\":\"hi\""))
            assertFalse(stub.posts[0].contains("boom"))
            val msgs = vm.repo.current().chats.single().messages
            assertEquals(2, msgs.size)
            assertEquals(ChatMsg.Role.ASSISTANT, msgs[1].role)
            assertEquals("Stub reply ok.", msgs[1].content)
            assertNull(msgs[1].error)
        }
    }

    @Test fun `rerun ignores non-user messages`() {
        StubServer().use { stub ->
            val vm = stubBackedVm(stub)
            val user = ChatMsg(role = ChatMsg.Role.USER, content = "hi")
            val reply = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "yo")
            val chat = Chat(messages = listOf(user, reply))
            vm.repo.replace(ChatState(listOf(chat), chat.id))
            vm.rerun(chat, reply.id)
            main.scheduler.advanceUntilIdle()
            assertTrue(stub.posts.isEmpty())
            assertEquals(2, vm.repo.current().chats.single().messages.size)
        }
    }

    @Test fun `retry deletes the failure and resends via stub`() {
        StubServer().use { stub ->
            val vm = stubBackedVm(stub)
            val user = ChatMsg(role = ChatMsg.Role.USER, content = "hi")
            val failed = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "", error = "boom")
            val chat = Chat(messages = listOf(user, failed))
            vm.repo.replace(ChatState(listOf(chat), chat.id))
            vm.setDraft("again")
            vm.retry(chat, failed.id)
            main.scheduler.advanceUntilIdle()
            waitForReply(vm)
            main.scheduler.advanceUntilIdle()
            assertEquals(1, stub.posts.size)
            val msgs = vm.repo.current().chats.single().messages
            assertFalse(msgs.any { it.error != null })
            assertEquals("Stub reply ok.", msgs.last().content)
        }
    }

    @Test fun `speak splits into per-locale utterances`() {
        val calls = mutableListOf<Pair<String, String>>()
        val rec = object : Speaker {
            override suspend fun inventory(): List<VoiceInfo> = emptyList()
            override suspend fun speak(text: String, onWord: (Int, Int) -> Unit, lang: String) {
                calls += text to lang
            }
            override fun stop() {}
        }
        val vm = ChatViewModel(speaker = rec)
        vm.speak(ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "Say hello. 你好！"))
        main.scheduler.advanceUntilIdle()
        assertEquals(2, calls.size)
        assertEquals("Say hello.", calls[0].first)
        assertEquals("你好！", calls[1].first)
        assertEquals("zh-CN", calls[1].second)
    }

    @Test fun `dictate maps empty to the no-speech hint`() {
        val vm = ChatViewModel(dictator = Dictator { "" })
        vm.dictate()
        main.scheduler.advanceUntilIdle()
        assertEquals("Didn't catch anything — try again.", vm.aidError.value)
        assertTrue(vm.draft.value.isBlank())
    }

    @Test fun `dictate maps engine codes to hints`() {
        val vm = ChatViewModel(dictator = Dictator { throw RuntimeException("dictation error: 7") })
        vm.dictate()
        main.scheduler.advanceUntilIdle()
        assertEquals("Didn't catch anything — try again.", vm.aidError.value)
    }
}
