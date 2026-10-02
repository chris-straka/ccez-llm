package studio.ccez.app.device

import org.junit.Assert.*
import org.junit.Test
import studio.ccez.app.data.AppSettings

class BiometricsTest {
    @Test fun `prompt only when required, possible, and locked`() {
        assertTrue(needsKeyPrompt(true, BioStatus.READY, false))
        assertFalse(needsKeyPrompt(true, BioStatus.READY, true))
        assertFalse(needsKeyPrompt(false, BioStatus.READY, false))
        assertFalse(needsKeyPrompt(true, BioStatus.NONE_ENROLLED, false))
        assertFalse(needsKeyPrompt(true, BioStatus.NO_HARDWARE, false))
        assertFalse(needsKeyPrompt(true, BioStatus.UNAVAILABLE, false))
    }

    @Test fun `biometric key lock defaults on`() {
        assertTrue(AppSettings().requireBiometricForKeys)
    }

    @Test fun `unprotected states warn when the lock is on`() {
        assertNotNull(biometricGapWarning(true, BioStatus.NONE_ENROLLED))
        assertNotNull(biometricGapWarning(true, BioStatus.NO_HARDWARE))
        assertNotNull(biometricGapWarning(true, BioStatus.UNAVAILABLE))
    }

    @Test fun `no warning when off or actually protected`() {
        assertNull(biometricGapWarning(false, BioStatus.NONE_ENROLLED))
        assertNull(biometricGapWarning(false, BioStatus.NO_HARDWARE))
        assertNull(biometricGapWarning(true, BioStatus.READY))
        assertNull(biometricGapWarning(false, BioStatus.READY))
    }
}
