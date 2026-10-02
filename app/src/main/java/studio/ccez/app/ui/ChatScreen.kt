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
import studio.ccez.app.domain.showComposerSelectionActions
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId
import studio.ccez.app.domain.LocalAid
import studio.ccez.app.domain.REFS_ONLY_BODY
import studio.ccez.app.domain.TapSequence
import studio.ccez.app.domain.foldPreviewText
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
 * Touch-first chat UI (Tauri Android parity): bottom-sheet chat list,
 * waypoint strip for long threads, fold/delete/edit, collapsible pastes,
 * annotation drafts baked on send, in-chat find, hide-until-tapped mode,
 * light/dark/system themes. Hardware keys kept where sensible:
 * Ctrl+N new chat, Ctrl+B chat list, Ctrl+F find.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun ChatScreen(
    vm: ChatViewModel,
    onOpenSearch: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val draft by vm.draft.collectAsState()
    val settings by vm.settings.collectAsState()
    val annMap by vm.annotations.collectAsState()
    val jump by vm.jumpTo.collectAsState()
    val aidPins by vm.aidPins.collectAsState()
    val aidSegments by vm.aidSegments.collectAsState()
    val tashkeelApplied by vm.tashkeelOriginal.collectAsState()
    val aidError by vm.aidError.collectAsState()
    val context = LocalContext.current
    // Study session: keep the screen on during read-aloud (wake lock
    // while any message speaks, released on stop — studyMedia parity).
    val speakingId by vm.speaking.collectAsState()
    LaunchedEffect(speakingId) {
        (context as? android.app.Activity)?.window?.let { window ->
            if (speakingId != null) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
    }
    LaunchedEffect(aidError) {
        aidError?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            vm.consumeAidError()
        }
    }
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    fun tick() { if (!settings.hapticsDisabled) vibrateTick(context) }
    /** Delete thump (Tauri "done" beat parity): every delete path shares it. */
    fun thump() { if (!settings.hapticsDisabled) vibrateDone(context) }
    fun openDrawer() { tick(); scope.launch { drawerState.open() } }
    fun closeDrawer() { tick(); scope.launch { drawerState.close() } }
    // Settings slides from the right like the chats drawer slides
    // from the left (an overlay panel, not a route).
    var settingsOpen by remember { mutableStateOf(false) }
    // Quick switcher overlay (two-finger hold / background double-tap):
    // never stacks with settings in either direction.
    var switcherOpen by remember { mutableStateOf(false) }
    fun openSettings() { tick(); switcherOpen = false; settingsOpen = true }
    fun closeSettings() { tick(); settingsOpen = false }
    fun summonSwitcher() {
        tick()
        settingsOpen = false
        switcherOpen = true
    }
    if (settingsOpen || drawerState.isOpen) {
        androidx.activity.compose.BackHandler { closeSettings(); closeDrawer() }
    }
    var showFind by remember { mutableStateOf(false) }
    var findQuery by remember { mutableStateOf("") }
    var findPos by remember { mutableStateOf(0) }
    var revealAll by remember { mutableStateOf(false) }
    var annotating: Pair<ChatMsg, String?>? by remember { mutableStateOf<Pair<ChatMsg, String?>?>(null) }
    // Live message selection for the composer's Annotate/Speak/Inspect
    // dock (Tauri ann-dock parity): redundant with the message's own
    // selection menu, minus Copy. Cleared with the selection itself.
    var composerSelection: Pair<ChatMsg, String>? by remember { mutableStateOf<Pair<ChatMsg, String>?>(null) }
    // Filing an annotation reads the quote back out when voice
    // readback is on (the prompt's audio button). Null quotes file
    // whole-message notes and stay silent.
    fun fileAnnotation(m: ChatMsg, q: String?) {
        annotating = m to q
        if (settings.voiceDefault && !q.isNullOrBlank()) vm.speakWord(q, m.content)
    }
    // Badge-tap rewrite target: set alongside annotating, cleared with it.
    var editingNote by remember { mutableStateOf<Annotation?>(null) }
    var inspecting: Pair<String, String>? by remember { mutableStateOf(null) }
    val listState = rememberLazyListState()
    var optionsChat: Chat? by remember { mutableStateOf<Chat?>(null) }
    val composerFocus = remember { FocusRequester() }
    var composerFocusTick by remember { mutableIntStateOf(0) }
    fun focusComposer() { composerFocusTick++ }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) vm.dictate()
        else Toast.makeText(context, "Microphone denied — dictation stays off", Toast.LENGTH_SHORT).show()
    }
    val ioScope = rememberCoroutineScope()
    fun textAttachment(name: String, mime: String, text: String): Attachment = Attachment(
        name = name,
        mimeType = mime,
        charCount = text.length,
        kind = "text",
        text = text,
        tokens = estimateTextTokens(text),
    )
    fun attachUri(uri: android.net.Uri) {
        ioScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val name = displayName(context, uri)
            val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
            val attachment = runCatching {
                if (mime.startsWith("image/")) {
                    val down = downscaleImage(context, uri)
                    Attachment(
                        name = name,
                        mimeType = "image/jpeg",
                        kind = "image",
                        dataUrl = down.dataUrl,
                        tokens = imageTokens(down.width, down.height),
                        charCount = 0,
                    )
                } else if (isTextAttachment(name, mime)) {
                    val raw = readTextDocument(context, uri, MAX_FILE_CHARS + 1)
                        ?: throw IllegalArgumentException("Could not read file")
                    textAttachment(name, mime, capFileText(raw))
                } else if (mime == "application/pdf" || name.substringAfterLast('.', "").lowercase() == "pdf") {
                    studio.ccez.app.device.PdfText.init(context)
                    val bytes = readBytesCapped(context, uri)
                        ?: throw IllegalArgumentException("Could not read PDF")
                    val text = capFileText(studio.ccez.app.device.PdfText.extract(bytes))
                    if (text.isBlank()) throw IllegalArgumentException("No text in PDF (scanned images need OCR)")
                    textAttachment(name, mime, text)
                } else if (mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                    name.substringAfterLast('.', "").lowercase() == "docx"
                ) {
                    val bytes = readBytesCapped(context, uri)
                        ?: throw IllegalArgumentException("Could not read document")
                    val text = capFileText(extractDocxText(bytes))
                    if (text.isBlank()) throw IllegalArgumentException("No text in document")
                    textAttachment(name, mime, text)
                } else throw IllegalArgumentException("Unsupported attachment: $name")
            }.getOrElse {
                launch(kotlinx.coroutines.Dispatchers.Main) {
                    Toast.makeText(context, it.message ?: "Attach failed", Toast.LENGTH_SHORT).show()
                }
                return@launch
            }
            launch(kotlinx.coroutines.Dispatchers.Main) { vm.stageAttachment(attachment) }
        }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) attachUri(uri)
    }
    val active = state.activeChat
    // Per-chat scroll memory (desktop parity): file the leaving
    // chat's position on dispose, restore the entering chat's
    // instantly. Explicit jumps below still win (they run after).
    val activeId = state.activeChatId
    androidx.compose.runtime.DisposableEffect(activeId) {
        onDispose {
            if (activeId != null) {
                vm.saveScroll(activeId, listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset)
            }
        }
    }
    LaunchedEffect(activeId) {
        if (activeId == null) return@LaunchedEffect
        val count = state.activeChat?.messages?.size ?: 0
        val (index, offset) = vm.restoreScroll(activeId, count)
        listState.scrollToItem(index, offset)
    }
    val drafts = active?.let { annMap[it.id] } ?: emptyList()
    val contents = remember(active) { active?.messages?.map { it.content } ?: emptyList() }
    val matches = remember(contents, findQuery) { findMessageIndices(contents, findQuery) }

    // Jump-landing flash target (blink.ts parity): set on every
    // scroll landing, cleared by the card when its fade ends.
    var flashMsg by remember { mutableStateOf<ChatMsgId?>(null) }
    // Swipe-folded messages, this session (desktop fold parity).
    var foldedMsgs by remember { mutableStateOf(setOf<ChatMsgId>()) }
    // hideButtons parity: tapping a message reveals its action row for 3s.
    // The tick restarts the window on every tap: re-tapping the same
    // message extends the reveal instead of letting it die on schedule.
    var revealedRow by remember { mutableStateOf<ChatMsgId?>(null) }
    var revealedTick by remember { mutableStateOf(0L) }
    LaunchedEffect(revealedRow, revealedTick) {
        val id = revealedRow ?: return@LaunchedEffect
        kotlinx.coroutines.delay(3000)
        if (revealedRow == id) revealedRow = null
    }
    LaunchedEffect(jump) {
        val target = jump ?: return@LaunchedEffect
        runCatching { listState.animateScrollToItem(target.second.coerceAtLeast(0)) }
        flashMsg = active?.messages?.getOrNull(target.second)?.id
        vm.consumeJump()
    }
    LaunchedEffect(findPos, matches) {
        if (showFind && matches.isNotEmpty()) {
            val idx = matches[findPos.coerceIn(matches.indices)]
            runCatching { listState.animateScrollToItem(idx) }
            flashMsg = active?.messages?.getOrNull(idx)?.id
        }
    }

    // Swipes must not cross-fire: the chats drawer ignores gestures while
    // settings is open, and the content swipe routes by open panel
    // (right closes settings, left never opens settings over chats).
    // M3's own content drag opens the list mid-screen, against the
    // Tauri contract — it stays off and the content swipe below owns
    // panel routing (edge-only open, leftward close, scrim tap).
    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = false,
        drawerContent = {
            // Drawer width parity: the phone sidebar never exceeds 340dp.
            ModalDrawerSheet(modifier = Modifier.widthIn(max = 340.dp)) {
                ChatDrawer(
                    chats = state.chats,
                    activeId = state.activeChatId,
                    onPick = { vm.selectChat(it); closeDrawer() },
                    onNew = { vm.newChat(); closeDrawer() },
                    onDelete = { thump(); vm.deleteChat(it) },
                    onOptions = { optionsChat = it },
                    onSearch = { closeDrawer(); onOpenSearch() },
                    onOpenSettings = { closeDrawer(); openSettings() },
                    onClose = { closeDrawer() },
                    onExport = { id ->
                        val exported = vm.exportMarkdown(id)
                        if (exported != null) {
                            val (name, md) = exported
                            if (!shareMarkdown(context, name, md)) {
                                copyMarkdown(context, md)
                                Toast.makeText(context, "No share target — copied instead", Toast.LENGTH_SHORT).show()
                            }
                        }
                    },
                )
            }
        },
    ) {
        Scaffold(
                    modifier = modifier
                        .fillMaxSize()
                        .onPreviewKeyEvent { e ->
                            if (e.type != KeyEventType.KeyDown || !e.isCtrlPressed) return@onPreviewKeyEvent false
                            when (e.key) {
                                Key.N -> { vm.newChat(); true }
                                Key.B -> { scope.launch { drawerState.apply { if (isClosed) open() else close() } }; true }
                                Key.F -> { showFind = !showFind; true }
                                Key.P -> { onOpenSearch(); true }
                                else -> false
                            }
                        },
                    bottomBar = {
                        Column {
                            // Model-driven web reads surface while they run (the web
                            // turn is silent; this chip is an improvement over both).
                            val fetchingHost by vm.fetching.collectAsState()
                            fetchingHost?.let { host ->
                                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                                    AssistChip(onClick = {}, label = { Text("Fetching $host…") })
                                }
                            }
                            if (drafts.isNotEmpty() && active != null) {
                                val chatId = active.id
                                FlowRow(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                                    drafts.forEach { a ->
                                        AssistChip(
                                            onClick = { vm.unannotate(chatId, a.id) },
                                            label = { Text("“${a.quote.take(24)}” ×") },
                                        )
                                    }
                                }
                            }
                            Composer(
                                draft = draft,
                                sending = active?.let { state.sendingChatIds.contains(it.id) } == true,
                                focus = composerFocus,
                                focusTick = composerFocusTick,
                                micEnabled = settings.micEnabled,
                                voiceOn = settings.voiceDefault,
                                onToggleVoice = { vm.setVoiceDefault(!settings.voiceDefault) },
                                sendBadge = replyLanguageFor(effectiveReplyLang(active?.replyLang, settings.replyLang))?.badge,
                                fontScale = settings.fontScale,
                                dictating = vm.dictating.collectAsState().value,
                                staged = vm.stagedAttachments.collectAsState().value,
                                onDraft = vm::setDraft,
                                onSend = {
                                    (context as? FragmentActivity)?.let { activity ->
                                        scope.launch {
                                            if (vm.ensureKeysUnlocked(activity)) {
                                                if (!settings.hapticsDisabled) vibrateTick(context)
                                                vm.send()
                                            }
                                        }
                                    }
                                },
                                onStop = { active?.let { vm.stop(it.id) } },
                                onMic = {
                                    if (vm.dictating.value) {
                                        vm.stopDictation()
                                    } else if (androidx.core.content.ContextCompat.checkSelfPermission(
                                            context, Manifest.permission.RECORD_AUDIO,
                                        ) == PackageManager.PERMISSION_GRANTED
                                    ) {
                                        vm.dictate()
                                    } else micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                },
                                onAttach = { pickFile.launch("*/*") },
                                onUnstage = vm::unstageAttachment,
                                onOcr = vm::ocrStagedImage,
                                selection = composerSelection?.let { (selMsg, q) ->
                                    ComposerSelection(
                                        quote = q,
                                        onAnnotate = { fileAnnotation(selMsg, q) },
                                        onSpeak = { tick(); vm.speakWord(q, selMsg.content) },
                                        onInspect = if (settings.inspectEnabled && shouldShowInspect(q, true)) {
                                            { inspecting = q to selMsg.content }
                                        } else {
                                            null
                                        },
                                    )
                                },
                                showJump = showComposerJump(active?.messages?.size ?: 0),
                                jumpPoints = waypoints(active?.messages?.size ?: 0),
                                onJump = { idx ->
                                    tick()
                                    scope.launch { runCatching { listState.animateScrollToItem(idx) } }
                                },
                                // Empty-composer hold swaps the reply
                                // language (Tauri send-hold parity): the
                                // badge vanishes and returns, ticking each
                                // switch. A sendable hold just sends.
                                onSendHold = {
                                    if (draft.isBlank() && vm.stagedAttachments.value.isEmpty() && drafts.isEmpty()) {
                                        val chat = active ?: return@Composer
                                        when (val swapped = vm.swapReplyLangHold(chat.id)) {
                                            is ChatViewModel.ReplySwap.Applied -> {
                                                tick()
                                                val lang = swapped.current?.let { replyLanguageFor(it) }
                                                Toast.makeText(
                                                    context,
                                                    if (lang != null) "${lang.native} ${lang.badge}"
                                                    else (swapped.stash?.let { replyLanguageFor(it)?.cleared } ?: "Cleared"),
                                                    Toast.LENGTH_SHORT,
                                                ).show()
                                            }
                                            ChatViewModel.ReplySwap.NoOp -> Unit
                                        }
                                    }
                                },
                            )
                        }
                    },
                ) { pad ->
                    Column(
                        Modifier.padding(pad).fillMaxSize()
                            .contentSwipe(
                                settingsOpen,
                                // Thumb-wide edge zone (Tauri edgeSwipeTarget
                                // parity): rightward strokes summon the list
                                // from the left edge only.
                                edgeDp = 64.dp,
                                // Any swipe with settings open closes it; a
                                // swipe over the open drawer closes that.
                                // Nothing ever cross-opens.
                                onSwipeLeft = {
                                    when {
                                        // The switcher yields to the settings
                                        // gesture instead of stacking.
                                        switcherOpen -> switcherOpen = false
                                        settingsOpen -> closeSettings()
                                        drawerState.isOpen -> closeDrawer()
                                        else -> openSettings()
                                    }
                                },
                                // Mid-screen right summons nothing — rightward
                                // strokes only dismiss.
                                onSwipeRight = { if (settingsOpen) closeSettings() },
                                onEdgeSwipeRight = {
                                    if (!settingsOpen && drawerState.isClosed) openDrawer()
                                },
                            )
                            .touchCommands(
                                onTwoFingerDoubleTap = {
                                    tick()
                                    val n = active?.messages?.size ?: 0
                                    if (n > 0) {
                                        scope.launch {
                                            runCatching { listState.animateScrollToItem(n - 1) }
                                        }
                                    }
                                },
                                onThreeFingerHold = {
                                    thump()
                                    vm.clearChats()
                                    Toast.makeText(context, "All chats deleted", Toast.LENGTH_SHORT).show()
                                },
                                onTwoFingerSwipe = { dir ->
                                    tick()
                                    when (dir) {
                                        SwipeDir.UP -> {
                                            scope.launch {
                                                runCatching { listState.animateScrollToItem(0) }
                                            }
                                        }
                                        SwipeDir.DOWN -> {
                                            val n = active?.messages?.size ?: 0
                                            if (n > 0) {
                                                scope.launch {
                                                    runCatching { listState.animateScrollToItem(n - 1) }
                                                }
                                            }
                                        }
                                        // Anywhere on content (the second
                                        // finger frees these from the edge):
                                        // right summons the list, left routes
                                        // settings like the one-finger stroke.
                                        SwipeDir.RIGHT -> {
                                            if (settingsOpen) closeSettings()
                                            else if (drawerState.isClosed) openDrawer()
                                        }
                                        SwipeDir.LEFT -> {
                                            when {
                                                settingsOpen -> closeSettings()
                                                drawerState.isOpen -> closeDrawer()
                                                else -> openSettings()
                                            }
                                        }
                                    }
                                },
                                onThreeFingerSwipe = { dir ->
                                    // Right steps newer, left older.
                                    if (dir == SwipeDir.RIGHT) vm.stepChat(newer = true)
                                    else if (dir == SwipeDir.LEFT) vm.stepChat(newer = false)
                                },
                                onTwoFingerHold = { summonSwitcher() },
                                onBackgroundDoubleTap = {
                                    if ((active?.messages?.size ?: 0) > 0) summonSwitcher()
                                },
                            ),
                    ) {
                        if (showFind) {
                            FindBar(
                                query = findQuery,
                                position = if (matches.isEmpty()) 0 else findPos + 1,
                                total = matches.size,
                                onQuery = { findQuery = it; findPos = 0 },
                                onPrev = { if (matches.isNotEmpty()) findPos = (findPos - 1).mod(matches.size) },
                                onNext = { if (matches.isNotEmpty()) findPos = (findPos + 1).mod(matches.size) },
                                onClose = { showFind = false },
                            )
                        }
                        if (active == null || active.messages.isEmpty()) {
                            Column(
                                // Empty-chat taps land the composer (desktop
                                // parity): pill taps consume themselves, so
                                // only bare space reaches this detector. A
                                // manual tap read, never clickable — clickable
                                // eats the swipe gestures routed above.
                                modifier = Modifier.weight(1f)
                                    .testTag("emptySpace")
                                    .tapWithoutConsuming { composerFocus.requestFocus() },
                                verticalArrangement = Arrangement.Center,
                            ) {
                                LanguageHero(
                                    activeReply = active?.replyLang,
                                    onPick = vm::pickReplyLang,
                                )
                            }
                        } else {
                            val chatId = active.id
                            LazyColumn(
                                state = listState,
                                modifier = Modifier.fillMaxSize().weight(1f),
                                verticalArrangement = Arrangement.spacedBy(
                                    scaledMessageGap(
                                        settings.messageGap * 16,
                                        settings.fontScale,
                                        settings.scaleActionsWithFont,
                                    ).dp,
                                ),
                            ) {
                                itemsIndexed(active.messages, key = { _, it -> it.id.value }) { idx, msg ->
                                    AnimatedVisibility(
                                        visible = true,
                                        enter = fadeIn() + expandVertically(),
                                        exit = fadeOut() + shrinkVertically(),
                                    ) {
                                        MessageCard(
                                            msg = msg,
                                            hidden = !revealAll && settings.hideUntilTapped,
                                            pins = aidPins[msg.id] ?: emptySet(),
                                            tashkeelApplied = tashkeelApplied.containsKey(msg.id),
                                            segments = (aidPins[msg.id] ?: emptySet()).takeIf { it.isNotEmpty() }?.let { aidSegments[msg.id to it] },
                                            onReveal = { revealAll = true },
                                            onDelete = { thump(); vm.deleteMessage(chatId, msg.id) },
                                            onMessageEnd = {
                                                tick()
                                                vm.jumpToChat(chatId, idx)
                                            },
                                            onEdit = { vm.editMessage(chatId, msg.id, it); vm.clearAids(msg.id) },
                                            onBranch = { vm.branchFrom(chatId, msg.id) },
                                            onRetry = { vm.retry(active, msg.id) },
                                            onRerun = { vm.rerun(active, msg.id) },
                                            onOpenSettings = { openSettings() },
                                            readingsForSelection = vm::selectionReadings,
                                            scaleActions = settings.scaleActionsWithFont,
                                            onPinchZoom = vm::pinchZoom,
                                            onInspectSelection = if (settings.inspectEnabled) {
                                                { quote ->
                                                    inspecting = quote to msg.content
                                                }
                                            } else {
                                                null
                                            },
                                            onSpeak = { vm.speak(msg) },
                                            speaking = vm.speaking.collectAsState().value == msg.id,
                                            onAnnotate = { quote -> fileAnnotation(msg, quote) },
                                            onToggleAid = { aid -> vm.toggleAid(chatId, msg, aid) },
                                            onTashkeel = {
                                                (context as? FragmentActivity)?.let { activity ->
                                                    scope.launch {
                                                        if (vm.ensureKeysUnlocked(activity)) vm.toggleTashkeel(chatId, msg)
                                                    }
                                                }
                                            },
                                            onWordSpeak = { word -> vm.speakWord(word, msg.content) },
                                            flash = flashMsg == msg.id,
                                            onFlashDone = { if (flashMsg == msg.id) flashMsg = null },
                                            thinking = if (state.sendingChatIds.contains(chatId) && msg.role == ChatMsg.Role.ASSISTANT && msg.content.isEmpty()) {
                                                thinkingLabelFor(effectiveReplyLang(active.replyLang, settings.replyLang))
                                            } else {
                                                null
                                            },
                                            draftQuotes = remember(annMap, chatId, msg.id) {
                                                annMap[chatId].orEmpty().filter { it.messageId == msg.id }.map { it.quote }
                                            },
                                            draftNotes = remember(annMap, chatId, msg.id) {
                                                annMap[chatId].orEmpty().filter { it.messageId == msg.id }
                                            },
                                            onEditNote = { note ->
                                                editingNote = note
                                                annotating = msg to note.quote
                                            },
                                            onPencilNote = { note ->
                                                tick()
                                                vm.setDraft(note.comment)
                                            },
                                            fontScale = settings.fontScale,
                                            ownBubble = settings.ownBubble,
                                            aiBubble = settings.aiBubble,
                                            folded = foldedMsgs.contains(msg.id),
                                            onFoldToggle = {
                                                tick()
                                                foldedMsgs = toggleFold(foldedMsgs, msg.id)
                                            },
                                            onUnfold = {
                                                tick()
                                                foldedMsgs = foldedMsgs - msg.id
                                            },
                                            showActions = settings.showMessageButtons &&
                                                (!settings.hideButtons || revealedRow == msg.id),
                                            hideActionRow = !settings.showMessageButtons,
                                            onTapMessage = {
                                                if (settings.hideButtons) {
                                                    revealedRow = msg.id
                                                    // Re-tapping restarts the 3s window instead
                                                    // of letting it die on schedule.
                                                    revealedTick = System.currentTimeMillis()
                                                }
                                            },
                                            onSelectionActive = { m, q -> composerSelection = m to q },
                                            onSelectionCleared = {
                                                if (composerSelection?.first?.id == msg.id) composerSelection = null
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
        SettingsPanel(
            vm = vm,
            visible = settingsOpen,
            onClose = { closeSettings() },
        )
    }

    val annotatingPair = annotating
    val annotatingMsg = annotatingPair?.first
    if (annotatingMsg != null && active != null) {
        AnnotateDialog(
            messageText = annotatingMsg.content,
            initialQuote = annotatingPair.second,
            initialComment = editingNote?.comment.orEmpty(),
            onDismiss = {
                annotating = null
                editingNote = null
            },
            onSave = { quote, comment ->
                tick()
                val editing = editingNote
                if (editing != null) {
                    // Badge-tap rewrite: edit in place and wash the message.
                    vm.editAnnotation(active.id, editing.id, quote, comment)
                    flashMsg = annotatingMsg.id
                } else {
                    vm.annotate(active.id, annotatingMsg.id, quote, comment)
                }
                annotating = null
                editingNote = null
            },
            onInspect = if (settings.inspectEnabled) {
                { quote ->
                    inspecting = quote to annotatingMsg.content
                    annotating = null
                }
            } else {
                null
            },
        )
    }
    // Inspect tables load once in the background; the dialog waits for them.
    var inspectTables by remember { mutableStateOf<InspectTables?>(null) }
    LaunchedEffect(Unit) {
        inspectTables = withContext(Dispatchers.IO) {
            runCatching { loadInspectTables(context) }.getOrNull()
        }
    }
    val inspectingNow = inspecting
    var inspectStrokes by remember { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(inspectingNow?.first) {
        inspectStrokes = null
        val ch = inspectingNow?.first ?: return@LaunchedEffect
        inspectStrokes = withContext(Dispatchers.IO) { strokeCache.pathsFor(ch) }
    }
    if (inspectingNow != null) {
        InspectDialog(
            char = inspectingNow.first,
            contextText = inspectingNow.second,
            tables = inspectTables,
            strokes = inspectStrokes,
            onDismiss = { inspecting = null },
        )
    }
    if (switcherOpen) {
        val switcherChats = state.chats
        val switcherAt = switcherChats.indexOfFirst { it.id == state.activeChatId }
        ChatSwitcherDialog(
            title = state.activeChat?.let { timestampLabel(it.createdAt) } ?: "No chats",
            position = if (switcherAt >= 0) "${switcherAt + 1} / ${switcherChats.size}"
                else "0 / ${switcherChats.size}",
            onOlder = { tick(); vm.cycleChat(newer = false) },
            onNewer = { tick(); vm.cycleChat(newer = true) },
            onNew = { tick(); vm.newChat(); switcherOpen = false },
            onDelete = { state.activeChatId?.let { thump(); vm.deleteChat(it) } },
            onDismiss = { switcherOpen = false },
        )
    }

    val optionsTarget = optionsChat
    if (optionsTarget != null) {
        ChatOptionsDialog(
            chat = optionsTarget,
            onDismiss = { optionsChat = null },
            onSave = { replyLang, voice ->
                vm.setReplyLang(optionsTarget.id, replyLang)
                vm.setChatVoice(optionsTarget.id, voice)
                optionsChat = null
            },
        )
    }

}

/**
 * Quick switcher overlay (two-finger hold / background double-tap, web
 * parity): ‹ / › cycle chats with wraparound without closing, the title
 * names the active chat with its position, + mints a chat, the bin drops
 * the active one. No Close button — tapping away or Esc dismisses.
 * Sideways strokes cycle from anywhere on the veil, so the swipe can
 * start on the card itself; taps (not strokes) on the veil dismiss.
 */
@Composable
fun ChatSwitcherDialog(
    title: String,
    position: String,
    onOlder: () -> Unit,
    onNewer: () -> Unit,
    onNew: () -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onDismiss) {
        // The opening gesture's own release lands here within a beat:
        // taps inside the grace window never close.
        val openedAt = remember { System.currentTimeMillis() }
        Box(
            Modifier.fillMaxSize()
                .cycleSwipe { newer -> if (newer) onNewer() else onOlder() }
                .tapWithoutConsuming {
                    if (System.currentTimeMillis() - openedAt >= 600) onDismiss()
                },
            contentAlignment = Alignment.Center,
        ) {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                ),
                shape = RoundedCornerShape(16.dp),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onOlder) {
                            Text("‹", style = MaterialTheme.typography.headlineMedium)
                        }
                        Column(
                            Modifier.weight(1f),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                title,
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.testTag("switcherTitle"),
                            )
                            Text(position, style = MaterialTheme.typography.bodySmall)
                        }
                        IconButton(onClick = onNewer) {
                            Text("›", style = MaterialTheme.typography.headlineMedium)
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = onNew) {
                            Text("+", style = MaterialTheme.typography.headlineMedium)
                        }
                        IconButton(onClick = onDelete) {
                            Glyph(DeleteIcon, "Delete chat")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun FindBar(
    query: String,
    position: Int,
    total: Int,
    onQuery: (String) -> Unit,
    onPrev: () -> Unit,
    onNext: () -> Unit,
    onClose: () -> Unit,
) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = onQuery,
            placeholder = { Text("Find in chat") },
            singleLine = true,
            modifier = Modifier.weight(1f),
        )
        Text("$position/$total", Modifier.padding(horizontal = 8.dp))
        TextButton(onClick = onPrev) { Text("↑") }
        TextButton(onClick = onNext) { Text("↓") }
        TextButton(onClick = onClose) { Text("✕") }
    }
}

/**
 * Empty-state hero (Tauri parity): centered prompt plus the four
 * reply-language menus. Picking a language pills the active chat
 * (tapping it again clears); the badge rides the send button.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LanguageHero(activeReply: String?, onPick: (String) -> Unit) {
    var openMenu by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "What can I do for you?",
            style = MaterialTheme.typography.headlineMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        // Small pills that fit one centered row on a phone, no scroll.
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
        ) {
            LANGUAGE_MENUS.forEach { menu ->
                val selected = menu.languages.any { it.code == activeReply }
                Box {
                    Box(
                        Modifier
                            .border(
                                1.dp,
                                if (selected) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.outline,
                                RoundedCornerShape(8.dp),
                            )
                            .background(
                                if (selected) MaterialTheme.colorScheme.secondaryContainer
                                else androidx.compose.ui.graphics.Color.Transparent,
                                RoundedCornerShape(8.dp),
                            )
                            .clickable { openMenu = if (openMenu == menu.id) null else menu.id }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Text("${menu.marker} ${menu.label}", fontSize = 12.sp, maxLines = 1)
                    }
                    DropdownMenu(
                        expanded = openMenu == menu.id,
                        onDismissRequest = { openMenu = null },
                    ) {
                        // Bare rows, not menu items: item chrome enforces
                        // ~48dp rows and the gaps read gigantic.
                        menu.languages.sortedBy { it.name }.forEach { lang ->
                            val langSelected = activeReply == lang.code
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth()
                                    .clickable { openMenu = null; onPick(lang.code) }
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                            ) {
                                Text(
                                    "${lang.badge} ${lang.name}",
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.weight(1f),
                                )
                                if (langSelected) {
                                    Text("✓", fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Content swipe (Tauri contentSwipeTarget/edgeSwipeTarget parity): a
 * mostly-horizontal stroke routes panels. Rightward strokes open the
 * chats list only from the thumb-wide edge zone ([edgeDp], zero
 * disables); mid-screen rightward only dismisses, leftward routes to
 * settings or folds the open panel. Purely observational — nothing is
 * consumed, so scrolling, folds, the drawers, and text fields keep
 * their gestures (strokes they claim stand this down); vertical drift
 * never qualifies. Belongs on non-interactive containers only
 * (sliders and fields would read their own drags as swipes).
 */
@Composable
fun Modifier.contentSwipe(
    // State key: routing reads panel state, so tracking restarts when it
    // flips — otherwise a swipe would act on a stale panel.
    key: Any? = Unit,
    edgeDp: androidx.compose.ui.unit.Dp = 0.dp,
    onSwipeLeft: () -> Unit = {},
    onSwipeRight: () -> Unit = {},
    onEdgeSwipeRight: () -> Unit = {},
): Modifier {
    val latestLeft by rememberUpdatedState(onSwipeLeft)
    val latestRight by rememberUpdatedState(onSwipeRight)
    val latestEdge by rememberUpdatedState(onEdgeSwipeRight)
    return pointerInput(key, edgeDp) {
        val minPx = 64.dp.toPx()
        val edgePx = edgeDp.toPx()
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var last = down.position
            do {
                val event = awaitPointerEvent()
                // Owned elsewhere (message fold, scrollers, fields) or
                // multifinger (the multitouch detector owns those): stand down.
                if (event.changes.all { it.isConsumed }) return@awaitEachGesture
                if (event.changes.count { it.pressed } > 1) return@awaitEachGesture
                event.changes.firstOrNull()?.let { last = it.position }
                if (event.changes.all { !it.pressed }) break
            } while (true)
            val dx = last.x - down.position.x
            val dy = last.y - down.position.y
            when (contentSwipeTarget(0f, 0f, dx, dy, minPx)) {
                EdgePanel.CHATS ->
                    if (edgePx > 0f && down.position.x <= edgePx) latestEdge()
                    else latestRight()
                EdgePanel.SETTINGS -> latestLeft()
                null -> Unit
            }
        }
    }
}

/**
 * Pinch zoom on a message (desktop pinch parity): two fingers spreading
 * or pinching scale the text size live. Single-finger touches pass
 * through untouched — scroll, fold, and selection never notice. Only
 * exactly two pressed fingers drive (a third joining pauses), and only
 * their moves are claimed.
 */
@Composable
fun Modifier.pinchZoom(onZoom: (Float) -> Unit): Modifier {
    val latest by rememberUpdatedState(onZoom)
    return pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false)
            var lastDist = 0f
            do {
                val event = awaitPointerEvent()
                if (event.changes.all { it.isConsumed }) return@awaitEachGesture
                val pressed = event.changes.filter { it.pressed }
                if (pressed.size == 2) {
                    val dist = (pressed[0].position - pressed[1].position).getDistance()
                    if (lastDist > 0f && dist > 0f && dist != lastDist) {
                        event.changes.forEach { it.consume() }
                        latest(dist / lastDist)
                    }
                    lastDist = dist
                } else {
                    lastDist = 0f
                }
                if (event.changes.all { !it.pressed }) break
            } while (true)
        }
    }
}

