import { describe, expect, it } from "vitest";
import {
	buildSearchDocs,
	chatMatchesQuery,
	collectSearchAnnotations,
	findMessageIndices,
	foldText,
	groupHitsByChat,
	hitTag,
	markSegments,
	parseQuery,
	querySearch,
	tokenizeText,
	type IndexableAnnotation,
	type SearchDoc,
	type SearchHit
} from "./chatSearch";

describe("tokenizeText", () => {
	it("splits latin words and lowercases", () => {
		expect(tokenizeText("Hello World")).toContain("hello");
		expect(tokenizeText("Hello World")).toContain("world");
	});

	it("segments CJK without whitespace", () => {
		const tokens = tokenizeText("中文搜索测试");
		expect(tokens.length).toBeGreaterThan(1);
		expect(tokens.join("")).toBe("中文搜索测试");
	});

	it("segments mixed CJK and latin", () => {
		const tokens = tokenizeText("你好world");
		expect(tokens).toContain("world");
		expect(tokens.join("")).toBe("你好world");
	});

	it("returns no tokens for blank input", () => {
		expect(tokenizeText("   ")).toEqual([]);
	});
});

describe("querySearch", () => {
	const docs: SearchDoc[] = [
		{ chatId: "a", msgId: "m1", kind: "message", text: "The quick brown fox" },
		{ chatId: "a", msgId: "m2", kind: "message", text: "Slow green turtle" },
		{ chatId: "b", msgId: null, kind: "annotation", text: "fox den notes" }
	];

	it("ranks exact matches and uses AND semantics", () => {
		const hits = querySearch(docs, "fox");
		expect(hits.map((h) => h.doc.msgId ?? h.doc.kind)).toContain("m1");
		expect(querySearch(docs, "fox turtle")).toEqual([]);
	});

	it("matches CJK queries", () => {
		const cjk: SearchDoc[] = [
			{ chatId: "a", msgId: "m1", kind: "message", text: "今天的中文菜单" }
		];
		expect(querySearch(cjk, "中文")).toHaveLength(1);
		expect(querySearch(cjk, "菜单")).toHaveLength(1);
	});

	it("returns nothing for blank queries", () => {
		expect(querySearch(docs, "  ")).toEqual([]);
	});

	it("respects the limit", () => {
		const many: SearchDoc[] = Array.from({ length: 10 }, (_, i) => ({
			chatId: "a",
			msgId: `m${i}`,
			kind: "message" as const,
			text: "shared token here"
		}));
		expect(querySearch(many, "shared", 3)).toHaveLength(3);
	});
});

describe("foldText", () => {
	it("drops case, accents, and umlauts", () => {
		expect(foldText("Über Café Straße")).toBe("uber cafe strasse");
		expect(foldText("ÆØŒ Łódź")).toBe("aeooe lodz");
	});

	it("maps fullwidth to ASCII but keeps kana voicing", () => {
		expect(foldText("ＡＢＣ")).toBe("abc");
		expect(foldText("が")).toBe("が");
		expect(foldText("が")).not.toBe(foldText("か"));
	});
});

describe("parseQuery", () => {
	it("splits phrases and filters from words", () => {
		expect(parseQuery('from:me "Guten Morgen" Tschüss in:notes')).toEqual({
			terms: ["tschuss"],
			phrases: ["guten morgen"],
			from: "user",
			notesOnly: true
		});
		expect(parseQuery("from:ai hi").from).toBe("assistant");
	});

	it("leaves filter-looking words inside text alone", () => {
		const q = parseQuery("platform:me");
		expect(q.from).toBeNull();
		expect(q.terms.join(" ")).toContain("platform");
	});
});

