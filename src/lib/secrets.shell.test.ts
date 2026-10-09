// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Shell-mode secrets: `invoke` stands in for the Rust Keychain commands. */
const keychain = new Map<string, string>();
let readFails = false;
const invoke = vi.fn(
	async (cmd: string, args: { account: string; secret?: string }) => {
		if (cmd === "keychain_get") {
			if (readFails) throw new Error("User interaction is not allowed.");
			return keychain.get(args.account) ?? null;
		}
		if (cmd === "keychain_set") {
			keychain.set(args.account, args.secret ?? "");
			return null;
		}
		return null;
	}
);
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const {
	hydrateSecrets,
	persistSecrets,
	resetSecretCacheForTests,
	secretsSurviveReload,
	encodeSecretBundle,
	SECRET_BUNDLE_ACCOUNT
} = await import("./secrets");
const { defaultSettings } = await import("./settings");

beforeEach(() => {
	keychain.clear();
	readFails = false;
	invoke.mockClear();
	resetSecretCacheForTests();
	(window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ =
		{};
});
afterEach(() => {
	delete (window as unknown as { __TAURI_INTERNALS__?: object })
		.__TAURI_INTERNALS__;
});

describe("secrets in the shell", () => {
	it("a failed Keychain read never lets a later save drop other keys", async () => {
		keychain.set(
			SECRET_BUNDLE_ACCOUNT,
			encodeSecretBundle({ muse: "muse-key", deepseek: "old-key" })
		);
		readFails = true;
		const settings = defaultSettings();
		settings.providers["muse"]!.apiKey = "";
		settings.providers["deepseek"]!.apiKey = "";
		await expect(hydrateSecrets(settings)).resolves.toEqual([]);
		// Seeing no key, the user pastes one for DeepSeek.
		settings.providers["deepseek"]!.apiKey = "new-key";
		await persistSecrets(settings);
		expect(invoke).not.toHaveBeenCalledWith("keychain_set", expect.anything());
		expect(keychain.get(SECRET_BUNDLE_ACCOUNT)).toBe(
			encodeSecretBundle({ muse: "muse-key", deepseek: "old-key" })
		);
	});

	it("once the Keychain reads again, the save merges nothing away", async () => {
		keychain.set(
			SECRET_BUNDLE_ACCOUNT,
			encodeSecretBundle({ muse: "muse-key" })
		);
		const settings = defaultSettings();
		settings.providers["muse"]!.apiKey = "";
		settings.providers["deepseek"]!.apiKey = "";
		await expect(hydrateSecrets(settings)).resolves.toEqual(["muse"]);
		settings.providers["deepseek"]!.apiKey = "new-key";
		await persistSecrets(settings);
		expect(keychain.get(SECRET_BUNDLE_ACCOUNT)).toBe(
			encodeSecretBundle({ muse: "muse-key", deepseek: "new-key" })
		);
	});

	it("an empty Keychain still takes the first key", async () => {
		const settings = defaultSettings();
		settings.providers["muse"]!.apiKey = "";
		settings.providers["deepseek"]!.apiKey = "";
		await hydrateSecrets(settings);
		settings.providers["muse"]!.apiKey = "first";
		await persistSecrets(settings);
		expect(keychain.get(SECRET_BUNDLE_ACCOUNT)).toBe(
			encodeSecretBundle({ muse: "first" })
		);
	});

	it("shell storage always outlives a reload", async () => {
		await expect(secretsSurviveReload()).resolves.toBe(true);
	});
});
