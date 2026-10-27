import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_MENUS } from "./languages";
import { annotationAnswer } from "./reading";
import type { ChatProvider } from "./providers/types";
import {
	buildWordCardMessages,
	cardWordRow,
	isWordQuote,
	shortGrammar,
	parseWordCard,
	WORD_PROFILES,
	wordCardDir,
	wordCardLang,
	wordCardText,
	type WordCard
} from "./word-card";

const franchi = {
	meaning: "crossed",
	parts: [
		{ text: "franch", label: "franchir", kind: "core" },
		{ text: "i", label: "past participle", kind: "tense" }
	],
	facts: [{ text: "passé composé, with a", kind: "tense" }],
	base: "franchir = to cross.",
	here: "With a before it, it is the passé composé.",
	watch: "With avoir it doesn't agree with the subject."
};

function scripted(...replies: string[]): {
	provider: ChatProvider;
	chat: ReturnType<typeof vi.fn>;
} {
	const queue = [...replies];
	const chat = vi.fn(async () => ({
		content: queue.shift() ?? "",
		usage: null
	}));
	return {
		provider: { id: "scripted", chat, stream: chat },
		chat
	};
}

describe("word profiles", () => {
	it("cover every language in the reply menus", () => {
		const codes = LANGUAGE_MENUS.flatMap((m) => m.languages.map((l) => l.code));
		expect(codes.length).toBeGreaterThan(40);
		for (const code of codes) {
			expect(WORD_PROFILES[code], code).toBeDefined();
			expect(WORD_PROFILES[code]!.checklist.length, code).toBeGreaterThan(2);
		}
	});

	it("run right to left for Arabic-script and Hebrew languages", () => {
		for (const code of ["ar", "fa", "ur", "he", "hbo"])
			expect(wordCardDir(code)).toBe("rtl");
		expect(wordCardDir("fr")).toBe("ltr");
		expect(wordCardDir(undefined)).toBe("ltr");
	});
});

describe("isWordQuote", () => {
	it("takes one word, with its apostrophes and edge punctuation", () => {
		expect(isWordQuote("franchi")).toBe(true);
		expect(isWordQuote("aujourd'hui,")).toBe(true);
		expect(isWordQuote("Donaudampfschifffahrtsgesellschaft")).toBe(true);
		expect(isWordQuote("読まれていた")).toBe(true);
	});

	it("leaves phrases and clauses to prose", () => {
		expect(isWordQuote("a franchi")).toBe(false);
		expect(isWordQuote("Il pleut.Encore")).toBe(false);
		expect(isWordQuote("私は食べるのが好きです")).toBe(false);
		expect(isWordQuote("食べる、飲む")).toBe(false);
		expect(isWordQuote("  ")).toBe(false);
	});
});

describe("wordCardLang", () => {
	it("prefers the chat's language, else reads the script", () => {
		expect(wordCardLang("franchi", "fr")).toBe("fr");
		expect(wordCardLang("食べる", null)).toBe("ja");
		expect(wordCardLang("电脑", null)).toBe("zh");
		expect(wordCardLang("학교", null)).toBe("ko");
		expect(wordCardLang("المكتبة", null)).toBe("ar");
		expect(wordCardLang("franchi", null)).toBeNull();
		expect(wordCardLang("franchi", "xx")).toBeNull();
	});
});

describe("parseWordCard", () => {
	it("keeps a full grammar name whole for the card to shorten", () => {
		const repart = {
			meaning: "leaves again",
			parts: [
				{ text: "repar", label: "repartir", kind: "core" },
				{
					text: "t",
					label: "present indicative, third-person singular",
					kind: "tense"
				}
			]
		};
		const label = parseWordCard(JSON.stringify(repart), "repart")?.parts[1]
			?.label;
		expect(label).toBe("present indicative, third-person singular");
		expect(shortGrammar(label ?? "")).toBe("▶ indicative, 3rd 👤");
	});
	it("reads the object, fenced or bare", () => {
		const json = JSON.stringify(franchi);
		expect(parseWordCard(json, "franchi")?.parts).toHaveLength(2);
		expect(
			parseWordCard("```json\n" + json + "\n```", "franchi")?.meaning
		).toBe("crossed");
	});

	it("drops a split that doesn't spell the word, keeping the rest", () => {
		const card = parseWordCard(
			JSON.stringify({
				...franchi,
				parts: [{ text: "franchir", kind: "core" }]
			}),
			"franchi"
		);
		expect(card?.parts).toEqual([]);
		expect(card?.base).toBe("franchir = to cross.");
	});

	it("matches the split across case and edge punctuation", () => {
		expect(
			parseWordCard(JSON.stringify(franchi), "Franchi,")?.parts
		).toHaveLength(2);
	});

	it("clips facts, reads unknown kinds as core, and needs a meaning", () => {
		const card = parseWordCard(
			JSON.stringify({
				...franchi,
				parts: [{ text: "franchi", kind: "weird", label: "franchir" }],
				facts: [1, 2, 3, 4].map((n) => ({ text: `f${n}`, kind: "role" }))
			}),
			"franchi"
		);
		expect(card?.parts[0]?.kind).toBe("core");
		expect(card?.facts).toHaveLength(3);
		expect(parseWordCard(JSON.stringify({ parts: [] }), "x")).toBeNull();
		expect(parseWordCard("crossed, as a past participle", "x")).toBeNull();
	});

	it("drops a sentence sense that only repeats the meaning", () => {
		const card = parseWordCard(
			JSON.stringify({ ...franchi, inSentence: "crossed" }),
			"franchi"
		);
		expect(card?.inSentence).toBeUndefined();
	});
});

