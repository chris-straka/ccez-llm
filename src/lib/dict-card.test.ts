import { describe, expect, it, vi } from "vitest";
import {
	cardFromDictionary,
	dictionaryPromptLines,
	firstHits,
	formatTags,
	japaneseHead,
	japaneseParts,
	lookupForms,
	stemSplit,
	type DictHit,
	type JaPiece
} from "./dict-card";
import { annotationAnswer } from "./reading";
import type { ChatProvider } from "./providers/types";

const franchir = {
	w: "franchir",
	p: "verb",
	s: [
		"to clear, to cross (a line); to get over (a fence)",
		"to cover (a distance)"
	]
};

describe("formatTags", () => {
	it("reads Wiktionary tag sets as grammar names", () => {
		expect(formatTags("participle past")).toBe("past participle");
		expect(formatTags("gerund participle present")).toBe("present participle");
		expect(formatTags("indicative present singular third-person")).toBe(
			"present indicative, third-person singular"
		);
		expect(formatTags("dative definite masculine singular")).toBe(
			"dative masculine singular"
		);
		expect(formatTags("feminine plural")).toBe("feminine plural");
		expect(formatTags("alternative")).toBe("alternative form");
		expect(formatTags("")).toBe("");
	});
});

describe("stemSplit", () => {
	it("splits where the stem shows, nowhere else", () => {
		expect(stemSplit("franchi", "franchir")).toEqual(["franch", "i"]);
		expect(stemSplit("parlé", "parler")).toEqual(["parl", "é"]);
		expect(stemSplit("Hauses", "Haus")).toEqual(["Haus", "es"]);
		expect(stemSplit("Häusern", "Haus")).toBeNull();
		expect(stemSplit("est", "être")).toBeNull();
		expect(stemSplit("maison", "maison")).toBeNull();
	});
});

describe("cardFromDictionary", () => {
	it("names the form and splits its ending at once", () => {
		const card = cardFromDictionary(
			"franchi",
			[{ tags: "participle past", entry: franchir }],
			"fr"
		)!;
		expect(card.meaning).toBe("past participle of franchir");
		expect(card.parts).toEqual([
			{ text: "franch", label: "franchir", kind: "core" },
			{ text: "i", label: "past participle", kind: "tense" }
		]);
		expect(card.base).toContain("franchir, verb: to clear");
		expect(card.partial).toBe(true);
		expect(card.lang).toBe("fr");
	});

	it("gives a headword its first sense and gender", () => {
		const card = cardFromDictionary(
			"Krankenhaus,",
			[
				{
					tags: "",
					entry: { w: "Krankenhaus", p: "noun", g: "neuter", s: ["hospital"] }
				},
				{
					tags: "dative singular",
					entry: { w: "Krankenhaus", p: "noun", g: "neuter", s: ["hospital"] }
				}
			],
			"de"
		)!;
		expect(card.meaning).toBe("hospital");
		expect(card.parts).toEqual([]);
		expect(card.facts).toEqual([{ text: "neuter", kind: "agree" }]);
	});

	it("marks case endings as the word's role", () => {
		const card = cardFromDictionary(
			"Hauses",
			[
				{
					tags: "genitive singular",
					entry: { w: "Haus", p: "noun", s: ["house"] }
				}
			],
			"de"
		)!;
		expect(card.parts[1]).toMatchObject({
			label: "genitive singular",
			kind: "role"
		});
	});

	it("is nothing without hits", () => {
		expect(cardFromDictionary("x", [], "fr")).toBeNull();
	});
});

const yomareteita: JaPiece[] = [
	{ surface: "読ま", pos: "動詞", sub: "自立", base: "読む", reading: "よま" },
	{ surface: "れ", pos: "動詞", sub: "接尾", base: "れる", reading: "れ" },
	{ surface: "て", pos: "助詞", sub: "接続助詞", base: "て", reading: "て" },
	{ surface: "い", pos: "動詞", sub: "非自立", base: "いる", reading: "い" },
	{ surface: "た", pos: "助動詞", sub: "", base: "た", reading: "た" }
];

