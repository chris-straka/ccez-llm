package studio.ccez.app.data

import org.junit.Assert.*
import org.junit.Test
import studio.ccez.app.domain.ProviderDef
import studio.ccez.app.domain.ProviderId

class SettingsMappingTest {
    @Test fun `settings round-trip the wire form`() {
        val settings = AppSettings(
            themeMode = AppSettings.ThemeMode.DARK,
            voiceDefault = true,
            hideUntilTapped = true,
            requireBiometricForKeys = false,
            providers = mapOf("muse" to ProviderConfig("https://b.example", "m", "high", listOf("m", "m2"))),
        )
        val (restored, providerId) = settings.toStored("deepseek").toDomain()
        assertEquals(settings, restored)
        assertEquals("deepseek", providerId)
    }

    @Test fun `unknown themes fall back to system`() {
        val (restored, _) = StoredAppSettings(theme = "NEON").toDomain()
        assertEquals(AppSettings.ThemeMode.SYSTEM, restored.themeMode)
    }

    @Test fun `wire defaults match domain defaults`() {
        val (restored, providerId) = StoredAppSettings().toDomain()
        assertEquals(AppSettings(), restored)
        assertEquals("muse", providerId)
    }

    @Test fun `new keys round-trip the wire form`() {
        val settings = AppSettings(
            replyLang = "ja",
            voiceLang = "fr-FR",
            voiceLangPinned = true,
            nativeVoiceId = "voice-1",
            micEnabled = false,
            fontScale = 1.5f,
            messageGap = 0.8f,
            ownBubble = true,
            scaleActionsWithFont = true,
            showMessageButtons = false,
            hideButtons = false,
            autoSpeakSelection = false,
            hapticsDisabled = true,
            replyNotifications = false,
            inspectEnabled = false,
            promptIdleSec = 5,
        )
        val (restored, _) = settings.toStored("muse").toDomain()
        assertEquals(settings, restored)
    }

    @Test fun `slider values clamp to tauri bounds`() {
        val (restored, _) = StoredAppSettings(fontScale = 99f, messageGap = -3f).toDomain()
        assertEquals(FONT_SCALE_MAX, restored.fontScale)
        assertEquals(MESSAGE_GAP_MIN, restored.messageGap)
    }

    @Test fun `legacy vibration off migrates to haptics disabled`() {
        val raw = """{"theme":"SYSTEM","providerId":"muse","providers":{},"vibration":false}"""
        val (restored, _) = storeJson.decodeFromString(
            StoredAppSettings.serializer(),
            raw,
        ).toDomain()
        assertTrue(restored.hapticsDisabled)
    }

    @Test fun `legacy vibration on stays haptic enabled`() {
        val raw = """{"theme":"SYSTEM","providerId":"muse","providers":{},"vibration":true}"""
        val (restored, _) = storeJson.decodeFromString(
            StoredAppSettings.serializer(),
            raw,
        ).toDomain()
        assertFalse(restored.hapticsDisabled)
    }

    @Test fun `custom providers round-trip and drop blanks`() {
        val settings = AppSettings(
            customProviders = listOf(
                ProviderDef(ProviderId("custom-x"), "X", "https://x.ai/v1", "m", "API key"),
            ),
        )
        val (restored, _) = settings.toStored("muse").toDomain()
        assertEquals(settings, restored)
        val dirty = StoredAppSettings(
            customProviders = listOf(StoredCustomProvider("", "", "", "")),
        )
        assertTrue(dirty.toDomain().first.customProviders.isEmpty())
    }

    @Test fun `old saves backfill new-key defaults`() {
        val raw = """{"theme":"DARK","providerId":"muse","providers":{}}"""
        val (restored, _) = storeJson.decodeFromString(
            StoredAppSettings.serializer(),
            raw,
        ).toDomain()
        val fresh = AppSettings(themeMode = AppSettings.ThemeMode.DARK)
        assertEquals(fresh, restored)
    }
}
