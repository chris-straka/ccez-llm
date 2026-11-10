/**
 * Offline fallback: when the network drops, a cloud chat provider is
 * parked on the on-device ML Kit option; reconnecting restores exactly
 * what the drop parked — never a provider the user picked meanwhile.
 * Pure helpers (tested); the event wiring lives in `+page.svelte`.
 */
import { asProviderId, builtin, type ProviderId } from "./providers/registry";

/** The on-device provider id (see `providers/registry.ts`). */
export const OFFLINE_FALLBACK_ID: ProviderId = builtin("local-mlkit");

/** On a Mac: Apple's on-device model (ccez-apple-llm on this Mac). */
export const MAC_OFFLINE_ID: ProviderId = builtin("apple");

/** Test seam id: the mock provider never touches the network either. */
const MOCK_ID = "mock";

/** True when the provider needs the network to answer (Apple's model only
 * answers offline on a Mac, where it runs). */
export function needsNetwork(providerId: string, mac = false): boolean {
	if (mac && providerId === MAC_OFFLINE_ID) return false;
	return providerId !== OFFLINE_FALLBACK_ID && providerId !== MOCK_ID;
}

/** Where an offline moment parks a cloud provider: Apple's model on a Mac,
 * Gemma (ML Kit) on Android. */
function parkedOn(mac: boolean): ProviderId {
	return mac ? MAC_OFFLINE_ID : OFFLINE_FALLBACK_ID;
}

/**
 * Offline moment: the id to switch to, or null when already local
 * (nothing to park).
 */
export function offlineTarget(
	activeId: string,
	mac = false
): ProviderId | null {
	return needsNetwork(activeId, mac) ? parkedOn(mac) : null;
}

/**
 * Back online: the id to restore, or null when there is nothing to do —
 * no parked provider, or the user has moved on to something else meanwhile.
 */
export function onlineRestore(
	parkedFrom: string | null,
	activeId: string,
	mac = false
): ProviderId | null {
	if (parkedFrom === null) return null;
	if (activeId !== parkedOn(mac)) return null;
	return asProviderId(parkedFrom);
}
