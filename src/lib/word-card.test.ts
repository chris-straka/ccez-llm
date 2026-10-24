import { describe, expect, it, vi } from "vitest";
import { LANGUAGE_MENUS } from "./languages";
import { annotationAnswer } from "./reading";
import type { ChatProvider } from "./providers/types";
import {
	buildWordCardMessages,
	isWordQuote,
	parseWordCard,
	WORD_PROFILES,
	wordCardDir,
	wordCardLang,
	wordCardText
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
		expect(system!.content).toContain(
			"the sense it takes when that differs from"
		);
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
