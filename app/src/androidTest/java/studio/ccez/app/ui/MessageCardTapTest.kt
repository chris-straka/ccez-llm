package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.doubleClick
import androidx.compose.ui.test.getBoundsInRoot
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.domain.ChatMsg

/**
 * Tapping message text must reveal the inline action row
 * (hide-until-tapped parity): the read-only field consumes the tap's up
 * for focus, so the card reads the press lifecycle instead of the
 * release event. The row lives below the bubble and reveals via opacity
 * only — the text never moves.
 */
class MessageCardTapTest {
    @get:Rule val rule = createComposeRule()

    private fun show(msg: ChatMsg, onTap: () -> Unit, onEnd: () -> Unit = {}) {
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = msg,
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                    showActions = false,
                    onTapMessage = onTap,
                    onMessageEnd = onEnd,
                )
            }
        }
    }

    @Test fun tap_on_text_fires_onTapMessage() {
        var taps = 0
        show(ChatMsg(role = ChatMsg.Role.USER, content = "tap probe"), onTap = { taps++ })
        rule.onNodeWithText("tap probe").assertIsDisplayed()
        rule.onNodeWithText("tap probe").performTouchInput { click() }
        rule.waitForIdle()
        assertEquals(1, taps)
    }

    @Test fun tap_on_card_text_focuses_the_field() {
        show(ChatMsg(role = ChatMsg.Role.USER, content = "focus probe"), onTap = {})
        rule.onNodeWithText("focus probe").performTouchInput { click() }
        rule.waitForIdle()
        rule.onNodeWithText("focus probe").assertIsFocused()
    }

    @Test fun double_tap_on_text_fires_onMessageEnd() {
        var ends = 0
        show(ChatMsg(role = ChatMsg.Role.USER, content = "end probe"), onTap = {}, onEnd = { ends++ })
        rule.onNodeWithText("end probe").performTouchInput { doubleClick() }
        rule.waitForIdle()
        assertEquals(1, ends)
    }

    @Test fun hidden_row_buttons_are_present_but_disabled() {
        show(ChatMsg(role = ChatMsg.Role.USER, content = "hidden probe"), onTap = {})
        rule.waitForIdle()
        // Opacity-zero plus disabled (web pointer-events:none parity):
        // the row reserves its line but takes no taps.
        rule.onNodeWithContentDescription("Rerun").assertIsNotEnabled()
        rule.onNodeWithContentDescription("Copy message").assertIsNotEnabled()
    }

    @Test fun revealing_row_does_not_move_message_text() {
        val actions = mutableStateOf(false)
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(role = ChatMsg.Role.USER, content = "steady probe"),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                    showActions = actions.value,
                    onTapMessage = {},
                    onMessageEnd = {},
                )
            }
        }
        val before = rule.onNodeWithText("steady probe").getBoundsInRoot()
        actions.value = true
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Rerun").assertIsDisplayed()
        val after = rule.onNodeWithText("steady probe").getBoundsInRoot()
        assertEquals(before, after)
    }

    @Test fun inline_rerun_button_fires_onRerun() {
        var reruns = 0
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(role = ChatMsg.Role.USER, content = "rerun probe"),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onRerun = { reruns++ },
                    onSpeak = {},
                    onAnnotate = {},
                    showActions = true,
                    onTapMessage = {},
                    onMessageEnd = {},
                )
            }
        }
        // No ⋯ menu anywhere: the row renders its buttons directly.
        rule.onAllNodesWithContentDescription("Message actions").assertCountEquals(0)
        rule.onNodeWithContentDescription("Rerun").performClick()
        rule.waitForIdle()
        assertEquals(1, reruns)
    }

    @Test fun assistant_row_order_has_no_edit_or_rerun() {
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "assistant probe"),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                    showActions = true,
                    onTapMessage = {},
                    onMessageEnd = {},
                )
            }
        }
        rule.onNodeWithContentDescription("Copy message").assertIsDisplayed()
        rule.onNodeWithContentDescription("Branch from here").assertIsDisplayed()
        rule.onNodeWithContentDescription("Delete message").assertIsDisplayed()
        rule.onNodeWithContentDescription("Read aloud").assertIsDisplayed()
        rule.onAllNodesWithContentDescription("Edit this message").assertCountEquals(0)
        rule.onAllNodesWithContentDescription("Rerun").assertCountEquals(0)
    }
}