/**
 * Horizontal cycle stroke (switcher overlay): a dominant sideways
 * stroke past the minimum fires once with its direction. Claims the
 * stroke so list scrolls stand down.
 */
@Composable
fun Modifier.cycleSwipe(onCycle: (newer: Boolean) -> Unit): Modifier {
    val latest by rememberUpdatedState(onCycle)
    return pointerInput(Unit) {
        val minPx = 64.dp.toPx()
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var dx = 0f
            var last = down.position
            var done = false
            do {
                val event = awaitPointerEvent()
                if (event.changes.all { it.isConsumed }) return@awaitEachGesture
                val change = event.changes.firstOrNull() ?: break
                if (!change.pressed) break
                dx += change.position.x - last.x
                last = change.position
                val dy = change.position.y - down.position.y
                if (!done && kotlin.math.abs(dx) > minPx &&
                    kotlin.math.abs(dx) > kotlin.math.abs(dy)
                ) {
                    done = true
                    event.changes.forEach { it.consume() }
                    // Right steps newer, left older (three-finger convention).
                    latest(dx > 0)
                }
                if (event.changes.all { !it.pressed }) break
            } while (true)
        }
    }
}

/**
 * Tap without consuming (empty-space focus): fires on a small-movement
 * down/up pair and observes everything else. Unlike clickable it never
 * claims pointer events, so swipe routers above keep working; taps
 * already owned below (pills) stand this down via the consumed-up
 * check. The callback always reads fresh.
 */
