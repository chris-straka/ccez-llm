package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class ComposerPolicyTest {
    @Test fun `enter never submits, only the send button does`() {
        assertFalse(composerEnterSubmits())
    }

    @Test fun `empty and first character share the compact default`() {
        assertEquals(1, COMPOSER_MIN_LINES)
        assertEquals(1, composerLineSpan(""))
        // First character never grows the card: still one line.
        assertEquals(composerLineSpan(""), composerLineSpan("x"))
    }

    @Test fun `the card grows only with text lines, up to the cap`() {
        assertEquals(2, composerLineSpan("a\nb"))
        assertEquals(3, composerLineSpan("a\nb\nc"))
        assertEquals(COMPOSER_MAX_LINES, composerLineSpan("1\n2\n3\n4\n5\n6\n7\n8"))
        // A long single line never grows the card; only newlines do.
        assertEquals(1, composerLineSpan("x".repeat(5000)))
    }

    @Test fun `jump button appears only for long threads`() {
        // waypoints() pages every 20: <=3 points (60 messages) shows nothing.
        assertFalse(showComposerJump(0))
        assertFalse(showComposerJump(1))
        assertFalse(showComposerJump(40))
        assertFalse(showComposerJump(60))
        assertTrue(showComposerJump(61))
        assertTrue(showComposerJump(200))
    }

    @Test fun `selection dock shows while text stands, never for blank`() {
        assertTrue(showComposerSelectionActions("日本"))
        assertFalse(showComposerSelectionActions(""))
        assertFalse(showComposerSelectionActions("   "))
    }
}
