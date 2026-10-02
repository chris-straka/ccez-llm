package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class AnnotationsTest {
    private val mid = ChatMsgId("m1")

    @Test fun `blank quotes never list`() {
        assertTrue(addAnnotation(emptyList(), mid, "   ").isEmpty())
        assertEquals(1, addAnnotation(emptyList(), mid, " quote ").size)
    }

    @Test fun `empty comments file like tauri`() {
        // Quote required, comment optional: a comment-less note still lists.
        val list = addAnnotation(emptyList(), mid, "quote", "")
        assertEquals(1, list.size)
        assertEquals("", list[0].comment)
        assertEquals(
            "q\n\nAnnotated selections:\n1. \"quote\" — ?",
            withAnnotations("q", list.map { it.quote to it.comment }),
        )
    }

    @Test fun `duplicate detection needs same span`() {
        val list = addAnnotation(emptyList(), mid, "abc")
        assertNotNull(duplicateAnnotationId(list, mid, "abc"))
        assertNull(duplicateAnnotationId(list, mid, "abd"))
        assertNull(duplicateAnnotationId(list, ChatMsgId("m2"), "abc"))
        assertNull(duplicateAnnotationId(list, mid, "  "))
    }

    @Test fun `tashkeel scope gates badges`() {
        assertTrue(aidMarkVisible(null, false))
        assertFalse(aidMarkVisible("tashkeel", false))
        assertTrue(aidMarkVisible("tashkeel", true))
    }

    @Test fun `bake format matches tauri contract`() {
        assertEquals("prompt", withAnnotations("prompt", emptyList()))
        assertEquals(
            "q\n\nAnnotated selections:\n1. \"a\" — x\n2. \"b\" — ?",
            withAnnotations("q", listOf("a" to "x", "b" to " ")),
        )
        assertEquals("Annotated selections:\n1. \"a\" — ?", withAnnotations("", listOf("a" to "")))
    }

    @Test fun `split round-trips the baked block`() {
        val content = withAnnotations("hello", listOf("q1" to "c1", "q2" to ""))
        val split = splitAnnotationBlock(content)!!
        assertEquals("hello", split.text)
        assertEquals(listOf(AnnotationRef(1, "q1", "c1"), AnnotationRef(2, "q2", "?")), split.refs)
    }

    @Test fun `lookalikes render untouched`() {
        assertNull(splitAnnotationBlock("I typed Annotated selections: by hand"))
        assertNull(splitAnnotationBlock("q\n\nAnnotated selections:\nnot a list"))
    }

    @Test fun `clear and rewrite`() {
        val content = withAnnotations("q", listOf("a" to "x", "b" to "y"))
        assertEquals("q", clearBakedAnnotations(content))
        assertNull(clearBakedAnnotations("plain"))
        assertEquals(
            withAnnotations("q", listOf("a" to "x", "b" to "z")),
            rewriteAnnotationComment(content, 2, "z"),
        )
        assertNull(rewriteAnnotationComment(content, 9, "z"))
    }

    @Test fun `copy redacts blocks`() {
        assertEquals("plain", redactedCopyText("plain"))
        val content = withAnnotations("q", listOf("a" to "x"))
        assertEquals("q", redactedCopyText(content))
        val only = withAnnotations("", listOf("a" to "", "b" to ""))
        assertTrue(isRefsOnly(only))
        assertEquals("a\nb", redactedCopyText(only))
        assertFalse(isRefsOnly(content))
    }

    @Test fun `draft restore drops corrupt entries`() {
        val raw = listOf(
            mapOf("id" to "a1", "messageId" to "m1", "quote" to "q", "comment" to "c"),
            mapOf("id" to "a2", "messageId" to "m1"),
        )
        val clean = cleanDraftList(raw)
        assertEquals(1, clean.size)
        assertEquals("q", clean.single().quote)
    }

    @Test fun `quote marks hit every occurrence`() {
        val marks = quoteMarkRanges("say hello, hello again", listOf("hello"))
        assertEquals(listOf(4..8, 11..15), marks)
    }

    @Test fun `quote marks merge overlaps and skip blanks`() {
        val marks = quoteMarkRanges("abcdef", listOf("abc", "cde", "", "  ", "xyz"))
        assertEquals(listOf(0..4), marks)
    }

    @Test fun `note rewrite replaces quote and comment`() {
        val a = Annotation(messageId = ChatMsgId("m"), quote = "old", comment = "c1")
        val b = Annotation(messageId = ChatMsgId("m"), quote = "keep", comment = "c2")
        val out = editAnnotation(listOf(a, b), a.id, "  new  ", "c3")
        assertEquals(listOf("new", "keep"), out.map { it.quote })
        assertEquals(listOf("c3", "c2"), out.map { it.comment })
        assertEquals(a.id, out[0].id)
    }

    @Test fun `note rewrite refuses blanks and strangers`() {
        val a = Annotation(messageId = ChatMsgId("m"), quote = "old", comment = "c1")
        val start = listOf(a)
        assertSame(start, editAnnotation(start, a.id, "  ", "c3"))
        val again = editAnnotation(start, AnnotationId("nope"), "new", "c3")
        assertEquals(listOf("old"), again.map { it.quote })
    }

    @Test fun `quote marks empty without hits`() {
        assertTrue(quoteMarkRanges("hello", listOf("bye")).isEmpty())
        assertTrue(quoteMarkRanges("hello", emptyList()).isEmpty())
        assertTrue(quoteMarkRanges("", listOf("hello")).isEmpty())
    }
}
