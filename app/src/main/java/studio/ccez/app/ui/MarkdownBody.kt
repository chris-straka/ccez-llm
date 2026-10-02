package studio.ccez.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import studio.ccez.app.domain.MdBlock
import studio.ccez.app.domain.MdInline
import studio.ccez.app.domain.blocksToText
import studio.ccez.app.domain.extractWordAt
import studio.ccez.app.domain.mathCopyText
import studio.ccez.app.domain.parseMessageMarkdown
import studio.ccez.app.domain.quoteMarkRanges

/**
 * Native markdown body: blocks render as Compose (no HTML round-trip,
 * so no sanitizer is needed). Code and math carry copy buttons with
 * the same source-preserving contract as the Tauri renderer.
 */
@Composable
fun MarkdownBody(
    raw: String,
    modifier: Modifier = Modifier,
    onWordSpeak: ((String) -> Unit)? = null,
    markQuotes: List<String> = emptyList(),
    fontScale: Float = 1f,
    /** Reports the highlighted span; selection renders via a read-only field. */
    onSelectionChange: ((String) -> Unit)? = null,
) {
    val context = LocalContext.current
    val (blocks, _) = remember(raw) { parseMessageMarkdown(raw) }
    val base = androidx.compose.material3.LocalTextStyle.current
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.material3.LocalTextStyle provides base.copy(fontSize = base.fontSize * fontScale),
    ) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MdBlock.Para -> InlineText(
                    block.inlines,
                    onWordSpeak = onWordSpeak,
                    markQuotes = markQuotes,
                    onSelectionChange = onSelectionChange,
                )
                is MdBlock.Heading -> {
                    val size = when (block.level) {
                        1 -> 22.sp * fontScale
                        2 -> 20.sp * fontScale
                        else -> 18.sp * fontScale
                    }
                    Text(
                        inlineString(block.inlines, MaterialTheme.colorScheme.primary, 13.sp * fontScale),
                        fontSize = size,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                is MdBlock.Code -> CodeBlock(
                    block.lang,
                    block.code,
                    onCopy = { copyMarkdown(context, block.code) },
                    fontScale = fontScale,
                )
                is MdBlock.Quote -> {
                    Row(Modifier.fillMaxWidth()) {
                        Box(
                            Modifier
                                .padding(end = 8.dp)
                                .background(
                                    MaterialTheme.colorScheme.primary,
                                    RoundedCornerShape(2.dp),
                                ),
                        ) { Text(" ", fontSize = 2.sp * fontScale) }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            block.blocks.forEach { RenderBlock(it, onWordSpeak = onWordSpeak, markQuotes = markQuotes, fontScale = fontScale) }
                        }
                    }
                }
                is MdBlock.Bullets -> {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        block.items.forEach { item ->
                            Row {
                                Text("• ", color = MaterialTheme.colorScheme.primary)
                                Column { item.forEach { RenderBlock(it, onWordSpeak = onWordSpeak, markQuotes = markQuotes, fontScale = fontScale) } }
                            }
                        }
                    }
                }
                is MdBlock.Numbered -> {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        block.items.forEachIndexed { index, item ->
                            Row {
                                Text("${block.start + index}. ", color = MaterialTheme.colorScheme.primary)
                                Column { item.forEach { RenderBlock(it, onWordSpeak = onWordSpeak, markQuotes = markQuotes, fontScale = fontScale) } }
                            }
                        }
                    }
                }
                MdBlock.Hr -> HorizontalDivider(Modifier.padding(vertical = 4.dp))
                is MdBlock.Table -> MarkdownTable(block.headers, block.rows)
                is MdBlock.Math -> MathDisplay(tex = block.tex) {
                    copyMarkdown(context, mathCopyText(block.tex))
                }
            }
        }
    }
    }
}

@Composable
private fun RenderBlock(
    block: MdBlock,
    onCopyCode: () -> Unit = {},
    onWordSpeak: ((String) -> Unit)? = null,
    markQuotes: List<String> = emptyList(),
    fontScale: Float = 1f,
) {
    val context = LocalContext.current
    when (block) {
        is MdBlock.Para -> InlineText(block.inlines, onWordSpeak = onWordSpeak, markQuotes = markQuotes)
        is MdBlock.Heading -> Text(inlineString(block.inlines, MaterialTheme.colorScheme.primary, 13.sp * fontScale), fontWeight = FontWeight.Bold)
        is MdBlock.Code -> CodeBlock(
            block.lang,
            block.code,
            onCopy = { copyMarkdown(context, block.code) },
            fontScale = fontScale,
        )
        is MdBlock.Quote -> Text(blocksToText(block.blocks), fontStyle = FontStyle.Italic)
        is MdBlock.Bullets -> block.items.forEach { item -> item.forEach { RenderBlock(it, onCopyCode) } }
        is MdBlock.Numbered -> block.items.forEach { item -> item.forEach { RenderBlock(it, onCopyCode) } }
        MdBlock.Hr -> HorizontalDivider()
        is MdBlock.Table -> MarkdownTable(block.headers, block.rows)
        is MdBlock.Math -> MathDisplay(tex = block.tex) { copyMarkdown(context, mathCopyText(block.tex)) }
    }
}

