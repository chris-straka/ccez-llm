package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

/**
 * The custom provider form stays collapsed until asked (web
 * <details> parity): name, base URL, and model fields mount only
 * once the toggle opens them.
 */
class CustomProviderCollapseTest {
    @get:Rule val rule = createComposeRule()

    @Test fun custom_provider_form_collapsed_by_default() {
        rule.setContent {
            MaterialTheme {
                SettingsScreen(vm = ChatViewModel(), onBack = {})
            }
        }
        // "Model id" is unique to the custom form (the provider config
        // block above uses "Base URL"/"Model" for the active provider).
        rule.onNodeWithText("Add a custom provider…").assertIsDisplayed()
        rule.onAllNodesWithText("Model id").assertCountEquals(0)
        rule.onNodeWithText("Add a custom provider…").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Model id").assertIsDisplayed()
        rule.onNodeWithText("Hide custom provider form").performClick()
        rule.waitForIdle()
        rule.onAllNodesWithText("Model id").assertCountEquals(0)
    }
}
