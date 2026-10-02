package studio.ccez.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.app.ActivityCompat
import androidx.fragment.app.FragmentActivity
import studio.ccez.app.device.AndroidReplyNotifier
import studio.ccez.app.device.AppForeground
import studio.ccez.app.device.connectivityFlow
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import studio.ccez.app.data.DataStoreChats
import studio.ccez.app.data.InMemorySecretStore
import studio.ccez.app.data.KeystoreSecretStore
import studio.ccez.app.device.AndroidDictator
import studio.ccez.app.device.AndroidSpeaker
import studio.ccez.app.device.FakeDictator
import studio.ccez.app.device.FakeOcr
import studio.ccez.app.device.FakeSpeaker
import studio.ccez.app.device.MlKitGemmaChat
import studio.ccez.app.device.MlKitOcrReader
import studio.ccez.app.domain.Chat
import studio.ccez.app.ui.CcezTheme
import studio.ccez.app.ui.ChatScreen
import studio.ccez.app.ui.ChatViewModel
import studio.ccez.app.ui.ChatViewModelFactory
import studio.ccez.app.ui.SearchScreen
import studio.ccez.app.ui.SettingsScreen

class MainActivity : FragmentActivity() {
    /** Pending share-intent text: set from the launch intent and every later one (singleTop). */
    private val sharedFlow = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Reply pings need an explicit grant on Android 13+; without it
        // the notifier stays silent and the setting simply no-ops.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                4201,
            )
        }
        sharedFlow.value = extractSharedText(intent)
        setContent {
            val appCtx = applicationContext
            // Fail-closed secrets: Keystore when available, memory-only otherwise (never plaintext).
            val secrets = remember {
                runCatching { KeystoreSecretStore(appCtx) }.getOrElse { InMemorySecretStore() }
            }
            // Native platform drivers, each falling back to its fake when unavailable.
            val speaker = remember { runCatching { AndroidSpeaker(appCtx) }.getOrElse { FakeSpeaker() } }
            val dictator = remember { runCatching { AndroidDictator(appCtx) }.getOrElse { FakeDictator() } }
            val onDevice = remember { MlKitGemmaChat() }
            val ocr = remember { runCatching { MlKitOcrReader(appCtx) }.getOrElse { FakeOcr() } }
            val notifier = remember { AndroidReplyNotifier(appCtx) }
            val vm: ChatViewModel = viewModel(
                factory = ChatViewModelFactory(secrets, speaker, dictator, onDevice, ocr, notifier),
            )
            val storage = remember { DataStoreChats(appCtx) }
            var ready by remember { mutableStateOf(false) }

            // Restore chats + settings once; then persist debounced
            // (never the in-memory sending flags; keys never touch DataStore).
            LaunchedEffect(Unit) {
                val (chats, active) =
                    runCatching { storage.load() }.getOrDefault(emptyList<Chat>() to null)
                if (chats.isNotEmpty() || active != null) {
                    vm.repo.replace(studio.ccez.app.domain.ChatState(chats, active))
                }
                runCatching { storage.loadSettings() }.getOrNull()?.let { (settings, providerId) ->
                    vm.restoreSettings(settings, providerId)
                }
                vm.ensureChat()
                ready = true
            }
            LaunchedEffect(ready) {
                if (!ready) return@LaunchedEffect
                @OptIn(FlowPreview::class)
                vm.state.debounce(800).collect { s ->
                    runCatching { storage.save(s.chats, s.activeChatId) }
                }
            }
            LaunchedEffect(ready) {
                if (!ready) return@LaunchedEffect
                @OptIn(FlowPreview::class)
                combine(vm.settings, vm.providerId) { settings, pid -> settings to pid }
                    .debounce(800)
                    .collect { (settings, pid) ->
                        runCatching { storage.saveSettings(settings, pid) }
                    }
            }

            val shared by sharedFlow.collectAsState()
            LaunchedEffect(shared) {
                shared?.let {
                    vm.prefillShared(it)
                    sharedFlow.value = null
                }
            }
            // Offline fallback: drops park cloud providers on ML Kit, reconnects restore.
            LaunchedEffect(Unit) {
                appCtx.connectivityFlow().collect { online ->
                    vm.onConnectivityChanged(online)
                }
            }
            val settings by vm.settings.collectAsState()
            var route by remember { mutableStateOf("chat") }
            CcezTheme(mode = settings.themeMode) {
                // Search keeps its route + back button; settings lives in
                // the right drawer, so only search needs the system-back trap.
                if (route != "chat") {
                    androidx.activity.compose.BackHandler { route = "chat" }
                }
                when (route) {
                    "search" -> SearchScreen(vm, onBack = { route = "chat" })
                    else -> ChatScreen(vm, onOpenSearch = { route = "search" })
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        AppForeground.enter()
        // Foreground return: the user sees the finished reply, so its
        // ping stands down instead of lingering in the shade.
        runCatching { AndroidReplyNotifier(applicationContext).cancelReply() }
    }

    override fun onStop() {
        AppForeground.exit()
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractSharedText(intent)?.let { sharedFlow.value = it }
    }

    /** SEND text -> chat draft; PROCESS_TEXT -> annotate prefill (Tauri parity). */
    private fun extractSharedText(intent: Intent?): String? {
        if (intent == null) return null
        return when (intent.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }
            Intent.ACTION_PROCESS_TEXT -> intent.getStringExtra(Intent.EXTRA_PROCESS_TEXT)?.takeIf { it.isNotBlank() }
            else -> null
        }
    }
}
