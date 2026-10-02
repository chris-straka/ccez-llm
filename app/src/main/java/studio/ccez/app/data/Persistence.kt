package studio.ccez.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStoreFile
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import studio.ccez.app.domain.Attachment
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatId
import studio.ccez.app.domain.ChatMsg
import studio.ccez.app.domain.ChatMsgId
import studio.ccez.app.domain.PasteFold
import studio.ccez.app.domain.ProviderDef
import studio.ccez.app.domain.ProviderId
import studio.ccez.app.domain.TokenUsage

private val CHATS_JSON = stringPreferencesKey("chats_json")
private val SETTINGS_JSON = stringPreferencesKey("settings_json")

val storeJson = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }

// ---- Stored shapes (Tauri localStorage-compatible) ----

@Serializable
data class StoredUsage(
    val prompt: Int = 0,
    val completion: Int = 0,
    val total: Int = 0,
    val reasoning: Int? = null,
)

@Serializable
data class StoredAttachment(
    val id: String = "",
    val name: String = "",
    val mimeType: String = "",
    val charCount: Int = 0,
    val kind: String = "text",
    val dataUrl: String? = null,
    val text: String? = null,
    val tokens: Int = 0,
)

@Serializable
data class StoredFold(
    val start: Int = 0,
    val end: Int = 0,
    val chars: Int = 0,
    val open: Boolean = false,
)

@Serializable
data class StoredMsg(
    val id: String = "",
    val role: String = "user",
    val content: String = "",
    val usage: StoredUsage? = null,
    val error: String? = null,
    val attachments: List<StoredAttachment> = emptyList(),
    val pasteFolds: List<StoredFold> = emptyList(),
)

@Serializable
data class StoredChat(
    val id: String = "",
    val createdAt: Long = 0L,
    val messages: List<StoredMsg> = emptyList(),
    val replyLang: String? = null,
    val voice: Boolean? = null,
)

@Serializable
data class StoredChatFile(
    val chats: List<StoredChat> = emptyList(),
    val activeChatId: String? = null,
)

@Serializable
data class StoredProviderSettings(
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = "",
)

@Serializable
data class StoredSettings(
    val activeProviderId: String = "muse",
    val providers: Map<String, StoredProviderSettings> = emptyMap(),
    val voice: Boolean = false,
    val theme: String? = null,
)

/** App settings wire form (version-tolerant: unknown keys drop, missing keys default). */
@Serializable
data class StoredAppProvider(
    val baseUrl: String = "",
    val model: String = "",
    val thinking: String? = null,
    val models: List<String> = emptyList(),
)

/** User-added provider def wire form (desktop customProviders parity). */
@Serializable
data class StoredCustomProvider(
    val id: String = "",
    val label: String = "",
    val baseUrl: String = "",
    val model: String = "",
)

@Serializable
data class StoredAppSettings(
    val theme: String = "SYSTEM",
    val voiceDefault: Boolean = false,
    val hideUntilTapped: Boolean = false,
    val requireBiometricForKeys: Boolean = true,
    val systemPrompt: String = "",
    val replyLang: String? = null,
    val voiceLang: String? = null,
    val voiceLangPinned: Boolean = false,
    val nativeVoiceId: String? = null,
    val micEnabled: Boolean = true,
    val fontScale: Float = 1f,
    val messageGap: Float = 0.35f,
    val ownBubble: Boolean = false,
    val aiBubble: Boolean = true,
    val scaleActionsWithFont: Boolean = false,
    val showMessageButtons: Boolean = true,
    val hideButtons: Boolean = true,
    val autoSpeakSelection: Boolean = true,
    val hapticsDisabled: Boolean = false,
    /** Legacy inverted wording (v0.4.14 renamed it): explicit off migrates to disabled. */
    val vibration: Boolean = true,
    val replyNotifications: Boolean = true,
    val inspectEnabled: Boolean = true,
    val promptIdleSec: Int = -1,
    val providerId: String = "muse",
    val providers: Map<String, StoredAppProvider> = emptyMap(),
    val customProviders: List<StoredCustomProvider> = emptyList(),
)

/** Tauri slider bounds, mirrored so corrupt saves clamp instead of throwing. */
const val FONT_SCALE_MIN = 0.5f
const val FONT_SCALE_MAX = 8f
const val FONT_SCALE_DEFAULT = 1f
const val MESSAGE_GAP_MIN = 0f
const val MESSAGE_GAP_MAX = 1.5f
const val MESSAGE_GAP_DEFAULT = 0.35f

