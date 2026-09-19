import { describe, it, expect } from "vitest";
import { voiceLocaleForInputSource } from "./keyboardLang";

describe("voiceLocaleForInputSource", () => {
	it("maps the user's five keyboards", () => {
		expect(voiceLocaleForInputSource("com.apple.inputmethod.SCIM.Pinyin")).toBe(
			"zh-CN"
		);
		expect(voiceLocaleForInputSource("com.apple.keylayout.US")).toBe("en-US");
		expect(voiceLocaleForInputSource("com.apple.keylayout.CanadianCSA")).toBe(
			"fr-CA"
		);
		expect(
			voiceLocaleForInputSource(
				"com.apple.inputmethod.Kotoeri.RomajiTyping.Japanese"
			)
		).toBe("ja-JP");
		expect(
			voiceLocaleForInputSource("com.apple.inputmethod.Korean.2SetKorean")
		).toBe("ko-KR");
	});

	it("keeps Simplified and Traditional Chinese apart", () => {
		expect(voiceLocaleForInputSource("com.apple.inputmethod.SCIM.WBX")).toBe(
			"zh-CN"
		);
		expect(voiceLocaleForInputSource("com.apple.inputmethod.TCIM.Pinyin")).toBe(
			"zh-TW"
		);
		expect(voiceLocaleForInputSource("com.apple.inputmethod.TCIM.Zhuyin")).toBe(
			"zh-TW"
		);
		expect(
			voiceLocaleForInputSource("com.apple.inputmethod.TCIM.Cangjie")
		).toBe("zh-TW");
	});

	it("maps common keylayouts and is case-insensitive", () => {
		expect(voiceLocaleForInputSource("com.apple.keylayout.British")).toBe(
			"en-GB"
		);
		expect(voiceLocaleForInputSource("COM.APPLE.KEYLAYOUT.FRENCH")).toBe(
			"fr-FR"
		);
		expect(voiceLocaleForInputSource("com.apple.keylayout.ABC")).toBe("en-US");
	});

	it("returns null for unrecognized ids and empty strings", () => {
		expect(voiceLocaleForInputSource("com.example.CustomLayout")).toBeNull();
		expect(voiceLocaleForInputSource("")).toBeNull();
	});
});
