import { isOnDeviceProvider } from "../ondevice/bridge";
import { OnDeviceChatProvider } from "../ondevice/provider";
import { MockProvider } from "./mock";
import {
	createProvider,
	getProviderDef,
	providerKeyMissing,
	type ProviderDef
} from "./registry";
import type { ProviderSettings } from "../settings";
import type { ChatProvider } from "./types";

/**
 * Active-provider construction (REFACTOR: pure decision over an
 * explicit snapshot, so the branches unit-test without the shell).
 * On-device Nano is keyless and conf-free; failures downstream throw
 * the seam's short copy, never a reroute. Keyless on-device endpoints
 * carry no key by design.
 */
export interface ProviderResolution {
	useMock: boolean;
	activeProviderId: string;
	providers: Record<string, ProviderSettings>;
	customProviders: ProviderDef[];
	mobile: boolean;
}

export function resolveProviderFor(r: ProviderResolution): ChatProvider | null {
	if (r.useMock) return new MockProvider();
	if (isOnDeviceProvider(r.activeProviderId))
		return new OnDeviceChatProvider();
	const conf = r.providers[r.activeProviderId];
	const keyless =
		getProviderDef(r.activeProviderId, r.customProviders).keyless === true;
	if (!conf) return null;
	if (providerKeyMissing(conf.apiKey, keyless)) return null;
	return createProvider(
		r.activeProviderId,
		{ ...conf, mobile: r.mobile },
		r.customProviders
	);
}
