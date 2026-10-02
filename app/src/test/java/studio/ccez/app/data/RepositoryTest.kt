package studio.ccez.app.data

import org.junit.Assert.*
import org.junit.Test
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg

class RepositoryTest {
    @Test fun `snapshot drops sending flags`() {
        val repo = ChatRepository()
        val chat = repo.newChat()
        repo.update { s -> studio.ccez.app.domain.markSending(s, chat.id, true) }
        assertTrue(repo.current().sending)
        val (chats, active) = repo.snapshot()
        assertEquals(1, chats.size)
        assertEquals(chat.id, active)
        repo.replace(repo.current())
        assertFalse(repo.current().sending)
    }

    @Test fun `secretKeyFor namespaces provider keys`() {
        assertEquals("key:muse", secretKeyFor("muse"))
        assertEquals("key:custom-1", secretKeyFor("custom-1"))
    }

    @Test fun `in-memory secrets round trip`() {
        val s = InMemorySecretStore()
        assertNull(s.get("key:muse"))
        s.set("key:muse", "sk-x")
        assertEquals("sk-x", s.get("key:muse"))
        s.clear("key:muse")
        assertNull(s.get("key:muse"))
    }

    @Test fun `sse delta parses content and ignores garbage`() {
        val data = """{"choices":[{"delta":{"content":"hello"}}]}"""
        assertEquals("hello", OpenAiCompatClient.parseDelta(data))
        assertEquals("", OpenAiCompatClient.parseDelta("not json"))
        assertEquals("", OpenAiCompatClient.parseDelta("""{"choices":[]}"""))
    }

    @Test fun `request omits thinking unless known level`() {
        val client = OpenAiCompatClient()
        val base = ChatRequest("https://api.deepseek.com", "k", "m", listOf(mapOf("role" to "user", "content" to "hi")))
        val withLow = client.buildRequest(base.copy(thinking = "low"))
        assertTrue(withLow.url.toString().endsWith("/chat/completions"))
        // Body assertion via tag-free path: unknown level must equal no-level body length.
        val unknownLen = client.buildRequest(base.copy(thinking = "ultra")).body!!.contentLength()
        val noneLen = client.buildRequest(base).body!!.contentLength()
        assertEquals(noneLen, unknownLen)
    }

    @Test fun `wire maps roles`() {
        val m = ChatMsg(role = ChatMsg.Role.USER, content = "hi")
        assertEquals("user", m.toWire()["role"])
    }

    @Test fun `images ride as parts on the last message`() {
        val client = OpenAiCompatClient()
        val req = ChatRequest(
            "https://x", "k", "m",
            listOf(mapOf("role" to "user", "content" to "hi")),
            images = listOf("data:image/jpeg;base64,AAA"),
        )
        val built = client.buildRequest(req)
        val buf = okio.Buffer()
        built.body!!.writeTo(buf)
        val body = buf.readUtf8()
        assertTrue(body.contains("\"type\":\"text\""))
        assertTrue(body.contains("\"type\":\"image_url\""))
        assertTrue(body.contains("data:image/jpeg;base64,AAA"))
    }

    @Test fun `loadChats heals missing active id`() {
        val c = Chat(messages = listOf(ChatMsg(role = ChatMsg.Role.USER, content = "x")))
        val repo = ChatRepository(listOf(c), ChatId("missing"))
        assertEquals(c.id, repo.current().activeChatId)
    }
}
