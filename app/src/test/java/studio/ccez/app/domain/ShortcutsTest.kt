package studio.ccez.app.domain

import org.junit.Assert.*
import androidx.compose.ui.geometry.Offset
import org.junit.Test

class ShortcutsTest {
    @Test fun `gesture table lists only working gestures`() {
        val rows = touchGestures()
        assertEquals(18, rows.size)
        assertEquals(rows.map { it.name }, rows.map { it.name }.sortedBy { it.lowercase() })
        val byName = rows.associateBy { it.name }
        assertEquals("Swipe right from the left edge · two-finger swipe right", byName["Chats list"]!!.gesture)
        assertEquals(
            "Swipe left off messages · chats list button · two-finger swipe left",
            byName["Settings"]!!.gesture,
        )
        assertEquals("Two-finger swipe up", byName["Top of chat"]!!.gesture)
        assertEquals("Two-finger swipe down", byName["Bottom of chat"]!!.gesture)
        assertEquals("Three-finger swipe right / left", byName["Newer / older chat"]!!.gesture)
        assertEquals("Two-finger hold · double-tap background", byName["Chat switcher"]!!.gesture)
        assertEquals("Tap a message · double-tap jumps to its end", byName["Message buttons"]!!.gesture)
        assertEquals("Three-finger tap", byName["Delete a message"]!!.gesture)
        assertEquals("Three-finger hold", byName["Delete every chat"]!!.gesture)
        assertEquals("Swipe a message sideways", byName["Fold a message"]!!.gesture)
        assertEquals("Double two-finger tap", byName["Message end"]!!.gesture)
        assertEquals("Hold the highlight 3.3s · Copy leads the menu", byName["Copy selection"]!!.gesture)
        assertEquals("Select text · Speak", byName["Speak selection"]!!.gesture)
        assertEquals("Select one Han character · Inspect", byName["Inspect character"]!!.gesture)
        assertEquals("Drag it", byName["Move the selection menu"]!!.gesture)
        assertEquals(
            "Scroll freely · only tap-away cancels",
            byName["Keep an annotation while scrolling"]!!.gesture,
        )
        assertNull(byName["Delete current chat"])
    }

    @Test fun `swipe classifier takes the dominant axis past the minimum`() {
        assertEquals(SwipeDir.RIGHT, swipeDirection(100f, 10f, 64f))
        assertEquals(SwipeDir.LEFT, swipeDirection(-100f, -10f, 64f))
        assertEquals(SwipeDir.DOWN, swipeDirection(10f, 100f, 64f))
        assertEquals(SwipeDir.UP, swipeDirection(-10f, -100f, 64f))
    }

    @Test fun `combined travel needs fingers moving together`() {
        assertEquals(SwipeDir.RIGHT, combinedSwipe(listOf(Offset(100f, 5f), Offset(90f, -5f)), 64f))
        assertEquals(SwipeDir.UP, combinedSwipe(listOf(Offset(5f, -100f), Offset(-5f, -90f)), 64f))
    }

    @Test fun `pinches holds and lone fingers route nothing`() {
        assertNull(combinedSwipe(listOf(Offset(100f, 0f), Offset(-100f, 0f)), 64f))
        assertNull(combinedSwipe(listOf(Offset(5f, 5f), Offset(-5f, -5f)), 64f))
        assertNull(combinedSwipe(listOf(Offset(100f, 0f)), 64f))
        assertNull(combinedSwipe(emptyList(), 64f))
    }

    @Test fun `short and diagonal strokes classify nothing`() {
        assertNull(swipeDirection(10f, 10f, 64f))
        assertNull(swipeDirection(63f, 0f, 64f))
        assertNull(swipeDirection(100f, 100f, 64f))
    }

    @Test fun `tap runs count double triple quadruple then cycle`() {
        var seq = nextTapCount(null, 1000, 50f, 50f)
        assertEquals(1, seq.count)
        seq = nextTapCount(seq, 1200, 52f, 51f)
        assertEquals(2, seq.count)
        seq = nextTapCount(seq, 1400, 50f, 50f)
        assertEquals(3, seq.count)
        seq = nextTapCount(seq, 1600, 50f, 50f)
        assertEquals(4, seq.count)
        seq = nextTapCount(seq, 1800, 50f, 50f)
        assertEquals(1, seq.count)
    }

    @Test fun `far or late taps restart the run`() {
        val seq = nextTapCount(null, 1000, 50f, 50f)
        assertEquals(1, nextTapCount(seq, 2000, 50f, 50f).count)
        assertEquals(1, nextTapCount(seq, 1100, 200f, 200f).count)
    }

    @Test fun `content swipes summon the matching panel`() {
        assertEquals(EdgePanel.CHATS, contentSwipeTarget(100f, 500f, 200f, 510f))
        assertEquals(EdgePanel.SETTINGS, contentSwipeTarget(500f, 500f, 400f, 490f))
    }

    @Test fun `short and vertical strokes never qualify`() {
        assertNull(contentSwipeTarget(100f, 500f, 140f, 500f))
        assertNull(contentSwipeTarget(100f, 500f, 300f, 800f))
        assertNull(contentSwipeTarget(100f, 500f, 300f, 500f, minDistance = 500f))
    }

    @Test fun `keys mask to bullets plus last four`() {
        assertEquals("", maskKey("   "))
        assertEquals("••••", maskKey("short"))
        assertEquals("••••", maskKey("12345678"))
        assertEquals("••••wsB0", maskKey("sk-ant-abcwsB0"))
        assertEquals("••••6789", maskKey("  sk-123456789  "))
    }
}
