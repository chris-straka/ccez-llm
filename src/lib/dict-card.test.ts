import { describe, expect, it, vi } from "vitest";
import {
	cardFromDictionary,
	dictionaryPromptLines,
	firstHits,
	formatTags,
	japaneseHead,
	japaneseParts,
	lookupForms,
	plainSpelling,
	stemSplit,
	type DictHit,
	type JaPiece
} from "./dict-card";
import { annotationAnswer, LOOKUP_WAIT_MS } from "./reading";
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
		expect(formatTags("inessive singular")).toBe("inessive singular");
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
		expect(card.meaning).toBe("to clear, to cross (a line)");
		expect(card.parts).toEqual([
			{ text: "franch", label: "franchir", kind: "core" },
			{ text: "i", label: "past participle", kind: "tense" }
		]);
		// The split already shows what the form is.
		expect(card.base).toBeUndefined();
		expect(card.partial).toBe(true);
		expect(card.lang).toBe("fr");
	});

	it("splits where the pack says, prefix and markers apart", () => {
		const hablar = { w: "hablar", p: "verb", s: ["to speak"] };
		expect(
			cardFromDictionary(
				"hablamos",
				[
					{
						tags: "first-person indicative plural present",
						entry: hablar,
						split: [0, 4, 0]
					}
				],
				"es"
			)!.parts
		).toEqual([
			{ text: "habl", label: "hablar", kind: "core" },
			{
				text: "amos",
				label: "present indicative, first-person plural",
				kind: "tense"
			}
		]);
		const machen = { w: "machen", p: "verb", s: ["to make, to do"] };
		expect(
			cardFromDictionary(
				"gemacht",
				[{ tags: "participle past", entry: machen, split: [2, 4, 0] }],
				"de"
			)!.parts
		).toEqual([
			{ text: "ge", label: "past participle", kind: "tense" },
			{ text: "mach", label: "machen", kind: "core" },
			{ text: "t", label: "", kind: "tense" }
		]);
		const klein = { w: "klein", p: "adj", s: ["small"] };
		expect(
			cardFromDictionary(
				"kleineren",
				[
					{
						tags: "comparative genitive masculine singular strong",
						entry: klein,
						split: [0, 5, 2]
					}
				],
				"de"
			)!.parts
		).toEqual([
			{ text: "klein", label: "klein", kind: "core" },
			{ text: "er", label: "comparative", kind: "derive" },
			{
				text: "en",
				label: "strong genitive masculine singular",
				kind: "role"
			}
		]);
		const talo = { w: "talo", p: "noun", s: ["house"] };
		expect(
			cardFromDictionary(
				"taloissa",
				[{ tags: "inessive plural", entry: talo, split: [0, 4, 1] }],
				"fi"
			)!.parts
		).toEqual([
			{ text: "talo", label: "talo", kind: "core" },
			{ text: "i", label: "plural", kind: "agree" },
			{ text: "ssa", label: "inessive", kind: "role" }
		]);
	});

	it("keeps the guessed split when the pack's counts another spelling", () => {
		// Found under a spelling with fewer letters: the lengths don't fit.
		const card = cardFromDictionary(
			"franchi",
			[{ tags: "participle past", entry: franchir, split: [0, 3, 0] }],
			"fr",
			[],
			"franch"
		)!;
		expect(card.parts.map((p) => p.text)).toEqual(["franch", "i"]);
	});

	it("shows a headword's derivation pieces", () => {
		const card = cardFromDictionary(
			"Krankenhaus",
			[
				{
					tags: "",
					entry: {
						w: "Krankenhaus",
						p: "noun",
						g: "neuter",
						s: ["hospital"],
						m: [
							["Krank", "Kranker", "core"],
							["en", "", "derive"],
							["haus", "Haus", "core"]
						]
					}
				}
			],
			"de"
		)!;
		expect(card.parts).toEqual([
			{ text: "Krank", label: "Kranker", kind: "core" },
			{ text: "en", label: "", kind: "derive" },
			{ text: "haus", label: "Haus", kind: "core" }
		]);
		expect(card.facts).toEqual([{ text: "das Krankenhaus", kind: "agree" }]);
	});

	it("splits an elided article off as its own piece", () => {
		const epineux = { w: "épineux", p: "adj", s: ["spikey; spiny"] };
		expect(
			cardFromDictionary(
				"l'épineuse",
				[{ tags: "feminine singular", entry: epineux }],
				"fr"
			)
		).toMatchObject({
			meaning: "spikey",
			parts: [
				{ text: "l'", label: "the", kind: "agree" },
				{ text: "épineu", label: "épineux", kind: "core" },
				{ text: "se", label: "feminine singular", kind: "agree" }
			]
		});
		const homme = { w: "homme", p: "noun", g: "masculine", s: ["man"] };
		expect(
			cardFromDictionary("l’homme", [{ tags: "", entry: homme }], "fr")?.parts
		).toEqual([
			{ text: "l’", label: "the", kind: "agree" },
			{ text: "homme", label: "homme", kind: "core" }
		]);
		// A word with an apostrophe of its own stays whole.
		const auj = { w: "aujourd'hui", p: "adv", s: ["today"] };
		expect(
			cardFromDictionary("aujourd'hui", [{ tags: "", entry: auj }], "fr")?.parts
		).toEqual([]);
	});

	it("gives a noun's gender as its article, never twice", () => {
		const caleche = {
			w: "calèche",
			p: "noun",
			g: "feminine",
			s: ["calèche, carriage"]
		};
		const card = cardFromDictionary(
			"calèches",
			[
				{ tags: "plural", entry: caleche },
				{ tags: "feminine plural", entry: caleche }
			],
			"fr"
		)!;
		expect(card.meaning).toBe("calèche, carriage");
		expect(card.parts[1]).toMatchObject({ text: "s", label: "plural" });
		expect(card.facts).toEqual([{ text: "la calèche", kind: "agree" }]);
		expect(card.base).toBeUndefined();
		const oeil = { w: "œil", p: "noun", g: "masculine", s: ["eye"] };
		expect(
			cardFromDictionary("yeux", [{ tags: "plural", entry: oeil }], "fr")
		).toMatchObject({
			meaning: "eye",
			parts: [],
			facts: [{ text: "un œil" }],
			base: "plural of œil, noun"
		});
	});

	it("shows gender where l' would hide it, and el before a stressed a", () => {
		const fact = (w: string, g: string, lang: string) =>
			cardFromDictionary(
				w,
				[{ tags: "", entry: { w, p: "noun", g, s: ["x"] } }],
				lang
			)!.facts[0]?.text;
		expect(fact("homme", "masculine", "fr")).toBe("un homme");
		expect(fact("heure", "feminine", "fr")).toBe("une heure");
		expect(fact("hache", "feminine", "fr")).toBe("une hache");
		expect(fact("amica", "feminine", "it")).toBe("un'amica");
		expect(fact("amico", "masculine", "it")).toBe("un amico");
		expect(fact("agua", "feminine", "es")).toBe("el agua");
		expect(fact("hambre", "feminine", "es")).toBe("el hambre");
		expect(fact("águila", "feminine", "es")).toBe("el águila");
		expect(fact("amiga", "feminine", "es")).toBe("la amiga");
		expect(fact("acción", "feminine", "es")).toBe("la acción");
	});

	it("keeps homographs apart", () => {
		const hits = [
			{
				tags: "",
				entry: { w: "Leiter", p: "noun", g: "feminine", s: ["ladder"] }
			},
			{
				tags: "",
				entry: { w: "Leiter", p: "noun", g: "masculine", s: ["leader"] }
			}
		];
		const lines = dictionaryPromptLines("Leiter", hits);
		expect(lines).toContain("ladder");
		expect(lines).toContain("leader");
	});

	it("lets the headword beat a variant spelling of itself", () => {
		const homme = { w: "homme", p: "noun", g: "masculine", s: ["man"] };
		const lines = dictionaryPromptLines("homme", [
			{ tags: "alternative", entry: homme },
			{ tags: "", entry: homme }
		]);
		expect(lines).not.toContain("alternative");
	});

	it("never splits on a two-letter prefix or outside eliding languages", () => {
		expect(stemSplit("gegangen", "gehen")).toBeNull();
		expect(stemSplit("нашёл", "найти")).toBeNull();
		expect(stemSplit("prenons", "prendre")).toEqual(["pren", "ons"]);
		const meat = { w: "м'ясо", p: "noun", s: ["meat"] };
		const card = cardFromDictionary(
			"м'яса",
			[{ tags: "genitive singular", entry: meat }],
			"uk"
		)!;
		expect(card.parts.map((p) => p.text)).not.toContain("м'");
		const today = { w: "aujourd'hui", p: "adv", s: ["today"] };
		const curly = cardFromDictionary(
			"aujourd’hui",
			[{ tags: "", entry: today }],
			"fr"
		)!;
		expect(curly.parts).toEqual([]);
		expect(curly.base).toBeUndefined();
	});

	it("splits off long elided words (lorsqu'il)", () => {
		expect(lookupForms("lorsqu'il", "fr")).toContain("il");
		const il = { w: "il", p: "pron", s: ["he"] };
		const card = cardFromDictionary(
			"lorsqu'il",
			[{ tags: "", entry: il }],
			"fr"
		)!;
		expect(card.parts[0]).toMatchObject({ text: "lorsqu'", label: "when" });
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
		expect(card.facts).toEqual([{ text: "das Krankenhaus", kind: "agree" }]);
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

	it("cuts the first sense outside its brackets", () => {
		const card = cardFromDictionary(
			"中国",
			[
				{
					tags: "",
					entry: {
						w: "中國",
						p: "name",
						s: [
							"China (a country in Asia; capital: Beijing); the Middle Kingdom"
						]
					}
				}
			],
			"zh"
		)!;
		expect(card.meaning).toBe("China (a country in Asia; capital: Beijing)");
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
		expect(card.base).toBe("読む (よむ), godan verb");
	});
});