describe("wordCardText", () => {
	it("reads meaning first, then the split, facts and notes", () => {
		const card = parseWordCard(
			JSON.stringify({ ...franchi, inSentence: "burst past" }),
			"franchi"
		)!;
		expect(wordCardText(card).split("\n")).toEqual([
			"crossed",
			"In this sentence: burst past",
			"franch (franchir) + i (past participle)",
			"passé composé, with a",
			"With a before it, it is the passé composé.",
			"Watch: With avoir it doesn't agree with the subject."
		]);
	});

	it("keeps the form the word belongs to and the phrase it means", () => {
		const card = parseWordCard(
			JSON.stringify({
				meaning: "gone",
				parts: [],
				facts: [],
				construction: {
					name: "perfect tense",
					words: "sind … gegangen",
					gloss: "are … gone"
				},
				phrase: { words: "sind … spazieren gegangen", meaning: "we strolled" }
			}),
			"gegangen"
		)!;
		expect(card.construction?.words).toBe("sind … gegangen");
		expect(wordCardText(card).split("\n")).toEqual([
			"gone",
			"perfect tense: sind … gegangen (are … gone)",
			"sind … spazieren gegangen → we strolled"
		]);
		// Half a construction is none.
		expect(
			parseWordCard(
				JSON.stringify({
					meaning: "gone",
					construction: { name: "perfect tense" }
				}),
				"gegangen"
			)!.construction
		).toBeUndefined();
	});

	it("drops a base the core piece's label already names", () => {
		const named = parseWordCard(JSON.stringify(franchi), "franchi")!;
		expect(named.base).toBeUndefined();
		// épineuse's core is épineus: épineux is news.
		const card = parseWordCard(
			JSON.stringify({
				meaning: "thorny",
				parts: [
					{ text: "épineus", label: "épineuse", kind: "core" },
					{ text: "e", label: "feminine", kind: "agree" }
				],
				facts: [],
				base: "épineux → thorny"
			}),
			"épineuse"
		)!;
		expect(card.base).toBe("épineux → thorny");
	});
});

describe("buildWordCardMessages", () => {
	const q = { quote: "raining", context: "It's raining cats and dogs." };

	it("asks for the literal meaning first and the idiom only after", () => {
		const [system] = buildWordCardMessages(q, null);
		expect(system!.content).toContain("what the word itself means, literally");
		expect(system!.content).toContain(
			"Never the sense of an idiom or larger phrase it sits in"
		);
		// The idiom goes in the phrase, with what it means here.
		expect(system!.content).toContain('"pleut des cordes"');
		expect(system!.content).toContain("never an abbreviation");
		expect(system!.content).toContain("Work out the passage's language first");
	});

	it("asks for no pieces when the dictionary split the word", () => {
		const [known] = buildWordCardMessages(q, "fr", { knownParts: true });
		expect(known!.content).toContain(
			'"parts": [] always: the dictionary already split the word.'
		);
		expect(known!.content).not.toContain("meaningful pieces");
		const [asked] = buildWordCardMessages(q, "fr");
		expect(asked!.content).toContain("meaningful pieces");
	});

	it("carries the language's checklist and reading line", () => {
		const [system] = buildWordCardMessages(q, "ja");
		expect(system!.content).toContain("The passage is in Japanese.");
		expect(system!.content).toContain("hiragana for any kanji");
		expect(system!.content).toContain("nominalizers の and こと");
		const [french] = buildWordCardMessages(q, "fr");
		expect(french!.content).toContain('"reading": leave it out.');
	});

	it("writes in the passage's language when asked", () => {
		const [system] = buildWordCardMessages(q, "fr", { inPassageLang: true });
		expect(system!.content).toContain(
			"Write every field in the passage's own language"
		);
	});
});

describe("annotationAnswer with one word", () => {
	const q = {
		quote: "franchi",
		question: "",
		context: "le fleuve a franchi ses digues"
	};

	it("files a word card and its text", async () => {
		const { provider, chat } = scripted(JSON.stringify(franchi));
		const reply = await annotationAnswer(provider, q, undefined, {
			lang: "fr"
		});
		expect(chat).toHaveBeenCalledTimes(1);
		expect(reply.card?.lang).toBe("fr");
		expect(reply.card?.parts.map((p) => p.text)).toEqual(["franch", "i"]);
		expect(reply.answer.split("\n")[0]).toBe("crossed");
	});

	it("files prose when the model answers in prose", async () => {
		const { provider, chat } = scripted("Crossed, gone over.");
		const reply = await annotationAnswer(provider, q);
		expect(chat).toHaveBeenCalledTimes(1);
		expect(reply).toEqual({ answer: "Crossed, gone over." });
	});

	it("asks again in prose when the card's JSON breaks", async () => {
		const { provider, chat } = scripted('{"meaning": "cro', "Crossed.");
		const reply = await annotationAnswer(provider, q);
		expect(chat).toHaveBeenCalledTimes(2);
		expect(reply).toEqual({ answer: "Crossed." });
	});

	it("a typed question always gets prose", async () => {
		const { provider, chat } = scripted("Because avoir.");
		const reply = await annotationAnswer(provider, {
			...q,
			question: "why i?"
		});
		expect(chat).toHaveBeenCalledTimes(1);
		expect(reply.card).toBeUndefined();
	});
});

