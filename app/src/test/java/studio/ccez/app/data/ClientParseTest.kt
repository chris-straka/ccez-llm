package studio.ccez.app.data

import org.junit.Assert.*
import org.junit.Test

class ClientParseTest {
    @Test fun `stream events carry text and tool-call fragments`() {
        val data = """{"choices":[{"delta":{
            "content":"hi",
            "tool_calls":[{"index":0,"id":"c1","function":{"name":"fetch_","arguments":"{\"url\":"}}]
        }}]}"""
        val (text, calls) = OpenAiCompatClient.parseStreamEvent(data)
        assertEquals("hi", text)
        assertEquals(1, calls.size)
        assertEquals(0, calls[0].index)
        assertEquals("c1", calls[0].id)
        assertEquals("fetch_", calls[0].name)
    }

    @Test fun `stream events tolerate missing tool calls`() {
        val (text, calls) = OpenAiCompatClient.parseStreamEvent("""{"choices":[{"delta":{"content":"x"}}]}""")
        assertEquals("x", text)
        assertTrue(calls.isEmpty())
    }

    @Test fun `stream events never throw`() {
        val (aText, aCalls) = OpenAiCompatClient.parseStreamEvent("nope")
        assertEquals("", aText)
        assertTrue(aCalls.isEmpty())
        val (bText, bCalls) = OpenAiCompatClient.parseStreamEvent("""{"choices":[]}""")
        assertEquals("", bText)
        assertTrue(bCalls.isEmpty())
    }

    @Test fun `complete bodies carry content and tool calls`() {
        val body = """{"choices":[{"message":{
            "content":null,
            "tool_calls":[{"id":"c9","type":"function","function":{"name":"fetch_url","arguments":"{\"url\":\"https://e.com\"}"}}]
        }}]}"""
        val done = OpenAiCompatClient.parseCompleteBody(body)
        assertEquals("", done.content)
        assertEquals(1, done.toolCalls.size)
        assertEquals("c9", done.toolCalls[0].id)
        assertEquals("fetch_url", done.toolCalls[0].name)
    }

    @Test fun `complete bodies never throw`() {
        assertEquals("", OpenAiCompatClient.parseCompleteBody("nope").content)
        assertEquals("", OpenAiCompatClient.parseCompleteBody("""{"choices":[]}""").content)
    }

    @Test fun `model ids list off a models body`() {
        // Lenient: a numeric id stringifies rather than dropping the row.
        val body = """{"data":[{"id":"m1"},{"id":"m2"},{"id":7},{"x":1}]}"""
        assertEquals(listOf("m1", "m2", "7"), OpenAiCompatClient.parseModelIds(body))
    }

    @Test fun `model ids never throw`() {
        assertTrue(OpenAiCompatClient.parseModelIds("nope").isEmpty())
        assertTrue(OpenAiCompatClient.parseModelIds("""{"data":[]}""").isEmpty())
        assertTrue(OpenAiCompatClient.parseModelIds("""{}""").isEmpty())
    }
}
