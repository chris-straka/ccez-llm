import { describe, it, expect } from "vitest";
import {
	hasQualityVoices,
	tierLabel,
	voicesForLang,
	allVoicesForLang,
	autoVoiceForLang,
	installedLangs,
	voiceLangOptions
} from "./voiceTiers";
import type { NativeVoice } from "./nativeTts";

const voice = (
	id: string,
	lang: string,
	quality: number,
	name?: string
): NativeVoice => ({
	id,
	name: name ?? id.split(".").pop() ?? id,
	lang,
	quality
});

describe("hasQualityVoices", () => {
	it("is true when a premium or enhanced voice is installed", () => {
		const voices = [
			voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1),
			voice("com.apple.voice.enhanced.bg-BG.Daria", "bg-BG", 2)
		];
		expect(hasQualityVoices(voices)).toBe(true);
		expect(
			hasQualityVoices([
				voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3)
			])
		).toBe(true);
	});

	it("is false for default-tier voices, Siri personas, and empty lists", () => {
		expect(
			hasQualityVoices([
				voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1),
				voice("com.apple.eloquence.en-US.Eddy", "en-US", 1),
				voice("a", "en-US", 0)
			])
		).toBe(false);
		expect(hasQualityVoices([])).toBe(false);
	});
});

describe("tierLabel", () => {
	it("labels premium, enhanced, Siri, and default voices", () => {
		expect(
			tierLabel(voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3))
		).toBe("premium");
		expect(
			tierLabel(voice("com.apple.voice.enhanced.bg-BG.Daria", "bg-BG", 2))
		).toBe("enhanced");
		expect(tierLabel(voice("com.apple.eloquence.en-US.Eddy", "en-US", 1))).toBe(
			"Siri"
		);
		expect(
			tierLabel(voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1))
		).toBe("default");
	});
});

describe("voicesForLang", () => {
	const voices = [
		voice("com.apple.voice.compact.en-GB.Daniel", "en-GB", 1, "Daniel"),
		voice("com.apple.voice.premium.en-GB.Malcolm", "en-GB", 3, "Jamie"),
		voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3, "Petra"),
		voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1, "Samantha"),
		voice("com.apple.eloquence.en-US.Eddy", "en-US", 1, "Eddy"),
		voice("com.apple.voice.enhanced.en-US.Zoe", "en-US", 2, "Zoe")
	];

	it("lists the exact locale first, then the same language", () => {
		expect(voicesForLang(voices, "en-US").map((v) => v.name)).toEqual([
			"Zoe",
			"Jamie"
		]);
		expect(voicesForLang(voices, "de-DE").map((v) => v.name)).toEqual([
			"Petra"
		]);
	});

	it("leaves out default-tier voices, including Siri personas", () => {
		const names = voicesForLang(voices, "en-US").map((v) => v.name);
		expect(names).not.toContain("Daniel");
		expect(names).not.toContain("Samantha");
		expect(names).not.toContain("Eddy");
	});

	it("matches locales case-insensitively and sorts by name", () => {
		expect(voicesForLang(voices, "EN-us").map((v) => v.id)).toEqual([
			"com.apple.voice.enhanced.en-US.Zoe",
			"com.apple.voice.premium.en-GB.Malcolm"
		]);
	});

	it("is empty when the language has nothing above the default tier", () => {
		expect(voicesForLang(voices, "fr-FR")).toEqual([]);
	});

	it("attaches tier labels to options", () => {
		expect(voicesForLang(voices, "en-US")[1]).toMatchObject({
			name: "Jamie",
			lang: "en-GB",
			tier: "premium"
		});
	});
});

describe("allVoicesForLang", () => {
	const voices = [
		voice("com.google.android.tts.en-GB", "en-GB", 0, "English (UK)"),
		voice("com.google.android.tts.en-US", "en-US", 0, "English (US)"),
		voice("com.google.android.tts.de-DE", "de-DE", 0, "Deutsch"),
		voice("com.apple.voice.premium.en-GB.Malcolm", "en-GB", 3, "Jamie")
	];

	it("lists every tier, exact locale first, then the same language", () => {
		expect(allVoicesForLang(voices, "en-US").map((v) => v.name)).toEqual([
			"English (US)",
			"English (UK)",
			"Jamie"
		]);
	});

	it("is empty when the language has no voices at all", () => {
		expect(allVoicesForLang(voices, "fr-FR")).toEqual([]);
	});
});

describe("autoVoiceForLang", () => {
	const jamie = voice(
		"com.apple.voice.premium.en-GB.Malcolm",
		"en-GB",
		3,
		"Jamie"
	);
	const zoe = voice("com.apple.voice.enhanced.en-US.Zoe", "en-US", 2, "Zoe");
	const sam = voice(
		"com.apple.voice.compact.en-US.Samantha",
		"en-US",
		1,
		"Samantha"
	);
	const voices = [sam, zoe, jamie];

	it("prefers the saved pick when it matches the language", () => {
		expect(autoVoiceForLang(voices, "en-US", zoe.id)).toMatchObject({
			name: "Zoe"
		});
	});

	it("picks best installed otherwise: exact locale, then quality", () => {
		// Jamie is premium but en-GB: Zoe's exact en-US wins the +10.
		expect(autoVoiceForLang(voices, "en-US", null)).toMatchObject({
			name: "Zoe",
			tier: "enhanced"
		});
		// Nothing installed for French: no resolution.
		expect(autoVoiceForLang(voices, "fr-FR", null)).toBeNull();
		expect(autoVoiceForLang([], "en-US", null)).toBeNull();
	});

	it("reaches default-tier voices that the picker hides", () => {
		expect(autoVoiceForLang([sam], "en-US", null)).toMatchObject({
			name: "Samantha",
			tier: "default"
		});
	});
});

describe("installedLangs", () => {
	it("lists distinct engine tags sorted, blanks dropped", () => {
		expect(
			installedLangs([
				voice("a", "ja-JP", 0),
				voice("b", "en-US", 1),
				voice("c", "en-US", 0),
				voice("d", "  ", 0),
				voice("e", "en-GB", 0)
			])
		).toEqual(["en-GB", "en-US", "ja-JP"]);
		expect(installedLangs([])).toEqual([]);
	});
});

describe("voiceLangOptions", () => {
	const label = (tag: string): string => `${tag}-label`;

	it("leads with follow, then installed, collapsing duplicates", () => {
		expect(
			voiceLangOptions(["en-US", "ja-JP"], "en-US", { tag: "ja-JP", name: "Japanese" }, label)
		).toEqual([
			{ value: "ja-JP", label: "Follow chat language (Japanese)" },
			{ value: "en-US", label: "en-US-label" }
		]);
	});
	it("keeps the current tag when nothing installed matches", () => {
		expect(voiceLangOptions(["en-US"], "xx-YY", null, label)).toEqual([
			{ value: "en-US", label: "en-US-label" },
			{ value: "xx-YY", label: "xx-YY-label" }
		]);
	});
	it("lists installed tags with no follow row", () => {
		expect(voiceLangOptions(["ja-JP", "en-US"], "en-US", null, label)).toEqual([
			{ value: "ja-JP", label: "ja-JP-label" },
			{ value: "en-US", label: "en-US-label" }
		]);
	});
});