describe("cardWordRow", () => {
	const base: WordCard = {
		meaning: "extension, add-on",
		parts: [{ text: "extension", label: "extension", kind: "core" }],
		facts: [{ text: "une extension", kind: "agree" }]
	};

	it("puts the article in ghost and drops what only repeats the word", () => {
		expect(cardWordRow(base, "extension")).toEqual({
			article: "une",
			parts: [{ text: "extension", label: "", kind: "core" }],
			facts: [],
			gender: ""
		});
	});

	it("keeps an elided article, and the gender of another form", () => {
		expect(
			cardWordRow(
				{ ...base, parts: [], facts: [{ text: "l'homme", kind: "agree" }] },
				"homme"
			)
		).toMatchObject({ article: "l'", parts: [{ text: "homme" }] });
		// calèches is not la calèche: no ghost article, the split shows
		// with the gender under its stem.
		const row = cardWordRow(
			{
				meaning: "carriages",
				parts: [
					{ text: "calèche", label: "calèche", kind: "core" },
					{ text: "s", label: "plural", kind: "agree" }
				],
				facts: [{ text: "la calèche", kind: "agree" }]
			},
			"calèches"
		);
		expect(row.article).toBe("");
		expect(row.gender).toBe("f.");
		expect(row.facts).toHaveLength(0);
		// Its stem's label only repeats the piece: dropped too.
		expect(row.parts.map((p) => p.label)).toEqual(["", "plural"]);
	});

	it("marks the gender under the stem when the fact names its base", () => {
		const row = cardWordRow(
			{
				meaning: "students at a lycée",
				parts: [
					{ text: "lycéen", label: "lycéen", kind: "core" },
					{ text: "s", label: "plural", kind: "agree" }
				],
				facts: [{ text: "le lycéen", kind: "agree" }]
			},
			"lycéens"
		);
		expect(row).toMatchObject({ article: "", gender: "m.", facts: [] });
		// A base unlike the stem's spelling still matches its label.
		expect(
			cardWordRow(
				{
					meaning: "eyes",
					parts: [{ text: "yeux", label: "œil", kind: "core" }],
					facts: [{ text: "un œil", kind: "agree" }]
				},
				"yeux"
			)
		).toMatchObject({ gender: "m.", facts: [], parts: [{ text: "yeux" }] });
		// An elided article in the word: the gender goes under the stem,
		// not under l'.
		const annonce = cardWordRow(
			{
				meaning: "the announcement",
				parts: [
					{ text: "l'", label: "definite article", kind: "agree" },
					{ text: "annonce", label: "annonce", kind: "core" }
				],
				facts: [{ text: "la annonce", kind: "agree" }]
			},
			"l'annonce"
		);
		expect(annonce).toMatchObject({ gender: "f.", facts: [] });
		// A singular with a case ending keeps the article before it.
		expect(
			cardWordRow(
				{
					meaning: "exit ban",
					parts: [
						{ text: "Ausreise", label: "Ausreise", kind: "core" },
						{ text: "verbot", label: "Verbot", kind: "core" },
						{ text: "s", label: "genitive", kind: "role" }
					],
					facts: [{ text: "das Ausreiseverbot", kind: "agree" }]
				},
				"Ausreiseverbots"
			)
		).toMatchObject({ article: "das", gender: "", facts: [] });
		// A fact about a form the split doesn't show stays a pill.
		expect(
			cardWordRow(
				{
					meaning: "tables",
					parts: [{ text: "Tische", label: "Tische", kind: "core" }],
					facts: [{ text: "der Tisch", kind: "agree" }]
				},
				"Tische"
			)
		).toMatchObject({ gender: "", facts: [{ text: "der Tisch" }], parts: [] });
	});

	it("shows nothing for a lone piece with nothing to add", () => {
		expect(cardWordRow({ ...base, facts: [] }, "extension").parts).toEqual([]);
	});
});

describe("shortGrammar", () => {
	it("draws persons, number and tense short", () => {
		expect(shortGrammar("present indicative, third-person singular")).toBe(
			"▶ indicative, 3rd 👤"
		);
		expect(shortGrammar("first-person plural")).toBe("1st 👨‍👨‍👧‍👦");
		expect(shortGrammar("past participle")).toBe("⏪ participle");
		expect(shortGrammar("present continuous")).toBe("▶ 🔁");
		expect(shortGrammar("passé composé")).toBe("passé composé");
	});
});