@Composable
fun Modifier.tapWithoutConsuming(onTap: () -> Unit): Modifier {
    val latest by rememberUpdatedState(onTap)
    return pointerInput(Unit) {
        val slop = viewConfiguration.touchSlop
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            // Consumption-blind release watch (message-tap lesson): the
            // release still arrives via awaitPointerEvent, only flagged.
            // A release owned below (consumed) stands this tap down.
            var last = down.position
            var owned = false
            withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                while (true) {
                    val event = awaitPointerEvent()
                    event.changes.firstOrNull()?.let { last = it.position }
                    if (event.changes.any { it.isConsumed }) owned = true
                    if (event.changes.all { !it.pressed }) break
                }
            } ?: return@awaitEachGesture
            if (owned) return@awaitEachGesture
            val dx = last.x - down.position.x
            val dy = last.y - down.position.y
            if (dx * dx + dy * dy <= slop * slop) latest()
        }
    }
}

/**
 * Message fold stroke (desktop parity: a stroke starting on a message
 * toggles its fold either way, never the panels). Horizontal-dominant
 * drags are consumed so the content swipe and the list scroll stand
 * down; vertical travel and taps pass through to scroll and selection
 * untouched. The callback always reads fresh (the detector
 * outlives recompositions).
 */
@Composable
fun Modifier.foldSwipe(onToggle: () -> Unit): Modifier {
    val latest by rememberUpdatedState(onToggle)
    return pointerInput(Unit) {
        val slop = viewConfiguration.touchSlop
        val minPx = 64.dp.toPx()
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            // Thumb-wide edge zone belongs to the chats drawer (same 64dp
            // the content swipe uses): a stroke starting here must summon
            // the list, never fold the message under it.
            if (down.position.x <= 64.dp.toPx()) return@awaitEachGesture
            var last = down.position
            var claimed = false
            do {
                val event = awaitPointerEvent()
                if (event.changes.all { it.isConsumed }) return@awaitEachGesture
                // One finger only: multifinger strokes belong to the
                // multitouch detector (chat steps), never the fold.
                if (event.changes.count { it.pressed } > 1) return@awaitEachGesture
                event.changes.firstOrNull()?.let { last = it.position }
                val dx = last.x - down.position.x
                val dy = last.y - down.position.y
                if (!claimed && kotlin.math.abs(dx) > slop && kotlin.math.abs(dx) > kotlin.math.abs(dy)) {
                    claimed = true
                }
                if (claimed) event.changes.forEach { it.consume() }
                if (event.changes.all { !it.pressed }) break
            } while (true)
            if (!claimed) return@awaitEachGesture
            val dx = last.x - down.position.x
            if (kotlin.math.abs(dx) >= minPx) latest()
        }
    }
}

