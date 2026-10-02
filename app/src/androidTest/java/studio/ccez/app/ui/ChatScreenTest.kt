package studio.ccez.app.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.click
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.MainActivity

class ChatScreenTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    @Test fun composer_shows_token_hint_and_send() {
        rule.onNodeWithText("Type a message").assertIsDisplayed()
        rule.onNodeWithText("What can I do for you?").assertIsDisplayed()
    }

    @Test fun chats_drawer_has_inline_search() {
        rule.onRoot().performTouchInput { swipeRight() }
        rule.onNodeWithText("Search chats").assertIsDisplayed()
        // The drawer Search button is gone; global search is Ctrl+P only.
        rule.onAllNodesWithText("Search").assertCountEquals(0)
    }

    @Test fun swipe_left_opens_settings_and_swipe_right_leaves() {
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Model provider").assertIsDisplayed()
        rule.onRoot().performTouchInput { swipeRight() }
        rule.onNodeWithText("Type a message").assertIsDisplayed()
    }

    @Test fun swipe_left_on_settings_closes() {
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Model provider").assertIsDisplayed()
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Type a message").assertIsDisplayed()
    }

    @Test fun settings_scrim_tap_closes() {
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Model provider").assertIsDisplayed()
        // Tap the exposed scrim strip outside the right-side sheet.
        rule.onRoot().performTouchInput { click(Offset(width * 0.05f, height * 0.4f)) }
        rule.onNodeWithText("Type a message").assertIsDisplayed()
    }

    @Test fun mid_screen_swipe_never_opens_the_list() {
        rule.onRoot().performTouchInput {
            swipe(
                start = Offset(width * 0.4f, height * 0.5f),
                end = Offset(width * 0.8f, height * 0.5f),
                durationMillis = 300,
            )
        }
        // The closed drawer stays composed but off-screen: pin it shut
        // by position, not by node count.
        val search = rule.onNodeWithText("Search chats").fetchSemanticsNode().boundsInRoot
        val sliver = with(rule.density) { 2.dp.toPx() }
        assertTrue(search.right <= sliver)
    }

    @Test fun sheet_swipe_left_folds_the_list() {
        rule.onRoot().performTouchInput { swipeRight() }
        rule.onNodeWithText("Search chats").assertIsDisplayed()
        rule.onNodeWithText("+").performTouchInput { swipeLeft() }
        val search = rule.onNodeWithText("Search chats").fetchSemanticsNode().boundsInRoot
        val sliver = with(rule.density) { 2.dp.toPx() }
        assertTrue(search.right <= sliver)
    }

    @Test fun drawer_buttons_have_breathing_room() {
        rule.onRoot().performTouchInput { swipeRight() }
        rule.onNodeWithText("Search chats").assertIsDisplayed()
        val plus = rule.onNodeWithText("+").fetchSemanticsNode().boundsInRoot
        val settings = rule.onNodeWithText("Settings").fetchSemanticsNode().boundsInRoot
        val gap = with(rule.density) { 8.dp.toPx() }
        assertTrue(settings.top - plus.bottom >= gap - 1f)
    }

    @Test fun settings_version_sits_bottom_center() {
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Model provider").assertIsDisplayed()
        val stamp = rule.onNodeWithTag("versionStamp")
        stamp.performScrollTo()
        fun centerX(bounds: androidx.compose.ui.geometry.Rect) = (bounds.left + bounds.right) / 2f
        val menu = rule.onNodeWithTag("settingsContent").fetchSemanticsNode().boundsInRoot
        val mark = stamp.fetchSemanticsNode().boundsInRoot
        val tolerance = with(rule.density) { 2.dp.toPx() }
        assertTrue(kotlin.math.abs(centerX(mark) - centerX(menu)) <= tolerance)
    }

    @Test fun empty_space_tap_focuses_the_composer() {
        rule.onNodeWithText("What can I do for you?").assertIsDisplayed()
        // Bare hero space above the centered greeting: pills would
        // consume their own taps, this strip reaches the column.
        rule.onNodeWithTag("emptySpace").performTouchInput {
            click(Offset(width * 0.5f, height * 0.08f))
        }
        rule.onNodeWithTag("composerField").assertIsFocused()
    }

    @Test fun hero_lists_language_menus() {
        rule.onNodeWithText("Europe", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Asia", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Africa", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Classics", substring = true).assertIsDisplayed()
    }

    @Test fun settings_lists_providers() {
        rule.onRoot().performTouchInput { swipeLeft() }
        rule.onNodeWithText("Model provider").performScrollTo().assertIsDisplayed()
        // "DeepSeek" appears only on its pill; "Muse" also captions the key row.
        rule.onNodeWithText("DeepSeek", substring = true).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText("Thinking level").performScrollTo().assertIsDisplayed()
    }
}
