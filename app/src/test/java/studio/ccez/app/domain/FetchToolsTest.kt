package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class FetchToolsTest {
    @Test fun `fetchable urls pass the gate`() {
        assertTrue(validFetchUrl("https://example.com/page?q=1"))
        assertTrue(validFetchUrl("http://localhost:1420/"))
        assertFalse(validFetchUrl("file:///etc/passwd"))
        assertFalse(validFetchUrl("javascript:alert(1)"))
        assertFalse(validFetchUrl("https://user:pass@example.com/"))
        assertFalse(validFetchUrl("https://example.com/a b"))
        assertFalse(validFetchUrl(""))
        assertFalse(validFetchUrl("https://"))
        assertFalse(validFetchUrl(null))
        assertFalse(validFetchUrl(42))
        assertFalse(validFetchUrl("x".repeat(MAX_FETCH_URL_CHARS + 1)))
    }

    @Test fun `feed gate spots rss and atom`() {
        assertTrue(looksLikeFeed("<rss version=\"2.0\"><item><title>x</title></item></rss>"))
        assertTrue(looksLikeFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"><entry/></feed>"))
        assertTrue(looksLikeFeed("<?xml version=\"1.0\"?><rss><item/></rss>"))
        assertFalse(looksLikeFeed("<html><body>hello</body></html>"))
    }

    @Test fun `rss items parse with link and description`() {
        val markup = """<rss version="2.0"><channel>
            <item><title>One</title><link>https://a.example/1</link><description>First story</description></item>
            <item><title>No link</title></item>
            <item><link>https://a.example/non-title</link></item>
        </channel></rss>"""
        val items = parseFeedItems(markup)
        assertEquals(2, items.size)
        assertEquals(FeedItem("One", "https://a.example/1", "First story"), items[0])
        assertEquals(FeedItem("No link", "", ""), items[1])
    }

    @Test fun `atom entries parse href links and summaries`() {
        val markup = """<feed xmlns="http://www.w3.org/2005/Atom">
            <entry><title>Two</title><link href="https://b.example/2"/><summary>Second story</summary></entry>
        </feed>"""
        val items = parseFeedItems(markup)
        assertEquals(1, items.size)
        assertEquals(FeedItem("Two", "https://b.example/2", "Second story"), items[0])
    }

    @Test fun `malformed feeds yield nothing, never throw`() {
        assertTrue(parseFeedItems("not xml at all <").isEmpty())
        assertTrue(parseFeedItems("<rss><item><title>Unclosed").isEmpty())
        assertTrue(parseFeedItems("<html><body>hi</body></html>").isEmpty())
    }

    @Test fun `feed items format like the web client`() {
        val text = formatFeedItems(
            listOf(
                FeedItem("One", "https://a.example/1", "First story"),
                FeedItem("No link", "", ""),
            ),
        )
        assertEquals("- One — First story (https://a.example/1)\n- No link", text)
    }

    @Test fun `fetch calls parse off the wire`() {
        assertEquals(
            FetchCall("c1", "https://example.com/x"),
            parseFetchCall("c1", "fetch_url", """{"url":"https://example.com/x"}"""),
        )
        assertNull(parseFetchCall("c1", "other_tool", """{"url":"https://example.com/x"}"""))
        assertNull(parseFetchCall("", "fetch_url", """{"url":"https://example.com/x"}"""))
        assertNull(parseFetchCall("c1", "fetch_url", """{"url":"file:///etc/passwd"}"""))
        assertNull(parseFetchCall("c1", "fetch_url", "not json"))
        assertNull(parseFetchCall("c1", "fetch_url", null))
    }

    @Test fun `html prefers article and drops chrome`() {
        // Line breaks come from literal source whitespace (textContent
        // semantics, like the web client) — never synthetic block breaks.
        val html = "<html><head><style>p{color:red}</style></head><body>" +
            "<nav>menu</nav><header>head</header>" +
            "<article><h1>Title</h1>\n<p>Hello <b>world</b></p><script>alert(1)</script></article>" +
            "<footer>foot</footer></body></html>"
        assertEquals("Title\nHello world", htmlToText(html))
    }

    @Test fun `html falls back to body and collapses whitespace`() {
        val html = "<html><body><p>  a&nbsp;&nbsp; b  </p>\n<p>c</p></body></html>"
        assertEquals("a b\nc", htmlToText(html))
    }

    @Test fun `html with nothing readable is empty`() {
        assertEquals("", htmlToText("<html><body><script>x</script></body></html>"))
        assertEquals("", htmlToText(""))
    }

    @Test fun `host labels shorten urls for progress`() {
        assertEquals("example.com", "https://example.com/page?q=1".hostLabel())
        assertEquals("example.com", "http://example.com".hostLabel())
        assertEquals("a.b:8080", "https://a.b:8080/x".hostLabel())
    }

    @Test fun `tool definition names fetch_url with a url arg`() {
        val def = fetchToolDefinition()
        assertEquals("function", def["type"])
        @Suppress("UNCHECKED_CAST")
        val fn = def["function"] as Map<String, Any?>
        assertEquals("fetch_url", fn["name"])
        @Suppress("UNCHECKED_CAST")
        val params = fn["parameters"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val props = params["properties"] as Map<String, Any?>
        assertTrue(props.containsKey("url"))
    }

    @Test fun `tool wording is invisible plumbing with no example feed urls`() {
        @Suppress("UNCHECKED_CAST")
        val fn = fetchToolDefinition()["function"] as Map<String, Any?>
        val description = fn["description"] as String
        // tools.ts parity: the user doesn't know the tool exists.
        assertTrue(description.contains("doesn't know it exists"))
        // No example feed URLs for the model to parrot back.
        assertFalse(description.contains("http"))
        assertFalse(description.contains("bbc"))
        assertFalse(description.contains("wikipedia"))
        // Feeds are still framed as the route to recent news.
        assertTrue(description.contains("RSS/Atom feeds"))
    }
}
