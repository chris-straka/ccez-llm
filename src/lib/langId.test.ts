import { describe, it, expect } from "vitest";
import { identifyLangOffline } from "./langId";

describe("identifyLangOffline", () => {
	it("resolves non-Latin scripts without statistics", () => {
		expect(identifyLangOffline("日本語を勉強しています")).toBe("ja-JP");
		expect(identifyLangOffline("我正在学习中文")).toBe("zh-CN");
		expect(identifyLangOffline("，。！")).toBe(null);
	});

	it("tells French from English on Latin samples", () => {
		const french =
			"Les enfants jouent dans le jardin avec leurs amis pour fêter la fin de lannée";
		const english =
			"The children have played with their friends and they would come back from there";
		expect(identifyLangOffline(french)).toBe("fr-FR");
		expect(identifyLangOffline(english)).toBe("en-US");
	});

	it("identifies German on a longer sample", () => {
		const german =
			"Der Hund und die Katze sind nicht von hier mit den anderen aus der Stadt";
		expect(identifyLangOffline(german)).toBe("de-DE");
	});

	it("returns null for short or scoreless samples", () => {
		expect(identifyLangOffline("")).toBe(null);
		expect(identifyLangOffline("hi there")).toBe(null);
		expect(
			identifyLangOffline("lorem ipsum dolor sit amet consectetur adipiscing")
		).toBe(null);
	});
});
