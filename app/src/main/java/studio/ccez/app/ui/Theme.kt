package studio.ccez.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import studio.ccez.app.data.AppSettings

/**
 * Fixed Ccez brand theme (Tauri app.css tokens, not the device dynamic
 * palette): one accent blue per theme, hairline borders, flat washes.
 * Dynamic M3 color read as a different, bubblier app; the native build
 * should wear the same paint as the Tauri Android build.
 */
fun ccezLightScheme(): ColorScheme = lightColorScheme(
    primary = Color(0xFF007AFF),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE5F0FF),
    onPrimaryContainer = Color(0xFF1C1C1E),
    secondaryContainer = Color(0xFFE5F0FF),
    onSecondaryContainer = Color(0xFF1C1C1E),
    tertiaryContainer = Color(0xFFFFF3B0),
    onTertiaryContainer = Color(0xFF1C1C1E),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF1C1C1E),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1C1C1E),
    surfaceVariant = Color(0xFFF1F1F4),
    onSurfaceVariant = Color(0xFF6E6E73),
    surfaceContainerLow = Color(0xFFF1F1F4),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerHighest = Color(0xFFE5E5EA),
    outline = Color(0xFFC7C7CC),
    outlineVariant = Color(0xFFE5E5EA),
    error = Color(0xFF94250A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDECEA),
    onErrorContainer = Color(0xFF94250A),
)

fun ccezDarkScheme(): ColorScheme = darkColorScheme(
    primary = Color(0xFF0A84FF),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF12233D),
    onPrimaryContainer = Color(0xFFF2F2F7),
    secondaryContainer = Color(0xFF12233D),
    onSecondaryContainer = Color(0xFFF2F2F7),
    tertiaryContainer = Color(0xFF7D5615),
    onTertiaryContainer = Color(0xFFF2F2F7),
    background = Color(0xFF17171A),
    onBackground = Color(0xFFF2F2F7),
    surface = Color(0xFF1C1C1E),
    onSurface = Color(0xFFF2F2F7),
    surfaceVariant = Color(0xFF2C2C2E),
    onSurfaceVariant = Color(0xFFAEAEB2),
    surfaceContainerLow = Color(0xFF2C2C2E),
    surfaceContainerLowest = Color(0xFF17171A),
    surfaceContainerHighest = Color(0xFF38383A),
    outline = Color(0xFF48484A),
    outlineVariant = Color(0xFF38383A),
    error = Color(0xFFE89A90),
    onError = Color(0xFF1C1C1E),
    errorContainer = Color(0xFF3D1008),
    onErrorContainer = Color(0xFFFFB4A2),
)

/**
 * Opt-in growth (desktop scale-actions parity): the toggle owns the
 * message gaps (gap × size, so 4x type more than doubles the gap)
 * and the action glyphs (damped like the desktop ramp, capped at 2x).
 */
fun scaledMessageGap(gapDp: Float, fontScale: Float, enabled: Boolean): Float =
    if (enabled) gapDp * fontScale else gapDp

fun scaledGlyphDp(baseDp: Float, fontScale: Float, enabled: Boolean): Float =
    if (enabled) baseDp * (1 + (minOf(fontScale, 2f) - 1) * 0.8f) else baseDp

/** Full-bleed text size (desktop FULLBLEED_FONT_SCALE parity): at and
past it the column goes wide so huge type stays readable; below it
assistant messages shrink-wrap to their text. */
fun isFullBleed(fontScale: Float): Boolean = fontScale >= 3.3f

/** Pinch zoom step (desktop pinch parity): multiplicative, snapped to
the text-size stops and clamped to the persisted bounds. */
fun zoomFontScale(current: Float, factor: Float, min: Float, max: Float, step: Float): Float =
    snapToStep((current * factor).coerceIn(min, max), min, max, step)

/** Tauri card rhythm (8px fields, 12px cards) instead of M3 domes. */
val CcezShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(12.dp),
)

@Composable
fun CcezTheme(mode: AppSettings.ThemeMode = AppSettings.ThemeMode.SYSTEM, content: @Composable () -> Unit) {
    val dark = when (mode) {
        AppSettings.ThemeMode.LIGHT -> false
        AppSettings.ThemeMode.DARK -> true
        AppSettings.ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }
    val scheme = if (dark) ccezDarkScheme() else ccezLightScheme()
    MaterialTheme(colorScheme = scheme, shapes = CcezShapes, content = content)
}
