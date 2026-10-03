import { SvelteSet } from "svelte/reactivity";
import { isOnDeviceProvider } from "./ondevice/bridge";
import { getProviderDef } from "./providers/registry";
import { resolveProviderFor } from "./providers/resolve";
import type { ChatProvider } from "./providers/types";
import type { AppSettings } from "./settings";
import { composerLocked } from "./submit";

/** Page-owned collaborators the key state reads. */
export interface ProviderKeysDeps {
	getSettings: () => AppSettings;
	/** Mock provider on (never locks, never needs a key). */
	mock: boolean;
	/** Keys live in secure storage (the shell); browsers keep them in
	settings, so they start loaded. */
	secure: boolean;
	isPhone: () => boolean;
	/** Pull secure-storage keys into the live settings. */
	hydrate: (settings: AppSettings) => Promise<unknown>;
	/** Fold one provider's pre-bundle item into the bundle; true when
	it held a key. */
	migrateLegacy: (settings: AppSettings, id: string) => Promise<boolean>;
}

/**
 * API-key state and active-provider resolution: secure-key hydration,
 * the no-key composer lock, the one-shot legacy migration per
 * provider, the send-time missing-key flag, and the phone's one toast
 * per keyless episode. Same shape as AnnotationDrafts: a plain const
 * holding the instance; the page keeps its effects and the editor.
 */
export class ProviderKeys {
	private readonly deps: ProviderKeysDeps;

	/** Secure-storage keys are in memory. The no-key lock waits on
	this: keys arrive asynchronously after first paint. */
	loaded = $state(true);
	/** The last send found no usable key (cleared by the next one). */
	missing = $state(false);
	/** Providers whose pre-bundle per-provider item was already tried. */
	private readonly legacyTried = new SvelteSet<string>();
	/** Provider id already toasted for a missing key. */
	private toastedFor: string | null = null;

	/**
	 * No-key lock: a keyed provider with a blank stored key locks the
	 * composer (no typing, locked hint) instead of accepting a draft
	 * into a doomed turn. Mock and keyless (on-device) never lock.
	 */
	readonly locked = $derived.by(() => {
		const settings = this.deps.getSettings();
		const id = settings.activeProviderId;
		return composerLocked({
			mock: this.deps.mock,
			keyless:
				getProviderDef(id, settings.customProviders).keyless === true ||
				isOnDeviceProvider(id),
			keysLoaded: this.loaded,
			apiKey: settings.providers[id]?.apiKey ?? ""
		});
	});

	constructor(deps: ProviderKeysDeps) {
		this.deps = deps;
		if (!deps.secure) return;
		// Pull Keychain keys into memory before the first send. A key
		// still parked in a pre-bundle item migrates here too: the
		// no-key lock blocks typing, so waiting for a send would strand it.
		this.loaded = false;
		const settings = deps.getSettings();
		const launchId = settings.activeProviderId;
		this.legacyTried.add(launchId);
		void deps
			.hydrate(settings)
			.then(() => deps.migrateLegacy(settings, launchId))
			.finally(() => {
				this.loaded = true;
			});
	}

	/** Switching to a locked provider tries its pre-bundle item once.
	The page runs this from an effect (reads subscribe). */
	tryLegacyWhenLocked(): void {
		if (!this.deps.secure || !this.locked) return;
		const settings = this.deps.getSettings();
		const id = settings.activeProviderId;
		if (this.legacyTried.has(id)) return;
		this.legacyTried.add(id);
		void this.deps.migrateLegacy(settings, id);
	}

	/** The active provider, or null when its key is blank. */
	resolve(): ChatProvider | null {
		const settings = this.deps.getSettings();
		return resolveProviderFor({
			useMock: this.deps.mock,
			activeProviderId: settings.activeProviderId,
			providers: settings.providers,
			customProviders: settings.customProviders,
			mobile: this.deps.isPhone()
		});
	}

	/**
	 * resolve plus one legacy migration attempt: when the active
	 * provider's key is blank, a pre-bundle per-provider item may still
	 * hold it — read that single item, fold it into the bundle, and
	 * re-resolve before concluding the key is missing. The launch path
	 * never does this fan-out; it fires only here, in the user's send
	 * context, at most once per legacy key.
	 */
	async resolveActive(): Promise<ChatProvider | null> {
		const direct = this.resolve();
		if (direct) return direct;
		const settings = this.deps.getSettings();
		if (await this.deps.migrateLegacy(settings, settings.activeProviderId)) {
			return this.resolve();
		}
		return null;
	}

	/**
	 * One "No API key" toast per provider episode (phones report
	 * errors as toasts). Never from inside Settings: switching to a
	 * keyless provider mid-panel must not toast before the key can be
	 * entered — closing the panel still keyless reminds once. A
	 * resolved key ends the episode. Run from an effect.
	 */
	noKeyToastDue(settingsOpen: boolean): boolean {
		const keyless = this.missing || this.locked;
		if (!keyless || settingsOpen) {
			if (!keyless) this.toastedFor = null;
			return false;
		}
		const id = this.deps.getSettings().activeProviderId;
		if (this.toastedFor === id) return false;
		this.toastedFor = id;
		return true;
	}
}
