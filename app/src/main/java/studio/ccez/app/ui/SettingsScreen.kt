package studio.ccez.app.ui

import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.IconButton
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.launch
import studio.ccez.app.data.AppSettings
import studio.ccez.app.data.FONT_SCALE_DEFAULT
import studio.ccez.app.data.FONT_SCALE_MAX
import studio.ccez.app.data.FONT_SCALE_MIN
import studio.ccez.app.data.MESSAGE_GAP_DEFAULT
import studio.ccez.app.data.MESSAGE_GAP_MAX
import studio.ccez.app.data.MESSAGE_GAP_MIN
import kotlin.math.roundToInt
import studio.ccez.app.data.ProviderConfig
import studio.ccez.app.device.VoiceInfo
import studio.ccez.app.device.biometricGapWarning
import studio.ccez.app.device.biometricStatus
import studio.ccez.app.domain.getProviderDef
import studio.ccez.app.domain.listProviders
import studio.ccez.app.domain.maskKey
import studio.ccez.app.domain.resolveThinkingId
import studio.ccez.app.domain.thinkingFor
import studio.ccez.app.domain.touchGestures

/**
 * Settings (Tauri SettingsPanel parity, phone layout): Model provider
 * with masked keys + model refresh, Defaults (system prompt, thinking
 * pills, message toggles, voice language, sliders), Color scheme,
 * Voice + privacy, Gestures + updates, Tauri import.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(vm: ChatViewModel, onBack: () -> Unit) {
    val settings by vm.settings.collectAsState()
    val providerId by vm.providerId.collectAsState()
    val onDeviceStatus by vm.onDeviceStatus.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var voices by remember { mutableStateOf<List<VoiceInfo>?>(null) }
    var showGestures by remember { mutableStateOf(false) }
    var showBioInfo by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        vm.probeOnDevice()
        voices = runCatching { vm.speaker.inventory() }.getOrNull()
    }
    Scaffold(topBar = {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
                .contentSwipe(onSwipeRight = onBack)
                .padding(start = 16.dp, end = 4.dp, top = 4.dp),
        ) {
            Text(
                "Settings",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onBack) { Glyph(CloseIcon, "Close settings") }
        }
    }) { pad ->
        Column(
            Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
                .testTag("settingsContent"),
        ) {
            Section("Model provider")
            val gemmaHidden = onDeviceStatus.let {
                it is studio.ccez.app.device.OnDeviceStatus.Unsupported ||
                    it is studio.ccez.app.device.OnDeviceStatus.Error
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listProviders(settings.customProviders).forEach { def ->
                    // Mount probe parity: the keyless radio hides where unsupported.
                    if (def.keyless && gemmaHidden) return@forEach
                    TextButton(onClick = { vm.setProvider(def.id.value) }) {
                        Text((if (providerId == def.id.value) "● " else "○ ") + def.label)
                    }
                }
            }
            val activeDef = runCatching { getProviderDef(providerId, settings.customProviders) }.getOrNull()
            if (activeDef != null) {
                ProviderConfigBlock(
                    vm = vm,
                    settings = settings,
                    providerId = providerId,
                    label = activeDef.label,
                    keyHint = activeDef.keyHint,
                    keyless = activeDef.keyless,
                    defaultBaseUrl = activeDef.defaultBaseUrl,
                    defaultModel = activeDef.defaultModel,
                    gemmaHidden = gemmaHidden,
                )
            }
            if (vm.isCustomProvider(providerId)) {
                TextButton(onClick = { vm.removeCustomProvider() }) { Text("Remove this provider") }
            }
            CustomProviderForm(vm)

            Section("Defaults")
            var systemPrompt by remember(providerId) { mutableStateOf(settings.systemPrompt) }
            OutlinedTextField(
                value = systemPrompt,
                onValueChange = {
                    systemPrompt = it
                    scope.launch { vm.setSystemPrompt(it) }
                },
                label = { Text("System prompt") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3,
            )
            Text("Thinking level", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
            if (activeDef != null) {
                val cfg = settings.providers[providerId]
                val model = cfg?.model ?: activeDef.defaultModel
                val support = remember(providerId, model) { thinkingFor(providerId, model) }
                val current = resolveThinkingId(support, cfg?.thinking)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                ) {
                    support.options.forEach { opt ->
                        TextButton(onClick = { vm.setThinking(providerId, opt.id) }) {
                            Text((if (current == opt.id) "● " else "○ ") + opt.label)
                        }
                    }
                }
            }
            Text("Messages", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
            CheckRow("Scale message icons with text size", settings.scaleActionsWithFont, vm::setScaleActionsWithFont)
            CheckRow("Hide message buttons until tapped", settings.hideButtons, vm::setHideButtons)
            CheckRow("Hide AI messages until tapped", settings.hideUntilTapped, vm::setHideUntilTapped)
            CheckRow("Show message buttons", settings.showMessageButtons, vm::setShowMessageButtons)
            CheckRow("Enable background on my messages", settings.ownBubble, vm::setOwnBubble)
            CheckRow("Enable background on AI messages", settings.aiBubble, vm::setAiBubble)
            CheckRow("Show Inspect for single kanji/hanzi highlights", settings.inspectEnabled, vm::setInspectEnabled)
            CheckRow("Disable haptic feedback", settings.hapticsDisabled, vm::setHapticsDisabled)
            CheckRow("Notify when replies finish in the background", settings.replyNotifications, vm::setReplyNotifications)
            CheckRow("Enable microphone dictation", settings.micEnabled, vm::setMicEnabled)
            CheckRow(
                "Biometric key unlock",
                settings.requireBiometricForKeys,
                onChange = { enabled ->
                    if (enabled) showBioInfo = true else vm.setRequireBiometric(false)
                },
            )
            val bioStatus = remember(context) { runCatching { biometricStatus(context) }.getOrNull() }
            val bioWarning = remember(settings.requireBiometricForKeys, bioStatus) {
                bioStatus?.let { biometricGapWarning(settings.requireBiometricForKeys, it) }
            }
            if (bioWarning != null) {
                Text(
                    bioWarning,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            if (showBioInfo) {
                AlertDialog(
                    onDismissRequest = { showBioInfo = false },
                    title = { Text("Biometric key unlock") },
                    text = {
                        Text(
                            "Your API keys are encrypted in this device's Keystore and never leave the app. " +
                                "Turning this on requires biometrics or device credential before keys are unlocked, once per launch.",
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { showBioInfo = false; vm.setRequireBiometric(true) }) { Text("Enable") }
                    },
                    dismissButton = {
                        TextButton(onClick = { showBioInfo = false }) { Text("Not now") }
                    },
                )
            }
            Section("Voice")
            val systemTag = remember { java.util.Locale.getDefault().toLanguageTag() }
            var voiceLang by remember { mutableStateOf(settings.voiceLang ?: systemTag) }
            var voiceMenuOpen by remember { mutableStateOf(false) }
            val voiceTag = voiceLang.ifBlank { systemTag }
            val voiceOptions = remember(voices, voiceTag) { voicesForTag(voices, voiceTag) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = voiceLang,
                    onValueChange = {
                        voiceLang = it
                        vm.setVoiceLang(it.trim().takeIf { s -> s.isNotEmpty() }, pinned = true)
                    },
                    label = { Text("Voice language") },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                )
                TextButton(
                    onClick = { voiceMenuOpen = true },
                    enabled = voiceOptions.isNotEmpty(),
                ) { Text("Choose") }
            }
            // Desktop parity: the menu only offers voices for the language
            // above, not the whole installed inventory.
            VoiceMenu(
                expanded = voiceMenuOpen,
                currentId = settings.nativeVoiceId,
                options = voiceOptions,
                onDismiss = { voiceMenuOpen = false },
                onPick = { voiceMenuOpen = false; vm.setNativeVoiceId(it) },
            )
            if (voices == null) {
                Text("Counting system voices…", style = MaterialTheme.typography.bodySmall)
            } else if (voiceOptions.isEmpty()) {
                Text("No voices installed for $voiceTag", style = MaterialTheme.typography.bodySmall)
            }
            Spacer(Modifier.height(8.dp))
            SettingSlider(
                label = "Text Size",
                value = settings.fontScale,
                onValueChange = vm::setFontScale,
                valueRange = FONT_SCALE_MIN..FONT_SCALE_MAX,
                step = 0.05f,
                defaultValue = FONT_SCALE_DEFAULT,
                defaultLabel = "100%",
                valueLabel = "${(settings.fontScale * 100).roundToInt()}%",
                description = "Text size percent",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
            )
            SettingSlider(
                label = "Gap size",
                value = settings.messageGap,
                onValueChange = vm::setMessageGap,
                valueRange = MESSAGE_GAP_MIN..MESSAGE_GAP_MAX,
                step = 0.05f,
                defaultValue = MESSAGE_GAP_DEFAULT,
                defaultLabel = "0.35",
                valueLabel = "${"%.2f".format(settings.messageGap)} rem",
                description = "Gap size in rem",
                modifier = Modifier.fillMaxWidth(),
            )

            Section("Color scheme")
            Row {
                listOf(
                    AppSettings.ThemeMode.SYSTEM,
                    AppSettings.ThemeMode.LIGHT,
                    AppSettings.ThemeMode.DARK,
                ).forEach { mode ->
                    TextButton(onClick = { vm.setTheme(mode) }) {
                        Text((if (settings.themeMode == mode) "● " else "○ ") + mode.name.lowercase().replaceFirstChar { it.uppercase() })
                    }
                }
            }

            Section("Gestures + updates")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { showGestures = true }) { Text("Show all gestures") }
                TextButton(onClick = {
                    val info = runCatching {
                        context.packageManager.getPackageInfo(context.packageName, 0)
                    }.getOrNull()
                    val stamp = if (info != null) "v${info.versionName} (${info.versionCode})" else "unknown version"
                    Toast.makeText(context, "$stamp — updates come via the store", Toast.LENGTH_LONG).show()
                }) { Text("Check for updates") }
            }
            if (showGestures) {
                AlertDialog(
                    onDismissRequest = { showGestures = false },
                    title = { Text("Touch gestures") },
                    text = {
                        Column(Modifier.verticalScroll(rememberScrollState())) {
                            touchGestures().forEach { row ->
                                Text(row.name, style = MaterialTheme.typography.labelLarge)
                                Text(row.gesture, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    },
                    confirmButton = { TextButton(onClick = { showGestures = false }) { Text("Close") } },
                )
            }
            val pkgInfo = runCatching {
                context.packageManager.getPackageInfo(context.packageName, 0)
            }.getOrNull()
            Text(
                "v${pkgInfo?.versionName ?: "?"} (${pkgInfo?.versionCode ?: "?"})",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 8.dp).testTag("versionStamp"),
            )

        }
    }
}

/**
 * Cline-style custom endpoint form (desktop ProviderPanel parity):
 * any OpenAI-compatible base URL + model becomes a provider.
 */
