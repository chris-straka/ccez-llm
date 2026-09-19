import { describe, expect, it } from "vitest";
import {
	buildSearchDocs,
	chatMatchesQuery,
	findMessageIndices,
	querySearch,
	snippetFor,
	tokenizeText,
	type SearchDoc
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

describe("snippetFor", () => {
	it("centers on the match with ellipses", () => {
		const text = `start ${"x ".repeat(50)}needle${" y".repeat(50)} end`;
		const snippet = snippetFor(text, ["needle"]);
		expect(snippet).toContain("needle");
		expect(snippet.startsWith("…")).toBe(true);
		expect(snippet.endsWith("…")).toBe(true);
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
	});
});
