package studio.ccez.app.device

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyNotifyTest {
    @Test fun `preview collapses whitespace and truncates`() {
        assertEquals("hello world", replyPreview("  hello\n  world "))
        assertEquals("", replyPreview("   "))
        val long = "x".repeat(200)
        val preview = replyPreview(long)
        assertEquals(160, preview.length)
        assertTrue(preview.endsWith("…"))
    }

    @Test fun `short replies ping too once backgrounded`() {
        assertTrue(shouldNotifyReply(notificationsOn = true, appForeground = false))
        assertFalse(shouldNotifyReply(notificationsOn = true, appForeground = true))
        assertFalse(shouldNotifyReply(notificationsOn = false, appForeground = false))
    }

    @Test fun `ping replaces itself and clears on its own`() {
        assertEquals(4201, REPLY_NOTIFICATION_ID)
        assertEquals(30_000L, REPLY_NOTIFICATION_TIMEOUT_MS)
    }

    @Test fun `foreground flag flips on activity start and stop`() {
        AppForeground.enter()
        assertTrue(AppForeground.isForeground)
        AppForeground.exit()
        assertFalse(AppForeground.isForeground)
        AppForeground.enter()
    }

    @Test fun `noop notifier never throws`() {
        val noop = NoopReplyNotifier()
        noop.notifyReply("Reply ready", "hi")
        noop.cancelReply()
    }
}
