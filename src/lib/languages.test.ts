import { describe, it, expect } from "vitest";
import {
	LANGUAGE_MENUS,
	EUROPEAN_LANGUAGES,
	ASIAN_LANGUAGES,
	AFRICAN_LANGUAGES,
	CLASSICAL_LANGUAGES,
	QUICK_LANG_CODES,
	langMenuAnchorFor,
	quickKeyFor,
	replyLanguageFor,
	switchToastFor,
	thinkingLabelFor
} from "./languages";

describe("reply languages", () => {
	it("has four menus in order", () => {
		expect(LANGUAGE_MENUS.map((m) => m.id)).toEqual([
			"europe",
			"asia",
			"africa",
			"classics"
		]);
	});

	it("keeps the requested European order", () => {
		expect(EUROPEAN_LANGUAGES.map((l) => l.code)).toEqual([
			"fr",
			"de",
			"es",
			"pt",
			"ru",
			"pl",
			"it",
			"no",
			"cs",
			"el",
			"ro",
			"bg",
			"hu",
			"uk",
			"nl",
			"sv",
			"da",
			"fi",
			"sr",
			"sk"
		]);
	});

	it("keeps the requested Asian order", () => {
		expect(ASIAN_LANGUAGES.map((l) => l.code)).toEqual([
			"zh",
			"ja",
			"ko",
			"ar",
			"hi",
			"id",
			"tr",
			"fa",
			"th",
			"vi",
			"hy",
			"ur",
			"he",
			"bn",
			"ta",
			"tl",
			"ms",
			"yue"
		]);
	});

	it("keeps the requested African order", () => {
		expect(AFRICAN_LANGUAGES.map((l) => l.code)).toEqual(["sw", "am"]);
	});

	it("labels Arabic short and resolves the new languages", () => {
		expect(replyLanguageFor("ar")?.name).toBe("Arabic (MSA)");
		expect(replyLanguageFor("ar")?.prompt).toBe(
			"Reply in Modern Standard Arabic."
		);
		for (const code of ["uk", "nl", "ur", "he"]) {
			expect(replyLanguageFor(code)?.prompt).toBe(
				`Reply in ${replyLanguageFor(code)?.name}.`
			);
		}
		expect(quickKeyFor("ar")).toBe("⌘8");
	});

	it("lists Latin, Ancient Greek, Sanskrit", () => {
		expect(CLASSICAL_LANGUAGES.map((l) => l.code)).toEqual(["la", "grc", "sa"]);
	});

	it("gives every language a distinct emoji marker", () => {
		for (const menu of LANGUAGE_MENUS) {
			const badges = menu.languages.map((l) => l.badge);
			for (const badge of badges) {
				// eslint-disable-next-line no-control-regex -- the range *is* the assertion: badges must be non-ASCII.
				expect(badge).toMatch(/[^\x00-\x7F]/);
			}
			expect(new Set(badges).size).toBe(badges.length);
		}
	});

	it("resolves codes and tolerates unknowns", () => {
		expect(replyLanguageFor("ja")?.prompt).toBe("Reply in Japanese.");
		expect(replyLanguageFor("ja")?.voice).toBe("ja-JP");
		expect(replyLanguageFor("yue")?.prompt).toBe("Reply in Cantonese.");
		expect(replyLanguageFor("sw")?.voice).toBe("sw-KE");
		expect(replyLanguageFor("sv")?.badge).toBe("🇸🇪");
		expect(replyLanguageFor(null)).toBeNull();
		expect(replyLanguageFor("xx")).toBeNull();
	});

	it("maps ⌘1…⌘0 to the priority flags in order", () => {
		expect([...QUICK_LANG_CODES]).toEqual([
			"fr",
			"de",
			"es",
			"zh",
			"ja",
			"pt",
			"ko",
			"ar",
			"hi",
			"ru"
		]);
	});

	it("resolves every quick code and labels its key", () => {
		for (const code of QUICK_LANG_CODES) {
			expect(replyLanguageFor(code)).not.toBeNull();
		}
		expect(quickKeyFor("fr")).toBe("⌘1");
		expect(quickKeyFor("zh")).toBe("⌘4");
		expect(quickKeyFor("hi")).toBe("⌘9");
		expect(quickKeyFor("ru")).toBe("⌘0");
		expect(quickKeyFor("it")).toBeNull();
		expect(quickKeyFor("xx")).toBeNull();
	});

	it("labels thinking in every reply language, English fallback", () => {
		const all = [
			...EUROPEAN_LANGUAGES,
			...ASIAN_LANGUAGES,
			...AFRICAN_LANGUAGES,
			...CLASSICAL_LANGUAGES
		];
		expect(all.length).toBeGreaterThan(0);
		for (const lang of all) {
			const label = thinkingLabelFor(lang.code);
			expect(label.length).toBeGreaterThan(0);
			expect(label).not.toBe(lang.code);
		}
		expect(thinkingLabelFor(null)).toBe("Thinking");
		expect(thinkingLabelFor("xx")).toBe("Thinking");
		expect(thinkingLabelFor("ja")).toBe("考え中");
		expect(thinkingLabelFor("ar")).toBe("تفكير");
		expect(thinkingLabelFor("fr")).toBe("Réflexion");
	});
});

describe("reply pill data", () => {
	it("gives every language an endonym and a cleared word", () => {
		for (const menu of LANGUAGE_MENUS) {
			for (const lang of menu.languages) {
				expect(lang.native.trim().length).toBeGreaterThan(0);
				expect(lang.cleared.trim().length).toBeGreaterThan(0);
			}
		}
		expect(replyLanguageFor("cs")?.native).toBe("Čeština");
		expect(replyLanguageFor("cs")?.cleared).toBe("Vymazáno");
		expect(replyLanguageFor("ja")?.native).toBe("日本語");
	});
	it("toasts the switch as endonym plus marker", () => {
		expect(switchToastFor(replyLanguageFor("cs")!)).toBe("Čeština 🇨🇿");
		expect(switchToastFor(replyLanguageFor("ja")!)).toBe("日本語 🇯🇵");
		expect(switchToastFor(replyLanguageFor("la")!)).toBe("Latina 🏛");
		// Language names stay lowercase where the language does so.
		expect(switchToastFor(replyLanguageFor("fr")!)).toBe("français 🇫🇷");
	});
});

describe("langMenuAnchorFor", () => {
	const base = {
		btnLeft: 100,
		btnBottom: 200,
		composerTop: 800,
		viewportWidth: 1280,
		itemCount: 4
	};

	it("drops short lists under the pill, capped at the composer", () => {
		expect(langMenuAnchorFor(base)).toEqual({
			left: 100,
			maxH: 578,
			mode: "drop",
			top: 206
		});
	});

	it("centers long lists that never fit the gap", () => {
		expect(
			langMenuAnchorFor({ ...base, itemCount: 30 }).mode
		).toBe("center");
		expect(
			langMenuAnchorFor({ ...base, itemCount: 30 }).maxH
		).toBe(784);
	});

	it("keeps the left edge on-screen", () => {
		expect(
			langMenuAnchorFor({ ...base, btnLeft: 1200 }).left
		).toBe(1092);
		expect(langMenuAnchorFor({ ...base, btnLeft: -50 }).left).toBe(8);
	});
});
