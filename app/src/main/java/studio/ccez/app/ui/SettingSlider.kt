package studio.ccez.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Snap a continuous slider position onto discrete [step] stops, clamped to
 * [min]..[max]. Tauri parity: its range inputs step (5% text, 0.05 gap),
 * so stored values stay clean instead of drifting (1.0000001, 0.3499999).
 */
fun snapToStep(value: Float, min: Float, max: Float, step: Float): Float {
    if (step <= 0f) return value.coerceIn(min, max)
    val stops = ((value - min) / step).roundToInt()
    return (min + stops * step).coerceIn(min, max)
}

/** Value position as a 0..1 fraction of [min]..[max] (clamped). */
fun sliderFraction(value: Float, min: Float, max: Float): Float {
    if (max <= min) return 0f
    return ((value - min) / (max - min)).coerceIn(0f, 1f)
}

/** Raw value at a 0..1 [fraction] of [min]..[max] (clamped). */
fun sliderValueAt(fraction: Float, min: Float, max: Float): Float {
    if (max <= min) return min
    return (min + fraction.coerceIn(0f, 1f) * (max - min)).coerceIn(min, max)
}

/**
 * Evenly spaced stop fractions for [min]..[max] at [step]. Empty when the
 * stops would render as a smudge (more than [maxStops]), the step is not
 * positive, or the range is degenerate.
 */
fun sliderStopFractions(min: Float, max: Float, step: Float, maxStops: Int = 24): List<Float> {
    if (step <= 0f || max <= min || maxStops < 2) return emptyList()
    val count = ((max - min) / step).roundToInt()
    if (count < 1 || count > maxStops) return emptyList()
    return List(count + 1) { i -> i.toFloat() / count }
}

/** Fixed Ccez slider paint (Tauri range-input tokens, both themes). */
data class CcezSliderPalette(
    val fill: Color,
    val track: Color,
    val tick: Color,
    val thumbFill: Color,
    val thumbRing: Color,
    val halo: Color,
    val resetBorder: Color,
    val resetText: Color,
)

fun ccezSliderPalette(dark: Boolean): CcezSliderPalette = if (dark) {
    CcezSliderPalette(
        fill = Color(0xFF0A84FF),
        track = Color(0xFF38383A),
        tick = Color(0xFF48484A),
        thumbFill = Color(0xFF1C1C1E),
        thumbRing = Color(0xFF0A84FF),
        halo = Color(0xFF0A84FF).copy(alpha = 0.22f),
        resetBorder = Color(0xFF48484A),
        resetText = Color(0xFFAEAEB2),
    )
} else {
    CcezSliderPalette(
        fill = Color(0xFF007AFF),
        track = Color(0xFFE5E5EA),
        tick = Color(0xFFC7C7CC),
        thumbFill = Color(0xFFFFFFFF),
        thumbRing = Color(0xFF007AFF),
        halo = Color(0xFF007AFF).copy(alpha = 0.14f),
        resetBorder = Color(0xFFC7C7CC),
        resetText = Color(0xFF6E6E73),
    )
}

private val TrackHeight: Dp = 5.dp
private val ThumbDiameter: Dp = 24.dp
private val ThumbRing: Dp = 2.dp
private val HaloDiameter: Dp = 40.dp
private val SliderHitHeight: Dp = 48.dp
/** Fixed thumb slot (halo fades, never pops layout) and rail inset. */
private val ThumbSlot: Dp = HaloDiameter

