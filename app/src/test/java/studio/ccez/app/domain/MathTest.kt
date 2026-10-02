package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class MathTest {
    @Test fun `display math extracts with raw`() {
        val (stripped, maths) = extractMath("Here:\n\n\$\$x^2 + y^2\$\$\n\ndone")
        assertEquals(listOf(MathEntry(MathEntry.Kind.DISPLAY, "x^2 + y^2", "\$\$x^2 + y^2\$\$")), maths)
        assertTrue(MATH_PLACEHOLDER_RE.containsMatchIn(stripped))
        assertFalse(stripped.contains("x^2"))
    }

    @Test fun `inline paren math extracts`() {
        val (_, maths) = extractMath("slope \\(m = \\frac{a}{b}\\) here")
        assertEquals(1, maths.size)
        assertEquals(MathEntry.Kind.INLINE, maths[0].kind)
        assertEquals("m = \\frac{a}{b}", maths[0].tex)
    }

    @Test fun `prices and joins stay literal`() {
        assertEquals("\$5 and \$10", extractMath("\$5 and \$10").first)
        assertEquals("a\$b", extractMath("a\$b").first)
        assertEquals("\$ x\$", extractMath("\$ x\$").first)
        // Bare $ crossing prices never pairs.
        assertEquals(0, extractMath("\$5 … \$10").second.size)
    }

    @Test fun `fences and code spans shield math`() {
        val (stripped, maths) = extractMath("```latex\n\$x^2\$\n```\n\nreal \$y\$")
        assertEquals(1, maths.size)
        assertEquals("y", maths[0].tex)
        assertTrue(stripped.contains("\$x^2\$"))
        val (s2, m2) = extractMath("`\$x\$` and \$y\$")
        assertEquals(1, m2.size)
        assertTrue(s2.contains("`\$x\$`"))
    }

    @Test fun `unclosed display stays literal`() {
        assertEquals("price \$\$5", extractMath("price \$\$5").first)
    }

    @Test fun `latex fence dupes collapse either order`() {
        val src = "```latex\n\$\$x^2\$\$\n```\n\n\$\$x^2\$\$"
        assertEquals("\$\$x^2\$\$", stripLatexFenceDupes(src))
        assertEquals("\$\$x^2\$\$", stripLatexFenceDupes("\$\$x^2\$\$\n\n```latex\n\$\$x^2\$\$\n```"))
        val other = "```latex\n\$\$x^2\$\$\n```\n\n\$\$y^2\$\$"
        assertEquals(other, stripLatexFenceDupes(other))
        assertEquals("\$\$x^2\$\$", stripLatexFenceDupes("```latex\nx^2\n```\n\n\$\$x^2\$\$"))
    }

    @Test fun `copy text keeps delimiters`() {
        assertEquals("\$\$x\$\$", mathCopyText("x", MathEntry.Kind.DISPLAY))
        assertEquals("\$x\$", mathCopyText("x", MathEntry.Kind.INLINE))
        assertEquals("\$\$x\$\$", mathCopyText("x"))
    }

    @Test fun `tex previews truncate to one line`() {
        assertEquals("a + b", mathTexPreview("a + b", 48))
        assertEquals("x ^2", mathTexPreview("x\n^2", 48))
        val long = mathTexPreview("a".repeat(60), 48)
        assertEquals(49, long.codePointCount(0, long.length))
        assertTrue(long.endsWith("…"))
    }

    @Test fun `fold previews prefer override then math then text`() {
        assertEquals("\"quoted\"", foldPreviewText("anything", "\"quoted\""))
        assertEquals("\\(x^2\\)", foldPreviewText("\$\$x^2\$\$", null))
        assertEquals("hello world", foldPreviewText("hello world", null))
        assertEquals("a".repeat(140) + "…", foldPreviewText("a".repeat(200) + "\nsecond", null))
        assertEquals("Sure!…", foldPreviewText("Sure!\nA whole essay follows.", null))
        assertEquals("Done.", foldPreviewText("Done.\n\n", null))
        // Astral-safe: no half surrogate pair before the marker.
        val emoji = foldPreviewText("😀".repeat(200), null)
        assertEquals(141, emoji.codePointCount(0, emoji.length))
        assertTrue(emoji.endsWith("…"))
    }

    @Test fun `fold previews land on the first sentence`() {
        assertEquals(
            "This is a long opening sentence.…",
            foldPreviewText("This is a long opening sentence. And then more follows on the same line.", null),
        )
        assertEquals(
            "これは長いオープニング文です。…",
            foldPreviewText("これは長いオープニング文です。続きがあります。", null),
        )
        assertEquals(
            "Version 3.14 ships today.…",
            foldPreviewText("Version 3.14 ships today. More here.", null),
        )
        // A leading "Mr." is an abbreviation, not a sentence — and a
        // one-sentence first line is not a cut.
        assertEquals("Mr. Smith went home.", foldPreviewText("Mr. Smith went home.", null))
    }

    @Test fun `firstSentence honors terminators and the stub floor`() {
        assertEquals("Hello there.", firstSentence("Hello there. looking good"))
        assertEquals("はい。これはテストです。", firstSentence("はい。これはテストです。x"))
        assertNull(firstSentence("no boundary here"))
        assertNull(firstSentence("Mr. X"))
        assertEquals("Long enough here!", firstSentence("Long enough here! tail"))
    }
}
