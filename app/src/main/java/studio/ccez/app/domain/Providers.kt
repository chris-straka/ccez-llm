package studio.ccez.app.domain

/** Built-ins mirror providers/registry.ts: muse, deepseek, keyless local-mlkit. */
data class ProviderDef(
    val id: ProviderId,
    val label: String,
    val defaultBaseUrl: String,
    val defaultModel: String,
    val keyHint: String,
    val keyless: Boolean = false,
)

fun builtinProviderId(id: String): ProviderId = ProviderId(id)

/** Prefix of the resolveProvider throw; the error row keys its Settings action off it. */
const val MISSING_KEY_ERROR_PREFIX = "Missing API key"

/** True when a message error is a missing-key failure (recoverable in Settings). */
fun isMissingKeyError(error: String?): Boolean =
    error?.startsWith(MISSING_KEY_ERROR_PREFIX) == true

val BUILTIN_PROVIDER_IDS = listOf("muse", "deepseek", "local-mlkit")

val PROVIDERS = listOf(
    ProviderDef(
        builtinProviderId("muse"),
        "Muse",
        "https://api.meta.ai/v1",
        "muse-spark-1.3-contributor",
        "Meta Model API key",
    ),
    ProviderDef(
        builtinProviderId("deepseek"),
        "DeepSeek",
        "https://api.deepseek.com",
        "deepseek-flash",
        "Starts with sk-",
    ),
    ProviderDef(
        builtinProviderId("local-mlkit"),
        "ML Kit (on-device)",
        "http://localhost:11434/v1",
        "gemma4:latest",
        "served on this device",
        keyless = true,
    ),
)

fun listProviders(custom: List<ProviderDef> = emptyList()): List<ProviderDef> = PROVIDERS + custom

/**
 * Add-form validation (desktop messages verbatim): name, http(s) base
 * URL, and model id are all required.
 */
fun validateCustomProvider(label: String, baseUrl: String, model: String): String? {
    if (label.trim().isEmpty()) return "Give the provider a name."
    if (!Regex("^https?://.+", RegexOption.IGNORE_CASE).matches(baseUrl.trim())) {
        return "Base URL must start with http(s)://."
    }
    if (model.trim().isEmpty()) return "Enter a model id."
    return null
}

/** Cline-style id: custom-\<slug\>, collision-suffixed against [taken]. */
fun mintCustomProviderId(label: String, taken: Set<String>): String {
    val slug = label.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "provider" }
    var id = "custom-$slug"
    var n = 2
    while (id in taken) id = "custom-$slug-${n++}"
    return id
}

/** Trimmed, slash-stripped custom def carrying the standard key hint. */
fun newCustomProvider(label: String, baseUrl: String, model: String, taken: Set<String>): ProviderDef =
    ProviderDef(
        id = ProviderId(mintCustomProviderId(label, taken)),
        label = label.trim(),
        defaultBaseUrl = baseUrl.trim().trimEnd('/'),
        defaultModel = model.trim(),
        keyHint = "API key",
    )

/** Throws on unknown ids (runtime validator for persisted JSON), like getProviderDef. */
fun getProviderDef(id: String, custom: List<ProviderDef> = emptyList()): ProviderDef =
    listProviders(custom).find { it.id.value == id }
        ?: throw IllegalArgumentException("Unknown provider: $id")

/**
 * Gating contract from TODO/platform tests: local-mlkit is listed only on
 * offline Android and hidden elsewhere. Desktop/web never offer it.
 */
fun visibleProviderIds(isAndroid: Boolean, isOffline: Boolean): List<String> =
    if (isAndroid && isOffline) BUILTIN_PROVIDER_IDS else listOf("muse", "deepseek")

/**
 * Thinking dial (providers/thinking.ts parity). Muse models speak
 * reasoning_effort (minimal…xhigh); DeepSeek reasoning models speak a
 * thinking toggle with off/high/max rungs and generic Transluce ones
 * speak prompt hints. Unknown providers/models send nothing.
 */
data class ThinkingOption(val id: String, val label: String)
data class ThinkingSupport(
    val options: List<ThinkingOption>,
    val defaultId: String,
    /** True when levels go out as API parameters; false when they only become system-prompt hints. */
    val native: Boolean,
    /** Extra chat body fields for an option. Total: unknown ids send nothing. */
    val wireFields: (String) -> Map<String, Any?>,
    /** System-prompt hint for an option; "" when the wire does the work. */
    val promptHint: (String) -> String,
)

