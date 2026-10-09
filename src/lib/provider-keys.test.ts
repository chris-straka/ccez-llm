import { describe, expect, it } from "vitest";
import { ProviderKeys } from "./provider-keys.svelte";
import { MockProvider } from "./providers/mock";
import { builtin, type ProviderId } from "./providers/registry";
import { defaultSettings, type AppSettings } from "./settings";

const DEEPSEEK = builtin("deepseek");
const MUSE = builtin("muse");
const MLKIT = builtin("local-mlkit");

function setKey(settings: AppSettings, id: ProviderId, key: string): void {
	const conf = settings.providers[id];
	if (!conf) throw new Error(`no ${id}`);
	conf.apiKey = key;
}

/** A promise the test settles by hand (hydration in flight). */
function gate(): { promise: Promise<void>; open: () => void } {
	let open = (): void => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

function harness(
	opts: {
		secure?: boolean;
		mock?: boolean;
		active?: ProviderId;
		hydrate?: Promise<void>;
		/** Keys the legacy items hold, folded in on migration. */
		legacy?: Partial<Record<ProviderId, string>>;
	} = {}
) {
	const settings = defaultSettings();
	// Env keys (VITE_*_API_KEY) seed defaults: start every key blank.
	for (const conf of Object.values(settings.providers)) conf.apiKey = "";
	settings.activeProviderId = opts.active ?? DEEPSEEK;
	const calls = { hydrated: 0, migrated: [] as string[] };
	const keys = new ProviderKeys({
		getSettings: () => settings,
		mock: opts.mock ?? false,
		secure: opts.secure ?? false,
		isPhone: () => false,
		hydrate: async () => {
			calls.hydrated++;
			await opts.hydrate;
		},
		migrateLegacy: async (s, id) => {
			calls.migrated.push(id);
			const key = opts.legacy?.[id as ProviderId];
			if (!key) return false;
			setKey(s, id as ProviderId, key);
			return true;
		}
	});
	return { keys, settings, calls };
}

describe("ProviderKeys lock", () => {
	it("a browser starts loaded and locks a blank keyed provider", () => {
		const { keys, settings, calls } = harness();
		expect(calls.hydrated).toBe(0);
		expect(keys.loaded).toBe(true);
		expect(keys.locked).toBe(true);
		setKey(settings, DEEPSEEK, "sk-1");
		expect(keys.locked).toBe(false);
	});

	it("mock and keyless providers never lock", () => {
		expect(harness({ mock: true }).keys.locked).toBe(false);
		expect(harness({ active: MLKIT }).keys.locked).toBe(false);
	});

	it("the shell waits for hydration before locking, then migrates the launch provider", async () => {
		const hydration = gate();
		const { keys, calls } = harness({
			secure: true,
			hydrate: hydration.promise
		});
		expect(calls.hydrated).toBe(1);
		expect(keys.loaded).toBe(false);
		expect(keys.locked).toBe(false);
		hydration.open();
		await new Promise((r) => setTimeout(r, 0));
		expect(calls.migrated).toEqual([DEEPSEEK]);
		expect(keys.loaded).toBe(true);
		expect(keys.locked).toBe(true);
	});

	it("a launch key parked in a legacy item unlocks after hydration", async () => {
		const { keys } = harness({
			secure: true,
			legacy: { [DEEPSEEK]: "sk-old" }
		});
		await new Promise((r) => setTimeout(r, 0));
		expect(keys.loaded).toBe(true);
		expect(keys.locked).toBe(false);
	});
});

describe("ProviderKeys.tryLegacyWhenLocked", () => {
	it("tries each locked provider's legacy item once, never the launch one again", async () => {
		const { keys, settings, calls } = harness({ secure: true });
		await new Promise((r) => setTimeout(r, 0));
		expect(calls.migrated).toEqual([DEEPSEEK]);
		keys.tryLegacyWhenLocked();
		settings.activeProviderId = MUSE;
		keys.tryLegacyWhenLocked();
		keys.tryLegacyWhenLocked();
		expect(calls.migrated).toEqual([DEEPSEEK, MUSE]);
	});

	it("does nothing in a browser or while unlocked", () => {
		const browser = harness();
		browser.keys.tryLegacyWhenLocked();
		expect(browser.calls.migrated).toEqual([]);
	});
});

describe("ProviderKeys resolve", () => {
	it("resolves a keyed provider and refuses a blank one", () => {
		const { keys, settings } = harness();
		expect(keys.resolve()).toBeNull();
		setKey(settings, DEEPSEEK, "sk-1");
		expect(keys.resolve()).not.toBeNull();
	});

	it("mock resolves the mock provider", () => {
		expect(harness({ mock: true }).keys.resolve()).toBeInstanceOf(MockProvider);
	});

	it("resolveActive folds a legacy key in before giving up", async () => {
		const found = harness({ legacy: { [DEEPSEEK]: "sk-old" } });
		expect(await found.keys.resolveActive()).not.toBeNull();
		expect(found.calls.migrated).toEqual([DEEPSEEK]);
		const none = harness();
		expect(await none.keys.resolveActive()).toBeNull();
	});
});

describe("ProviderKeys.noKeyToastDue", () => {
	it("toasts once per keyless provider episode, never inside Settings", () => {
		const { keys, settings } = harness();
		expect(keys.noKeyToastDue(true)).toBe(false);
		expect(keys.noKeyToastDue(false)).toBe(true);
		expect(keys.noKeyToastDue(false)).toBe(false);
		settings.activeProviderId = MUSE;
		expect(keys.noKeyToastDue(false)).toBe(true);
		setKey(settings, MUSE, "k");
		expect(keys.noKeyToastDue(false)).toBe(false);
		setKey(settings, MUSE, "");
		expect(keys.noKeyToastDue(false)).toBe(true);
	});

	it("a failed send's missing flag also toasts", () => {
		const { keys, settings } = harness();
		setKey(settings, DEEPSEEK, "sk-1");
		expect(keys.noKeyToastDue(false)).toBe(false);
		keys.missing = true;
		expect(keys.noKeyToastDue(false)).toBe(true);
	});
});