describe("querySearch (folding, phrases, filters, pinyin)", () => {
	const docs: SearchDoc[] = [
		{ chatId: "de", msgId: "m1", kind: "message", role: "user", text: "Was heißt über auf Englisch?", at: 1 },
		{ chatId: "de", msgId: "m2", kind: "message", role: "assistant", text: "Über means over or about.", at: 1 },
		{ chatId: "fr", msgId: "m3", kind: "message", role: "assistant", text: "Un café, s'il vous plaît.", at: 2 },
		{ chatId: "zh", msgId: "m4", kind: "message", role: "assistant", text: "我们一起学习中文吧", at: 3 },
		{ chatId: "fr", msgId: "m5", kind: "annotation", text: "café\nask for coffee", at: 2 }
	];
	const ids = (q: string) => querySearch(docs, q).map((h) => h.doc.msgId);

	it("matches without accents either way", () => {
		expect(ids("uber")).toEqual(expect.arrayContaining(["m1", "m2"]));
		expect(ids("cafe")).toEqual(expect.arrayContaining(["m3", "m5"]));
		expect(ids("heisst")).toEqual(["m1"]);
		expect(ids("CAFÉ")).toEqual(expect.arrayContaining(["m3", "m5"]));
	});

	it("filters by author and by notes", () => {
		expect(ids("uber from:me")).toEqual(["m1"]);
		expect(ids("uber from:ai")).toEqual(["m2"]);
		expect(ids("cafe in:notes")).toEqual(["m5"]);
		expect(ids("from:me")).toEqual([]);
	});

	it("matches quoted phrases whole", () => {
		expect(ids('"means over"')).toEqual(["m2"]);
		expect(ids('"over means"')).toEqual([]);
	});

	it("finds Han text by toneless pinyin, partial last syllable included", () => {
		expect(ids("xuexi")).toEqual(["m4"]);
		expect(ids("xuex")).toEqual(["m4"]);
		expect(ids("zhongwen")).toEqual(["m4"]);
		expect(ids("xuewen")).toEqual([]);
	});

	it("marks the matched text in the snippet", () => {
		const [hit] = querySearch(docs, "xuexi");
		const [a, b] = hit?.marks[0] ?? [0, 0];
		expect(hit?.snippet.slice(a, b)).toBe("学习");
		const [cafe] = querySearch(docs, "cafe from:ai");
		const [c, d] = cafe?.marks[0] ?? [0, 0];
		expect(cafe?.snippet.slice(c, d)).toBe("café");
	});

	it("marks words from their start only", () => {
		const hits = querySearch(
			[{ chatId: "a", msgId: "x", kind: "message", text: "find it in here" }],
			"in"
		);
		const marked = (hits[0]?.marks ?? []).map(([a, b]) => hits[0]?.snippet.slice(a, b));
		expect(marked).toEqual(["in"]);
	});

	it("centers long text on the match with ellipses", () => {
		const text = `${"lorem ".repeat(30)}needle ${"ipsum ".repeat(30)}`;
		const [hit] = querySearch([{ chatId: "a", msgId: "x", kind: "message", text }], "needle");
		expect(hit?.snippet.startsWith("…")).toBe(true);
		expect(hit?.snippet.endsWith("…")).toBe(true);
		expect(hit?.snippet).toContain("needle");
	});

	it("breaks score ties toward newer chats", () => {
		expect(ids("cafe")[0]).toBe("m3");
		const tie: SearchDoc[] = [
			{ chatId: "old", msgId: "o", kind: "message", text: "hallo", at: 1 },
			{ chatId: "new", msgId: "n", kind: "message", text: "hallo", at: 9 }
		];
		expect(querySearch(tie, "hallo").map((h) => h.doc.msgId)).toEqual(["n", "o"]);
	});
});

describe("buildSearchDocs", () => {
	it("flattens messages and annotations, skipping blanks", () => {
		const docs = buildSearchDocs(
			[
				{
					id: "a",
					createdAt: 1,
					messages: [
						{ id: "m1", content: "hi" },
						{ id: "m2", content: "  " }
					]
				}
			],
			[{ chatId: "a", messageId: "m1", quote: "hi", comment: "" }]
		);
		expect(docs).toHaveLength(2);
		expect(docs[1]?.kind).toBe("annotation");
		expect(docs[1]?.at).toBe(1);
	});
});

