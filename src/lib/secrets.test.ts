// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { describe, it, expect, beforeEach } from "vitest";
import {
	getSecret,
	setSecret,
	deleteSecret,
	hydrateSecrets,
	migrateLegacySecret,
	persistSecrets,
	withBlankedKeys,
	secretAccount,
	tauriBackendAvailable,
	KEYCHAIN_SERVICE,
	SECRET_BUNDLE_ACCOUNT,
	encodeSecretBundle,
	decodeSecretBundle,
	resetSecretCacheForTests
} from "./secrets";
import { defaultSettings } from "./settings";

beforeEach(() => {
	localStorage.clear();
	resetSecretCacheForTests();
});

describe("secrets fallback (no Tauri shell)", () => {
	it("reports no Tauri backend in jsdom", () => {
		expect(tauriBackendAvailable()).toBe(false);
	});

	it("detects the v2 shell global (v1 name kept as fallback)", () => {
		const w = window as unknown as Record<string, unknown>;
		const prevInternals = w.__TAURI_INTERNALS__;
		const prevV1 = w.__TAURI__;
		try {
			w.__TAURI_INTERNALS__ = {};
			expect(tauriBackendAvailable()).toBe(true);
			delete w.__TAURI_INTERNALS__;
			w.__TAURI__ = {};
			expect(tauriBackendAvailable()).toBe(true);
		} finally {
			if (prevInternals === undefined) delete w.__TAURI_INTERNALS__;
			else w.__TAURI_INTERNALS__ = prevInternals;
			if (prevV1 === undefined) delete w.__TAURI__;
			else w.__TAURI__ = prevV1;
		}
		expect(tauriBackendAvailable()).toBe(false);
	});

	it("round-trips secrets through namespaced storage", async () => {
		expect(await getSecret(secretAccount("deepseek"))).toBeNull();
		await setSecret(secretAccount("deepseek"), "sk-test");
		expect(await getSecret(secretAccount("deepseek"))).toBe("sk-test");
		await deleteSecret(secretAccount("deepseek"));
		expect(await getSecret(secretAccount("deepseek"))).toBeNull();
	});

	it("never leaves the key as plaintext where WebCrypto exists", async () => {
		if (!globalThis.crypto?.subtle) return; // Compat path: plaintext, see below.
		await setSecret(secretAccount("deepseek"), "sk-test");
		const stored = localStorage.getItem("ccez-keychain:provider:deepseek");
		expect(stored).toContain("gcm1:");
		expect(stored).not.toContain("sk-test");
		expect(await getSecret(secretAccount("deepseek"))).toBe("sk-test");
	});

	it("still reads legacy plaintext entries (pre-encryption)", async () => {
		localStorage.setItem("ccez-keychain:provider:legacy", "sk-plain");
		expect(await getSecret(secretAccount("legacy"))).toBe("sk-plain");
		// The next write re-encrypts the entry.
		await setSecret(secretAccount("legacy"), "sk-plain");
		expect(await getSecret(secretAccount("legacy"))).toBe("sk-plain");
		if (globalThis.crypto?.subtle) {
			expect(localStorage.getItem("ccez-keychain:provider:legacy")).toContain(
				"gcm1:"
			);
		}
	});

	it("hydrates blank settings keys from the bundle only", async () => {
		await setSecret(
			SECRET_BUNDLE_ACCOUNT,
			encodeSecretBundle({ muse: "muse-test" })
		);
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "";
		settings.providers["muse"]!.apiKey = "";
		const hydrated = await hydrateSecrets(settings);
		expect(hydrated).toEqual(["muse"]);
		expect(settings.providers["muse"]!.apiKey).toBe("muse-test");
		// Already-filled keys are left alone.
		settings.providers["deepseek"]!.apiKey = "keep";
		await expect(hydrateSecrets(settings)).resolves.toEqual([]);
		expect(settings.providers["deepseek"]!.apiKey).toBe("keep");
	});

	it("launch never touches legacy per-provider items", async () => {
		await setSecret(secretAccount("muse"), "muse-test");
		const settings = defaultSettings();
		settings.providers["muse"]!.apiKey = "";
		await expect(hydrateSecrets(settings)).resolves.toEqual([]);
		expect(settings.providers["muse"]!.apiKey).toBe("");
		// The legacy item survives for on-demand migration.
		expect(await getSecret(secretAccount("muse"))).toBe("muse-test");
	});

	it("freezes the secretAccount format (renaming orphans stored secrets)", () => {
		expect(secretAccount("deepseek")).toBe("provider:deepseek");
		expect(secretAccount("openai")).toBe("provider:openai");
	});

	it("keeps one keychain identity across frontend, Rust, and bundle id", async () => {
		// Ad-hoc dev rebuilds change code identity and macOS re-prompts;
		// a service/identifier drift would orphan entries the same way,
		// so all three spellings are locked together here.
		// Vitest runs from the repo root, so these stay CWD-relative.
		const [confRaw, libRs] = await Promise.all([
			readFile("src-tauri/tauri.conf.json", "utf8"),
			readFile("src-tauri/src/lib.rs", "utf8")
		]);
		const identifier = (JSON.parse(confRaw) as { identifier?: unknown })
			.identifier;
		expect(identifier).toBe(KEYCHAIN_SERVICE);
		const service = /const KEYCHAIN_SERVICE: &str = "([^"]+)"/.exec(libRs)?.[1];
		expect(service).toBe(KEYCHAIN_SERVICE);
	});

	it("persists keys and blanks copies for shell storage", async () => {
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "sk-live";
		settings.providers["muse"]!.apiKey = "";
		await persistSecrets(settings);
		expect(decodeSecretBundle(await getSecret(SECRET_BUNDLE_ACCOUNT))).toEqual({
			deepseek: "sk-live"
		});
		// One item for all providers: no per-provider entries are created.
		expect(await getSecret(secretAccount("deepseek"))).toBeNull();
		const blanked = withBlankedKeys(settings);
		expect(blanked.providers["deepseek"]!.apiKey).toBe("");
		expect(settings.providers["deepseek"]!.apiKey).toBe("sk-live");
	});

	it("skips the write when nothing changed (no Keychain touch, no re-prompt)", async () => {
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "sk-live";
		settings.providers["muse"]!.apiKey = "muse-live";
		await persistSecrets(settings);
		// Plant a sentinel over storage: a second identical persist must
		// leave it alone, proving no write happened.
		localStorage.setItem("ccez-keychain:providers", "sentinel");
		await persistSecrets(settings);
		expect(localStorage.getItem("ccez-keychain:providers")).toBe("sentinel");
		// A changed key writes again.
		resetSecretCacheForTests();
		localStorage.removeItem("ccez-keychain:providers");
		await persistSecrets(settings);
		settings.providers["deepseek"]!.apiKey = "sk-rotated";
		await persistSecrets(settings);
		expect(decodeSecretBundle(await getSecret(SECRET_BUNDLE_ACCOUNT))).toEqual({
			deepseek: "sk-rotated",
			muse: "muse-live"
		});
	});

	it("migrates one legacy item on demand, once", async () => {
		await setSecret(secretAccount("muse"), "muse-test");
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "";
		settings.providers["muse"]!.apiKey = "";
		await expect(migrateLegacySecret(settings, "muse")).resolves.toBe(true);
		expect(settings.providers["muse"]!.apiKey).toBe("muse-test");
		expect(decodeSecretBundle(await getSecret(SECRET_BUNDLE_ACCOUNT))).toEqual({
			muse: "muse-test"
		});
		expect(await getSecret(secretAccount("muse"))).toBeNull();
		// Nothing left to migrate: second call is a no-op.
		await expect(migrateLegacySecret(settings, "muse")).resolves.toBe(false);
		// Later launches read the bundle: same result, no legacy reads.
		const again = defaultSettings();
		again.providers["muse"]!.apiKey = "";
		await expect(hydrateSecrets(again)).resolves.toEqual(["muse"]);
		expect(again.providers["muse"]!.apiKey).toBe("muse-test");
	});

	it("on-demand migration skips filled keys and missing items", async () => {
		const settings = defaultSettings();
		settings.providers["muse"]!.apiKey = "keep";
		await expect(migrateLegacySecret(settings, "muse")).resolves.toBe(false);
		settings.providers["muse"]!.apiKey = "";
		await expect(migrateLegacySecret(settings, "muse")).resolves.toBe(false);
		await expect(migrateLegacySecret(settings, "nope")).resolves.toBe(false);
	});

	it("never clobbers a stored bundle with emptiness before first hydrate", async () => {
		await setSecret(
			SECRET_BUNDLE_ACCOUNT,
			encodeSecretBundle({ muse: "muse-test" })
		);
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "";
		settings.providers["muse"]!.apiKey = "";
		await persistSecrets(settings);
		expect(decodeSecretBundle(await getSecret(SECRET_BUNDLE_ACCOUNT))).toEqual({
			muse: "muse-test"
		});
	});

	it("encodes bundles canonically and reads corrupt payloads as empty", () => {
		expect(encodeSecretBundle({ b: "2", a: "1" })).toBe('{"a":"1","b":"2"}');
		expect(encodeSecretBundle({})).toBe("{}");
		expect(decodeSecretBundle(null)).toEqual({});
		expect(decodeSecretBundle("not json")).toEqual({});
		expect(decodeSecretBundle("[1,2]")).toEqual({});
		expect(decodeSecretBundle('{"a":1,"b":"","c":"x"}')).toEqual({ c: "x" });
	});
});