/** Two-finger tap windows and holds, in milliseconds (Tauri tap parity). */
internal const val MULTI_TAP_MS = 350L
private const val THREE_FINGER_HOLD_MS = 600L
internal const val TAP_SLOP_PX = 12f

/**
 * Multi-finger commands on message content: two-finger swipes jump
 * (up/down) and route panels (left/right, anywhere on content), a
 * two-finger double-tap jumps to the thread bottom, three-finger
 * swipes step chats newer/older, and a still three-finger 600ms hold
 * wipes every chat. Three-finger quick taps belong to the message
 * under them (see threeFingerTap). Consumed movement (list scrolls)
 * still counts toward swipe travel — the jumps land absolute — but
 * taps owned below never double-fire here.
 */
@Composable
fun Modifier.touchCommands(
    onTwoFingerDoubleTap: () -> Unit,
    onThreeFingerHold: () -> Unit,
    onTwoFingerSwipe: (SwipeDir) -> Unit = {},
    onThreeFingerSwipe: (SwipeDir) -> Unit = {},
    /** Two-finger still hold: the chat switcher. */
    onTwoFingerHold: () -> Unit = {},
    /** Single-finger double-tap on unowned background: also the switcher. */
    onBackgroundDoubleTap: () -> Unit = {},
): Modifier {
    val latestDouble by rememberUpdatedState(onTwoFingerDoubleTap)
    val latestHold by rememberUpdatedState(onThreeFingerHold)
    val latestTwoSwipe by rememberUpdatedState(onTwoFingerSwipe)
    val latestThreeSwipe by rememberUpdatedState(onThreeFingerSwipe)
    val latestTwoHold by rememberUpdatedState(onTwoFingerHold)
    val latestBgDouble by rememberUpdatedState(onBackgroundDoubleTap)
    val holdScope = rememberCoroutineScope()
    return pointerInput(Unit) {
        val minSwipe = 64.dp.toPx()
        var twoTap: TapSequence? = null
        var oneTap: TapSequence? = null
        awaitEachGesture {
            val first = awaitFirstDown(requireUnconsumed = false)
            val t0 = System.currentTimeMillis()
            val positions = mutableMapOf(first.id to first.position)
            val starts = mutableMapOf(first.id to first.position)
            val ends = mutableMapOf<androidx.compose.ui.input.pointer.PointerId, androidx.compose.ui.geometry.Offset>()
            var maxCount = 1
            var maxMove = 0f
            var ownedElsewhere = false
            var holdJob: kotlinx.coroutines.Job? = null
            var holdFired = false
            var twoHoldJob: kotlinx.coroutines.Job? = null
            var twoHoldFired = false
            try {
                do {
                    val event = awaitPointerEvent()
                    if (event.changes.all { it.isConsumed }) ownedElsewhere = true
                    for (change in event.changes) {
                        if (change.pressed) {
                            val prev = positions[change.id]
                            if (prev == null) {
                                positions[change.id] = change.position
                                starts[change.id] = change.position
                            } else {
                                maxMove = maxOf(maxMove, (change.position - prev).getDistance())
                            }
                            ends[change.id] = change.position
                        } else {
                            positions.remove(change.id)
                        }
                    }
                    maxCount = maxOf(maxCount, positions.size)
                    if (positions.size == 3 && holdJob == null && !holdFired) {
                        holdJob = holdScope.launch {
                            kotlinx.coroutines.delay(THREE_FINGER_HOLD_MS)
                            if (positions.size == 3 && maxMove <= TAP_SLOP_PX) {
                                holdFired = true
                                latestHold()
                            }
                        }
                    }
                    if (maxMove > TAP_SLOP_PX || positions.size < 3) holdJob?.cancel()
                    if (positions.size == 2 && twoHoldJob == null && !twoHoldFired) {
                        twoHoldJob = holdScope.launch {
                            kotlinx.coroutines.delay(THREE_FINGER_HOLD_MS)
                            if (positions.size == 2 && maxMove <= TAP_SLOP_PX) {
                                twoHoldFired = true
                                latestTwoHold()
                            }
                        }
                    }
                    if (maxMove > TAP_SLOP_PX || positions.size != 2) twoHoldJob?.cancel()
                    if (positions.isEmpty()) break
                } while (true)
            } finally {
                holdJob?.cancel()
                twoHoldJob?.cancel()
            }
            if (holdFired || twoHoldFired) return@awaitEachGesture
            // Combined travel: pinches cancel out and route nothing.
            val vecs = starts.mapNotNull { (id, start) ->
                ends[id]?.let { end ->
                    androidx.compose.ui.geometry.Offset(end.x - start.x, end.y - start.y)
                }
            }
            val dir = combinedSwipe(vecs, minSwipe)
            if (dir != null && (maxCount == 2 || maxCount == 3)) {
                twoTap = null
                oneTap = null
                if (maxCount == 2) latestTwoSwipe(dir) else latestThreeSwipe(dir)
                return@awaitEachGesture
            }
            if (ownedElsewhere) return@awaitEachGesture
            val dt = System.currentTimeMillis() - t0
            if (dt <= MULTI_TAP_MS && maxMove <= TAP_SLOP_PX && maxCount == 2) {
                twoTap = nextTapCount(twoTap, t0, first.position.x, first.position.y)
                if (twoTap?.count == 2) {
                    twoTap = null
                    latestDouble()
                }
            }
            if (dt <= MULTI_TAP_MS && maxMove <= TAP_SLOP_PX && maxCount == 1) {
                oneTap = nextTapCount(oneTap, t0, first.position.x, first.position.y)
                if (oneTap?.count == 2) {
                    oneTap = null
                    latestBgDouble()
                }
            }
        }
    }
}

