package studio.ccez.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import studio.ccez.app.domain.Chat
import studio.ccez.app.domain.ChatMsg

@RunWith(AndroidJUnit4::class)
class PersistenceTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test fun datastore_roundtrip() = runBlocking {
        val store = DataStoreChats(context, "ccez_test_${System.nanoTime()}")
        assertTrue(store.load().first.isEmpty())
        val chat = Chat(messages = listOf(ChatMsg(role = ChatMsg.Role.USER, content = "hello")))
        store.save(listOf(chat), chat.id)
        val (chats, active) = store.load()
        assertEquals(1, chats.size)
        assertEquals(chat.id, chats[0].id)
        assertEquals("hello", chats[0].messages[0].content)
        assertEquals(chat.id, active)
    }

    @Test fun settings_roundtrip() = runBlocking {
        val store = DataStoreChats(context, "ccez_test_${System.nanoTime()}")
        assertNull(store.loadSettings())
        val settings = AppSettings(
            themeMode = AppSettings.ThemeMode.DARK,
            voiceDefault = true,
            hideUntilTapped = true,
            requireBiometricForKeys = false,
            providers = mapOf("muse" to ProviderConfig("https://b.example", "m", "high")),
        )
        store.saveSettings(settings, "deepseek")
        val (restored, providerId) = store.loadSettings()!!
        assertEquals(settings, restored)
        assertEquals("deepseek", providerId)
    }

    @Test fun keystore_roundtrip() {
        val secrets = KeystoreSecretStore(context, "ccez_test_${System.nanoTime()}")
        val key = secretKeyFor("test-provider")
        assertNull(secrets.get(key))
        secrets.set(key, "sk-test")
        assertEquals("sk-test", secrets.get(key))
        secrets.clear(key)
        assertNull(secrets.get(key))
    }
}
