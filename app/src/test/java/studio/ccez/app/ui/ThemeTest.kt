package studio.ccez.app.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeTest {
    @Test fun `light scheme wears the tauri tokens`() {
        val s = ccezLightScheme()
        assertEquals(Color(0xFF007AFF), s.primary)
        assertEquals(Color(0xFFFFFFFF), s.background)
        assertEquals(Color(0xFF1C1C1E), s.onBackground)
        assertEquals(Color(0xFFF1F1F4), s.surfaceVariant)
        assertEquals(Color(0xFFC7C7CC), s.outline)
        assertEquals(Color(0xFFE5E5EA), s.outlineVariant)
        assertEquals(Color(0xFF94250A), s.error)
    }

    @Test fun `dark scheme wears the tauri dark tokens`() {
        val s = ccezDarkScheme()
        assertEquals(Color(0xFF0A84FF), s.primary)
        assertEquals(Color(0xFF17171A), s.background)
        assertEquals(Color(0xFFF2F2F7), s.onBackground)
        assertEquals(Color(0xFF1C1C1E), s.surface)
        assertEquals(Color(0xFF2C2C2E), s.surfaceVariant)
        assertEquals(Color(0xFF48484A), s.outline)
        assertEquals(Color(0xFF38383A), s.outlineVariant)
    }

    @Test fun `gap scaling only with the opt-in`() {
        assertEquals(5.6f, scaledMessageGap(5.6f, 4f, false), 0.0001f)
        assertEquals(22.4f, scaledMessageGap(5.6f, 4f, true), 0.0001f)
    }

    @Test fun `pinch zoom multiplies snaps and clamps`() {
        assertEquals(1.2f, zoomFontScale(1f, 1.2f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(0.8f, zoomFontScale(1f, 0.81f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(8f, zoomFontScale(8f, 2f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(0.5f, zoomFontScale(0.5f, 0.5f, 0.5f, 8f, 0.05f), 0.0001f)
    }

    @Test fun `full-bleed trips at the desktop threshold`() {
        assertFalse(isFullBleed(1f))
        assertFalse(isFullBleed(3.29f))
        assertTrue(isFullBleed(3.3f))
        assertTrue(isFullBleed(8f))
    }

    @Test fun `glyph growth is damped and capped`() {
        assertEquals(20f, scaledGlyphDp(20f, 4f, false), 0.0001f)
        assertEquals(36f, scaledGlyphDp(20f, 2f, true), 0.0001f)
        assertEquals(36f, scaledGlyphDp(20f, 8f, true), 0.0001f)
    }

    @Test fun `shapes follow the card rhythm`() {
        assertEquals(RoundedCornerShape(8.dp), CcezShapes.small)
        assertEquals(RoundedCornerShape(12.dp), CcezShapes.medium)
        assertEquals(RoundedCornerShape(12.dp), CcezShapes.large)
    }
}