/**
 * Labeled settings slider: name + bordered reset pill on top, hairline
 * pill track with accent fill and a ringed thumb below, tabular readout
 * at the end. Tauri slider-row parity (label, reset, stepped input,
 * stable readout) with the app's own paint instead of the stock M3
 * thumb. Drag, keys, and screen-reader semantics still ride the M3
 * Slider — only the thumb and track are custom.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingSlider(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    valueRange: ClosedFloatingPointRange<Float>,
    step: Float,
    defaultValue: Float,
    defaultLabel: String,
    valueLabel: String,
    description: String,
    modifier: Modifier = Modifier,
) {
    val dark = MaterialTheme.colorScheme.background.luminance() < 0.5f
    val palette = remember(dark) { ccezSliderPalette(dark) }
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val stops = remember(valueRange, step) {
        sliderStopFractions(valueRange.start, valueRange.endInclusive, step)
    }

    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
            Box(
                modifier = Modifier
                    .border(1.dp, palette.resetBorder, CircleShape)
                    .clip(CircleShape)
                    .clickable(role = Role.Button, onClickLabel = "Reset $label") { onValueChange(defaultValue) }
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(defaultLabel, style = MaterialTheme.typography.labelMedium, color = palette.resetText)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Slider(
                value = value,
                onValueChange = {
                    onValueChange(snapToStep(it, valueRange.start, valueRange.endInclusive, step))
                },
                modifier = Modifier
                    .weight(1f)
                    .height(SliderHitHeight)
                    .semantics { contentDescription = description },
                valueRange = valueRange,
                interactionSource = interaction,
                colors = SliderDefaults.colors(
                    activeTrackColor = Color.Transparent,
                    inactiveTrackColor = Color.Transparent,
                    thumbColor = Color.Transparent,
                    disabledActiveTrackColor = Color.Transparent,
                    disabledInactiveTrackColor = Color.Transparent,
                    disabledThumbColor = Color.Transparent,
                ),
                thumb = {
                    CcezThumb(palette = palette, pressed = pressed)
                },
                track = {
                    CcezTrack(
                        fraction = sliderFraction(value, valueRange.start, valueRange.endInclusive),
                        stops = stops,
                        palette = palette,
                    )
                },
            )
            Text(
                valueLabel,
                style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.End,
                maxLines = 1,
                modifier = Modifier.width(72.dp),
            )
        }
    }
}

/**
 * Ringed dot thumb in a fixed slot: the halo fades instead of popping
 * layout, so M3's thumb placement (measured off this slot) never jumps
 * between rest and press.
 */
@Composable
private fun CcezThumb(palette: CcezSliderPalette, pressed: Boolean) {
    Box(
        Modifier.width(ThumbSlot).height(ThumbSlot),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .background(if (pressed) palette.halo else Color.Transparent, CircleShape)
                .width(HaloDiameter)
                .height(HaloDiameter),
        )
        Box(
            modifier = Modifier
                .shadow(2.dp, CircleShape)
                .background(palette.thumbFill, CircleShape)
                .border(ThumbRing, palette.thumbRing, CircleShape)
                .width(ThumbDiameter)
                .height(ThumbDiameter),
        )
    }
}

/**
 * Hairline pill track: uniform inactive rail, accent fill up to
 * [fraction], stop ticks where they stay legible. The rail insets by
 * half the thumb slot — the same inset M3 uses to seat the thumb —
 * so the fill always lands under the thumb center.
 */
@Composable
private fun CcezTrack(fraction: Float, stops: List<Float>, palette: CcezSliderPalette) {
    Canvas(Modifier.fillMaxWidth().height(SliderHitHeight)) {
        val railY = size.height / 2f
        val startX = (ThumbSlot / 2).toPx()
        val endX = size.width - (ThumbSlot / 2).toPx()
        drawLine(
            color = palette.track,
            start = Offset(startX, railY),
            end = Offset(endX, railY),
            strokeWidth = TrackHeight.toPx(),
        )
        val fillX = startX + fraction * (endX - startX)
        if (fillX > startX) {
            drawLine(
                color = palette.fill,
                start = Offset(startX, railY),
                end = Offset(fillX, railY),
                strokeWidth = TrackHeight.toPx(),
            )
        }
        val tickR = 2.dp.toPx()
        stops.forEach { stop ->
            val x = startX + stop * (endX - startX)
            drawCircle(
                color = if (stop <= fraction) palette.fill else palette.tick,
                radius = tickR,
                center = Offset(x, railY),
            )
        }
    }
}
