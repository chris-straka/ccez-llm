package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Web parity for the quick switcher: ‹ / › cycle, + mints, the bin
 * deletes — and no Close button exists (tapping away dismisses).
 */
class SwitcherDialogTest {
    @get:Rule val rule = createComposeRule()

    private class Calls {
        var older = 0
        var newer = 0
        var new = 0
        var delete = 0
        var dismiss = 0
    }

    private fun show(calls: Calls = Calls()) {
        rule.setContent {
            MaterialTheme {
                ChatSwitcherDialog(
                    title = "chat title",
                    position = "2 / 5",
                    onOlder = { calls.older++ },
                    onNewer = { calls.newer++ },
                    onNew = { calls.new++ },
                    onDelete = { calls.delete++ },
                    onDismiss = { calls.dismiss++ },
                )
            }
        }
    }

    @Test fun four_buttons_and_no_close() {
        show()
        rule.onNodeWithText("‹").assertIsDisplayed()
        rule.onNodeWithText("›").assertIsDisplayed()
        rule.onNodeWithText("+").assertIsDisplayed()
        rule.onNodeWithContentDescription("Delete chat").assertIsDisplayed()
        rule.onNodeWithText("chat title").assertIsDisplayed()
        rule.onNodeWithText("2 / 5").assertIsDisplayed()
        rule.onAllNodesWithText("Close").assertCountEquals(0)
    }

    @Test fun arrows_new_and_delete_fire() {
        val calls = Calls()
        show(calls)
        rule.onNodeWithText("‹").performClick()
        rule.onNodeWithText("›").performClick()
        rule.onNodeWithText("+").performClick()
        rule.onNodeWithContentDescription("Delete chat").performClick()
        rule.waitForIdle()
        assertEquals(1, calls.older)
        assertEquals(1, calls.newer)
        assertEquals(1, calls.new)
        assertEquals(1, calls.delete)
        assertEquals(0, calls.dismiss)
    }

    @Test fun sideways_swipe_on_title_cycles_without_dismissing() {
        val calls = Calls()
        show(calls)
        rule.onNodeWithTag("switcherTitle").performTouchInput { swipeRight() }
        rule.waitForIdle()
        assertEquals(1, calls.newer)
        rule.onNodeWithTag("switcherTitle").performTouchInput { swipeLeft() }
        rule.waitForIdle()
        assertEquals(1, calls.older)
        assertEquals(0, calls.dismiss)
    }
}