/** Domain → wire (provider configs ride along; keys never do). */
fun AppSettings.toStored(providerId: String): StoredAppSettings = StoredAppSettings(
    theme = themeMode.name,
    voiceDefault = voiceDefault,
    hideUntilTapped = hideUntilTapped,
    requireBiometricForKeys = requireBiometricForKeys,
    systemPrompt = systemPrompt,
    replyLang = replyLang,
    voiceLang = voiceLang,
    voiceLangPinned = voiceLangPinned,
    nativeVoiceId = nativeVoiceId,
    micEnabled = micEnabled,
    fontScale = fontScale,
    messageGap = messageGap,
    ownBubble = ownBubble,
    aiBubble = aiBubble,
    scaleActionsWithFont = scaleActionsWithFont,
    showMessageButtons = showMessageButtons,
    hideButtons = hideButtons,
    autoSpeakSelection = autoSpeakSelection,
    hapticsDisabled = hapticsDisabled,
    replyNotifications = replyNotifications,
    inspectEnabled = inspectEnabled,
    promptIdleSec = promptIdleSec,
    providerId = providerId,
    providers = providers.mapValues { (_, c) ->
        StoredAppProvider(c.baseUrl, c.model, c.thinking, c.models)
    },
    customProviders = customProviders.map { d ->
        StoredCustomProvider(d.id.value, d.label, d.defaultBaseUrl, d.defaultModel)
    },
)

/** Wire → domain (unknown theme names fall back to SYSTEM; sliders clamp). */
fun StoredAppSettings.toDomain(): Pair<AppSettings, String> {
    val theme = runCatching { AppSettings.ThemeMode.valueOf(theme) }
        .getOrDefault(AppSettings.ThemeMode.SYSTEM)
    return AppSettings(
        themeMode = theme,
        voiceDefault = voiceDefault,
        hideUntilTapped = hideUntilTapped,
        requireBiometricForKeys = requireBiometricForKeys,
        systemPrompt = systemPrompt,
        replyLang = replyLang,
        voiceLang = voiceLang,
        voiceLangPinned = voiceLangPinned,
        nativeVoiceId = nativeVoiceId,
        micEnabled = micEnabled,
        fontScale = fontScale.coerceIn(FONT_SCALE_MIN, FONT_SCALE_MAX),
        messageGap = messageGap.coerceIn(MESSAGE_GAP_MIN, MESSAGE_GAP_MAX),
        ownBubble = ownBubble,
        aiBubble = aiBubble,
        scaleActionsWithFont = scaleActionsWithFont,
        showMessageButtons = showMessageButtons,
        hideButtons = hideButtons,
        autoSpeakSelection = autoSpeakSelection,
        // Legacy `vibration` (inverted wording): an explicit off becomes
        // disabled; anything else stays enabled. Fresh saves always carry
        // hapticsDisabled, so the stored flag wins when present.
        hapticsDisabled = hapticsDisabled || vibration == false,
        replyNotifications = replyNotifications,
        inspectEnabled = inspectEnabled,
        promptIdleSec = promptIdleSec,
        providers = providers.mapValues { (_, p) -> ProviderConfig(p.baseUrl, p.model, p.thinking, p.models) },
        customProviders = customProviders
            .filter { it.id.isNotBlank() && it.label.isNotBlank() }
            .map { d ->
                ProviderDef(
                    ProviderId(d.id),
                    d.label,
                    d.baseUrl,
                    d.model,
                    "API key",
                )
            },
    ) to migrateProviderId(providerId)
}

data class TauriSettingsImport(
    val keys: Map<String, String>,
    val configs: Map<String, ProviderConfig>,
    val activeProviderId: String,
)

fun StoredMsg.toDomain(): ChatMsg? {
    val role = when (role) {
        "assistant" -> ChatMsg.Role.ASSISTANT
        "user" -> ChatMsg.Role.USER
        else -> return null
    }
    return ChatMsg(
        id = ChatMsgId(id.ifBlank { java.util.UUID.randomUUID().toString() }),
        role = role,
        content = content,
        usage = usage?.let { TokenUsage(it.prompt, it.completion, it.total, it.reasoning) },
        error = error,
        attachments = attachments.map {
            Attachment(
                id = it.id.ifBlank { java.util.UUID.randomUUID().toString() },
                name = it.name,
                mimeType = it.mimeType,
                charCount = it.charCount,
                kind = it.kind,
                dataUrl = it.dataUrl,
                text = it.text,
                tokens = it.tokens,
            )
        },
        pasteFolds = pasteFolds.filter { it.start >= 0 && it.end >= it.start }
            .map { PasteFold(it.start, it.end, it.chars, it.open) },
    )
}

fun StoredChat.toDomain(): Chat? {
    if (id.isBlank()) return null
    return Chat(
        id = ChatId(id),
        createdAt = createdAt,
        messages = messages.mapNotNull { it.toDomain() },
        replyLang = replyLang,
        voice = voice,
    )
}

fun ChatMsg.toStored(): StoredMsg = StoredMsg(
    id = id.value,
    role = when (role) {
        ChatMsg.Role.USER -> "user"
        ChatMsg.Role.ASSISTANT -> "assistant"
    },
    content = content,
    usage = usage?.let { StoredUsage(it.prompt, it.completion, it.total, it.reasoning) },
    error = error,
    attachments = attachments.map {
        StoredAttachment(it.id, it.name, it.mimeType, it.charCount, it.kind, it.dataUrl, it.text, it.tokens)
    },
    pasteFolds = pasteFolds.map { StoredFold(it.start, it.end, it.chars, it.open) },
)

