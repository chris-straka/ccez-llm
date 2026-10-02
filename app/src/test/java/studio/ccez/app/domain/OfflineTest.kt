package studio.ccez.app.domain

import org.junit.Assert.*
import org.junit.Test

class OfflineTest {
    @Test fun `cloud providers park on gemma when offline`() {
        assertEquals("local-mlkit", offlineTarget("muse"))
        assertEquals("local-mlkit", offlineTarget("deepseek"))
        assertNull(offlineTarget("local-mlkit"))
    }

    @Test fun `reconnect restores exactly what the drop parked`() {
        assertEquals("muse", onlineRestore("muse", "local-mlkit"))
        // Nothing parked: no-op.
        assertNull(onlineRestore(null, "local-mlkit"))
        // User moved on meanwhile: their pick wins.
        assertNull(onlineRestore("muse", "deepseek"))
        assertNull(onlineRestore("muse", "muse"))
    }

    @Test fun `only gemma is network-free`() {
        assertFalse(needsNetwork("local-mlkit"))
        assertTrue(needsNetwork("muse"))
        assertTrue(needsNetwork("deepseek"))
        assertTrue(needsNetwork("anything-else"))
    }
}