@Composable
fun InlineText(
    inlines: List<MdInline>,
    onWordSpeak: ((String) -> Unit)? = null,
    markQuotes: List<String> = emptyList(),
    fontScale: Float = 1f,
    onSelectionChange: ((String) -> Unit)? = null,
) {
    val linkColor = MaterialTheme.colorScheme.primary
    val markColor = MaterialTheme.colorScheme.tertiaryContainer
    // Quote marks (applyMarks parity, static form): quoted spans keep a
    // badge tint over the rendered paragraph text.
    val annotated = remember(inlines, linkColor, markColor, markQuotes, fontScale) {
        val base = inlineString(inlines, linkColor, 13.sp * fontScale)
        if (markQuotes.isEmpty()) base
        else buildAnnotatedString {
            append(base)
            quoteMarkRanges(base.text, markQuotes).forEach { r ->
                addStyle(SpanStyle(background = markColor), r.first, (r.last + 1).coerceAtMost(base.text.length))
            }
        }
    }
    // Highlight path: a read-only field owns its selection and reports
    // the span, so message actions can work on exactly what was held.
    // (The OS floating bar stays stock; ours ride under the bubble.)
    if (onSelectionChange != null) {
        var field by remember(annotated) { mutableStateOf(TextFieldValue(annotated)) }
        BasicTextField(
            value = field,
            onValueChange = { v ->
                field = v
                onSelectionChange(
                    if (v.selection.collapsed) ""
                    else v.annotatedString.text.substring(v.selection.min, v.selection.max),
                )
            },
            readOnly = true,
            textStyle = androidx.compose.material3.LocalTextStyle.current.copy(
                color = androidx.compose.material3.LocalContentColor.current,
            ),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(
                androidx.compose.ui.graphics.Color.Transparent,
            ),
        )
        return
    }
    if (onWordSpeak == null) {
        Text(annotated)
        return
    }
    // Word-tap speech: long-press maps the touch to a layout offset,
    // then to the maximal word run (web right-click parity).
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Text(
        annotated,
        onTextLayout = { layout = it },
        modifier = Modifier.pointerInput(onWordSpeak) {
            detectTapGestures(
                onLongPress = { pos ->
                    val offset = layout?.getOffsetForPosition(pos) ?: return@detectTapGestures
                    val word = extractWordAt(annotated.text, offset)
                    if (word.isNotEmpty()) onWordSpeak(word)
                },
            )
        },
    )
}

fun inlineString(
    inlines: List<MdInline>,
    linkColor: androidx.compose.ui.graphics.Color,
    codeSize: androidx.compose.ui.unit.TextUnit = 13.sp,
): AnnotatedString = buildAnnotatedString {
    fun appendInline(inline: MdInline) {
        when (inline) {
            is MdInline.Text -> append(inline.text)
            is MdInline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                inline.inlines.forEach { appendInline(it) }
            }
            is MdInline.Em -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                inline.inlines.forEach { appendInline(it) }
            }
            is MdInline.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                inline.inlines.forEach { appendInline(it) }
            }
            is MdInline.Code -> withStyle(
                SpanStyle(fontFamily = FiraCode, fontSize = codeSize),
            ) { append(inline.code) }
            is MdInline.Link -> withStyle(
                SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline),
            ) { inline.label.forEach { appendInline(it) } }
            is MdInline.Math -> withStyle(
                SpanStyle(fontFamily = FontFamily.Monospace, fontSize = codeSize),
            ) { append(inline.tex) }
            MdInline.Br -> append("\n")
        }
    }
    inlines.forEach { appendInline(it) }
}

@Composable
fun CodeBlock(lang: String, code: String, onCopy: () -> Unit, fontScale: Float = 1f) {
    Column(
        Modifier
            .fillMaxWidth()
            // Code pans never fold (desktop parity): horizontal strokes
            // are claimed here so the message fold stands down.
            .swipeTrap()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                lang.ifBlank { "code" },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            TextButton(onClick = onCopy) { Text("Copy") }
        }
        Text(
            code,
            fontFamily = FiraCode,
            fontSize = 13.sp * fontScale,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/** Display math: centered TeX card with copy (typeset KaTeX stays a TODO). */
@Composable
fun MathDisplay(tex: String, onCopy: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            // Latex pans never fold (desktop parity): see CodeBlock.
            .swipeTrap()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(10.dp))
            .padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            tex,
            fontFamily = FontFamily.Monospace,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("TeX", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onCopy) { Text("Copy") }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MarkdownTable(headers: List<String>, rows: List<List<String>>) {
    Column(Modifier.fillMaxWidth()) {
        FlowRow {
            headers.forEach { Text(it, fontWeight = FontWeight.Bold, modifier = Modifier.padding(end = 12.dp)) }
        }
        HorizontalDivider()
        rows.forEach { row ->
            FlowRow {
                row.forEach { Text(it, modifier = Modifier.padding(end = 12.dp)) }
            }
        }
    }
}
