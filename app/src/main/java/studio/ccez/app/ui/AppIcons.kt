package studio.ccez.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Tauri ActionIcon set, ported path-for-path (16x16 viewBox, 1.6px
 * rounded strokes). Rects/circles from the SVG source are rewritten
 * as equivalent path strings; rendering follows the local content
 * color exactly like the currentColor originals.
 */
private fun lineIcon(name: String, vararg d: String): ImageVector {
    val builder = ImageVector.Builder(name, 16.dp, 16.dp, 16f, 16f)
    d.forEach { data ->
        builder.addPath(
            pathData = PathParser().parsePathString(data).toNodes(),
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 1.6f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
        )
    }
    return builder.build()
}

val FoldIcon: ImageVector by lazy { lineIcon("fold", "M4 6l4 4 4-4") }

val CopyIcon: ImageVector by lazy {
    lineIcon(
        "copy",
        "M7.5 6h4A1.5 1.5 0 0 1 13 7.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 6 11.5v-4A1.5 1.5 0 0 1 7.5 6z",
        "M9.5 6V4.2A1.2 1.2 0 0 0 8.3 3H4.2A1.2 1.2 0 0 0 3 4.2v4.1a1.2 1.2 0 0 0 1.2 1.2H6",
    )
}

val BranchIcon: ImageVector by lazy {
    lineIcon("branch", "M2.5 12.5h7v-6", "M6.8 6.7L9.5 4l2.7 2.7")
}

val SpeakIcon: ImageVector by lazy {
    lineIcon(
        "speak",
        "M2.5 6v4h2.3L9 13.3V2.7L4.8 6H2.5z",
        "M11 6.2a3 3 0 0 1 0 3.6",
        "M12.8 4.4a5.6 5.6 0 0 1 0 7.2",
    )
}

val DeleteIcon: ImageVector by lazy {
    lineIcon(
        "delete",
        "M2.5 4.5h11",
        "M6.5 4.5V2.8h3v1.7",
        "M4 4.5l.75 7.9a1.5 1.5 0 0 0 1.5 1.3h3.5a1.5 1.5 0 0 0 1.5-1.3L12 4.5",
        "M6.8 7.2v3.6M9.2 7.2v3.6",
    )
}

val RerunIcon: ImageVector by lazy {
    lineIcon("rerun", "M13.5 8a5.5 5.5 0 1 1-1.7-4", "M13.7 1.4v3.1h-3.1")
}

val CloseIcon: ImageVector by lazy { lineIcon("close", "M4 4l8 8M12 4l-8 8") }

/**
 * Paper plane pointing up: symmetric about the vertical axis, so it
 * centers optically in the round send button (the diagonal feather
 * read as riding top-right). Same 16-grid line language.
 */
val SendIcon: ImageVector by lazy {
    lineIcon(
        "send",
        "M8 1.8L13.6 14.2L8 11.4L2.4 14.2L8 1.8z",
        "M8 3.2V11",
    )
}

val MicIcon: ImageVector by lazy {
    lineIcon(
        "mic",
        "M6 3.5v3a2 2 0 0 0 4 0v-3a2 2 0 0 0-4 0z",
        "M4 8.5a4 4 0 0 0 8 0",
        "M8 12.5v2",
        "M6 14.5h4",
    )
}

val AttachIcon: ImageVector by lazy {
    lineIcon(
        "attach",
        "M14.3 7.4l-6.1 6.1a4 4 0 0 1-5.7-5.7l5.7-5.7a2.7 2.7 0 0 1 3.8 3.8l-5.7 5.7a1.3 1.3 0 0 1-1.9-1.9l5.7-5.6",
    )
}

val PasteIcon: ImageVector by lazy {
    lineIcon(
        "paste",
        "M6 4.5V3.2A1.2 1.2 0 0 1 7.2 2h3.6a1.2 1.2 0 0 1 1.2 1.2v1.3",
        "M6 4.5h5.5A1.5 1.5 0 0 1 13 6v6.5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 12.5V6A1.5 1.5 0 0 1 6 4.5z",
        "M6.5 8.5h4M6.5 11h2.5",
    )
}

val PencilIcon: ImageVector by lazy {
    lineIcon(
        "pencil",
        "M11.3 2.2a1.9 1.9 0 0 1 2.7 2.7L5.2 13.7 2 14.2l.5-3.2L11.3 2.2z",
        "M9.8 3.7l2.7 2.7",
    )
}

val JumpIcon: ImageVector by lazy {
    lineIcon(
        "jump",
        "M8 14.2S3.8 9.9 3.8 6.4a4.2 4.2 0 0 1 8.4 0c0 3.5-4.2 7.8-4.2 7.8z",
        "M9.5 6.2a1.5 1.5 0 1 1-3 0 1.5 1.5 0 1 1 3 0z",
    )
}

val MarkIcon: ImageVector by lazy {
    lineIcon(
        "mark",
        "M9.7 2.3l4 4L7.2 12.8l-4.4 1.2 1.2-4.4 6.7-7.3z",
        "M8.2 3.8l4 4",
    )
}

val ExportIcon: ImageVector by lazy {
    lineIcon(
        "export",
        "M8 2v8.5",
        "M5 7.2L8 10.2l3-3",
        "M2.5 11.5v1.3a1.2 1.2 0 0 0 1.2 1.2h8.6a1.2 1.2 0 0 0 1.2-1.2v-1.3",
    )
}

/** Overflow dots (no Tauri equivalent; same 16-grid line language). */
val MoreIcon: ImageVector by lazy {
    ImageVector.Builder("more", 16.dp, 16.dp, 16f, 16f).apply {
        listOf(3.5f, 8f, 12.5f).forEach { cx ->
            addPath(
                pathData = PathParser().parsePathString(
                    "M${cx + 1.3f} 8a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0z",
                ).toNodes(),
                fill = SolidColor(Color.Black),
            )
        }
    }.build()
}

/**
 * Glyph icon following the local content color (currentColor parity).
 * Fixed 20dp frame matches the 16-grid line weight on phone screens.
 */
@Composable
fun Glyph(
    icon: ImageVector,
    description: String?,
    modifier: Modifier = Modifier,
    tint: Color = androidx.compose.material3.LocalContentColor.current,
    iconSize: Dp = 20.dp,
) {
    Image(
        painter = rememberVectorPainter(icon),
        contentDescription = description,
        colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(tint),
        modifier = modifier.size(iconSize),
    )
}