/**
 * Three-finger quick tap on one message (Tauri "Delete a message"
 * parity): deletes the tapped message. Holds belong to the content
 * detector (wipe-all) and pass through here untouched.
 */
@Composable
fun Modifier.threeFingerTap(onTap: () -> Unit): Modifier {
    val latest by rememberUpdatedState(onTap)
    return pointerInput(Unit) {
        awaitEachGesture {
            val first = awaitFirstDown(requireUnconsumed = false)
            val t0 = System.currentTimeMillis()
            val positions = mutableMapOf(first.id to first.position)
            var maxCount = 1
            var maxMove = 0f
            do {
                val event = awaitPointerEvent()
                if (event.changes.all { it.isConsumed }) return@awaitEachGesture
                for (change in event.changes) {
                    if (change.pressed) {
                        val prev = positions[change.id]
                        if (prev == null) positions[change.id] = change.position
                        else maxMove = maxOf(maxMove, (change.position - prev).getDistance())
                    } else {
                        positions.remove(change.id)
                    }
                }
                maxCount = maxOf(maxCount, positions.size)
                if (positions.isEmpty()) break
            } while (true)
            val dt = System.currentTimeMillis() - t0
            if (!first.isConsumed && dt <= MULTI_TAP_MS && maxMove <= TAP_SLOP_PX && maxCount == 3) {
                latest()
            }
        }
    }
}

