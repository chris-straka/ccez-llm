package studio.ccez.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import studio.ccez.app.domain.InspectTables
import studio.ccez.app.domain.clampStrokeStep
import studio.ccez.app.domain.inspectLangFor
import studio.ccez.app.domain.isHanOverlayLangUncertain
import studio.ccez.app.domain.onKunLine

/**
 * Character Inspect overlay (web Inspect parity): offline Unihan +
 * decomposition facts, on-demand KanjiVG stroke vectors with a manual
 * stepper (never autoplay), JP/中文 reading toggle for ambiguous Han.
 * The font glyph stands in while vectors load; misses keep the
 * schematic preview (count + components). A bottom sheet: on touch
 * there is no right-click anchor, so the card parks below the
 * inspected text instead of covering it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InspectDialog(
    char: String,
    contextText: String,
    tables: InspectTables?,
    strokes: List<String>?,
    onDismiss: () -> Unit,
) {
    val data = remember(char, tables) { tables?.getInspectData(char) }
    var lang by remember(char, contextText) { mutableStateOf(inspectLangFor(char, contextText)) }
    var step by remember(char) { mutableIntStateOf(1) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        // Fully open: a half-docked sheet would strand the facts below
        // the fold. Overflow scrolls inside the sheet.
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Inspect $char", style = MaterialTheme.typography.titleLarge)
                if (isHanOverlayLangUncertain(char)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { lang = "ja" }) {
                            Text(if (lang == "ja") "● 日本語" else "日本語")
                        }
                        TextButton(onClick = { lang = "zh" }) {
                            Text(if (lang == "zh") "● 中文" else "中文")
                        }
                    }
                }
                val paths = strokes
                // Null strokes = still loading (or offline): the font
                // glyph stands in, exactly like the web schematic wait.
                if (!paths.isNullOrEmpty()) {
                    val total = paths.size
                    val shown = clampStrokeStep(step, total)
                    val vectorPaths = remember(paths) {
                        paths.map { d ->
                            runCatching { PathParser().parsePathString(d).toPath() }.getOrNull()
                        }
                    }
                    val stepped = MaterialTheme.colorScheme.primary
                    val rest = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)
                    Canvas(
                        Modifier
                            .size(160.dp)
                            .align(Alignment.CenterHorizontally),
                    ) {
                        scale(size.width / 109f) {
                            vectorPaths.forEachIndexed { i, path ->
                                if (path != null) drawPath(path, if (i < shown) stepped else rest)
                            }
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { step = clampStrokeStep(step - 1, total) }, enabled = step > 1) {
                            Text("‹")
                        }
                        Text("$shown / $total", fontSize = 14.sp)
                        TextButton(onClick = { step = clampStrokeStep(step + 1, total) }, enabled = step < total) {
                            Text("›")
                        }
                    }
                    Text(
                        "Stroke vectors: KanjiVG (CC BY-SA 3.0)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(char, fontSize = 72.sp, modifier = Modifier.align(Alignment.CenterHorizontally))
                }
                data?.let { d ->
                    if (d.components.isNotEmpty()) {
                        Text("Parts: ${d.components.joinToString(" + ")}", fontSize = 14.sp)
                    }
                    d.strokeCount?.let { Text("Strokes: $it", fontSize = 14.sp) }
                    if (d.radical != null) {
                        Text(
                            "Radical: ${d.radical}" + (d.radicalRest?.let { " + $it" } ?: ""),
                            fontSize = 14.sp,
                        )
                    }
                    d.definition?.let { Text(it, fontSize = 14.sp) }
                    if (lang == "ja") {
                        onKunLine(d.japaneseOn, d.japaneseKun)?.let { Text(it, fontSize = 14.sp) }
                        d.mandarin?.let { Text("Pinyin: $it", fontSize = 14.sp) }
                    } else {
                        d.mandarin?.let { Text("Pinyin: $it", fontSize = 14.sp) }
                        onKunLine(d.japaneseOn, d.japaneseKun)?.let { Text(it, fontSize = 14.sp) }
                    }
                } ?: Text("Character data still loading…", fontSize = 14.sp)
                TextButton(onClick = onDismiss, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Text("Close")
                }
            }
    }
}
