package studio.ccez.app.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatState
import studio.ccez.app.domain.createChat
import studio.ccez.app.domain.emptyState
import studio.ccez.app.domain.loadChats
import studio.ccez.app.domain.ProviderDef

/**
 * Local-first chat repository. Persistent impl backs this with DataStore;
 * the in-memory default keeps unit tests and previews hermetic.
 * Reloads always boot idle (sending is in-memory only).
 */
class ChatRepository(initial: List<Chat> = emptyList(), savedActiveId: ChatId? = null) {
    private val _state = MutableStateFlow(loadChats(initial, savedActiveId))
    val state: StateFlow<ChatState> = _state.asStateFlow()

    fun current(): ChatState = _state.value
    fun replace(s: ChatState) { _state.value = s.copy(sendingChatIds = emptySet()) }
    fun update(f: (ChatState) -> ChatState) { _state.update { f(it).copy() } }
    fun newChat(): Chat {
        val chat = Chat()
        _state.update { createChat(it, chat) }
        return chat
    }

    /** Snapshot for persistence (drops sending flags). */
    fun snapshot(): Pair<List<Chat>, ChatId?> = _state.value.chats to _state.value.activeChatId
}

data class ProviderConfig(
    val baseUrl: String,
    val model: String,
    val thinking: String? = null,
    /** Cached `/models` ids behind the Model picker (Refresh refills). */
    val models: List<String> = emptyList(),
)

/**
 * Settings contract (Tauri AppSettings parity for every phone-relevant
 * key). Desktop-only keys (chatWidth, hover actions, sidebar, voice
 * engine, vim) stay out; user-added custom providers are a follow-up.
 * Persisted via DataStore.
 */
data class AppSettings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val voiceDefault: Boolean = false,
    val hideUntilTapped: Boolean = false,
    /** Biometric/device-credential prompt before API keys are read (once per process). */
    val requireBiometricForKeys: Boolean = true,
    /** Custom system-prompt base (reply-lang suffix and thinking hints append after). */
    val systemPrompt: String = "",
    /** Global reply-language default; per-chat pills override. Null = default. */
    val replyLang: String? = null,
    /** Default voice locale for Latin-script text (BCP-47); null = system locale. */
    val voiceLang: String? = null,
    /** User pinned the voice locale: restarts keep it instead of resetting. */
    val voiceLangPinned: Boolean = false,
    /** Explicit system voice id; null = auto-pick per language. */
    val nativeVoiceId: String? = null,
    /** Microphone dictation buttons (prompt + annotation drafts). */
    val micEnabled: Boolean = true,
    /** Text-size multiplier for messages and the prompt. */
    val fontScale: Float = 1f,
    /** Gap between messages, message-gap units. */
    val messageGap: Float = 0.35f,
    /** Shade the user's own messages like a bubble. */
    val ownBubble: Boolean = false,
    /** Shade the assistant's messages like a bubble. */
    val aiBubble: Boolean = true,
    /** Message action buttons grow with the text-size setting. */
    val scaleActionsWithFont: Boolean = false,
    /** Message action rows render at all (off = gestures/keyboard only). */
    val showMessageButtons: Boolean = true,
    /** Hide message action rows until tapped (tap reveals one row). */
    val hideButtons: Boolean = true,
    /** Read a fresh text selection aloud on release. */
    val autoSpeakSelection: Boolean = true,
    /** Disable every haptic beat (send, stream end, button taps). Off by default — haptics are on. */
    val hapticsDisabled: Boolean = false,
    /** Ping when a reply lands while the app is backgrounded. */
    val replyNotifications: Boolean = true,
    /** Character Inspect overlay (radicals/stroke/definition). */
    val inspectEnabled: Boolean = true,
    /** Seconds of no input before the prompt slides away; -1 = never, 0 = always. */
    val promptIdleSec: Int = -1,
    val providers: Map<String, ProviderConfig> = emptyMap(),
    /** User-added OpenAI-compatible endpoints (desktop customProviders parity). */
    val customProviders: List<ProviderDef> = emptyList(),
) {
    enum class ThemeMode { LIGHT, DARK, SYSTEM }
}
