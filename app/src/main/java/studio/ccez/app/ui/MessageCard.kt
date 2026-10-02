package studio.ccez.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.fragment.app.FragmentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api

import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.rememberDrawerState
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import studio.ccez.app.device.loadInspectTables
import studio.ccez.app.device.strokeCache
import studio.ccez.app.domain.InspectTables
import studio.ccez.app.domain.AidScript
import studio.ccez.app.domain.AidSegment
import studio.ccez.app.domain.Attachment
import studio.ccez.app.domain.COMPOSER_MAX_LINES
import studio.ccez.app.domain.COMPOSER_MIN_LINES
import studio.ccez.app.domain.AnnotatedRun
import studio.ccez.app.domain.Annotation
import studio.ccez.app.domain.SwipeDir
import studio.ccez.app.domain.combinedSwipe
import studio.ccez.app.domain.shouldShowInspect
import studio.ccez.app.domain.showComposerJump
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId
import studio.ccez.app.domain.LocalAid
import studio.ccez.app.domain.REFS_ONLY_BODY
import studio.ccez.app.domain.TapSequence
import studio.ccez.app.domain.foldPreviewText
import studio.ccez.app.domain.isMissingKeyError
import studio.ccez.app.domain.nextTapCount
import studio.ccez.app.domain.toggleFold
import studio.ccez.app.device.displayName
import studio.ccez.app.device.downscaleImage
import studio.ccez.app.device.readBytesCapped
import studio.ccez.app.device.readTextDocument
import studio.ccez.app.device.vibrateDone
import studio.ccez.app.device.vibrateTick
import studio.ccez.app.domain.MAX_FILE_CHARS
import studio.ccez.app.domain.capFileText
import studio.ccez.app.domain.detectScripts
import studio.ccez.app.domain.estimateTextTokens
import studio.ccez.app.domain.extractDocxText
import studio.ccez.app.domain.findMessageIndices
import studio.ccez.app.domain.imageTokens
import studio.ccez.app.domain.isTextAttachment
import studio.ccez.app.domain.splitAnnotationBlock
import studio.ccez.app.domain.stripCodeForDetection
import studio.ccez.app.domain.EdgePanel
import studio.ccez.app.domain.LANGUAGE_MENUS
import studio.ccez.app.domain.contentSwipeTarget
import studio.ccez.app.domain.effectiveReplyLang
import studio.ccez.app.domain.replyLanguageFor
import studio.ccez.app.domain.thinkingLabelFor
import studio.ccez.app.domain.timestampLabel
import studio.ccez.app.domain.waypoints


/**
 * Message cards (extracted from ChatScreen): the bubble, the
 * below-bubble action row, aid chips, ruby readings, and the
 * selection menu/popups. Gesture detectors stay in ChatScreen.
 */
