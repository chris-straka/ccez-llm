import { describe, expect, it } from "vitest";
import { ONDEVICE_PROVIDER_ID } from "./ondevice/bridge";
import { replySystemPrompt } from "./replyPrompt";
import {
	CORRECTION_HINT,
	DEEPSEEK_LOOKUP_HINT,
	LOOKUP_CAPABILITY_HINT,
	defaultSettings
} from "./settings";
import { asProviderId } from "./providers/registry";

describe("replySystemPrompt", () => {
	it("tells cloud replies they can look things up", () => {
		const settings = defaultSettings();
		settings.activeProviderId = asProviderId("opencode-zen");
		const prompt = replySystemPrompt(settings, null, undefined);
		expect(prompt).toContain(LOOKUP_CAPABILITY_HINT);
		// fetch_url serves the app's guide on demand there.
		expect(prompt).not.toContain("# Ccez LLM: how the app works");
	});

	it("tells DeepSeek it searches itself and carries the app's guide", () => {
		for (const id of ["deepseek", "deepseek-login", "deepseek-mac"]) {
			const settings = defaultSettings();
			settings.activeProviderId = asProviderId(id);
			const prompt = replySystemPrompt(settings, null, undefined);
			expect(prompt, id).toContain(DEEPSEEK_LOOKUP_HINT);
			expect(prompt).not.toContain("fetch_url");
			expect(prompt).toContain("# Ccez LLM: how the app works");
		}
	});

	it("leaves the lookup hint off on-device (no fetch tool there)", () => {
		const settings = defaultSettings();
		settings.activeProviderId = ONDEVICE_PROVIDER_ID;
		expect(replySystemPrompt(settings, null, undefined)).not.toContain(
			LOOKUP_CAPABILITY_HINT
		);
	});

	it("adds the correction line only for a correcting chat with a reply language", () => {
		const settings = defaultSettings();
		expect(
			replySystemPrompt(settings, "de", { correction: true, replyLang: "de" })
		).toContain(CORRECTION_HINT);
		expect(
			replySystemPrompt(settings, null, { correction: true, replyLang: null })
		).not.toContain(CORRECTION_HINT);
	});
});