describe("collectSearchAnnotations", () => {
	const live: IndexableAnnotation[] = [
		{ id: "a1", messageId: "m1", quote: "q", comment: "c" }
	];
	const stored: IndexableAnnotation[] = [
		{ id: "b1", messageId: "m2", quote: "qq", comment: "cc" }
	];
	const chats = [{ id: "open" }, { id: "other" }];

	it("takes live drafts for the open chat, stored for the rest", () => {
		const anns = collectSearchAnnotations(chats, "open", live, (id) =>
			id === "other" ? stored : []
		);
		expect(anns).toEqual([
			{ chatId: "open", messageId: "m1", quote: "q", comment: "c" },
			{ chatId: "other", messageId: "m2", quote: "qq", comment: "cc" }
		]);
	});

	it("scopes dedup keys by chat, collapses repeat chats", () => {
		// Same annotation id in two chats: both kept (keys differ).
		const sameId: IndexableAnnotation[] = [
			{ id: "a1", messageId: "m9", quote: "q", comment: "c" }
		];
		const anns = collectSearchAnnotations(chats, "open", live, () => sameId);
		expect(anns).toHaveLength(2);
		// Same chat twice: second pass collapses.
		const repeat = collectSearchAnnotations(
			[{ id: "open" }, { id: "open" }],
			"open",
			live,
			() => live
		);
		expect(repeat).toHaveLength(1);
	});

	it("a throwing loader yields nothing for that chat", () => {
		const anns = collectSearchAnnotations(chats, "open", live, () => {
			throw new Error("locked");
		});
		expect(anns).toHaveLength(1);
		expect(anns[0]?.chatId).toBe("open");
	});
});

describe("findMessageIndices", () => {
	it("lists message indices containing the query, case-insensitive", () => {
		expect(
			findMessageIndices(["miso ramen", "sushi rice", "MISO soup"], "miso")
		).toEqual([0, 2]);
		expect(findMessageIndices(["aaa", "bbb"], "z")).toEqual([]);
		expect(findMessageIndices(["aaa"], "  ")).toEqual([]);
	});

	it("ignores accents", () => {
		expect(findMessageIndices(["Das ist schön", "nope"], "schon")).toEqual([0]);
	});
});

describe("chatMatchesQuery", () => {
	it("matches labels and message bodies, blank query matches all", () => {
		expect(chatMatchesQuery("label", ["body"], "")).toBe(true);
		expect(chatMatchesQuery("Morning notes", [], "morning")).toBe(true);
		expect(chatMatchesQuery("label", ["sushi recipe"], "sushi")).toBe(true);
		expect(chatMatchesQuery("label", ["sushi recipe"], "ramen")).toBe(false);
		expect(chatMatchesQuery("label", ["sushi recipe"], "sushi ramen")).toBe(
			false
		);
		expect(chatMatchesQuery("label", ["Grüße aus Köln"], "grusse koln")).toBe(true);
	});
});

describe("result shaping", () => {
	const hit = (chatId: string, msgId: string): SearchHit => ({
		doc: { chatId, msgId, kind: "message", text: "" },
		score: 1,
		snippet: "",
		marks: []
	});

	it("groups hits by chat in best-hit order", () => {
		const ids = groupHitsByChat([
			hit("a", "1"),
			hit("b", "2"),
			hit("a", "3"),
			hit("c", "4"),
			hit("b", "5")
		]).map((h) => h.doc.msgId);
		expect(ids).toEqual(["1", "3", "2", "5", "4"]);
	});

	it("splits a snippet into marked runs", () => {
		expect(markSegments("say über it", [[4, 8]])).toEqual([
			{ text: "say ", hit: false },
			{ text: "über", hit: true },
			{ text: " it", hit: false }
		]);
		expect(markSegments("plain", [])).toEqual([{ text: "plain", hit: false }]);
	});

	it("tags who said it", () => {
		expect(hitTag({ chatId: "a", msgId: null, kind: "annotation", text: "" })).toBe("note");
		expect(hitTag({ chatId: "a", msgId: "m", kind: "message", role: "user", text: "" })).toBe("you");
		expect(hitTag({ chatId: "a", msgId: "m", kind: "message", role: "assistant", text: "" })).toBe("AI");
	});
});
