import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock";
import { OnDeviceChatProvider } from "../ondevice/provider";
import { OpenAICompatProvider } from "./openai-compat";
import { builtin } from "./registry";
import { resolveProviderFor, type ProviderResolution } from "./resolve";

function base(over: Partial<ProviderResolution> = {}): ProviderResolution {
	return {
		useMock: false,
		activeProviderId: builtin("muse"),
		providers: {
			[builtin("muse")]: {
				baseUrl: "https://api.meta.ai/v1",
				apiKey: "k",
				model: "m",
				models: []
			}
		},
		customProviders: [],
		mobile: false,
		...over
	};
}

describe("resolveProviderFor", () => {
	it("returns the mock provider when mocked", () => {
		expect(resolveProviderFor(base({ useMock: true }))).toBeInstanceOf(
			MockProvider
		);
	});

	it("returns the on-device provider without conf or key", () => {
		expect(
			resolveProviderFor(base({ activeProviderId: "local-mlkit", providers: {} }))
		).toBeInstanceOf(OnDeviceChatProvider);
	});

	it("throws on unknown ids even without conf", () => {
		expect(() => resolveProviderFor(base({ activeProviderId: "nope" }))).toThrow(
			"Unknown provider"
		);
	});

	it("returns null without conf and without a usable key", () => {
		expect(
			resolveProviderFor(base({ activeProviderId: builtin("deepseek") }))
		).toBeNull();
		const blank = base();
		blank.providers[builtin("muse")]!.apiKey = "  ";
		expect(resolveProviderFor(blank)).toBeNull();
	});

	it("constructs the configured provider with the mobile flag", () => {
		const got = resolveProviderFor(base({ mobile: true }));
		expect(got).toBeInstanceOf(OpenAICompatProvider);
	});
});