describe("Japanese pieces", () => {
	it("label the content word by its dictionary form and the rest by name", () => {
		expect(japaneseParts(yomareteita)).toEqual([
			{ text: "読ま", label: "読む", kind: "core", reading: "よま" },
			{ text: "れ", label: "passive", kind: "voice" },
			{ text: "て", label: "te-form", kind: "tense" },
			{ text: "い", label: "ongoing", kind: "tense" },
			{ text: "た", label: "past", kind: "tense" }
		]);
		expect(japaneseHead(yomareteita)).toBe("読む");
	});

	it("tell a nominalizing の from a possessive one", () => {
		const parts = japaneseParts([
			{ surface: "の", pos: "名詞", sub: "非自立", base: "の" },
			{ surface: "の", pos: "助詞", sub: "格助詞", base: "の" },
			{ surface: "が", pos: "助詞", sub: "格助詞", base: "が" }
		]);
		expect(parts.map((p) => p.label)).toEqual([
			"makes a noun",
			"possessive",
			"subject marker"
		]);
	});

	it("split a card from the analysis", () => {
		const card = cardFromDictionary(
			"読まれていた",
			[
				{
					tags: "",
					entry: { w: "読む", p: "godan verb", r: "よむ", s: ["to read"] }
				}
			],
			"ja",
			yomareteita
		)!;
		expect(card.parts).toHaveLength(5);
		expect(card.meaning).toBe("to read");
		expect(card.base).toBe("読む (よむ), godan verb: to read");
	});
});

describe("lookups", () => {
	it("try the word, then what follows an elided article", () => {
		expect(lookupForms("« franchi, »")).toEqual(["franchi"]);
		expect(lookupForms("l'homme")).toEqual(["l'homme", "homme"]);
		expect(lookupForms("qu’il")).toEqual(["qu’il", "il"]);
		expect(lookupForms("...")).toEqual([]);
	});

	it("take the first form that hits", () => {
		const hit: DictHit = { tags: "", entry: franchir };
		expect(firstHits([[], [hit]])).toEqual([hit]);
		expect(firstHits([[], []])).toEqual([]);
	});

	it("brief the model with each form and its senses", () => {
		expect(
			dictionaryPromptLines("franchi", [
				{ tags: "participle past", entry: franchir }
			])
		).toBe(
			"- franchi: past participle of franchir. franchir (verb): " +
				"to clear, to cross (a line); to get over (a fence); to cover (a distance)"
		);
	});
});

describe("annotationAnswer with a dictionary", () => {
	const q = {
		quote: "franchi",
		question: "",
		context: "le fleuve a franchi ses digues"
	};
	const model = JSON.stringify({
		meaning: "crossed",
		parts: [
			{ text: "franch", label: "franchir", kind: "core" },
			{ text: "i", label: "past participle", kind: "tense" }
		],
		facts: []
	});

	it("shows the dictionary's card first, then the model's", async () => {
		const chat = vi.fn(async () => ({ content: model, usage: null }));
		const provider = { id: "s", chat, stream: chat } as unknown as ChatProvider;
		const partials: unknown[] = [];
		const reply = await annotationAnswer(provider, q, undefined, {
			lang: "fr",
			lookup: async () => ({
				hits: [{ tags: "participle past", entry: franchir }],
				japanese: []
			}),
			onPartial: (r) => partials.push(r.card)
		});
		expect(partials).toHaveLength(1);
		expect(partials[0]).toMatchObject({
			meaning: "past participle of franchir",
			partial: true
		});
		expect(reply.card?.meaning).toBe("crossed");
		expect(reply.card?.partial).toBeUndefined();
		const system = (
			chat.mock.calls[0] as unknown as [Array<{ content: string }>]
		)[0][0]!.content;
		expect(system).toContain("Dictionary entries for the word");
		expect(system).toContain("past participle of franchir");
	});

	it("asks the model alone when the lookup has nothing or fails", async () => {
		const chat = vi.fn(async () => ({ content: model, usage: null }));
		const provider = { id: "s", chat, stream: chat } as unknown as ChatProvider;
		const onPartial = vi.fn();
		await annotationAnswer(provider, q, undefined, {
			lang: "fr",
			lookup: () => Promise.reject(new Error("no pack")),
			onPartial
		});
		expect(onPartial).not.toHaveBeenCalled();
		const system = (
			chat.mock.calls[0] as unknown as [Array<{ content: string }>]
		)[0][0]!.content;
		expect(system).not.toContain("Dictionary entries");
	});
});
