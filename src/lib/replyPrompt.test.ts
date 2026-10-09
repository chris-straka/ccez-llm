import { describe, expect, it } from "vitest";
import { ONDEVICE_PROVIDER_ID } from "./ondevice/bridge";
import { replySystemPrompt } from "./replyPrompt";
import {
	CORRECTION_HINT,
	LOOKUP_CAPABILITY_HINT,
	defaultSettings
} from "./settings";

describe("replySystemPrompt", () => {
	it("tells cloud replies they can look things up", () => {
		const prompt = replySystemPrompt(defaultSettings(), null, undefined);
		expect(prompt).toContain(LOOKUP_CAPABILITY_HINT);
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
