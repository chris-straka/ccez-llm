package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class ChatTest {
    @Test fun `estimateTokens rounds up at 4 chars per token`() {
        assertEquals(0, estimateTokens(0))
        assertEquals(1, estimateTokens(1))
        assertEquals(1, estimateTokens(4))
        assertEquals(2, estimateTokens(5))
    }

    @Test fun `retryable only when error set`() {
        assertTrue(ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "x", error = "boom").retryable)
        assertFalse(ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "x").retryable)
    }

    @Test fun `missing-key errors are recognized for the settings action`() {
        assertTrue(isMissingKeyError("Missing API key for DeepSeek"))
        assertTrue(isMissingKeyError("Missing API key for Muse"))
        assertFalse(isMissingKeyError("send failed"))
        assertFalse(isMissingKeyError(null))
        assertFalse(isMissingKeyError(""))
    }

    @Test fun `timestampLabel handles today yesterday older`() {
        val now = System.currentTimeMillis()
        assertTrue(timestampLabel(now, now).startsWith("Today"))
        assertTrue(timestampLabel(now - 24 * 3600 * 1000L, now).startsWith("Yesterday"))
        assertFalse(timestampLabel(now - 10L * 24 * 3600 * 1000L, now).contains("Today"))
    }
}

class ProvidersTest {
    @Test fun `builtins resolve and unknown throws`() {
        assertEquals("Muse", getProviderDef("muse").label)
        assertEquals("DeepSeek", getProviderDef("deepseek").label)
        assertEquals("ML Kit (on-device)", getProviderDef("local-mlkit").label)
        assertTrue(getProviderDef("local-mlkit").keyless)
        try {
            getProviderDef("nope")
            fail("expected throw")
        } catch (e: IllegalArgumentException) { /* expected */ }
    }

    @Test fun `local-mlkit visible only on offline android`() {
        assertEquals(listOf("muse", "deepseek", "local-mlkit"), visibleProviderIds(true, true))
        assertEquals(listOf("muse", "deepseek"), visibleProviderIds(true, false))
        assertEquals(listOf("muse", "deepseek"), visibleProviderIds(false, true))
    }

    @Test fun `custom provider validation matches desktop`() {
        assertEquals("Give the provider a name.", validateCustomProvider("  ", "https://x.ai/v1", "m"))
        assertEquals(
            "Base URL must start with http(s)://.",
            validateCustomProvider("X", "ftp://x.ai", "m"),
        )
        assertEquals("Enter a model id.", validateCustomProvider("X", "https://x.ai/v1", "  "))
        assertNull(validateCustomProvider("X", "https://x.ai/v1", "m"))
    }

    @Test fun `custom ids slug and dedupe`() {
        assertEquals("custom-my-proxy", mintCustomProviderId("My Proxy!", emptySet()))
        assertEquals(
            "custom-my-proxy-2",
            mintCustomProviderId("My Proxy!", setOf("custom-my-proxy")),
        )
        assertEquals("custom-provider", mintCustomProviderId("!!!", emptySet()))
    }

    @Test fun `custom def trims and strips slashes`() {
        val def = newCustomProvider("  X  ", "https://x.ai/v1///", "  m  ", emptySet())
        assertEquals("X", def.label)
        assertEquals("https://x.ai/v1", def.defaultBaseUrl)
        assertEquals("m", def.defaultModel)
        assertEquals("API key", def.keyHint)
        assertTrue(def.id.value.startsWith("custom-"))
    }

    @Test fun `thinking normalize drops unknown`() {
        assertNull(ThinkingLevels.normalize(null))
        assertNull(ThinkingLevels.normalize(""))
        assertNull(ThinkingLevels.normalize("ultra"))
        assertEquals("low", ThinkingLevels.normalize("low"))
    }
}

class ChatStoreTest {
    @Test fun `create append edit delete round trip`() {
        var s = emptyState()
        val chat = Chat()
        s = createChat(s, chat)
        assertEquals(chat.id, s.activeChatId)
        val msg = ChatMsg(role = ChatMsg.Role.USER, content = "hello")
        s = appendMessage(s, chat.id, msg)
        assertEquals(1, s.activeChat!!.messages.size)
        s = editMessage(s, chat.id, msg.id, "hi")
        assertEquals("hi", s.activeChat!!.messages.single().content)
        s = deleteMessage(s, chat.id, msg.id)
        assertTrue(s.activeChat!!.messages.isEmpty())
    }

