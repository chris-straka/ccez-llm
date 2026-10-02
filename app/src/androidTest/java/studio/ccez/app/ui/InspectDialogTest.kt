package studio.ccez.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test
import studio.ccez.app.domain.InspectTables

private const val MINI_UNIHAN = """{
"通":{"d":"go through","m":"tōng","on":"TSUU TSU","kun":"TOORU","t":"10","rs":"162.7"},
"一":{"d":"one","m":"yī","on":"ICHI","kun":"HITOTSU","t":"1","rs":"1.0"}
}"""
private const val MINI_DECOMP = """{"通":["辶","甬"]}"""

class InspectDialogTest {
    @get:Rule val rule = createComposeRule()

    private val tables = InspectTables.load(MINI_UNIHAN, MINI_DECOMP)

    private fun show(
        char: String = "通",
        contextText: String = "这是中文",
        strokes: List<String>? = listOf("M0,0 L109,109", "M0,109 L109,0"),
    ) {
        rule.setContent {
            MaterialTheme {
                InspectDialog(
                    char = char,
                    contextText = contextText,
                    tables = tables,
                    strokes = strokes,
                    onDismiss = {},
                )
            }
        }
    }

    @Test fun overlay_shows_facts_and_steps() {
        show()
        rule.onNodeWithText("Inspect 通").assertIsDisplayed()
        rule.onNodeWithText("Parts: 辶 + 甬").assertIsDisplayed()
        rule.onNodeWithText("Strokes: 10").assertIsDisplayed()
        rule.onNodeWithText("Radical: 辶 + 7").assertIsDisplayed()
        rule.onNodeWithText("Pinyin: tōng").assertIsDisplayed()
        rule.onNodeWithText("1 / 2").assertIsDisplayed()
        rule.onNodeWithText("›").performClick()
        rule.onNodeWithText("2 / 2").assertIsDisplayed()
        rule.onNodeWithText("‹").performClick()
        rule.onNodeWithText("1 / 2").assertIsDisplayed()
        rule.onNodeWithText("KanjiVG", substring = true).assertIsDisplayed()
    }

    @Test fun missing_vectors_show_glyph_standin() {
        show(strokes = null)
        // The font glyph stands in while vectors load; facts still show.
        rule.onNodeWithText("Parts: 辶 + 甬").assertIsDisplayed()
        rule.onNodeWithText("Strokes: 10").assertIsDisplayed()
    }

    @Test fun stepper_clamps_at_the_ends() {
        show()
        // Already at step 1: back is disabled, forward walks once.
        rule.onNodeWithText("›").performClick()
        rule.onNodeWithText("›").performClick()
        rule.onNodeWithText("2 / 2").assertIsDisplayed()
    }
}