/**
 * Composer strokes are cursor/scroll work (desktop parity): claim
 * horizontal drags nobody owns so panel swipes never start here.
 * Selection and cursor drags consume first and pass through.
 */
fun Modifier.swipeTrap(): Modifier = pointerInput(Unit) {
    val slop = viewConfiguration.touchSlop
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false)
        var last = down.position
        do {
            val event = awaitPointerEvent()
            if (event.changes.all { it.isConsumed }) return@awaitEachGesture
            event.changes.firstOrNull()?.let { last = it.position }
            val dx = last.x - down.position.x
            val dy = last.y - down.position.y
            if (kotlin.math.abs(dx) > slop && kotlin.math.abs(dx) > kotlin.math.abs(dy)) {
                event.changes.forEach { it.consume() }
            }
            if (event.changes.all { !it.pressed }) break
        } while (true)
    }
}

@Composable
fun AnnotateDialog(
    messageText: String,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
    onInspect: ((String) -> Unit)? = null,
    initialQuote: String? = null,
    initialComment: String = "",
) {
    var quote by remember(messageText, initialQuote) {
        mutableStateOf(initialQuote?.take(500) ?: messageText.take(500))
    }
    var comment by remember(initialComment) { mutableStateOf(initialComment) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Annotate") },
        text = {
            Column {
                OutlinedTextField(
                    value = quote,
                    onValueChange = { quote = it },
                    label = { Text("Quote") },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 4,
                )
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Note (folds into your next message)") },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    maxLines = 4,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(quote, comment) }, enabled = quote.isNotBlank()) { Text("Save") }
        },
        dismissButton = {
            Row {
                if (onInspect != null && studio.ccez.app.domain.shouldShowInspect(quote, true)) {
                    TextButton(onClick = { onInspect(quote.trim()) }) { Text("Inspect") }
                }
                TextButton(onClick = onDismiss) { Text("Cancel") }
            }
        },
    )
}

/**
 * Live message selection docked in the composer (Tauri ann-dock
 * parity): redundant with the message's own selection menu, minus
 * Copy. Null when nothing is selected.
 */
data class ComposerSelection(
    val quote: String,
    val onAnnotate: () -> Unit,
    val onSpeak: () -> Unit,
    val onInspect: (() -> Unit)? = null,
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Composer(
    draft: String,
    sending: Boolean,
    /** Focus handle for post-switch new chats (Tauri doNewChat lands in the prompt). */
    focus: FocusRequester? = null,
    /** Bump to move focus into the field; consumed as a LaunchedEffect key. */
    focusTick: Int = 0,
    dictating: Boolean = false,
    staged: List<Attachment> = emptyList(),
    onDraft: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onMic: () -> Unit = {},
    micEnabled: Boolean = true,
    /** Voice-readback default; the toggle lives here, next to mic. */
    voiceOn: Boolean = false,
    onToggleVoice: () -> Unit = {},
    /** Reply-language badge riding the send button; null = plain arrow. */
    sendBadge: String? = null,
    fontScale: Float = 1f,
    onAttach: () -> Unit = {},
    onUnstage: (String) -> Unit = {},
    onOcr: (String) -> Unit = {},
    /** Live selection dock (Annotate/Speak/Inspect, no Copy); null hides it. */
    selection: ComposerSelection? = null,
    /** Quick navigation (Tauri wp-jump parity): shown only for long threads. */
    showJump: Boolean = false,
    jumpPoints: List<Int> = emptyList(),
    onJump: (Int) -> Unit = {},
    /**
     * Send-button hold (Tauri send-hold parity): the caller gates this on
     * an empty composer — holding swaps the reply language, releasing a
     * sendable draft still sends.
     */
    onSendHold: (() -> Unit)? = null,
) {
    var jumpOpen by remember { mutableStateOf(false) }
    LaunchedEffect(focusTick) {
        if (focusTick > 0) runCatching { focus?.requestFocus() }
    }
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            MaterialTheme.colorScheme.outline,
        ),
        modifier = Modifier.fillMaxWidth().padding(12.dp).swipeTrap(),
    ) {
        Column(Modifier.padding(8.dp)) {
            if (staged.isNotEmpty()) {
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    staged.forEach { a ->
                        if (a.kind == "image" && a.dataUrl != null) {
                            StagedImageCard(a = a, onUnstage = onUnstage, onOcr = onOcr)
                        } else {
                            AssistChip(
                                onClick = { onUnstage(a.id) },
                                leadingIcon = { Glyph(AttachIcon, null) },
                                label = { Text("${a.name.take(18)} · ~${a.tokens} tok ×") },
                            )
                        }
                    }
                }
            }
            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                modifier = Modifier.fillMaxWidth()
                    .testTag("composerField")
                    .then(if (focus != null) Modifier.focusRequester(focus) else Modifier),
                // Fixed size on purpose: the text-size setting scales
                // reading, never typing.
                textStyle = androidx.compose.material3.LocalTextStyle.current.copy(
                    fontSize = 18.sp,
                ),
                placeholder = { Text("Type a message") },
                // Phone discipline (Tauri enterSubmits=false): Enter is
                // a carriage return — only the send button submits. The
                // field stays multi-line with a neutral IME action, so
                // the keyboard offers newline, never send. singleLine
                // must stay false or Enter would submit on hardware keys.
                singleLine = false,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                // One geometry (Tauri one-geometry): a fixed compact
                // default that grows only with content lines — fresh,
                // focus, first character, and emptied-after-send share
                // the same single-line size; the field scrolls past cap.
                minLines = COMPOSER_MIN_LINES,
                maxLines = COMPOSER_MAX_LINES,
                shape = RoundedCornerShape(8.dp),
                colors = androidx.compose.material3.OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedBorderColor = androidx.compose.ui.graphics.Color.Transparent,
                ),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onAttach, enabled = !sending) {
                    Glyph(AttachIcon, "Attach images or files")
                }
                if (micEnabled) {
                    val micGlow = if (dictating) {
                        Modifier.background(
                            androidx.compose.ui.graphics.Color(0xFFE53935).copy(alpha = 0.14f),
                            CircleShape,
                        )
                    } else {
                        Modifier
                    }
                    IconButton(onClick = onMic, enabled = !sending, modifier = micGlow) {
                        Glyph(
                            MicIcon,
                            if (dictating) "Stop dictation" else "Dictate into the prompt",
                            tint = if (dictating) androidx.compose.ui.graphics.Color(0xFFE53935)
                            else androidx.compose.material3.LocalContentColor.current,
                        )
                    }
                }
                IconButton(onClick = onToggleVoice, enabled = !sending) {
                    Glyph(
                        SpeakIcon,
                        if (voiceOn) "Voice readback on" else "Voice readback off",
                        tint = if (voiceOn) androidx.compose.ui.graphics.Color(0xFF4CAF50)
                        else androidx.compose.material3.LocalContentColor.current,
                    )
                }
                // Selection dock (Tauri ann-dock parity): the message's
                // Annotate/Speak/Inspect, thumb-reachable in the prompt.
                // Copy stays menu-only. Shown only while selected text
                // stands (see showComposerSelectionActions).
                val dock = selection?.takeIf { showComposerSelectionActions(it.quote) }
                if (dock != null) {
                    IconButton(onClick = dock.onAnnotate, enabled = !sending) {
                        Glyph(PencilIcon, "Annotate selection")
                    }
                    IconButton(onClick = dock.onSpeak, enabled = !sending) {
                        Glyph(SpeakIcon, "Speak selection")
                    }
                    if (dock.onInspect != null) {
                        IconButton(onClick = dock.onInspect, enabled = !sending) {
                            Glyph(MarkIcon, "Inspect selection")
                        }
                    }
                }
                // Jump-to-message (Tauri wp-jump parity): attach, audio,
                // jump order; only long threads earn the slot.
                if (showJump) {
                    Box {
                        IconButton(onClick = { jumpOpen = true }, enabled = !sending) {
                            Glyph(JumpIcon, "Jump to a message")
                        }
                        DropdownMenu(
                            expanded = jumpOpen,
                            onDismissRequest = { jumpOpen = false },
                        ) {
                            jumpPoints.forEachIndexed { i, idx ->
                                DropdownMenuItem(
                                    text = { Text("§${i + 1}") },
                                    onClick = { jumpOpen = false; onJump(idx) },
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.weight(1f))
                if (sending) {
                    TextButton(onClick = onStop) { Text("Stop") }
                } else {
                    val latestHold by rememberUpdatedState(onSendHold)
                    Button(
                        onClick = onSend,
                        enabled = draft.isNotBlank() || staged.isNotEmpty(),
                        shape = CircleShape,
                        contentPadding = PaddingValues(0.dp),
                        modifier = Modifier.size(44.dp).pointerInput(Unit) {
                            // A disabled send button takes no clicks, so an
                            // empty-composer hold reaches this detector; a
                            // sendable hold releases into the normal send.
                            // Manual long-press (not detectTapGestures): the
                            // down must count even if an ancestor observes it.
                            awaitEachGesture {
                                val down = awaitFirstDown(requireUnconsumed = false)
                                val up = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                                    waitForUpOrCancellation()
                                }
                                if (up == null) {
                                    latestHold?.invoke()
                                }
                            }
                        },
                    ) {
                        if (sendBadge != null) {
                            Text(sendBadge, fontSize = 22.sp)
                        } else {
                            // Optical nudge: the plane's ink mass reads a
                            // hair right of the circle's center.
                            Glyph(
                                SendIcon,
                                "Send",
                                modifier = Modifier.offset(x = (-1).dp),
                                iconSize = 20.dp,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Staged image preview (desktop sent-card parity): thumbnail, name,
 * remove, and OCR — instead of a bare chip.
 */
@Composable
private fun StagedImageCard(
    a: Attachment,
    onUnstage: (String) -> Unit,
    onOcr: (String) -> Unit,
) {
    val bitmap = remember(a.id, a.dataUrl) { decodeDataUrlBitmap(a.dataUrl) }
    Card(shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.padding(6.dp)) {
            if (bitmap != null) {
                Image(
                    bitmap.asImageBitmap(),
                    contentDescription = a.name,
                    modifier = Modifier.size(96.dp)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    a.name.take(14),
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    modifier = Modifier.weight(1f, fill = false),
                )
                IconButton(onClick = { onOcr(a.id) }, modifier = Modifier.size(28.dp)) {
                    Text("OCR", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = { onUnstage(a.id) }, modifier = Modifier.size(28.dp)) {
                    Glyph(CloseIcon, "Remove attachment", iconSize = 14.dp)
                }
            }
        }
    }
}

private fun decodeDataUrlBitmap(dataUrl: String?): android.graphics.Bitmap? = runCatching {
    val base64 = dataUrl!!.substringAfter("base64,")
    val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}.getOrNull()

/**
 * Per-chat options: reply-language pill (also steers Han-only aid lines)
 * and the voice-readback override. Stored on the chat like Tauri.
 */
@Composable
fun ChatOptionsDialog(chat: Chat, onDismiss: () -> Unit, onSave: (String?, Boolean?) -> Unit) {
    var replyLang by remember(chat.id) { mutableStateOf(chat.replyLang ?: "") }
    var voice by remember(chat.id) { mutableStateOf(chat.voice) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(timestampLabel(chat.createdAt)) },
        text = {
            Column {
                OutlinedTextField(
                    value = replyLang,
                    onValueChange = { replyLang = it },
                    label = { Text("Reply language (blank = off; ja zh yue fr…)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Voice:", Modifier.padding(end = 4.dp))
                    TextButton(onClick = { voice = null }) { Text(if (voice == null) "● Auto" else "Auto") }
                    TextButton(onClick = { voice = true }) { Text(if (voice == true) "● On" else "On") }
                    TextButton(onClick = { voice = false }) { Text(if (voice == false) "● Off" else "Off") }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(replyLang.ifBlank { null }, voice) }) { Text("Save") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private enum class SettingsValue { Closed, Open }

/**
 * Settings slide-over: the chats drawer's mirror. It follows the finger
 * and settles with a fling; dragging it shut reports close exactly like
 * tapping the scrim, and the scrim fades with the drag.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun SettingsPanel(vm: ChatViewModel, visible: Boolean, onClose: () -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val density = LocalDensity.current
        val widthPx = with(density) { maxWidth.toPx() }
        val anchors = remember(widthPx) {
            DraggableAnchors<SettingsValue> {
                SettingsValue.Closed at widthPx
                SettingsValue.Open at 0f
            }
        }
        val state = remember(anchors) {
            AnchoredDraggableState(
                initialValue = SettingsValue.Closed,
                anchors = anchors,
                positionalThreshold = { distance -> distance * 0.5f },
                velocityThreshold = { with(density) { 125.dp.toPx() } },
                snapAnimationSpec = tween(250),
                decayAnimationSpec = androidx.compose.animation.core.exponentialDecay(),
            )
        }
        LaunchedEffect(visible) {
            state.animateTo(if (visible) SettingsValue.Open else SettingsValue.Closed)
        }
        LaunchedEffect(state.settledValue) {
            if (state.settledValue == SettingsValue.Closed && visible) onClose()
        }
        val offset = state.offset ?: widthPx
        if (offset < widthPx) {
            val fraction = (offset / widthPx).coerceIn(0f, 1f)
            Box(
                Modifier.fillMaxSize()
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f * (1f - fraction)))
                    .clickable(onClick = onClose),
            )
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) {
                ModalDrawerSheet(
                    modifier = Modifier
                        .offset { androidx.compose.ui.unit.IntOffset(offset.roundToInt(), 0) }
                        .anchoredDraggable(
                            state = state,
                            orientation = androidx.compose.foundation.gestures.Orientation.Horizontal,
                        ),
                    drawerContainerColor = MaterialTheme.colorScheme.surface,
                ) {
                    SettingsScreen(vm, onBack = onClose)
                }
            }
        }
    }
}

/**
 * Chats drawer (Tauri sidebar parity): inline search, one row per
 * chat with export + delete, then New and Settings at the bottom.
 */
@Composable
fun ChatDrawer(
    chats: List<Chat>,
    activeId: ChatId?,
    onPick: (ChatId) -> Unit,
    onNew: () -> Unit,
    onDelete: (ChatId) -> Unit,
    onSearch: () -> Unit = {},
    onExport: (ChatId) -> Unit = {},
    onOptions: (Chat) -> Unit = {},
    onOpenSettings: () -> Unit = {},
    /** Leftward sheet stroke folds the open list (Tauri drawer parity). */
    onClose: () -> Unit = {},
) {
    var query by remember { mutableStateOf("") }
    val visible = remember(chats, query) {
        if (query.isBlank()) chats else chats.filter { chat ->
            chat.messages.any { it.content.contains(query, ignoreCase = true) }
        }
    }
    val drawerFocus = androidx.compose.ui.platform.LocalFocusManager.current
    val drawerKeyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    // Tapping off the search field drops focus and the keyboard.
    Column(
        Modifier.fillMaxSize().padding(16.dp)
            // Sheet strokes report close; field drags, buttons, and the
            // list scroll claim their own and stand this down.
            .contentSwipe(onSwipeLeft = onClose)
            .clickable(
                indication = null,
                interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                onClick = { drawerFocus.clearFocus(); drawerKeyboard?.hide() },
            ),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Search chats") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(top = 10.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            visible.forEach { chat ->
                val selected = chat.id == activeId
                val count = chat.messages.size
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(start = 4.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        TextButton(
                            onClick = { onPick(chat.id) },
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(
                                (if (selected) "● " else "○ ") + timestampLabel(chat.createdAt) +
                                    " · $count msg" + (if (count == 1) "" else "s"),
                                maxLines = 1,
                            )
                        }
                        IconButton(onClick = { onExport(chat.id) }) { Glyph(ExportIcon, "Export chat") }
                        IconButton(onClick = { onDelete(chat.id) }) { Glyph(CloseIcon, "Delete chat") }
                    }
                }
            }
        }
        OutlinedButton(
            onClick = onNew,
            modifier = Modifier.fillMaxWidth().height(56.dp).padding(top = 8.dp),
        ) { Text("+", fontSize = 22.sp) }
        OutlinedButton(
            onClick = onOpenSettings,
            modifier = Modifier.fillMaxWidth().height(56.dp).padding(top = 8.dp),
        ) { Text("Settings", fontSize = 18.sp) }
    }
}
