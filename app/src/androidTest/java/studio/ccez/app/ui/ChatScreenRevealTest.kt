package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.getBoundsInRoot
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatState

/**
 * Hide-until-tapped contract at the screen level: a tap reveals the
 * inline action row for 3s, expiry hides it, re-tapping extends the
 * window, and the text never moves either way.
 */
class ChatScreenRevealTest {
    @get:Rule val rule = createComposeRule()

    private fun show(text: String = "timer probe"): ChatViewModel {
        val vm = ChatViewModel()
        val user = ChatMsg(role = ChatMsg.Role.USER, content = text)
        val chat = Chat(messages = listOf(user))
        vm.repo.replace(ChatState(listOf(chat), chat.id))
        rule.setContent {
            MaterialTheme {
                ChatScreen(vm = vm)
            }
        }
        return vm
    }

    @Test fun tap_reveals_row_and_expiry_hides_it() {
        show()
        rule.onNodeWithContentDescription("Rerun").assertIsNotEnabled()
        rule.onNodeWithText("timer probe").performTouchInput { click() }
        rule.onNodeWithContentDescription("Rerun").assertIsEnabled()
        rule.mainClock.advanceTimeBy(3500)
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Rerun").assertIsNotEnabled()
    }

    @Test fun reveal_does_not_move_message_text() {
        show()
        val before = rule.onNodeWithText("timer probe").getBoundsInRoot()
        rule.onNodeWithText("timer probe").performTouchInput { click() }
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Rerun").assertIsDisplayed()
        val revealed = rule.onNodeWithText("timer probe").getBoundsInRoot()
        assertEquals(before, revealed)
        rule.mainClock.advanceTimeBy(3500)
        rule.waitForIdle()
        val expired = rule.onNodeWithText("timer probe").getBoundsInRoot()
        assertEquals(before, expired)
    }

    @Test fun re_tap_extends_the_reveal_window() {
        show()
        rule.onNodeWithText("timer probe").performTouchInput { click() }
        rule.mainClock.advanceTimeBy(2500)
        // Re-tap before expiry: the window restarts instead of dying
        // on the first tap's schedule.
        rule.onNodeWithText("timer probe").performTouchInput { click() }
        rule.mainClock.advanceTimeBy(2500)
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Rerun").assertIsEnabled()
        rule.mainClock.advanceTimeBy(3500)
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Rerun").assertIsNotEnabled()
    }
}