@Composable
private fun CustomProviderForm(vm: ChatViewModel) {
    // Collapsed by default (web <details> parity): the three-field form
    // only mounts once expanded.
    var open by remember { mutableStateOf(false) }
    TextButton(onClick = { open = !open }) {
        Text(if (open) "Hide custom provider form" else "Add a custom provider…")
    }
    if (!open) return
    var name by remember { mutableStateOf("") }
    var baseUrl by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    Text(
        "Custom provider",
        style = MaterialTheme.typography.labelLarge,
        modifier = Modifier.padding(top = 8.dp),
    )
    OutlinedTextField(
        value = name,
        onValueChange = { name = it; error = null },
        label = { Text("Name") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    OutlinedTextField(
        value = baseUrl,
        onValueChange = { baseUrl = it; error = null },
        label = { Text("Base URL") },
        placeholder = { Text("https://…/v1") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    OutlinedTextField(
        value = model,
        onValueChange = { model = it; error = null },
        label = { Text("Model id") },
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
    if (error != null) {
        Text(error!!, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
    TextButton(onClick = {
        error = vm.addCustomProvider(name, baseUrl, model)
        if (error == null) {
            name = ""
            baseUrl = ""
            model = ""
        }
    }) { Text("Add provider") }
}

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.padding(top = 12.dp, bottom = 6.dp),
    )
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) },
    ) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(
            label,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
    }
}

/** Provider config: base URL, model + refresh, masked key with Replace. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun ProviderConfigBlock(
    vm: ChatViewModel,
    settings: AppSettings,
    providerId: String,
    label: String,
    keyHint: String,
    keyless: Boolean,
    defaultBaseUrl: String,
    defaultModel: String,
    gemmaHidden: Boolean,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    if (keyless && !gemmaHidden) {
        Text("Keyless on-device endpoint", style = MaterialTheme.typography.bodySmall)
        val status = (vm.onDeviceStatus.collectAsState().value)
        val statusText = when (status) {
            null -> "Checking on-device model…"
            studio.ccez.app.device.OnDeviceStatus.Ready -> "On-device model ready"
            is studio.ccez.app.device.OnDeviceStatus.Downloading ->
                "Downloading model (${status.bytesDownloaded / 1_000_000} MB so far)…"
            studio.ccez.app.device.OnDeviceStatus.NoModel ->
                "Model not downloaded yet (download started)"
            studio.ccez.app.device.OnDeviceStatus.Unsupported ->
                "Not available on this device"
            is studio.ccez.app.device.OnDeviceStatus.Error ->
                "Check failed: ${status.message}"
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(statusText, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            TextButton(onClick = { vm.probeOnDevice() }) { Text("Check") }
        }
    }
    if (!keyless) {
        val cfg = settings.providers[providerId]
        var baseUrl by remember(providerId, cfg?.baseUrl) {
            mutableStateOf(cfg?.baseUrl ?: defaultBaseUrl)
        }
        OutlinedTextField(
            value = baseUrl,
            onValueChange = {
                baseUrl = it
                val prev = settings.providers[providerId]
                vm.setProviderConfig(
                    providerId,
                    (prev ?: ProviderConfig(defaultBaseUrl, defaultModel)).copy(baseUrl = it),
                )
            },
            label = { Text("Base URL") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        var model by remember(providerId, cfg?.model) {
            mutableStateOf(cfg?.model ?: defaultModel)
        }
        var refreshing by remember { mutableStateOf(false) }
        var modelsOpen by remember { mutableStateOf(false) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            ExposedDropdownMenuBox(
                expanded = modelsOpen,
                onExpandedChange = { modelsOpen = it && (cfg?.models.orEmpty().isNotEmpty()) },
                modifier = Modifier.weight(1f),
            ) {
                OutlinedTextField(
                    value = model,
                    onValueChange = {
                        model = it
                        val prev = settings.providers[providerId]
                        vm.setProviderConfig(
                            providerId,
                            (prev ?: ProviderConfig(defaultBaseUrl, defaultModel)).copy(model = it),
                        )
                    },
                    label = { Text("Model") },
                    trailingIcon = {
                        if (cfg?.models.orEmpty().isNotEmpty()) {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = modelsOpen)
                        }
                    },
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                    singleLine = true,
                )
                ExposedDropdownMenu(expanded = modelsOpen, onDismissRequest = { modelsOpen = false }) {
                    cfg?.models.orEmpty().forEach { id ->
                        DropdownMenuItem(
                            text = { Text(id) },
                            onClick = {
                                model = id
                                modelsOpen = false
                                val prev = settings.providers[providerId]
                                vm.setProviderConfig(
                                    providerId,
                                    (prev ?: ProviderConfig(defaultBaseUrl, defaultModel)).copy(model = id),
                                )
                            },
                        )
                    }
                }
            }
            TextButton(
                onClick = {
                    (context as? FragmentActivity)?.let { activity ->
                        scope.launch {
                            if (!vm.ensureKeysUnlocked(activity)) return@launch
                            refreshing = true
                            val result = vm.refreshModels(providerId)
                            refreshing = false
                            val msg = result.fold(
                                onSuccess = { ids -> if (ids.isEmpty()) "No models listed" else "${ids.size} models" },
                                onFailure = { e -> e.message ?: "Refresh failed" },
                            )
                            Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                        }
                    }
                },
                enabled = !refreshing,
            ) { Text(if (refreshing) "…" else "Refresh") }
        }
        KeyRow(vm = vm, providerId = providerId, label = label, keyHint = keyHint)
    }
}

/** Masked key with Replace; blank keys show the entry field directly. */
@Composable
private fun KeyRow(vm: ChatViewModel, providerId: String, label: String, keyHint: String) {
    var replacing by remember(providerId) { mutableStateOf(vm.getKey(providerId).isNullOrBlank()) }
    var key by remember(providerId) { mutableStateOf(vm.getKey(providerId) ?: "") }
    if (!replacing) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Key loaded: ${maskKey(key)}", modifier = Modifier.weight(1f))
            TextButton(onClick = { replacing = true }) { Text("Replace") }
        }
    } else {
        OutlinedTextField(
            value = key,
            onValueChange = { key = it; vm.setKey(providerId, it) },
            label = { Text(keyHint) },
            supportingText = { Text("$label keys never leave this device") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
    }
}

/**
 * Voices for one language tag, exact-region matches first (desktop
 * voicesForLang parity: the picker never shows the whole inventory).
 */
private fun voicesForTag(voices: List<VoiceInfo>?, langTag: String): List<VoiceInfo> {
    val prefix = langTag.substringBefore("-").lowercase()
    return voices.orEmpty()
        .filter { it.locale.substringBefore("-").lowercase() == prefix }
        .sortedWith(compareBy({ !it.locale.equals(langTag, ignoreCase = true) }, { it.name }))
}

/** Voice dropdown content; the Choose button lives by the language field. */
@Composable
private fun VoiceMenu(
    expanded: Boolean,
    currentId: String?,
    options: List<VoiceInfo>,
    onDismiss: () -> Unit,
    onPick: (String?) -> Unit,
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text("Auto per language") },
            onClick = { onPick(null) },
        )
        options.take(50).forEach { v ->
            DropdownMenuItem(
                text = { Text("${v.name} (${v.locale})") },
                trailingIcon = if (v.id == currentId) {
                    { Text("✓", color = MaterialTheme.colorScheme.primary) }
                } else {
                    null
                },
                onClick = { onPick(v.id) },
            )
        }
    }
}
