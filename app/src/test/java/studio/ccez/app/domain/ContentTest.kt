package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class SearchTest {
    @Test fun `tokenize lowers and splits words`() {
        assertEquals(listOf("hello", "world"), tokenizeText("Hello, world!"))
        assertTrue(tokenizeText("  ").isEmpty())
    }

    @Test fun `snippet centers on first hit`() {
        val text = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do"
        val s = snippetFor(text, listOf("consectetur"), radius = 20)
        assertTrue(s.contains("consectetur"))
        assertTrue(s.startsWith("…") || s.length <= text.length)
    }

    @Test fun `snippet falls back to head without hits`() {
        assertEquals("abcdef", snippetFor("abcdef", listOf("zzz")))
        assertEquals("", snippetFor("   ", listOf("zzz")))
    }

    @Test fun `find bar matches case-insensitively`() {
        assertEquals(listOf(0, 2), findMessageIndices(listOf("Hello", "bye", "HELLO again"), "hello"))
        assertTrue(findMessageIndices(listOf("a"), "  ").isEmpty())
    }

    @Test fun `query ranks exact above partial and enforces AND`() {
        val docs = listOf(
            SearchDoc("c1", "m1", SearchDoc.Kind.MESSAGE, "the quick brown fox"),
            SearchDoc("c1", "m2", SearchDoc.Kind.MESSAGE, "quick recipes"),
        )
        val hits = querySearch(docs, "quick fox")
        assertEquals(1, hits.size)
        assertEquals("m1", hits[0].doc.msgId)
        assertTrue(hits[0].snippet.contains("fox"))
    }

    @Test fun `empty query returns nothing`() {
        assertTrue(querySearch(listOf(SearchDoc("c", null, SearchDoc.Kind.CHAT, "x")), "  ").isEmpty())
    }
}

class ExportTest {
    @Test fun `markdown sections with attachments`() {
        val md = chatToMarkdown(
            listOf(
                ExportMsg("user", "hi", listOf("a.png")),
                ExportMsg("assistant", "hello"),
            ),
        )
        assertTrue(md.contains("## You"))
        assertTrue(md.contains("## Assistant"))
        assertTrue(md.contains("- Attachment: a.png"))
    }

    @Test fun `empty chat and empty message placeholders`() {
        assertTrue(chatToMarkdown(emptyList()).contains("(empty chat)"))
        assertTrue(chatToMarkdown(listOf(ExportMsg("user", "   "))).contains("(no text)"))
    }

    @Test fun `markers strip from export`() {
        val md = chatToMarkdown(listOf(ExportMsg("user", "see $IMAGE_MARKER attached")))
        assertFalse(md.contains(IMAGE_MARKER))
        assertTrue(md.contains("see"))
    }

    @Test fun `filename is a UTC date`() {
        // 2026-09-01T00:00:00Z.
        assertEquals("chat-2026-09-01.md", exportFilename(1788220800000L))
    }
}

class AttachmentTest {
    @Test fun `image tokens scale with tiles`() {
        assertEquals(85 + 170, imageTokens(100, 100))
        assertEquals(85 + 170 * 4, imageTokens(1024, 600))
    }

    @Test fun `fit preserves aspect inside max`() {
        val (w, h) = fitDimensions(4000, 2000)
        assertEquals(IMAGE_MAX_DIM, w)
        assertEquals(784, h)
        assertEquals(100 to 50, fitDimensions(100, 50))
    }

    @Test fun `text detection by mime and extension`() {
        assertTrue(isTextAttachment("a.txt", "application/octet-stream"))
        assertTrue(isTextAttachment("a", "text/plain"))
        assertTrue(isTextAttachment("Main.kt", "application/octet-stream"))
        assertFalse(isTextAttachment("photo.png", "image/png"))
    }

    @Test fun `strip drops marker-only lines`() {
        assertEquals("hi", stripAttachmentMarkers("hi\n$IMAGE_MARKER"))
        assertEquals("a\nb", stripAttachmentMarkers("a\n$FILE_MARKER \nb"))
    }

    @Test fun `file cap and sample size math`() {
        assertEquals("abc", capFileText("abcdef", 3))
        assertEquals("abc", capFileText("abc", 3))
        assertEquals(1, inSampleSizeFor(100, 50))
        assertEquals(1, inSampleSizeFor(1568, 1568))
        assertEquals(2, inSampleSizeFor(1569, 10))
        assertEquals(4, inSampleSizeFor(4000, 2000))
    }

    @Test fun `paste helpers`() {
        assertEquals("[Pasted 12 chars]", pastedLabel(12))
        assertEquals("expand", pasteToggleAction(1, 0))
        assertEquals("collapse", pasteToggleAction(0, 2))
        assertEquals("none", pasteToggleAction(0, 0))
        assertTrue(shouldFoldPaste(101))
        assertFalse(shouldFoldPaste(100))
    }
}