/** Prose hints for providers with no native knob (the old behavior). */
private val GENERIC_HINTS = mapOf(
    "low" to "Answer directly with minimal deliberation.",
    "medium" to "",
    "high" to "Think carefully before answering.",
)

private fun generic(): ThinkingSupport {
    val options = listOf(
        ThinkingOption("low", "Low"),
        ThinkingOption("medium", "Medium"),
        ThinkingOption("high", "High"),
    )
    return ThinkingSupport(
        options = options,
        defaultId = "medium",
        native = false,
        wireFields = { emptyMap() },
        promptHint = { optionId -> GENERIC_HINTS[optionId] ?: "" },
    )
}

/**
 * Muse Spark on the Meta Model API: top-level `reasoning_effort` from
 * `minimal` to `xhigh`. There is no off switch — `none` is a 400 —
 * so even Minimal still reasons.
 */
private fun metaSpark(): ThinkingSupport {
    val options = listOf(
        ThinkingOption("minimal", "Minimal"),
        ThinkingOption("low", "Low"),
        ThinkingOption("medium", "Medium"),
        ThinkingOption("high", "High"),
        ThinkingOption("xhigh", "Max"),
    )
    val ids = options.map { it.id }.toSet()
    return ThinkingSupport(
        options = options,
        defaultId = "medium",
        native = true,
        wireFields = { optionId -> if (optionId in ids) mapOf("reasoning_effort" to optionId) else emptyMap() },
        promptHint = { "" },
    )
}

/**
 * DeepSeek (`deepseek-flash`, `deepseek-v4-*`): top-level
 * `reasoning_effort` (`high` the default, `max` for harder pushes)
 * plus a `thinking` toggle. Off fully disables thinking rather than
 * lowering it.
 */
private fun deepseekV4(): ThinkingSupport = ThinkingSupport(
    options = listOf(
        ThinkingOption("off", "Off"),
        ThinkingOption("high", "High"),
        ThinkingOption("max", "Max"),
    ),
    defaultId = "high",
    native = true,
    wireFields = { optionId ->
        when (optionId) {
            "off" -> mapOf("thinking" to mapOf("type" to "disabled"))
            "high", "max" -> mapOf("thinking" to mapOf("type" to "enabled"), "reasoning_effort" to optionId)
            else -> emptyMap()
        }
    },
    promptHint = { "" },
)

/** Support table for one provider id + model name. */
fun thinkingFor(providerId: String, model: String): ThinkingSupport {
    if (providerId == "muse") return metaSpark()
    if (providerId == "deepseek" && Regex("v4|flash", RegexOption.IGNORE_CASE).containsMatchIn(model)) {
        return deepseekV4()
    }
    return generic()
}

/** Clamp a saved id to what the model offers. */
fun resolveThinkingId(support: ThinkingSupport, saved: String?): String {
    if (!saved.isNullOrEmpty() && support.options.any { it.id == saved }) return saved
    return support.defaultId
}

/** Step the dial one rung, wrapping around. */
fun cycleThinkingId(support: ThinkingSupport, current: String, direction: Int): String {
    val ids = support.options.map { it.id }
    val at = ids.indexOf(current)
    val from = if (at < 0) ids.indexOf(support.defaultId) else at
    val next = (from + direction + ids.size) % ids.size
    return ids.getOrElse(next) { support.defaultId }
}

/**
 * System prompt lines: base, then every enabled thinking hint, then
 * the reply-language suffix (the local aids teach their own script).
 */
fun effectiveSystemPrompt(
    replyLang: ReplyLanguage?,
    base: String = "",
    thinking: String = "",
): String = buildList {
    val trimmed = base.trim()
    if (trimmed.isNotEmpty()) add(trimmed)
    if (thinking.isNotEmpty()) add(thinking)
    replyLang?.let { add(it.prompt) }
}.joinToString("\n")

/** Legacy shim: option ids the old single-level sender knew. */
object ThinkingLevels {
    val NONE: String? = null
    const val LOW = "low"
    const val MEDIUM = "medium"
    const val HIGH = "high"
    fun normalize(raw: String?): String? = raw?.takeIf { it == LOW || it == MEDIUM || it == HIGH }
}
