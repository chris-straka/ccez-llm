import { describe, it, expect } from "vitest";
import type { ChatId } from "../chat";
import {
	asProviderId,
	builtin,
	getProviderDef,
	isBuiltinProviderId,
	listProviders,
	providerKeyMissing,
	createProvider,
	BUILTIN_PROVIDER_IDS,
	isFreeModel,
	pickedModels,
	defaultProviderFor,
	platformDefaultProvider,
	type ProviderId
} from "./registry";

const custom = [
	{
		id: asProviderId("custom-kimi"),
		label: "Kimi",
		defaultBaseUrl: "https://api.moonshot.ai/v1",
		defaultModel: "moonshot-v1",
		keyHint: "API key"
	}
];

describe("registry", () => {
	it("lists built-ins plus customs, rejects unknowns", () => {
		expect(listProviders(custom).map((p) => p.id)).toEqual([
			"deepseek",
			"deepseek-login",
			"deepseek-mac",
			"opencode-zen",
			"local-mlkit",
			"apple",
			"custom-kimi"
		]);
		expect(getProviderDef("custom-kimi", custom).label).toBe("Kimi");
		expect(getProviderDef("deepseek-mac", custom).label).toBe("DeepSeek (Mac)");
		// Retired: Muse is no provider at all.
		expect(() => getProviderDef("muse", custom)).toThrow("Unknown provider");
		expect(() => getProviderDef("muse-login", custom)).toThrow(
			"Unknown provider"
		);
		expect(() => getProviderDef("nope", custom)).toThrow("Unknown provider");
		expect(
			createProvider(
				"custom-kimi",
				{ baseUrl: "https://x", apiKey: "k", model: "m" },
				custom
			)
		).toBeTruthy();
	});

	it("flags the on-device fallback as keyless with Ollama defaults", () => {
		const def = getProviderDef("local-mlkit", custom);
		expect(def.label).toBe("ML Kit (on-device)");
		expect(def.keyless).toBe(true);
		expect(def.defaultBaseUrl).toBe("http://localhost:11434/v1");
		expect(
			createProvider(
				"local-mlkit",
				{ baseUrl: def.defaultBaseUrl, apiKey: "", model: def.defaultModel },
				custom
			)
		).toBeTruthy();
	});

	it("narrows OpenCode Zen's model list and marks its free models", () => {
		expect(
			pickedModels("opencode-zen", ["gpt-6-sol", "glm-5.3", "exo-free"])
		).toEqual(["exo-free", "glm-5.3"]);
		// Other providers keep the list as fetched.
		expect(pickedModels("deepseek", ["b", "a"])).toEqual(["b", "a"]);
		expect(isFreeModel("opencode-zen", "big-pickle")).toBe(true);
		expect(isFreeModel("opencode-zen", "glm-5.3")).toBe(false);
		expect(isFreeModel("deepseek", "big-pickle")).toBe(false);
	});

	it("pins the built-in set: registry ids match BUILTIN_PROVIDER_IDS", () => {
		expect(listProviders().map((p) => p.id)).toEqual([...BUILTIN_PROVIDER_IDS]);
		expect(isBuiltinProviderId("deepseek-login")).toBe(true);
		expect(isBuiltinProviderId("local-mlkit")).toBe(true);
		expect(isBuiltinProviderId("custom-kimi")).toBe(false);
		expect(isBuiltinProviderId("muse")).toBe(false);
	});

	it("rejects cross-kind ids at compile time", () => {
		const chatId = "x" as ChatId;
		// @ts-expect-error a chat id is not a provider id
		const misassigned: ProviderId = chatId;
		expect(misassigned).toBe("x");
		// @ts-expect-error a typo'd built-in never compiles via builtin()
		builtin("deepseak");
	});
});

describe("the three ways to DeepSeek", () => {
	it("all run deepseek-flash; two need no key", () => {
		const keyed = getProviderDef("deepseek");
		const login = getProviderDef("deepseek-login");
		const mac = getProviderDef("deepseek-mac");
		for (const def of [keyed, login, mac])
			expect(def.defaultModel).toBe("deepseek-flash");
		expect(keyed.defaultBaseUrl).toBe("https://api.deepseek.com");
		expect(keyed.keyless).toBeUndefined();
		expect(login).toMatchObject({
			label: "DeepSeek (logged in)",
			defaultBaseUrl: "/api/ai/deepseek",
			keyless: true
		});
		expect(mac).toMatchObject({
			label: "DeepSeek (Mac)",
			defaultBaseUrl: "https://z.tailfe37c2.ts.net:8448/ai/deepseek",
			keyless: true
		});
	});

	it("starts each platform on its own route", () => {
		expect(defaultProviderFor({ shell: true, android: false })).toBe(
			"deepseek-mac"
		);
		expect(defaultProviderFor({ shell: false, android: false })).toBe(
			"deepseek-login"
		);
		// A phone's browser is the website too.
		expect(defaultProviderFor({ shell: false, android: true })).toBe(
			"deepseek-login"
		);
		expect(defaultProviderFor({ shell: true, android: true })).toBe("deepseek");
		// Node: no shell, no phone.
		expect(platformDefaultProvider()).toBe("deepseek-login");
	});
});

describe("providerKeyMissing", () => {
	it("refuses blank keys except on keyless endpoints", () => {
		expect(providerKeyMissing("  ", false)).toBe(true);
		expect(providerKeyMissing("", false)).toBe(true);
		expect(providerKeyMissing("k", false)).toBe(false);
		expect(providerKeyMissing("", true)).toBe(false);
	});
});
