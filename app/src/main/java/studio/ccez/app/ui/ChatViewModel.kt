package studio.ccez.app.ui

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import studio.ccez.app.data.AppSettings
import studio.ccez.app.data.ChatRepository
import studio.ccez.app.data.FONT_SCALE_MAX
import studio.ccez.app.data.FONT_SCALE_MIN
import studio.ccez.app.data.InMemorySecretStore
import studio.ccez.app.data.OpenAiCompatClient
import studio.ccez.app.data.ProviderConfig
import studio.ccez.app.data.SecretStore
import studio.ccez.app.data.secretKeyFor
import studio.ccez.app.data.toWire
import studio.ccez.app.device.AppForeground
import studio.ccez.app.device.Dictator
import studio.ccez.app.device.FakeDictator
import studio.ccez.app.device.NoopReplyNotifier
import studio.ccez.app.device.ReplyNotifier
import studio.ccez.app.device.fetchPageText
import studio.ccez.app.device.replyPreview
import studio.ccez.app.device.shouldNotifyReply
import studio.ccez.app.domain.MISSING_KEY_ERROR_PREFIX
import studio.ccez.app.domain.effectiveSystemPrompt
import studio.ccez.app.domain.hostLabel
import studio.ccez.app.domain.effectiveReplyLang
import studio.ccez.app.domain.replyLanguageFor
import studio.ccez.app.domain.toggleReplyLang
import studio.ccez.app.domain.resolveThinkingId
import studio.ccez.app.domain.thinkingFor
import studio.ccez.app.device.FakeOcr
import studio.ccez.app.device.FakeOnDevice
import studio.ccez.app.device.FakeSpeaker
import studio.ccez.app.device.OcrReader
import studio.ccez.app.device.OnDeviceChat
import studio.ccez.app.device.Speaker
import studio.ccez.app.domain.AidSegment
import studio.ccez.app.domain.Annotation
import studio.ccez.app.domain.AnnotationId
import studio.ccez.app.domain.Attachment
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId
import studio.ccez.app.domain.ChatState
import studio.ccez.app.domain.FuriganaEngine
import studio.ccez.app.domain.LocalAid
import studio.ccez.app.domain.ProviderDef
import studio.ccez.app.domain.SearchDoc
import studio.ccez.app.domain.AnnotatedRun
import studio.ccez.app.domain.addAnnotation
import studio.ccez.app.domain.aidSegmentsFor
import studio.ccez.app.domain.annotatedRuns
import studio.ccez.app.domain.aidTargetLines
import studio.ccez.app.domain.appendMessage
import studio.ccez.app.domain.branchFrom
import studio.ccez.app.domain.IMAGE_MARKER
import studio.ccez.app.domain.MAX_FILE_CHARS
import studio.ccez.app.domain.clearChats
import studio.ccez.app.domain.deleteChat
import studio.ccez.app.domain.deleteMessage
import studio.ccez.app.domain.swapReplyLang
import studio.ccez.app.domain.editMessage
import studio.ccez.app.domain.estimateTextTokens
import studio.ccez.app.domain.getProviderDef
import studio.ccez.app.domain.listProviders
import studio.ccez.app.domain.newCustomProvider
import studio.ccez.app.domain.validateCustomProvider
import studio.ccez.app.domain.markSending
import studio.ccez.app.domain.updateChat
import studio.ccez.app.domain.preferredLocalAid
import studio.ccez.app.domain.redactedCopyText
import studio.ccez.app.domain.rerunFrom
import studio.ccez.app.domain.cycleChatId
import studio.ccez.app.domain.spliceAidResult
import studio.ccez.app.domain.stepChatId
import studio.ccez.app.domain.tashkeelMessages
import studio.ccez.app.domain.withAnnotations
import studio.ccez.app.domain.dictationHint
import studio.ccez.app.domain.quoteLangFor
import studio.ccez.app.domain.sentenceLangsFor
import studio.ccez.app.domain.speechText
import studio.ccez.app.domain.splitSpeechSegments

/**
 * Single ViewModel owns chat + settings for v1. Streaming appends tokens by
 * replacing the message object (never mutating), mirroring the Svelte frontend.
 */
