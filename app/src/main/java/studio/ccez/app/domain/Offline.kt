package studio.ccez.app.domain

/**
 * Offline fallback: when the network drops, a cloud chat provider is
 * parked on the on-device ML Kit option; reconnecting restores exactly
 * what the drop parked — never a provider the user picked meanwhile.
 * Pure helpers (mirrors offline.ts); the event wiring lives in the
 * activity.
 */

/** The on-device provider id (see Providers.kt). */
const val OFFLINE_FALLBACK_ID = "local-mlkit"

/** True when the provider needs the network to answer. */
fun needsNetwork(providerId: String): Boolean = providerId != OFFLINE_FALLBACK_ID

/**
 * Offline moment: the id to switch to, or null when already local
 * (nothing to park).
 */
fun offlineTarget(activeId: String): String? =
    if (needsNetwork(activeId)) OFFLINE_FALLBACK_ID else null

/**
 * Back online: the id to restore, or null when there is nothing to do —
 * no parked provider, or the user has moved on to something else meanwhile.
 */
fun onlineRestore(parkedFrom: String?, activeId: String): String? {
    if (parkedFrom == null) return null
    if (activeId != OFFLINE_FALLBACK_ID) return null
    return parkedFrom
}
