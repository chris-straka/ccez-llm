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
			"muse",
			"deepseek",
			"opencode-zen",
			"local-mlkit",
			"custom-kimi"
		]);
		expect(getProviderDef("custom-kimi", custom).label).toBe("Kimi");
		expect(getProviderDef("muse", custom).label).toBe("Muse");
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
		expect(pickedModels("opencode-zen", ["gpt-6-sol", "glm-5.3", "exo-free"])).toEqual([
			"exo-free",
			"glm-5.3"
		]);
		// Other providers keep the list as fetched.
		expect(pickedModels("deepseek", ["b", "a"])).toEqual(["b", "a"]);
		expect(isFreeModel("opencode-zen", "big-pickle")).toBe(true);
		expect(isFreeModel("opencode-zen", "glm-5.3")).toBe(false);
		expect(isFreeModel("deepseek", "big-pickle")).toBe(false);
	});

	it("pins the built-in set: registry ids match BUILTIN_PROVIDER_IDS", () => {
		expect(listProviders().map((p) => p.id)).toEqual([...BUILTIN_PROVIDER_IDS]);
		expect(isBuiltinProviderId("muse")).toBe(true);
		expect(isBuiltinProviderId("local-mlkit")).toBe(true);
		expect(isBuiltinProviderId("custom-kimi")).toBe(false);
		expect(isBuiltinProviderId("musse")).toBe(false);
	});

	it("rejects cross-kind ids at compile time", () => {
		const chatId = "x" as ChatId;
		// @ts-expect-error a chat id is not a provider id
		const misassigned: ProviderId = chatId;
		expect(misassigned).toBe("x");
		// @ts-expect-error a typo'd built-in never compiles via builtin()
		builtin("musse");
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