describe("plainSpelling", () => {
	it("drops the marks ordinary text leaves out", () => {
		expect(plainSpelling("parliàmo", "it")).toBe("parliamo");
		expect(plainSpelling("parlerèbbero", "it")).toBe("parlerebbero");
		// A final accent is ordinary Italian spelling.
		expect(plainSpelling("parlò", "it")).toBeNull();
		expect(plainSpelling("perché", "it")).toBeNull();
		expect(plainSpelling("говорю́", "ru")).toBe("говорю");
		expect(plainSpelling("amō", "la")).toBe("amo");
		expect(plainSpelling("kùća", "sr")).toBe("kuća");
		expect(plainSpelling("كَتَبَ", "ar")).toBe("كتب");
		expect(plainSpelling("שָׁלוֹם", "he")).toBe("שלום");
		// Russian prints ё and writes е; Greek is typed without accents.
		expect(plainSpelling("пришёл", "ru")).toBe("пришел");
		expect(plainSpelling("είναι", "el")).toBe("ειναι");
	});

	it("keeps letters that only look marked", () => {
		expect(plainSpelling("ćao", "sr")).toBeNull();
		expect(plainSpelling("йод", "ru")).toBeNull();
		expect(plainSpelling("її", "uk")).toBeNull();
		expect(plainSpelling("été", "fr")).toBeNull();
	});
});