class ChatViewModel(
    val repo: ChatRepository = ChatRepository(),
    private val secrets: SecretStore = InMemorySecretStore(),
    private val net: OpenAiCompatClient = OpenAiCompatClient(),
    val speaker: Speaker = FakeSpeaker(),
    val dictator: Dictator = FakeDictator(),
    val onDevice: OnDeviceChat = FakeOnDevice(),
    private val ocr: OcrReader = FakeOcr(),
    private val notifier: ReplyNotifier = NoopReplyNotifier(),
    private val pinyinReader: studio.ccez.app.domain.PinyinReader = studio.ccez.app.device.IcuPinyinReader(),
    private val aidDispatcher: kotlinx.coroutines.CoroutineDispatcher = kotlinx.coroutines.Dispatchers.Default,
) : ViewModel() {
    val state: StateFlow<ChatState> = repo.state

    private val _settings = MutableStateFlow(AppSettings())
    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft.asStateFlow()

    private val _providerId = MutableStateFlow("muse")
    val providerId: StateFlow<String> = _providerId.asStateFlow()

    /** Unsent annotation drafts per chat (persisted separately; baked blocks never persist as drafts). */
    private val _annotations = MutableStateFlow<Map<ChatId, List<Annotation>>>(emptyMap())
    val annotations: StateFlow<Map<ChatId, List<Annotation>>> = _annotations.asStateFlow()

    /** Jump-to-message request consumed by the chat screen (chat id + message index). */
    private val _jumpTo = MutableStateFlow<Pair<ChatId, Int>?>(null)
    val jumpTo: StateFlow<Pair<ChatId, Int>?> = _jumpTo.asStateFlow()

    /** Reading-aid engines: Kuromoji loads its dictionary lazily on first conversion. */
    private val furiganaEngine = FuriganaEngine()

    /** Pinned local aids per message (dual pins render each aid on its own lines). */
    private val _aidPins = MutableStateFlow<Map<ChatMsgId, Set<LocalAid>>>(emptyMap())
    val aidPins: StateFlow<Map<ChatMsgId, Set<LocalAid>>> = _aidPins.asStateFlow()

    /** Converted ruby segments per (message, pinned set). */
    private val _aidSegments = MutableStateFlow<Map<Pair<ChatMsgId, Set<LocalAid>>, List<AidSegment>>>(emptyMap())
    val aidSegments: StateFlow<Map<Pair<ChatMsgId, Set<LocalAid>>, List<AidSegment>>> = _aidSegments.asStateFlow()

    /** Tashkeel originals (memory-only): applied messages revert without losing text. */
    private val _tashkeelOriginal = MutableStateFlow<Map<ChatMsgId, String>>(emptyMap())
    val tashkeelOriginal: StateFlow<Map<ChatMsgId, String>> = _tashkeelOriginal.asStateFlow()

    /** Aid failures surfaced as toasts by the chat screen. */
    private val _aidError = MutableStateFlow<String?>(null)
    val aidError: StateFlow<String?> = _aidError.asStateFlow()

    /** Biometric key unlock: memory-only, dies with the process. */
    private var keysUnlocked = false

    /** Fetch_url round in flight (host label), shown as a chip while the model reads the web. */
    private val _fetching = MutableStateFlow<String?>(null)
    val fetching: StateFlow<String?> = _fetching.asStateFlow()

    /** On-device model readiness (probed on demand; mount probe hides ML Kit where unsupported). */
    private val _onDeviceStatus = MutableStateFlow<studio.ccez.app.device.OnDeviceStatus?>(null)
    val onDeviceStatus: StateFlow<studio.ccez.app.device.OnDeviceStatus?> = _onDeviceStatus.asStateFlow()

    fun probeOnDevice() {
        viewModelScope.launch {
            _onDeviceStatus.value = try {
                onDevice.status()
            } catch (e: Exception) {
                studio.ccez.app.device.OnDeviceStatus.Error(e.message ?: "failed")
            }
        }
    }

    private val _speaking = MutableStateFlow<ChatMsgId?>(null)
    val speaking: StateFlow<ChatMsgId?> = _speaking.asStateFlow()

    /** Per-chat options (reply-language pill, voice override). */
    /**
     * Empty-state language pick: the pill lives on the active chat
     * (a chat is created for it); tapping the active language clears.
     */
    fun pickReplyLang(code: String) {
        val chat = repo.current().activeChat ?: repo.newChat()
        repo.update { updateChat(it, chat.id) { c -> c.copy(replyLang = toggleReplyLang(c.replyLang, code)) } }
    }

    fun setReplyLang(chatId: ChatId, code: String?) {
        repo.update { updateChat(it, chatId) { c -> c.copy(replyLang = code?.trim()?.takeIf { s -> s.isNotEmpty() }) } }
    }

    /** Send-button hold stash, one per chat (Tauri replyLangStash parity). */
    private val replyLangStash = mutableMapOf<ChatId, String>()

    /** Send-hold outcome: the swap applied (with the new current language), or it was a no-op. */
    sealed interface ReplySwap {
        data class Applied(val current: String?, val stash: String? = null) : ReplySwap
        data object NoOp : ReplySwap
    }

    /**
     * Send-button hold swap (touch, empty composer): holding with a reply
     * language set stashes it and drops back to default; holding with
     * none restores the stash.
     */
    fun swapReplyLangHold(chatId: ChatId): ReplySwap {
        val current = repo.current().chats.find { it.id == chatId }?.replyLang
        val next = swapReplyLang(current, replyLangStash[chatId])
        if (next.current == current) return ReplySwap.NoOp
        if (next.stash != null) replyLangStash[chatId] = next.stash
        repo.update { updateChat(it, chatId) { c -> c.copy(replyLang = next.current) } }
        return ReplySwap.Applied(next.current, next.stash)
    }

    fun setChatVoice(chatId: ChatId, voice: Boolean?) {
        repo.update { updateChat(it, chatId) { c -> c.copy(voice = voice) } }
    }

    /**
     * Read one tapped word aloud in its own locale (stops message
     * speech first). The surrounding message seeds identification,
     * so an ASCII French word in a French message reads French
     * instead of the device locale.
     */
    fun speakWord(word: String, context: String? = null) {
        stopSpeaking()
        viewModelScope.launch {
            try {
                val device = java.util.Locale.getDefault().toLanguageTag()
                val seed =
                    if (context.isNullOrBlank()) device else quoteLangFor(context, device)
                val lang = quoteLangFor(word, seed)
                speaker.speakWord(word, lang)
            } catch (e: Exception) {
                if (e !is kotlinx.coroutines.CancellationException) {
                    _aidError.value = e.message ?: "speech failed"
                }
            }
        }
    }

    private var speakJob: Job? = null

    /** Cancel in-flight speech without touching anything else. */
    private fun stopSpeaking() {
        speakJob?.cancel()
        speakJob = null
        speaker.stop()
        _speaking.value = null
    }

    /**
     * Read the message aloud, one voice run per sentence (voice.ts
     * parity: markdown reduced to speech, each run in its own locale);
     * tapping again stops.
     */
    fun speak(msg: ChatMsg) {
        if (_speaking.value == msg.id) {
            stopSpeaking()
            return
        }
        stopSpeaking()
        speakJob = viewModelScope.launch {
            _speaking.value = msg.id
            try {
                val fallback = _settings.value.voiceLang
                    ?: java.util.Locale.getDefault().toLanguageTag()
                val clean = speechText(redactedCopyText(msg.content))
                val langFor = sentenceLangsFor(clean, fallback, fallback)
                val segments = splitSpeechSegments(clean, langFor)
                for (seg in segments) {
                    ensureActive()
                    speaker.speak(seg.text, { _, _ -> }, seg.lang)
                }
            } catch (e: Exception) {
                if (e !is kotlinx.coroutines.CancellationException) {
                    _aidError.value = e.message ?: "speech failed"
                }
            } finally {
                if (_speaking.value == msg.id) _speaking.value = null
            }
        }
    }

    /** Composer-staged attachments (images + inlined text). Sent with the next message, then cleared. */
    private val _staged = MutableStateFlow<List<Attachment>>(emptyList())
    val stagedAttachments: StateFlow<List<Attachment>> = _staged.asStateFlow()

    fun stageAttachment(attachment: Attachment) {
        _staged.update { cur ->
            if (cur.size >= 10) {
                _aidError.value = "At most 10 attachments per message"
                cur
            } else cur + attachment
        }
    }

    fun unstageAttachment(id: String) {
        _staged.update { cur -> cur.filterNot { it.id == id } }
    }

    /** OCR a staged image into a companion text attachment. */
    fun ocrStagedImage(id: String) {
        val att = _staged.value.find { it.id == id } ?: return
        val payload = att.dataUrl?.substringAfter(",", "")?.takeIf { it.isNotEmpty() } ?: run {
            _aidError.value = "No image data to read"
            return
        }
        viewModelScope.launch {
            try {
                val bytes = java.util.Base64.getDecoder().decode(payload)
                val text = ocr.recognize(bytes).trim()
                if (text.isEmpty()) {
                    _aidError.value = "No text found in image"
                    return@launch
                }
                val capped = if (text.length > MAX_FILE_CHARS) text.substring(0, MAX_FILE_CHARS) else text
                stageAttachment(
                    Attachment(
                        name = att.name + ".txt",
                        mimeType = "text/plain",
                        charCount = capped.length,
                        kind = "text",
                        text = capped,
                        tokens = estimateTextTokens(capped),
                    ),
                )
            } catch (e: Exception) {
                _aidError.value = e.message ?: "OCR failed"
            }
        }
    }

    /** One stream job per chat: switching, stopping, or rerunning never touches another chat. */
    private val sendJobs = mutableMapOf<ChatId, Job>()

    fun setDraft(v: String) { _draft.value = v }
    fun prefillShared(text: String) { _draft.value = text }
    /** Session-only per-chat scroll memory (desktop chatScrollTops parity; never persisted). */
    private val scrollMemory = mutableMapOf<ChatId, Pair<Int, Int>>()

    /** File the leaving chat's list position (first visible index + offset). */
    fun saveScroll(chatId: ChatId, index: Int, offset: Int) {
        scrollMemory[chatId] = index.coerceAtLeast(0) to offset.coerceAtLeast(0)
    }

    /**
     * Instant-restore target for the entering chat: the filed
     * position clamped to the list (offset dropped when the index
     * clamps), else the top like a fresh chat.
     */
    fun restoreScroll(chatId: ChatId, messageCount: Int): Pair<Int, Int> {
        if (messageCount <= 0) return 0 to 0
        val (index, offset) = scrollMemory[chatId] ?: return 0 to 0
        if (index >= messageCount) return (messageCount - 1) to 0
        return index to offset
    }

    fun selectChat(id: ChatId) { repo.update { it.copy(activeChatId = id) } }
    fun newChat() { repo.newChat() }
    fun deleteChat(id: ChatId) {
        sendJobs.remove(id)?.cancel()
        scrollMemory.remove(id)
        repo.update { deleteChat(it, id) }
    }
    /** Three-finger hold wipe (Tauri dropAllChats parity): the thread becomes one blank chat. */
    fun clearChats() {
        sendJobs.values.forEach { it.cancel() }
        sendJobs.clear()
        scrollMemory.clear()
        repo.update { clearChats(it) }
    }

    /** Boot: the drawer always lists the open chat, even before its first message. */
    fun ensureChat() { if (repo.current().chats.isEmpty()) repo.newChat() }
    fun deleteMessage(chatId: ChatId, msgId: ChatMsgId) { repo.update { deleteMessage(it, chatId, msgId) } }
    fun editMessage(chatId: ChatId, msgId: ChatMsgId, content: String) { repo.update { editMessage(it, chatId, msgId, content) } }
    fun branchFrom(chatId: ChatId, msgId: ChatMsgId) { repo.update { branchFrom(it, chatId, msgId) } }
    fun setTheme(mode: AppSettings.ThemeMode) { _settings.update { it.copy(themeMode = mode) } }
    fun setSystemPrompt(v: String) { _settings.update { it.copy(systemPrompt = v) } }
    fun setVoiceDefault(v: Boolean) { _settings.update { it.copy(voiceDefault = v) } }
    fun setReplyLangDefault(code: String?) { _settings.update { it.copy(replyLang = code) } }
    fun setVoiceLang(tag: String?, pinned: Boolean) {
        _settings.update { it.copy(voiceLang = tag, voiceLangPinned = pinned) }
    }
    fun setNativeVoiceId(id: String?) { _settings.update { it.copy(nativeVoiceId = id) } }
    fun setMicEnabled(v: Boolean) { _settings.update { it.copy(micEnabled = v) } }
    fun setFontScale(v: Float) { _settings.update { it.copy(fontScale = v) } }
    fun setMessageGap(v: Float) { _settings.update { it.copy(messageGap = v) } }
    fun setOwnBubble(v: Boolean) { _settings.update { it.copy(ownBubble = v) } }
    fun setAiBubble(v: Boolean) { _settings.update { it.copy(aiBubble = v) } }
    fun setScaleActionsWithFont(v: Boolean) { _settings.update { it.copy(scaleActionsWithFont = v) } }
    fun setShowMessageButtons(v: Boolean) { _settings.update { it.copy(showMessageButtons = v) } }
    fun setHideButtons(v: Boolean) { _settings.update { it.copy(hideButtons = v) } }
    fun setHideUntilTapped(v: Boolean) { _settings.update { it.copy(hideUntilTapped = v) } }
    fun setAutoSpeakSelection(v: Boolean) { _settings.update { it.copy(autoSpeakSelection = v) } }
    fun setHapticsDisabled(v: Boolean) { _settings.update { it.copy(hapticsDisabled = v) } }
    fun setReplyNotifications(v: Boolean) { _settings.update { it.copy(replyNotifications = v) } }
    fun setInspectEnabled(v: Boolean) { _settings.update { it.copy(inspectEnabled = v) } }
    fun setPromptIdleSec(v: Int) { _settings.update { it.copy(promptIdleSec = v) } }

    /**
     * System prompt for one send: custom base, then the thinking hint
     * for the resolved rung, then the reply-language suffix.
     */
    private fun systemPromptFor(replyLang: String?, cfg: ProviderConfig): String {
        val support = thinkingFor(_providerId.value, cfg.model)
        val rung = resolveThinkingId(support, cfg.thinking)
        return effectiveSystemPrompt(replyLanguageFor(replyLang), _settings.value.systemPrompt, support.promptHint(rung))
    }

    /** Apply persisted settings on launch (unknown provider ids keep the default). */
    fun restoreSettings(settings: AppSettings, providerId: String?) {
        _settings.value = settings
        providerId?.let { setProvider(it) }
    }
    fun setRequireBiometric(v: Boolean) {
        _settings.update { it.copy(requireBiometricForKeys = v) }
        if (!v) keysUnlocked = false
    }

    /**
     * Biometric/device-credential gate before API keys are read. True
     * when the caller may proceed; false shows a toast and blocks.
     * Unlock lasts for the process lifetime only.
     */
    suspend fun ensureKeysUnlocked(activity: FragmentActivity): Boolean {
        val status = studio.ccez.app.device.biometricStatus(activity)
        if (!studio.ccez.app.device.needsKeyPrompt(_settings.value.requireBiometricForKeys, status, keysUnlocked)) {
            return true
        }
        val ok = studio.ccez.app.device.biometricAuth(activity, "Unlock API keys")
        keysUnlocked = ok
        if (!ok) _aidError.value = "Authentication needed — keys stay locked"
        return ok
    }
    fun setProvider(id: String) {
        runCatching { getProviderDef(id, _settings.value.customProviders) }.onSuccess { _providerId.value = id }
    }

    /**
     * Cline-style custom endpoint (desktop addCustomProvider parity):
     * null on success (and the new provider becomes active), otherwise
     * the validation message for the form.
     */
    fun addCustomProvider(label: String, baseUrl: String, model: String): String? {
        validateCustomProvider(label, baseUrl, model)?.let { return it }
        val taken = listProviders(_settings.value.customProviders).map { it.id.value }.toSet()
        val def = newCustomProvider(label, baseUrl, model, taken)
        _settings.update { s ->
            s.copy(
                customProviders = s.customProviders + def,
                providers = s.providers + (def.id.value to ProviderConfig(def.defaultBaseUrl, def.defaultModel)),
            )
        }
        _providerId.value = def.id.value
        return null
    }

    /** Removes the active provider when it is user-added (desktop parity: back to Muse). */
    fun removeCustomProvider() {
        val id = _providerId.value
        if (_settings.value.customProviders.none { it.id.value == id }) return
        _settings.update { s ->
            s.copy(
                customProviders = s.customProviders.filterNot { it.id.value == id },
                providers = s.providers - id,
            )
        }
        _providerId.value = "muse"
    }

    fun isCustomProvider(id: String): Boolean =
        _settings.value.customProviders.any { it.id.value == id }

    /** Pinch spread on a message (desktop pinch parity): live text scaling. */
    fun pinchZoom(factor: Float) {
        if (factor <= 0f || factor == 1f) return
        _settings.update { s ->
            s.copy(
                fontScale = zoomFontScale(
                    s.fontScale,
                    factor,
                    FONT_SCALE_MIN,
                    FONT_SCALE_MAX,
                    0.05f,
                ),
            )
        }
    }

    /** Three-finger swipe chat step (newer = toward the head). */
    fun stepChat(newer: Boolean) {
        val state = repo.current()
        val active = state.activeChatId ?: return
        val next = stepChatId(state.chats, active, newer) ?: return
        repo.update { it.copy(activeChatId = next) }
    }

    /** Switcher-overlay cycle with wraparound. */
    fun cycleChat(newer: Boolean) {
        val state = repo.current()
        val active = state.activeChatId ?: return
        val next = cycleChatId(state.chats, active, newer) ?: return
        repo.update { it.copy(activeChatId = next) }
    }

    /** Provider parked by a network drop (memory-only; user picks win over restores). */
    private var parkedProvider: String? = null

    /**
     * Offline fallback: a drop parks cloud providers on keyless
     * on-device ML Kit; reconnecting restores exactly what the drop
     * parked — never a provider the user picked meanwhile.
     */
    fun onConnectivityChanged(online: Boolean) {
        if (!online) {
            val target = studio.ccez.app.domain.offlineTarget(_providerId.value) ?: return
            parkedProvider = _providerId.value
            setProvider(target)
            _aidError.value = "Network lost — parked on on-device ML Kit"
        } else {
            val restore = studio.ccez.app.domain.onlineRestore(parkedProvider, _providerId.value) ?: return
            parkedProvider = null
            setProvider(restore)
            _aidError.value = "Back online — provider restored"
        }
    }
    fun setKey(providerId: String, key: String) { secrets.set(secretKeyFor(providerId), key) }
    fun getKey(providerId: String): String? = secrets.get(secretKeyFor(providerId))
    fun setProviderConfig(id: String, cfg: ProviderConfig) { _settings.update { it.copy(providers = it.providers + (id to cfg)) } }

    /** Thinking rung for one provider (clamped to that model's dial). */
    fun setThinking(providerId: String, rungId: String) {
        val cur = _settings.value.providers[providerId]
        val model = cur?.model ?: runCatching { getProviderDef(providerId, _settings.value.customProviders).defaultModel }.getOrNull().orEmpty()
        val rung = resolveThinkingId(thinkingFor(providerId, model), rungId)
        val next = (cur ?: ProviderConfig("", model)).copy(thinking = rung)
        _settings.update { it.copy(providers = it.providers + (providerId to next)) }
    }

    /**
     * Refill the cached `/models` ids for one provider (Refresh parity).
     * The caller gates on ensureKeysUnlocked first; failures return
     * Result.failure with a short message for a toast.
     */
    suspend fun refreshModels(providerId: String): Result<List<String>> {
        val def = runCatching { getProviderDef(providerId, _settings.value.customProviders) }.getOrElse {
            return Result.failure(IllegalStateException("Unknown provider"))
        }
        if (def.keyless) return Result.success(emptyList())
        val cfg = _settings.value.providers[providerId]
            ?: ProviderConfig(def.defaultBaseUrl, def.defaultModel)
        // No key gate: many OpenAI-compatible endpoints serve /models
        // without auth, so refresh works straight from the base URL.
        val key = secrets.get(secretKeyFor(providerId)).orEmpty()
        val out = runCatching { net.listModels(cfg.baseUrl.ifBlank { def.defaultBaseUrl }, key) }
        out.onSuccess { ids ->
            _settings.update { s ->
                val next = (s.providers[providerId] ?: cfg).copy(models = ids)
                s.copy(providers = s.providers + (providerId to next))
            }
        }
        val err = out.exceptionOrNull() ?: return Result.success(out.getOrThrow())
        return Result.failure(IllegalStateException(err.message ?: "Refresh failed"))
    }
    /**
     * Stop one chat's in-flight request; other chats stream on. The
     * flag clears here too: a job cancelled before its first run
     * never reaches its own cleanup, which would strand sending on.
     */
    fun stop(chatId: ChatId) {
        sendJobs.remove(chatId)?.cancel()
        repo.update { markSending(it, chatId, false) }
    }

    fun draftAnnotations(chatId: ChatId): List<Annotation> = _annotations.value[chatId] ?: emptyList()

    fun annotate(chatId: ChatId, msgId: ChatMsgId, quote: String, comment: String = "") {
        _annotations.update { cur -> cur + (chatId to addAnnotation(cur[chatId] ?: emptyList(), msgId, quote, comment)) }
    }

    fun unannotate(chatId: ChatId, id: AnnotationId) {
        _annotations.update { cur -> cur + (chatId to ((cur[chatId] ?: emptyList()).filterNot { it.id == id })) }
    }

    /** Badge-tap rewrite: a pending note edited in place. */
    fun editAnnotation(chatId: ChatId, id: AnnotationId, quote: String, comment: String) {
        _annotations.update { cur ->
            cur + (chatId to studio.ccez.app.domain.editAnnotation(cur[chatId] ?: emptyList(), id, quote, comment))
        }
    }

    /** Outgoing text: draft plus this chat's annotation block (pure, unit-tested). */
    fun buildSendText(chatId: ChatId, draft: String): String =
        withAnnotations(draft.trim(), draftAnnotations(chatId).map { it.quote to it.comment })

    fun jumpToChat(chatId: ChatId, index: Int) {
        repo.update { it.copy(activeChatId = chatId) }
        _jumpTo.value = chatId to index
    }

    fun consumeJump(): Pair<ChatId, Int>? = _jumpTo.value.also { _jumpTo.value = null }

    fun consumeAidError(): String? = _aidError.value.also { _aidError.value = null }

    private val _dictating = MutableStateFlow(false)
    val dictating: StateFlow<Boolean> = _dictating.asStateFlow()

    private var dictateJob: kotlinx.coroutines.Job? = null

    /** Dictate into the composer: recognized text appends to the draft. */
    fun dictate() {
        if (_dictating.value) return
        dictateJob = viewModelScope.launch {
            _dictating.value = true
            try {
                val heard = dictator.listen().trim()
                if (heard.isNotEmpty()) {
                    _draft.update { cur -> if (cur.isBlank()) heard else "$cur $heard" }
                } else {
                    _aidError.value = "Didn't catch anything — try again."
                }
            } catch (e: Exception) {
                if (e !is kotlinx.coroutines.CancellationException) {
                    _aidError.value = dictationHint(e.message ?: "dictation failed")
                }
            } finally {
                _dictating.value = false
            }
        }
    }

    /** Second mic tap: cancel the in-flight listen, keeping the draft. */
    fun stopDictation() {
        dictateJob?.cancel()
        dictateJob = null
    }

    /**
     * Selection-popup readings (desktop selection-furigana parity):
     * per-Han runs with word-context readings, null for kana-only
     * selections. Off the main thread — the dictionary loads lazily.
     */
    suspend fun selectionReadings(text: String): List<AnnotatedRun>? = withContext(Dispatchers.Default) {
        if (text.isBlank()) null else annotatedRuns(furiganaEngine.segments(text))
    }

    fun toggleAid(chatId: ChatId, msg: ChatMsg, aid: LocalAid) {
        val cur = _aidPins.value[msg.id] ?: emptySet()
        val next = if (aid in cur) cur - aid else cur + aid
        _aidPins.update { it + (msg.id to next) }
        if (next.isNotEmpty()) ensureAid(chatId, msg, next)
    }

    /** Editing invalidates readings: drop pins, segments, and tashkeel originals. */
    fun clearAids(msgId: ChatMsgId) {
        _aidPins.update { it - msgId }
        _aidSegments.update { cur -> cur.filterKeys { it.first != msgId } }
        _tashkeelOriginal.update { it - msgId }
    }

    private fun ensureAid(chatId: ChatId, msg: ChatMsg, aids: Set<LocalAid>) {
        val key = msg.id to aids
        if (_aidSegments.value.containsKey(key)) return
        viewModelScope.launch(aidDispatcher) {
            val preferred = preferredLocalAid(repo.current().chats.find { it.id == chatId }?.replyLang)
            val segs = aidSegmentsFor(msg.content, aids, preferred, pinyinReader, furiganaEngine)
            _aidSegments.update { it + (key to segs) }
        }
    }

    private data class ResolvedProvider(val def: ProviderDef, val cfg: ProviderConfig, val key: String)

    private fun resolveProvider(): ResolvedProvider {
        val pid = _providerId.value
        val def = getProviderDef(pid, _settings.value.customProviders)
        val cfg = _settings.value.providers[pid]
            ?: ProviderConfig(def.defaultBaseUrl, def.defaultModel, null)
        val key = if (def.keyless) "" else (secrets.get(secretKeyFor(pid)) ?: "")
        if (!def.keyless && key.isBlank()) throw IllegalStateException("$MISSING_KEY_ERROR_PREFIX for ${def.label}")
        return ResolvedProvider(def, cfg, key)
    }

    /**
     * Tashkeel toggle: applied messages revert to the memory-only
     * original; otherwise the provider vocalizes the Arabic lines and
     * only those splice back in (other paragraphs stay byte-identical).
     */
    fun toggleTashkeel(chatId: ChatId, msg: ChatMsg) {
        val original = _tashkeelOriginal.value[msg.id]
        if (original != null) {
            repo.update { editMessage(it, chatId, msg.id, original) }
            _tashkeelOriginal.update { it - msg.id }
            return
        }
        viewModelScope.launch {
            try {
                val indexes = aidTargetLines(msg.content)
                if (indexes.isEmpty()) {
                    _aidError.value = "No Arabic lines in this message"
                    return@launch
                }
                val resolved = resolveProvider()
                val lines = msg.content.split("\n")
                val wire = tashkeelMessages(indexes.map { lines[it] }.joinToString("\n"))
                    .map { (role, content) -> mapOf("role" to role, "content" to content) }
                val acc = StringBuilder()
                net.stream(
                    studio.ccez.app.data.ChatRequest(
                        resolved.cfg.baseUrl,
                        resolved.key,
                        resolved.cfg.model,
                        wire,
                        resolved.cfg.thinking,
                        providerId = _providerId.value,
                    ),
                ) { token -> acc.append(token) }
                val vocalized = acc.toString().trim()
                if (vocalized.isEmpty()) {
                    _aidError.value = "Empty tashkeel reply"
                    return@launch
                }
                val spliced = spliceAidResult(msg.content, indexes, vocalized) ?: vocalized
                _tashkeelOriginal.update { it + (msg.id to msg.content) }
                repo.update { editMessage(it, chatId, msg.id, spliced) }
            } catch (e: Exception) {
                _aidError.value = e.message ?: "tashkeel failed"
            }
        }
    }

    /** Searchable docs across chats: messages (baked blocks redacted) + annotation drafts. */
    fun searchDocs(): List<SearchDoc> {
        val s = repo.current()
        val out = mutableListOf<SearchDoc>()
        for (chat in s.chats) {
            for (msg in chat.messages) {
                out.add(SearchDoc(chat.id.value, msg.id.value, SearchDoc.Kind.MESSAGE, redactedCopyText(msg.content)))
            }
        }
        for ((chatId, list) in _annotations.value) {
            for (a in list) {
                out.add(SearchDoc(chatId.value, a.messageId.value, SearchDoc.Kind.ANNOTATION, "${a.quote} ${a.comment}".trim()))
            }
        }
        return out
    }

    fun exportMarkdown(chatId: ChatId): Pair<String, String>? {
        val chat = repo.current().chats.find { it.id == chatId } ?: return null
        return studio.ccez.app.domain.exportFilename(chat.createdAt) to
            studio.ccez.app.domain.chatToMarkdown(
                chat.messages.map { m ->
                    studio.ccez.app.domain.ExportMsg(
                        role = if (m.role == ChatMsg.Role.ASSISTANT) "assistant" else "user",
                        content = m.content,
                        attachments = m.attachments.map { it.name },
                    )
                },
            )
    }

    /** Import a Tauri export/settings file: chats merge, keys land in the secret store. */
    fun importTauri(chatsJson: String, settingsJson: String? = null): Pair<Int, Int> {
        val (chats, active) = studio.ccez.app.data.migrateTauriChats(chatsJson)
        importChats(chats, active)
        var keys = 0
        val imp = settingsJson?.let { studio.ccez.app.data.migrateTauriSettings(it) }
        if (imp != null) {
            for ((id, key) in imp.keys) {
                setKey(id, key)
                keys += 1
            }
            for ((id, cfg) in imp.configs) setProviderConfig(id, cfg)
            runCatching { setProvider(imp.activeProviderId) }
        }
        return chats.size to keys
    }

    fun send() {
        val chat = repo.current().activeChat ?: repo.newChat()
        val staged = _staged.value
        val stagedImages = staged.filter { it.kind == "image" && it.dataUrl != null }
        val stagedTexts = staged.filter { it.kind == "text" && !it.text.isNullOrEmpty() }
        var text = buildSendText(chat.id, _draft.value)
        if (stagedImages.isNotEmpty()) text = (text + "\n" + stagedImages.joinToString(" ") { IMAGE_MARKER }).trim()
        for (t in stagedTexts) {
            text += "\n\n[Attachment: ${t.name}]\n${t.text}"
        }
        if (text.isEmpty()) return
        // History keeps metadata + inlined text; JPEG bytes ride the
        // request only (DataStore is no place for megabytes of base64).
        val user = ChatMsg(
            role = ChatMsg.Role.USER,
            content = text,
            attachments = staged.map { it.copy(dataUrl = null) },
        )
        _annotations.update { it + (chat.id to emptyList()) }
        _staged.value = emptyList()
        repo.update { appendMessage(markSending(it, chat.id, true), chat.id, user) }
        _draft.value = ""
        streamHistory(chat, stagedImages.mapNotNull { it.dataUrl })
    }

    /**
     * Rerun-from-here (desktop rerunFrom parity): drops every message
     * after the user message [msgId] and regenerates its reply in
     * place. Non-user targets refuse silently.
     */
    fun rerun(chat: Chat, msgId: ChatMsgId) {
        if (chat.messages.find { it.id == msgId }?.role != ChatMsg.Role.USER) return
        stop(chat.id)
        repo.update { markSending(rerunFrom(it, chat.id, msgId), chat.id, true) }
        streamHistory(chat)
    }

    /**
     * Streams one assistant reply for the chat's current history: the
     * shared tail of send (new turn) and rerun (regenerated turn).
     * Appends the empty assistant shell, fills it, and clears sending.
     */
    private fun streamHistory(chat: Chat, images: List<String> = emptyList()) {
        sendJobs[chat.id]?.cancel()
        lateinit var job: Job
        job = viewModelScope.launch {
            try {
                val assistantId = studio.ccez.app.domain.newMsgId()
                repo.update { appendMessage(it, chat.id, ChatMsg(id = assistantId, role = ChatMsg.Role.ASSISTANT, content = "")) }
                try {
                    // Keyless on-device path: one-shot flattened prompt, never the network client.
                    if (_providerId.value == "local-mlkit") {
                        val flat = (repo.current().chats.find { it.id == chat.id }?.messages ?: emptyList())
                            .filter { it.id != assistantId }
                            .joinToString("\n") {
                                "${if (it.role == ChatMsg.Role.ASSISTANT) "assistant" else "user"}: ${it.content}"
                            }
                        val reply = onDevice.chat(flat)
                        repo.update { s -> markSending(editMessage(s, chat.id, assistantId, reply), chat.id, false) }
                        notifyReplyDone(reply)
                        return@launch
                    }
                    val resolved = resolveProvider()
                    val history = (repo.current().chats.find { it.id == chat.id }?.messages ?: emptyList())
                        .filter { it.id != assistantId }
                        .map { it.toWire() }
                    val acc = StringBuilder()
                    net.streamConversation(
                        studio.ccez.app.data.ChatRequest(
                            resolved.cfg.baseUrl,
                            resolved.key,
                            resolved.cfg.model,
                            history,
                            resolved.cfg.thinking,
                            // Images ride only the live request; history keeps the marker tags.
                            images = images,
                            systemPrompt = systemPromptFor(effectiveReplyLang(chat.replyLang, _settings.value.replyLang), resolved.cfg),
                            providerId = _providerId.value,
                        ),
                        { url ->
                            _fetching.value = url.hostLabel()
                            try {
                                fetchPageText(url)
                            } finally {
                                _fetching.value = null
                            }
                        },
                    ) { token ->
                        acc.append(token)
                        val snapshot = acc.toString()
                        repo.update { s -> editMessage(s, chat.id, assistantId, snapshot) }
                    }
                    repo.update { markSending(it, chat.id, false) }
                    notifyReplyDone(acc.toString())
                } catch (e: Exception) {
                    val msg = e.message ?: "send failed"
                    repo.update { s ->
                        markSending(editMessage(s, chat.id, assistantId, ""), chat.id, false).let { cur ->
                            // attach error to the assistant message
                            cur.copy(chats = cur.chats.map { c ->
                                if (c.id != chat.id) c
                                else c.copy(messages = c.messages.map { m ->
                                    if (m.id == assistantId) m.copy(error = msg) else m
                                })
                            })
                        }
                    }
                }
        } finally {
            if (sendJobs[chat.id] === job) sendJobs.remove(chat.id)
        }
        }
        sendJobs[chat.id] = job
    }

    /** Import chats (e.g. a Tauri export file): valid chats merge in front, healed like a reload. */
    fun importChats(chats: List<Chat>, active: ChatId?) {
        if (chats.isEmpty()) return
        repo.update { s ->
            val known = s.chats.map { it.id }.toSet()
            val fresh = chats.filter { it.id !in known }
            val merged = fresh + s.chats
            s.copy(chats = merged, activeChatId = active?.takeIf { a -> merged.any { it.id == a } } ?: s.activeChatId ?: merged.firstOrNull()?.id)
        }
    }

    /**
     * Backgrounded reply ping (studyMedia.ts parity): silent when
     * foregrounded, silent for failures and empty bodies. Never throws.
     */
    private fun notifyReplyDone(text: String) {
        runCatching {
            val preview = replyPreview(text)
            if (preview.isEmpty()) return
            if (!shouldNotifyReply(_settings.value.replyNotifications, AppForeground.isForeground)) return
            notifier.notifyReply("Reply ready", preview)
        }
    }

    fun retry(chat: Chat, failedId: ChatMsgId) {
        val failed = chat.messages.find { it.id == failedId } ?: return
        _draft.value = failed.content.ifEmpty { _draft.value }
        repo.update { deleteMessage(it, chat.id, failedId) }
        send()
    }
}

/** Injects platform implementations (Keystore secrets, native speech/OCR/on-device). */
class ChatViewModelFactory(
    private val secrets: SecretStore = InMemorySecretStore(),
    private val speaker: Speaker = FakeSpeaker(),
    private val dictator: Dictator = FakeDictator(),
    private val onDevice: OnDeviceChat = FakeOnDevice(),
    private val ocr: OcrReader = FakeOcr(),
    private val notifier: ReplyNotifier = NoopReplyNotifier(),
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        ChatViewModel(secrets = secrets, speaker = speaker, dictator = dictator, onDevice = onDevice, ocr = ocr, notifier = notifier) as T
}
