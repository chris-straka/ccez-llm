package studio.ccez.app.ui

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingSliderTest {
    @Test fun `snaps to the nearest stop`() {
        assertEquals(1.25f, snapToStep(1.26f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(1.25f, snapToStep(1.24f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(0.35f, snapToStep(0.3499999f, 0f, 1.5f, 0.05f), 0.0001f)
    }

    @Test fun `clamps outside the range`() {
        assertEquals(0.5f, snapToStep(0.1f, 0.5f, 8f, 0.05f), 0.0001f)
        assertEquals(8f, snapToStep(9f, 0.5f, 8f, 0.05f), 0.0001f)
    }

    @Test fun `non-positive step only clamps`() {
        assertEquals(1.234f, snapToStep(1.234f, 0.5f, 8f, 0f), 0.0001f)
    }

    @Test fun `fraction maps value across the range`() {
        assertEquals(0f, sliderFraction(0.5f, 0.5f, 8f), 0.0001f)
        assertEquals(1f, sliderFraction(8f, 0.5f, 8f), 0.0001f)
        assertEquals(0.1f, sliderFraction(1.25f, 0.5f, 8f), 0.0001f)
    }

    @Test fun `fraction clamps outside the range`() {
        assertEquals(0f, sliderFraction(0.1f, 0.5f, 8f), 0.0001f)
        assertEquals(1f, sliderFraction(9f, 0.5f, 8f), 0.0001f)
    }

    @Test fun `fraction round-trips through value`() {
        val v = sliderValueAt(0.37f, 0.5f, 8f)
        assertEquals(0.37f, sliderFraction(v, 0.5f, 8f), 0.0001f)
    }

    @Test fun `stop fractions cover the range`() {
        val stops = sliderStopFractions(0f, 1f, 0.25f)
        assertEquals(listOf(0f, 0.25f, 0.5f, 0.75f, 1f), stops)
    }

    @Test fun `dense stops collapse to none`() {
        assertTrue(sliderStopFractions(0.5f, 8f, 0.05f).isEmpty())
        assertTrue(sliderStopFractions(0f, 1f, 0f).isEmpty())
        assertTrue(sliderStopFractions(1f, 1f, 0.1f).isEmpty())
    }

    @Test fun `light palette rides the tauri accent`() {
        val p = ccezSliderPalette(dark = false)
        assertEquals(Color(0xFF007AFF), p.fill)
        assertEquals(Color(0xFFE5E5EA), p.track)
        assertEquals(Color(0xFFFFFFFF), p.thumbFill)
    }

    @Test fun `dark palette rides the tauri dark tokens`() {
        val p = ccezSliderPalette(dark = true)
        assertEquals(Color(0xFF0A84FF), p.fill)
        assertEquals(Color(0xFF38383A), p.track)
        assertEquals(Color(0xFF1C1C1E), p.thumbFill)
    }
}