@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun MessageCard(
    msg: ChatMsg,
    hidden: Boolean,
    pins: Set<LocalAid> = emptySet(),
    tashkeelApplied: Boolean = false,
    segments: List<AidSegment>? = null,
    onReveal: () -> Unit,
    onDelete: () -> Unit,
    onEdit: (String) -> Unit,
    onBranch: () -> Unit,
    onRetry: () -> Unit,
    /** Regenerate this user message's reply in place (desktop Rerun parity). */
    onRerun: () -> Unit = {},
    /** Missing-key errors offer Settings (add the key or switch provider). */
    onOpenSettings: () -> Unit = {},
    onSpeak: () -> Unit,
    speaking: Boolean = false,
    /** Highlighted span (null = whole message) to annotate. */
    onAnnotate: (String?) -> Unit,
    onToggleAid: (LocalAid) -> Unit = {},
    onTashkeel: () -> Unit = {},
    onWordSpeak: (String) -> Unit = {},
    flash: Boolean = false,
    onFlashDone: () -> Unit = {},
    draftQuotes: List<String> = emptyList(),
    thinking: String? = null,
    fontScale: Float = 1f,
    ownBubble: Boolean = false,
    aiBubble: Boolean = true,
    folded: Boolean = false,
    onFold: (Boolean) -> Unit = {},
    /**
     * The action row below the bubble renders (false hides it;
     * gestures/keyboard only). Visibility is opacity-only and the row
     * always reserves its line, so revealing never moves the bubble.
     */
    showActions: Boolean = true,
    /**
     * Removes the row outright (the Messages toggle): unlike a hidden
     * row it reserves no space. Defaults to composed-but-hidden.
     */
    hideActionRow: Boolean = false,
    onTapMessage: () -> Unit = {},
    /** Double-tap jumps to this message's end (Tauri Message buttons parity). */
    onMessageEnd: () -> Unit = {},
    /** Swipe toggles this message's fold; tapping a folded message unfolds it. */
    onFoldToggle: () -> Unit = {},
    onUnfold: () -> Unit = {},
    /** Selection readings for the below-bubble popup (desktop selection-furigana parity). */
    readingsForSelection: suspend (String) -> List<AnnotatedRun>? = { null },
    /** Inspect entry for the above-bubble menu; null hides it. */
    onInspectSelection: ((String) -> Unit)? = null,
    /** Damped action-glyph growth with the text-size opt-in. */
    scaleActions: Boolean = false,
    /** Pinch spread on the bubble scales the text size live. */
    onPinchZoom: (Float) -> Unit = {},
    /** Pending notes on this message (badge-tap rewrites them). */
    draftNotes: List<Annotation> = emptyList(),
    /** Badge tap: reopen the note for rewrite. */
    onEditNote: (Annotation) -> Unit = {},
    /** Pencil tap: load the note's comment into the composer. */
    onPencilNote: (Annotation) -> Unit = {},
    /**
     * Live selection mirror for the composer's Annotate/Speak/Inspect
     * dock (Tauri ann-dock parity): fires with each selection, clears
     * with it. Defaults no-op so card tests stay untouched.
     */
    onSelectionActive: (ChatMsg, String) -> Unit = { _, _ -> },
    onSelectionCleared: () -> Unit = {},
) {
    val context = LocalContext.current
    // Currently highlighted span; drives the selection action row.
    var selectedText by remember(msg.id) { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    var editText by remember(msg.id) { mutableStateOf(msg.content) }
    var unfolded by remember(msg.id) { mutableStateOf(false) }
    var showRefs by remember(msg.id) { mutableStateOf(false) }
    var showNotes by remember(msg.id) { mutableStateOf(false) }
    val baked = remember(msg.content) { splitAnnotationBlock(msg.content) }
    // Localized "thinking" shimmer while the assistant reply streams in
    // (Tauri parity: the status speaks the chat's reply language).
    val showThinking = thinking != null && msg.role == ChatMsg.Role.ASSISTANT &&
        msg.content.isEmpty() && msg.error == null
    val body = when {
        baked != null -> if (baked.text.isNotBlank()) baked.text else REFS_ONLY_BODY
        msg.content.isEmpty() && msg.error != null -> "Failed: ${msg.error}"
        msg.content.isEmpty() -> "…"
        else -> msg.content
    }
    val bubbleUser = msg.role == ChatMsg.Role.USER
    // Selection owns the interaction: its action menu rides above the
    // bubble (no right-click on touch) and any readings land below it.
    var selReadings by remember { mutableStateOf<List<AnnotatedRun>?>(null) }
    // Copy stays off the menu until the selection is held: quick
    // highlights get Annotate/Speak/Inspect only, a 3.3s hold arms
    // Copy at the far left.
    var menuCopyArmed by remember(msg.id) { mutableStateOf(false) }
    LaunchedEffect(selectedText) {
        selReadings = if (selectedText.isBlank()) null else readingsForSelection(selectedText)
        if (selectedText.isBlank()) {
            menuCopyArmed = false
            onSelectionCleared()
        } else {
            onSelectionActive(msg, selectedText)
            menuCopyArmed = false
            kotlinx.coroutines.delay(SELECTION_COPY_HOLD_MS)
            menuCopyArmed = true
        }
    }
    val hasSelection = selectedText.isNotBlank()
    // Bubble, then the action row beneath it (web parity): the row sits
    // outside the bubble in its own full-width line and always reserves
    // that line — hidden is opacity only, so tapping a message reveals
    // buttons without moving the text a pixel. Own bubbles dock hard
    // right with left-aligned text; replies hug the left.
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
    if (hasSelection) {
        SelectionMenuPopup(
            showCopy = menuCopyArmed,
            onCopy = {
                copyMarkdown(context, selectedText)
                Toast.makeText(context, "Selection copied", Toast.LENGTH_SHORT).show()
                selectedText = ""
            },
            onAnnotate = { onAnnotate(selectedText); selectedText = "" },
            onSpeak = { onWordSpeak(selectedText); selectedText = "" },
            onInspect = onInspectSelection
                ?.takeIf { shouldShowInspect(selectedText, true) }
                ?.let { inspect -> { inspect(selectedText); selectedText = "" } },
            onClose = { selectedText = "" },
        )
    }
    // Jump-landing flash (blink.ts parity): full grade, then fade to the
    // resting color; always ends cleared, never strands a highlight.
    // The toggles mean it: no background at all when off, either side.
    val resting = if (bubbleUser && ownBubble) MaterialTheme.colorScheme.surfaceVariant
    else if (bubbleUser) androidx.compose.ui.graphics.Color.Transparent
    else if (aiBubble) MaterialTheme.colorScheme.surfaceContainerLow
    else androidx.compose.ui.graphics.Color.Transparent
    var flashPhase by remember { mutableStateOf(false) }
    LaunchedEffect(flash, msg.id) {
        if (!flash) return@LaunchedEffect
        flashPhase = true
        kotlinx.coroutines.delay(700)
        flashPhase = false
        kotlinx.coroutines.delay(350)
        onFlashDone()
    }
    val container by animateColorAsState(
        targetValue = if (flashPhase) MaterialTheme.colorScheme.tertiaryContainer else resting,
        animationSpec = tween(durationMillis = if (flashPhase) 60 else 350),
        label = "jump-flash",
    )
    BoxWithConstraints(
        Modifier.fillMaxWidth(),
        contentAlignment = if (bubbleUser) Alignment.CenterEnd else Alignment.CenterStart,
    ) {
    Card(
        modifier = Modifier
            .animateContentSize()
            .pinchZoom(onPinchZoom)
            .foldSwipe(onToggle = onFoldToggle)
            // Three-finger tap deletes this message (hold-to-wipe lives
            // on the content detector, never here).
            .threeFingerTap(onDelete)
            .then(
                // Mine hug my side, capped like a real chat bubble.
                // Replies shrink-wrap below the full-bleed size and run
                // full width at/past it (folded previews always span).
                if (bubbleUser) Modifier.widthIn(max = maxWidth * 0.85f)
                else if (folded || isFullBleed(fontScale)) Modifier.fillMaxWidth()
                else Modifier.wrapContentWidth(Alignment.Start),
            ),
        colors = CardDefaults.cardColors(containerColor = container),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            if (folded) {
                Text(
                    text = remember(body) { foldPreviewText(body, null) },
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable { onUnfold(); onTapMessage() },
                )
            } else if (hidden && msg.role == ChatMsg.Role.ASSISTANT && !unfolded) {
                TextButton(onClick = { unfolded = true; onReveal() }) { Text("Tap to reveal") }
            } else if (editing) {
                OutlinedTextField(value = editText, onValueChange = { editText = it }, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { editing = false; onEdit(editText) }) { Text("Save") }
                    TextButton(onClick = { editing = false }) { Text("Cancel") }
                }
            } else if (segments != null) {
                RubyText(segments, fontScale)
            } else if (showThinking) {
                val pulse by rememberInfiniteTransition(label = "thinking").animateFloat(
                    initialValue = 0.45f,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
                    label = "thinking-alpha",
                )
                Text(
                    thinking + "…",
                    modifier = Modifier.alpha(pulse),
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                if (pins.isNotEmpty()) Text("…", style = MaterialTheme.typography.bodySmall)
                // Tap-hold highlights text (word-speak is mouse-only). No
                // ripple: tapping must not flash the bubble. A second
                // tap lands this message's end above the composer.
                val latestTap by rememberUpdatedState(onTapMessage)
                val latestEnd by rememberUpdatedState(onMessageEnd)
                Box(
                    Modifier
                        .semantics { onClick("Show message buttons") { latestTap(); true } }
                        // Manual tap read, not detectTapGestures: the text
                        // field below consumes the down AND the up for
                        // focus, so waitForUpOrCancellation never sees the
                        // release and tapping text would never reveal the
                        // row. Watch the press lifecycle ignoring
                        // consumption instead. Single tap reveals,
                        // double-tap lands the message end (both fire).
                        .pointerInput(msg.id) {
                            var taps: TapSequence? = null
                            awaitEachGesture {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                val t0 = System.currentTimeMillis()
                                val end = withTimeoutOrNull(MULTI_TAP_MS) {
                                    var last = down.position
                                    while (true) {
                                        val event = awaitPointerEvent()
                                        event.changes.firstOrNull()?.let { last = it.position }
                                        if (event.changes.all { !it.pressed }) break
                                    }
                                    last
                                } ?: return@awaitEachGesture
                                val dx = end.x - down.position.x
                                val dy = end.y - down.position.y
                                if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) return@awaitEachGesture
                                latestTap()
                                taps = nextTapCount(taps, t0, down.position.x, down.position.y)
                                if (taps?.count == 2) {
                                    taps = null
                                    latestEnd()
                                }
                            }
                        },
                ) {
                    val markQuotes = remember(baked, draftQuotes) {
                        draftQuotes + (baked?.refs?.map { it.quote } ?: emptyList())
                    }
                    MarkdownBody(
                        body,
                        markQuotes = markQuotes,
                        fontScale = fontScale,
                        onSelectionChange = { selectedText = it },
                    )
                }
            }
            if (hasSelection && selReadings != null) {
                ReadingsPopup(selReadings!!)
            }
            AidChips(msg, pins, tashkeelApplied, onToggleAid, onTashkeel)
            if (baked != null) {
                AssistChip(
                    onClick = { showRefs = !showRefs },
                    label = { Text(if (showRefs) "Hide ${baked.refs.size} refs" else "${baked.refs.size} refs") },
                )
                if (showRefs) {
                    baked.refs.forEach { ref ->
                        Text("“${ref.quote}” — ${ref.comment.ifBlank { "?" }}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            // Pending-note review (desktop review parity): badges reopen
            // the note for rewrite, the pencil loads its comment into
            // the composer. Rewrites wash the message via flashMsg.
            if (draftNotes.isNotEmpty()) {
                val count = "${draftNotes.size} note" + if (draftNotes.size == 1) "" else "s"
                AssistChip(
                    onClick = { showNotes = !showNotes },
                    label = { Text(if (showNotes) "Hide $count" else count) },
                )
                if (showNotes) {
                    draftNotes.forEach { note ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TextButton(
                                onClick = { onEditNote(note) },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text(
                                    "“${note.quote}” — ${note.comment.ifBlank { "?" }}",
                                    style = MaterialTheme.typography.bodySmall,
                                    maxLines = 2,
                                )
                            }
                            IconButton(
                                onClick = { onPencilNote(note) },
                                modifier = Modifier.size(32.dp),
                            ) {
                                Glyph(PencilIcon, "Load note into composer")
                            }
                        }
                    }
                }
            }
            // Pasted-content tags read big and bold like desktop's fold
            // markers — tap toggles the full text.
            msg.pasteFolds.forEach { fold ->
                Text(
                    text = if (fold.open || unfolded) "[pasted ${fold.chars} chars ✓]"
                    else "[pasted ${fold.chars} chars…]",
                    style = MaterialTheme.typography.bodyLarge.copy(
                        fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                    ),
                    modifier = Modifier.clickable { unfolded = !unfolded },
                )
            }
            if (msg.attachments.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    msg.attachments.forEach { a ->
                        AssistChip(
                            onClick = {},
                            leadingIcon = { Glyph(AttachIcon, null) },
                            label = { Text("${a.name.take(18)} · ~${a.tokens} tok") },
                        )
                    }
                }
            }
            msg.usage?.let { u ->
                Text("send ${u.prompt} / recv ${u.completion}", style = MaterialTheme.typography.bodySmall)
            }
        }
        }
    }
    // Action row below the bubble (web .actions parity): always composed
    // so the bubble never moves — hidden is opacity plus disabled only.
    // A live selection owns the interaction, so the row stands down
    // until it clears. Button order matches the web row per role
    // (assistant: copy, branch, delete, audio; own: copy, audio, branch,
    // delete, edit, rerun).
    val rowVisible = showActions && !hasSelection
    if (!hideActionRow) {
    Row(
        Modifier.fillMaxWidth()
            .alpha(if (rowVisible) 1f else 0f)
            .semantics { if (!rowVisible) invisibleToUser() },
        horizontalArrangement = if (bubbleUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val glyphSize = scaledGlyphDp(20f, fontScale, scaleActions).dp
        if (msg.retryable) {
            IconButton(onClick = onRetry, enabled = rowVisible) {
                Glyph(RerunIcon, "Retry", iconSize = glyphSize)
            }
        }
        // A missing key never heals by retrying: offer the place
        // that fixes it (add the key or switch provider).
        if (isMissingKeyError(msg.error)) {
            TextButton(onClick = onOpenSettings, enabled = rowVisible) {
                Text("Settings")
            }
        }
        IconButton(
            onClick = {
                copyMarkdown(context, msg.content)
                Toast.makeText(context, "Message copied", Toast.LENGTH_SHORT).show()
            },
            enabled = rowVisible,
        ) {
            Glyph(CopyIcon, "Copy message", iconSize = glyphSize)
        }
        if (!bubbleUser) {
            IconButton(onClick = onBranch, enabled = rowVisible) {
                Glyph(BranchIcon, "Branch from here", iconSize = glyphSize)
            }
            IconButton(onClick = onDelete, enabled = rowVisible) {
                Glyph(DeleteIcon, "Delete message", iconSize = glyphSize)
            }
        }
        IconButton(onClick = onSpeak, enabled = rowVisible) {
            Glyph(SpeakIcon, if (speaking) "Stop speaking" else "Read aloud", iconSize = glyphSize)
        }
        if (bubbleUser) {
            IconButton(onClick = onBranch, enabled = rowVisible) {
                Glyph(BranchIcon, "Branch from here", iconSize = glyphSize)
            }
            IconButton(onClick = onDelete, enabled = rowVisible) {
                Glyph(DeleteIcon, "Delete message", iconSize = glyphSize)
            }
            IconButton(onClick = { editing = true }, enabled = rowVisible) {
                Glyph(PencilIcon, "Edit this message", iconSize = glyphSize)
            }
            IconButton(onClick = onRerun, enabled = rowVisible) {
                Glyph(RerunIcon, "Rerun", iconSize = glyphSize)
            }
        }
    }
    }
    }
}

/** Aid buttons for detected scripts (code excluded from detection). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AidChips(
    msg: ChatMsg,
    pins: Set<LocalAid>,
    tashkeelApplied: Boolean,
    onToggleAid: (LocalAid) -> Unit,
    onTashkeel: () -> Unit,
) {
    val scripts = remember(msg.content) { detectScripts(stripCodeForDetection(msg.content)) }
    if (scripts.isEmpty()) return
    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (AidScript.ZH in scripts) {
            AssistChip(
                onClick = { onToggleAid(LocalAid.PINYIN) },
                label = { Text(if (LocalAid.PINYIN in pins) "拼 pinyin ✓" else "拼 pinyin") },
            )
        }
        if (AidScript.JA in scripts) {
            AssistChip(
                onClick = { onToggleAid(LocalAid.FURIGANA) },
                label = { Text(if (LocalAid.FURIGANA in pins) "あ furigana ✓" else "あ furigana") },
            )
        }
        if (AidScript.AR in scripts) {
            AssistChip(
                onClick = onTashkeel,
                label = { Text(if (tashkeelApplied) "إبداعي ✓" else "تشكيل") },
            )
        }
    }
}

/** Ruby rendering: readings sit above their base, wrapping per token. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RubyText(segments: List<AidSegment>, fontScale: Float = 1f) {
    val rows = remember(segments) {
        val out = mutableListOf<List<AidSegment>>()
        var cur = mutableListOf<AidSegment>()
        for (seg in segments) {
            if (seg.surface == "\n" && seg.reading == null) {
                if (cur.isNotEmpty()) {
                    out.add(cur)
                    cur = mutableListOf()
                }
            } else cur.add(seg)
        }
        if (cur.isNotEmpty()) out.add(cur)
        out
    }
    Column {
        rows.forEach { RubyRow(it, fontScale) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RubyRow(segments: List<AidSegment>, fontScale: Float = 1f) {
    FlowRow {
        for (seg in segments) {
            if (seg.reading == null) {
                Text(seg.surface, fontSize = 16.sp * fontScale)
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        seg.reading,
                        fontSize = 10.sp * fontScale,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                    )
                    Text(seg.surface, fontSize = 16.sp * fontScale)
                }
            }
        }
    }
}

/**
 * How long a selection stands before Copy joins the menu (quick
 * highlights get Annotate/Speak/Inspect only).
 */
const val SELECTION_COPY_HOLD_MS = 3_300L

/**
 * Selection action menu (no right-click on touch): Annotate, Speak,
 * with Inspect for single-Han highlights; a 3.3s held selection arms
 * Copy at the far left. Rides above the bubble (desktop sel-menu
 * parity, touch order).
 */
@Composable
fun SelectionMenuPopup(
    onCopy: () -> Unit,
    onAnnotate: () -> Unit,
    onSpeak: () -> Unit,
    onInspect: (() -> Unit)?,
    onClose: () -> Unit,
    /** False hides Copy (selection not held long enough). */
    showCopy: Boolean = true,
) {
    // Tap-and-drag moves the menu (Tauri sel-menu parity): the stroke
    // is consumed here so list scroll never steals it; taps still fire.
    var menuOffset by remember { mutableStateOf(Offset.Zero) }
    Card(
        modifier = Modifier
            .offset { IntOffset(menuOffset.x.roundToInt(), menuOffset.y.roundToInt()) }
            .pointerInput(Unit) {
                detectDragGestures { change, drag ->
                    change.consume()
                    menuOffset += drag
                }
            },
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(
            Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (showCopy) TextButton(onClick = onCopy) { Text("Copy") }
            TextButton(onClick = onAnnotate) { Text("Annotate") }
            TextButton(onClick = onSpeak) { Text("Speak") }
            if (onInspect != null) TextButton(onClick = onInspect) { Text("Inspect") }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Glyph(CloseIcon, "Dismiss selection menu")
            }
        }
    }
}

/**
 * Selection readings (desktop selection-furigana parity): Han slices
 * with their word-context reading stacked above, okurigana plain.
 * Rides below the bubble.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReadingsPopup(runs: List<AnnotatedRun>) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        FlowRow(
            Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            runs.forEach { run ->
                if (run.reading != null) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            run.reading,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            run.text,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = androidx.compose.ui.text.font.FontWeight.Bold,
                            ),
                        )
                    }
                } else {
                    Text(run.text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
