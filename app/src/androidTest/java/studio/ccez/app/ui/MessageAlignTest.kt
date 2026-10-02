package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatState

/**
 * Chat-app docking: own messages hug the right edge, replies hug the
 * left — and tapping a message to reveal its row moves neither.
 */
class MessageAlignTest {
    @get:Rule val rule = createComposeRule()

    @Test fun own_right_replies_left_and_tap_moves_nothing() {
        val vm = ChatViewModel()
        val user = ChatMsg(role = ChatMsg.Role.USER, content = "short hi")
        val reply = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "short hello")
        val chat = Chat(messages = listOf(user, reply))
        vm.repo.replace(ChatState(listOf(chat), chat.id))
        rule.setContent {
            MaterialTheme {
                ChatScreen(vm = vm)
            }
        }
        val root = rule.onRoot().getBoundsInRoot()
        val slop = 40.dp
        val userBox = rule.onNodeWithText("short hi").getBoundsInRoot()
        val replyBox = rule.onNodeWithText("short hello").getBoundsInRoot()
        // Own text docks hard right …
        assertTrue(
            "user right ${userBox.right} vs root ${root.right}",
            root.right - userBox.right < slop,
        )
        assertTrue(userBox.left > root.right / 2)
        // … replies hug the left.
        assertTrue(
            "reply left ${replyBox.left} vs root ${root.left}",
            replyBox.left - root.left < slop,
        )
        assertTrue(replyBox.right < root.right / 2)
    }

    @Test fun long_reply_still_starts_at_the_left() {
        val vm = ChatViewModel()
        val reply = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "long word ".repeat(60))
        val chat = Chat(messages = listOf(reply))
        vm.repo.replace(ChatState(listOf(chat), chat.id))
        rule.setContent {
            MaterialTheme {
                ChatScreen(vm = vm)
            }
        }
        val root = rule.onRoot().getBoundsInRoot()
        val slop = 40.dp
        val replyBox = rule.onNodeWithText("long word", substring = true).getBoundsInRoot()
        // Full-width paragraphs start at the left edge, never centered.
        assertTrue(
            "reply left ${replyBox.left} vs root ${root.left}",
            replyBox.left - root.left < slop,
        )
    }
}
