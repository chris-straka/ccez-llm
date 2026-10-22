// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { wordAt, wordRanges } from "./listenHighlight";

describe("wordRanges", () => {
	it("finds each word in order across element boundaries", () => {
		const root = document.createElement("div");
		root.innerHTML =
			"<p>C'est ce qu'il <mark>est</mark> en train. C'est ce qu'il dit.</p>";
		const words = [
			"C'est",
			"ce",
			"qu'il",
			"est",
			"en",
			"train.",
			"C'est",
			"ce"
		];
		const ranges = wordRanges(root, words);
		expect(ranges.map((r) => r?.toString())).toEqual(words);
		// The second "C'est" is the second one, not the first again.
		const second = ranges[6];
		expect(second?.startOffset).toBe(" en train. ".length);
	});

	it("skips a word the text doesn't have and keeps going", () => {
		const root = document.createElement("div");
		root.textContent = "Parlons de la peste.";
		const ranges = wordRanges(root, ["Parlons", "du", "la", "peste."]);
		expect(ranges.map((r) => r?.toString() ?? null)).toEqual([
			"Parlons",
			null,
			"la",
			"peste."
		]);
	});
});

describe("wordAt", () => {
	it("is the last word started", () => {
		expect(wordAt([1, 1.5, 2], 0.5)).toBe(-1);
		expect(wordAt([1, 1.5, 2], 1.7)).toBe(1);
		expect(wordAt([1, 1.5, 2], 9)).toBe(2);
	});
});