describe("lookups", () => {
	it("try a marked word without its marks", () => {
		expect(lookupForms("говорю́,", "ru")).toEqual(["говорю́", "говорю"]);
	});

	it("try the word, then what follows an elided article", () => {
		expect(lookupForms("« franchi, »")).toEqual(["franchi"]);
		expect(lookupForms("l'homme")).toEqual(["l'homme", "homme"]);
		expect(lookupForms("qu’il")).toEqual(["qu’il", "il"]);
		expect(lookupForms("...")).toEqual([]);
	});

	it("try the spelling dictionaries print", () => {
		expect(lookupForms("İyi", "tr")).toEqual(["İyi", "iyi"]);
		expect(lookupForms("ştiu", "ro")).toEqual(["ştiu", "știu"]);
		expect(lookupForms("خيلي", "fa")).toEqual(["خيلي", "خیلی"]);
	});

	it("try the bare word last, inside clitics, prefixes and particles", () => {
		expect(lookupForms("avez-vous", "fr")).toEqual(["avez-vous", "avez"]);
		expect(lookupForms("deixa-me", "pt")).toEqual(["deixa-me", "deixa"]);
		expect(lookupForms("nechci", "cs")).toEqual(["nechci", "chci"]);
		// Too short to be a negated word: není is not ní.
		expect(lookupForms("není", "cs")).toEqual(["není"]);
		expect(lookupForms("ואני", "he")).toEqual(["ואני", "אני"]);
		expect(lookupForms("بالطبع", "ar")).toEqual(["بالطبع", "الطبع", "طبع"]);
		expect(lookupForms("우리가", "ko")).toEqual(["우리가", "우리"]);
		expect(lookupForms("제가", "ko")).toEqual(["제가", "저"]);
		expect(lookupForms("padaku", "id")).toEqual(["padaku", "pada"]);
		expect(lookupForms("akong", "tl")).toEqual(["akong", "ako", "akon"]);
		// Other languages keep the word whole.
		expect(lookupForms("E-Mail", "de")).toEqual(["E-Mail"]);
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
		expect(
			dictionaryPromptLines("franchi", [
				{ tags: "participle past", entry: franchir, split: [0, 6, 0] }
			])
		).toMatch(/^- franchi \(franch \+ i\): past participle of franchir\./);
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
			meaning: "to clear, to cross (a line)",
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

	it("keeps the pack's split and asks the model only for notes", async () => {
		// The model splits differently; the pack's split stands.
		const chat = vi.fn(async () => ({
			content: JSON.stringify({
				meaning: "crossed",
				parts: [{ text: "franchi", label: "franchir", kind: "core" }],
				facts: [],
				base: "franchir → to cross"
			}),
			usage: null
		}));
		const provider = { id: "s", chat, stream: chat } as unknown as ChatProvider;
		const reply = await annotationAnswer(provider, q, undefined, {
			lang: "fr",
			lookup: async () => ({
				hits: [{ tags: "participle past", entry: franchir, split: [0, 6, 0] }],
				japanese: [],
				form: "franchi"
			})
		});
		expect(reply.card?.parts).toEqual([
			{ text: "franch", label: "franchir", kind: "core" },
			{ text: "i", label: "past participle", kind: "tense" }
		]);
		// The franch piece already names franchir.
		expect(reply.card?.base).toBeUndefined();
		const system = (
			chat.mock.calls[0] as unknown as [Array<{ content: string }>]
		)[0][0]!.content;
		expect(system).toContain("the dictionary already split the word");
	});

	it("never holds the model on a slow lookup, yet shows its card when it lands", async () => {
		vi.useFakeTimers();
		try {
			let land: (v: { hits: DictHit[]; japanese: [] }) => void = () =>
				undefined;
			let answer: (v: { content: string; usage: null }) => void = () =>
				undefined;
			const chat = vi.fn(
				() =>
					new Promise<{ content: string; usage: null }>((resolve) => {
						answer = resolve;
					})
			);
			const provider = {
				id: "s",
				chat,
				stream: chat
			} as unknown as ChatProvider;
			const partials: unknown[] = [];
			const replied = annotationAnswer(provider, q, undefined, {
				lang: "fr",
				lookup: () =>
					new Promise((resolve) => {
						land = resolve;
					}),
				onPartial: (r) => partials.push(r.card)
			});
			await vi.advanceTimersByTimeAsync(LOOKUP_WAIT_MS);
			expect(chat).toHaveBeenCalledOnce();
			land({
				hits: [{ tags: "participle past", entry: franchir }],
				japanese: []
			});
			await vi.advanceTimersByTimeAsync(0);
			expect(partials).toHaveLength(1);
			answer({ content: model, usage: null });
			expect((await replied).card?.meaning).toBe("crossed");
		} finally {
			vi.useRealTimers();
		}
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
