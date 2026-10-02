package studio.ccez.app.data

import org.junit.Assert.*
import org.junit.Test
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatMsg

class MigrationTest {
    private val tauriFile = """
        {"chats": [
          {"id": "c1", "createdAt": 1000, "messages": [
            {"id": "m1", "role": "user", "content": "hi"},
            {"id": "m2", "role": "assistant", "content": "hello", "usage": {"prompt": 3, "completion": 2, "total": 5}}
          ], "replyLang": "fr", "voice": true},
          {"id": "", "createdAt": 0, "messages": []},
          {"id": "c3", "createdAt": 0, "messages": [
            {"id": "mx", "role": "system", "content": "drop me"},
            {"id": "my", "role": "user", "content": "keep me", "pasteFolds": [{"start": 5, "end": 2, "chars": 9}, {"start": 0, "end": 3, "chars": 9}]}
          ]}
        ], "activeChatId": "c9"}
    """.trimIndent()

    @Test fun `migrates file shape with healing`() {
        val (chats, active) = migrateTauriChats(tauriFile)
        assertEquals(listOf("c1", "c3"), chats.map { it.id.value })
        val c1 = chats[0]
        assertEquals(1000L, c1.createdAt)
        assertEquals("fr", c1.replyLang)
        assertEquals(true, c1.voice)
        assertEquals(ChatMsg.Role.ASSISTANT, c1.messages[1].role)
        assertEquals(5, c1.messages[1].usage?.total)
        // Unknown active id heals to the first chat.
        assertEquals("c1", active?.value)
        // System message dropped, inverted fold dropped, valid fold kept.
        val c3 = chats[1]
        assertEquals(1, c3.messages.size)
        assertEquals(1, c3.messages[0].pasteFolds.size)
        assertEquals(0, c3.messages[0].pasteFolds[0].start)
    }

    @Test fun `migrates bare list shape`() {
        val (chats, active) = migrateTauriChats("""[{"id": "a", "createdAt": 1, "messages": []}]""")
        assertEquals("a", chats.single().id.value)
        assertEquals("a", active?.value)
    }

    @Test fun `garbage never throws`() {
        assertEquals(0, migrateTauriChats("not json").first.size)
        assertEquals(0, migrateTauriChats("""{"nope": true}""").first.size)
    }

    @Test fun `round trip preserves domain`() {
        val chat = Chat(
            messages = listOf(
                ChatMsg(role = ChatMsg.Role.USER, content = "x"),
                ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "y", error = "boom"),
            ),
            replyLang = "de",
        )
        val raw = storeJson.encodeToString(StoredChatFile.serializer(), StoredChatFile(listOf(chat.toStored()), chat.id.value))
        val (back, active) = migrateTauriChats(raw)
        assertEquals(1, back.size)
        assertEquals(chat.id, back[0].id)
        assertEquals("boom", back[0].messages[1].error)
        assertEquals(chat.id, active)
    }

    @Test fun `settings import splits keys and configs`() {
        val json = """
            {"activeProviderId": "deepseek", "voice": true,
             "providers": {
               "muse": {"baseUrl": "https://api.meta.ai/v1", "apiKey": "k1", "model": "muse-spark"},
               "deepseek": {"baseUrl": "https://api.deepseek.com", "apiKey": "", "model": "deepseek-flash"},
               "local-gemma": {"baseUrl": "x", "apiKey": "", "model": "g"}
             }}
        """.trimIndent()
        val imp = migrateTauriSettings(json)!!
        assertEquals(mapOf("muse" to "k1"), imp.keys)
        assertEquals("muse-spark", imp.configs["muse"]?.model)
        assertEquals("deepseek", imp.activeProviderId)
    }

    @Test fun `settings garbage returns null`() {
        assertNull(migrateTauriSettings("nope"))
    }

    @Test fun `legacy local-gemma id migrates to local-mlkit`() {
        assertEquals("local-mlkit", migrateProviderId("local-gemma"))
        assertEquals("muse", migrateProviderId("muse"))
        val json = """
            {"activeProviderId": "local-gemma",
             "providers": {
               "local-gemma": {"baseUrl": "x", "apiKey": "", "model": "g"}
             }}
        """.trimIndent()
        val imp = migrateTauriSettings(json)!!
        assertEquals("local-mlkit", imp.activeProviderId)
        assertEquals("g", imp.configs["local-mlkit"]?.model)
        assertNull(imp.configs["local-gemma"])
    }
}
