import { describe, it, expect } from "vitest";
import { identifyLangOffline, identifyLangShort } from "./langId";

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

describe("identifyLangShort", () => {
	it("reads German quotes by stopwords, capitals, and umlauts", () => {
		expect(
			identifyLangShort("bis zu einer erstaunlichen Vielfalt an Brotsorten")
		).toBe("de-DE");
		expect(identifyLangShort("Weihnachtsmärkte")).toBe("de-DE");
		expect(identifyLangShort("tief geformt")).toBe(null);
		expect(identifyLangShort("der Hund")).toBe("de-DE");
		expect(identifyLangShort("für dich")).toBe("de-DE");
	});

	it("reads short English by function words", () => {
		expect(
			identifyLangShort(
				"Great picks — these are all very natural German constructions"
			)
		).toBe("en-US");
		expect(identifyLangShort("the cat")).toBe("en-US");
		expect(identifyLangShort("deeply shaped / profoundly shaped")).toBe(
			null
		);
	});

	it("reads French by accents and elisions", () => {
		expect(
			identifyLangShort("L'histoire allemande fut façonnée par une série")
		).toBe("fr-FR");
		expect(identifyLangShort("où est la gare")).toBe("fr-FR");
	});

	it("reads Spanish, Italian, Portuguese, Dutch shorts", () => {
		expect(identifyLangShort("¿Dónde está la biblioteca")).toBe("es-ES");
		expect(identifyLangShort("è un bel giorno")).toBe("it-IT");
		expect(identifyLangShort("não sei onde é")).toBe("pt-PT");
		expect(identifyLangShort("ik zie je morgen")).toBe("nl-NL");
	});

	it("stays null on scoreless or contested fragments", () => {
		expect(identifyLangShort("")).toBe(null);
		expect(identifyLangShort("qwerty asdf")).toBe(null);
		expect(identifyLangShort("miteinander")).toBe(null);
		expect(identifyLangShort("tief = deep / deeply")).toBe(null);
		// café votes three ways at once: no contestant leads.
		expect(identifyLangShort("café")).toBe(null);
		expect(identifyLangShort("connects, joins, combines")).toBe(null);
	});
});
