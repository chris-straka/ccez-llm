package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.text.TextRange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.domain.AnnotatedRun
import studio.ccez.app.domain.Annotation
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId

class ComposerTest {
    @get:Rule val rule = createComposeRule()

    private fun show(micEnabled: Boolean) {
        rule.setContent {
            MaterialTheme {
                Composer(
                    draft = "",
                    sending = false,
                    micEnabled = micEnabled,
                    onDraft = {},
                    onSend = {},
                    onStop = {},
                )
            }
        }
    }

    @Test fun mic_button_shows_when_enabled() {
        show(micEnabled = true)
        rule.onNodeWithContentDescription("Dictate into the prompt").assertIsDisplayed()
        rule.onNodeWithContentDescription("Attach images or files").assertIsDisplayed()
    }

    @Test fun mic_button_hides_when_disabled() {
        show(micEnabled = false)
        rule.onAllNodesWithContentDescription("Dictate into the prompt").assertCountEquals(0)
        // The composer itself still works.
        rule.onNodeWithContentDescription("Send").assertIsDisplayed()
    }

    @Test fun reply_badge_rides_the_send_button() {
        rule.setContent {
            MaterialTheme {
                Composer(
                    draft = "hi",
                    sending = false,
                    sendBadge = "🇯🇵",
                    onDraft = {},
                    onSend = {},
                    onStop = {},
                )
            }
        }
        rule.onNodeWithText("🇯🇵").assertIsDisplayed()
        rule.onAllNodesWithText("↑").assertCountEquals(0)
    }
}

class ThinkingStatusTest {
    @get:Rule val rule = createComposeRule()

    private fun show(msg: ChatMsg, thinking: String?) {
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
                    thinking = thinking,
                )
            }
        }
    }

    private fun emptyAssistant() = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "")

    @Test fun thinking_label_speaks_the_reply_language() {
        show(emptyAssistant(), thinking = "考え中")
        rule.onNodeWithText("考え中…").assertIsDisplayed()
    }

    @Test fun empty_reply_without_status_keeps_ellipsis() {
        show(emptyAssistant(), thinking = null)
        rule.onNodeWithText("…").assertIsDisplayed()
    }

    @Test fun streamed_content_replaces_the_status() {
        show(ChatMsg(role = ChatMsg.Role.ASSISTANT, content = "hi"), thinking = "Thinking")
        rule.onNodeWithText("hi").assertIsDisplayed()
        rule.onAllNodesWithText("Thinking…").assertCountEquals(0)
    }
}

@OptIn(ExperimentalTestApi::class)
class SelectionPopupTest {
    @get:Rule val rule = createComposeRule()