fun Chat.toStored(): StoredChat = StoredChat(
    id = id.value,
    createdAt = createdAt,
    messages = messages.map { it.toStored() },
    replyLang = replyLang,
    voice = voice,
)

/**
 * Migrate Tauri web chats (`ccez-llm-chats-v1`: `{chats, activeChatId}`
 * or a bare list). Healing mirrors loadChats: corrupt chats/messages
 * drop, total garbage yields an empty state — never a throw.
 */
fun migrateTauriChats(json: String): Pair<List<Chat>, ChatId?> {
    val file = runCatching {
        storeJson.decodeFromString(StoredChatFile.serializer(), json)
    }.getOrElse {
        val list = runCatching {
            storeJson.decodeFromString(kotlinx.serialization.builtins.ListSerializer(StoredChat.serializer()), json)
        }.getOrNull() ?: return emptyList<Chat>() to null
        StoredChatFile(list, list.firstOrNull()?.id)
    }
    val chats = file.chats.mapNotNull { it.toDomain() }
    val active = chats.find { it.id.value == file.activeChatId }?.id ?: chats.firstOrNull()?.id
    return chats to active
}

/**
 * The on-device pill renamed local-gemma → local-mlkit (ML Kit, not
 * Gemma): old saves and Tauri imports pointing at the old id follow
 * it instead of silently dropping the choice.
 */
fun migrateProviderId(id: String): String =
    if (id == "local-gemma") "local-mlkit" else id

/** Migrate Tauri settings: API keys (→ secret store) + baseUrl/model per provider. */
fun migrateTauriSettings(json: String): TauriSettingsImport? {
    val stored = runCatching { storeJson.decodeFromString(StoredSettings.serializer(), json) }.getOrNull()
        ?: return null
    val keys = stored.providers.mapNotNull { (id, p) -> if (p.apiKey.isBlank()) null else migrateProviderId(id) to p.apiKey }.toMap()
    val configs = stored.providers.mapKeys { (id, _) -> migrateProviderId(id) }
        .mapValues { (_, p) -> ProviderConfig(p.baseUrl, p.model, null) }
    return TauriSettingsImport(keys, configs, migrateProviderId(stored.activeProviderId))
}

/** Local-first chat persistence. Tolerant reader: today's writes and Tauri exports both load. */
class DataStoreChats(context: Context, storeName: String = "ccez_chats") {
    private val store: DataStore<Preferences> = PreferenceDataStoreFactory.create(
        scope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
    ) { context.applicationContext.preferencesDataStoreFile(storeName) }

    suspend fun load(): Pair<List<Chat>, ChatId?> {
        val raw: String = store.data.map { prefs -> prefs[CHATS_JSON] }.first()
            ?: return emptyList<Chat>() to null
        if (raw.isBlank()) return emptyList<Chat>() to null
        return migrateTauriChats(raw)
    }

    suspend fun save(chats: List<Chat>, activeChatId: ChatId?) {
        val raw = storeJson.encodeToString(
            StoredChatFile.serializer(),
            StoredChatFile(chats.map { it.toStored() }, activeChatId?.value),
        )
        store.edit { prefs ->
            prefs[CHATS_JSON] = raw
        }
    }

    suspend fun loadSettings(): Pair<AppSettings, String>? {
        val raw: String = store.data.map { prefs -> prefs[SETTINGS_JSON] }.first()
            ?: return null
        if (raw.isBlank()) return null
        return runCatching {
            storeJson.decodeFromString(StoredAppSettings.serializer(), raw).toDomain()
        }.getOrNull()
    }

    suspend fun saveSettings(settings: AppSettings, providerId: String) {
        val raw = storeJson.encodeToString(
            StoredAppSettings.serializer(),
            settings.toStored(providerId),
        )
        store.edit { prefs ->
            prefs[SETTINGS_JSON] = raw
        }
    }
}

/**
 * Fail-closed secret store: Keystore AES/GCM via EncryptedSharedPreferences.
 * Reads return null when unavailable; writes throw instead of persisting
 * plaintext anywhere.
 */
class KeystoreSecretStore(context: Context, fileName: String = "ccez_secrets") : SecretStore {
    private val prefs = runCatching {
        val masterKey = MasterKey.Builder(context, MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            fileName,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }.getOrNull()

    override fun get(key: String): String? = try {
        prefs?.getString(key, null)
    } catch (_: Exception) {
        null
    }

    override fun set(key: String, value: String) {
        val p = prefs ?: throw IllegalStateException("secret store unavailable")
        p.edit().putString(key, value).apply()
    }

    override fun clear(key: String) {
        val p = prefs ?: throw IllegalStateException("secret store unavailable")
        p.edit().remove(key).apply()
    }
}