    @Test fun `branch copies prefix with fresh ids`() {
        var s = createChat(emptyState())
        val id = s.activeChatId!!
        val a = ChatMsg(role = ChatMsg.Role.USER, content = "a")
        val b = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "b")
        s = appendMessage(appendMessage(s, id, a), id, b)
        s = branchFrom(s, id, a.id)
        assertEquals(2, s.chats.size)
        assertEquals(listOf("a"), s.activeChat!!.messages.map { it.content })
        assertNotEquals(a.id, s.activeChat!!.messages.single().id)
    }

    @Test fun `rerun keeps the user prefix in place`() {
        var s = createChat(emptyState())
        val id = s.activeChatId!!
        val a = ChatMsg(role = ChatMsg.Role.USER, content = "a")
        val b = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "b")
        val c = ChatMsg(role = ChatMsg.Role.USER, content = "c")
        s = appendMessage(appendMessage(appendMessage(s, id, a), id, b), id, c)
        s = rerunFrom(s, id, a.id)
        assertEquals(listOf("a"), s.activeChat!!.messages.map { it.content })
        assertEquals(a.id, s.activeChat!!.messages.single().id)
    }

    @Test fun `chat stepping walks newest-first neighbors`() {
        val a = Chat()
        val b = Chat()
        val chats = listOf(b, a)
        assertEquals(a.id, stepChatId(chats, b.id, newer = false))
        assertEquals(b.id, stepChatId(chats, a.id, newer = true))
        assertNull(stepChatId(chats, b.id, newer = true))
        assertNull(stepChatId(chats, a.id, newer = false))
        assertNull(stepChatId(chats, ChatId("missing"), newer = true))
    }

    @Test fun `switcher cycle loops around both ends`() {
        val a = Chat()
        val b = Chat()
        val chats = listOf(b, a)
        assertEquals(a.id, cycleChatId(chats, b.id, newer = false))
        assertEquals(a.id, cycleChatId(chats, b.id, newer = true))
        assertEquals(b.id, cycleChatId(chats, a.id, newer = true))
        assertEquals(b.id, cycleChatId(chats, a.id, newer = false))
        assertNull(cycleChatId(chats, ChatId("missing"), newer = true))
        assertNull(cycleChatId(emptyList(), ChatId("missing"), newer = true))
    }

    @Test fun `rerun refuses non-user messages and unknown ids`() {
        var s = createChat(emptyState())
        val id = s.activeChatId!!
        val a = ChatMsg(role = ChatMsg.Role.USER, content = "a")
        val b = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "b")
        s = appendMessage(appendMessage(s, id, a), id, b)
        assertSame(s, rerunFrom(s, id, b.id))
        assertSame(s, rerunFrom(s, id, ChatMsgId("missing")))
        assertSame(s, rerunFrom(s, ChatId("missing"), a.id))
    }

    @Test fun `sending never persists through load`() {
        val c = Chat(messages = listOf(ChatMsg(role = ChatMsg.Role.USER, content = "x")))
        val s = loadChats(listOf(c), c.id)
        assertFalse(s.sending)
        assertEquals(c.id, s.activeChatId)
        val healed = loadChats(listOf(c), ChatId("missing"))
        assertEquals(c.id, healed.activeChatId)
    }

    @Test fun `waypoints page every 20`() {
        assertEquals(emptyList<Int>(), waypoints(0))
        assertEquals(listOf(0), waypoints(1))
        assertEquals(listOf(0, 20, 40), waypoints(45))
    }

    @Test fun `deleteChat lands the neighbor and mints a blank at the end`() {
        var s = createChat(emptyState())
        val first = s.activeChatId!!
        val second = Chat()
        s = createChat(s, second)
        // Background drop never moves the active id.
        s = deleteChat(s, first)
        assertEquals(listOf(second.id), s.chats.map { it.id })
        assertEquals(second.id, s.activeChatId)
        // Last one out mints a blank and activates it (Tauri parity).
        s = deleteChat(s, second.id)
        assertEquals(1, s.chats.size)
        assertEquals(s.chats[0].id, s.activeChatId)
    }

    @Test fun `deleteChat lands the chat below the deleted active one`() {
        var s = emptyState()
        val ids = List(3) { Chat().id }
        ids.forEach { id -> s = createChat(s, Chat(id = id)) }
        // Newest-first: [ids[2], ids[1], ids[0]]; activate the middle.
        s = s.copy(activeChatId = ids[1])
        s = deleteChat(s, ids[1])
        assertEquals(listOf(ids[2], ids[0]), s.chats.map { it.id })
        assertEquals(ids[0], s.activeChatId)
    }

    @Test fun `clearChats wipes to one blank active chat`() {
        var s = createChat(emptyState())
        s = createChat(s, Chat())
        s = clearChats(s)
        assertEquals(1, s.chats.size)
        assertEquals(s.chats[0].id, s.activeChatId)
        assertTrue(s.chats[0].messages.isEmpty())
    }

    @Test fun `toggleFold folds either way and unfolds`() {
        val id = ChatMsgId("m1")
        assertEquals(setOf(id), toggleFold(emptySet(), id))
        assertEquals(emptySet<ChatMsgId>(), toggleFold(setOf(id), id))
    }

    @Test fun `updateChat maps one chat`() {
        var s = createChat(emptyState())
        val id = s.activeChatId!!
        s = updateChat(s, id) { it.copy(replyLang = "ja", voice = true) }
        assertEquals("ja", s.activeChat!!.replyLang)
        assertEquals(true, s.activeChat!!.voice)
        val other = Chat()
        s = createChat(s, other)
        s = updateChat(s, other.id) { it.copy(replyLang = "fr") }
        assertEquals("ja", s.chats.find { it.id == id }!!.replyLang)
    }
}