    private fun show(content: String, readings: List<AnnotatedRun>? = null) {
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(role = ChatMsg.Role.ASSISTANT, content = content),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                    readingsForSelection = { if (it.isBlank()) null else readings },
                )
            }
        }
    }

    @Test fun selecting_text_summons_the_menu_above() {
        show("hello world")
        rule.onNodeWithText("hello world", substring = true)
            .performTextInputSelection(TextRange(0, 5))
        // Quick highlights get Annotate/Speak/Inspect only; Copy arms
        // after a 3.3s hold (see copy_arms_after_a_held_selection).
        rule.onAllNodesWithText("Copy").assertCountEquals(0)
        rule.onNodeWithText("Annotate").assertIsDisplayed()
        rule.onNodeWithText("Speak").assertIsDisplayed()
    }

    @Test fun copy_arms_after_a_held_selection() {
        rule.mainClock.autoAdvance = false
        show("hello world")
        rule.onNodeWithText("hello world", substring = true)
            .performTextInputSelection(TextRange(0, 5))
        rule.onAllNodesWithText("Copy").assertCountEquals(0)
        rule.mainClock.advanceTimeBy(SELECTION_COPY_HOLD_MS)
        rule.onNodeWithText("Copy").assertIsDisplayed()
    }

    @Test fun clearing_the_selection_dismisses_the_menu() {
        show("hello world")
        val field = rule.onNodeWithText("hello world", substring = true)
        field.performTextInputSelection(TextRange(0, 5))
        rule.onNodeWithText("Annotate").assertIsDisplayed()
        field.performTextInputSelection(TextRange.Zero)
        rule.onAllNodesWithText("Annotate").assertCountEquals(0)
    }

    @Test fun han_selection_shows_word_context_readings_below() {
        show("日本語", readings = listOf(AnnotatedRun("日本語", "にほんご")))
        rule.onNodeWithText("日本語", substring = true)
            .performTextInputSelection(TextRange(0, 3))
        rule.onNodeWithText("Annotate").assertIsDisplayed()
        rule.onNodeWithText("にほんご").assertIsDisplayed()
    }

    @Test fun switcher_shows_title_position_and_four_buttons() {
        var added = false
        var deleted = false
        rule.setContent {
            MaterialTheme {
                ChatSwitcherDialog(
                    title = "chat title",
                    position = "1 / 2",
                    onOlder = {},
                    onNewer = {},
                    onNew = { added = true },
                    onDelete = { deleted = true },
                    onDismiss = {},
                )
            }
        }
        rule.onNodeWithText("chat title").assertIsDisplayed()
        rule.onNodeWithText("1 / 2").assertIsDisplayed()
        rule.onNodeWithText("‹").assertIsDisplayed()
        rule.onNodeWithText("›").assertIsDisplayed()
        rule.onNodeWithText("+").performClick()
        rule.onNodeWithContentDescription("Delete chat").performClick()
        rule.runOnIdle {
            assertEquals(true, added)
            assertEquals(true, deleted)
        }
    }

    @Test fun switcher_stroke_cycles_with_direction() {
        var newer = 0
        var older = 0
        rule.setContent {
            MaterialTheme {
                ChatSwitcherDialog(
                    title = "chat title",
                    position = "1 / 2",
                    onOlder = { older++ },
                    onNewer = { newer++ },
                    onNew = {},
                    onDelete = {},
                    onDismiss = {},
                )
            }
        }
        rule.onNodeWithText("chat title").performTouchInput { swipeRight() }
        rule.runOnIdle { assertEquals(1, newer) }
        rule.onNodeWithText("chat title").performTouchInput { swipeLeft() }
        rule.runOnIdle { assertEquals(1, older) }
    }

    @Test fun note_badges_rewrite_and_pencil_loads() {
        val note = Annotation(messageId = ChatMsgId("m"), quote = "hello", comment = "note!")
        var edited: Annotation? = null
        var penciled: Annotation? = null
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(role = ChatMsg.Role.USER, content = "hello world"),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                    draftNotes = listOf(note),
                    onEditNote = { edited = it },
                    onPencilNote = { penciled = it },
                )
            }
        }
        rule.onNodeWithText("1 note").performClick()
        rule.onNodeWithText("“hello” — note!", substring = true).performClick()
        rule.runOnIdle { assertEquals(note.id, edited?.id) }
        rule.onNodeWithContentDescription("Load note into composer").performClick()
        rule.runOnIdle { assertEquals(note.id, penciled?.id) }
    }

    @Test fun code_pans_never_fold() {
        rule.setContent {
            MaterialTheme {
                MessageCard(
                    msg = ChatMsg(
                        role = ChatMsg.Role.ASSISTANT,
                        content = "Here:\n```kt\nline1\nline2\n```",
                    ),
                    hidden = false,
                    onReveal = {},
                    onDelete = {},
                    onEdit = {},
                    onBranch = {},
                    onRetry = {},
                    onSpeak = {},
                    onAnnotate = {},
                )
            }
        }
        rule.onNodeWithText("line1", substring = true).performTouchInput { swipeLeft() }
        // Still unfolded: the whole block stays on screen.
        rule.onNodeWithText("line2", substring = true).assertIsDisplayed()
    }

    @Test fun kana_selection_shows_no_readings() {
        show("あいう")
        rule.onNodeWithText("あいう", substring = true)
            .performTextInputSelection(TextRange(0, 3))
        rule.onNodeWithText("Annotate").assertIsDisplayed()
        rule.onAllNodesWithText("にほんご").assertCountEquals(0)
    }
}
