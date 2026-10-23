import { describe, expect, it } from "vitest";
import { heardTimes, type HeardWord } from "./listenHeard";
import type { Token } from "./listenClips";

/** Caption tokens from words, `gap` seconds apart from `at`. */
function caption(words: string[], at = 0, gap = 0.5): Token[] {
	return words.map((text, k) => ({
		text,
		start: at + k * gap,
		end: at + k * gap + gap * 0.8,
		space: k > 0
	}));
}

/** Heard words from words, each with its own [start, end]. */
function heard(words: [string, number, number][]): HeardWord[] {
	return words.map(([text, start, end]) => ({ text, start, end }));
}

describe("heardTimes", () => {
	it("gives each caption word the time it was heard", () => {
		const tokens = caption(["Parlons", "de", "la", "peste."]);
		const times = heardTimes(
			tokens,
			heard([
				["parlons", 1.2, 1.6],
				["de", 1.7, 1.8],
				["la", 1.9, 2.0],
				["peste", 2.3, 2.9]
			])
		);
		expect(times?.tokens.map((t) => [t.text, t.start, t.end])).toEqual([
			["Parlons", 1.2, 1.6],
			["de", 1.7, 1.8],
			["la", 1.9, 2.0],
			["peste.", 2.3, 2.9]
		]);
		expect(times?.upTo).toBe(3);
	});

	it("spreads words it didn't hear between the ones it did", () => {
		const tokens = caption(["un", "deux", "trois", "quatre", "cinq"]);
		const times = heardTimes(
			tokens,
			heard([
				["un", 10, 10.3],
				["deux", 10.5, 10.8],
				["drois", 11, 11.3],
				["quatre", 11.5, 11.8],
				["cinq", 12, 12.3]
			])
		);
		const third = times?.tokens[2];
		expect(third?.text).toBe("trois");
		expect(third?.start).toBeGreaterThan(10.5);
		expect(third?.start).toBeLessThan(11.5);
	});

	it("pairs the recognizer's grouped and split words", () => {
		// Apple groups "il y a" into one word and splits "70%".
		const tokens = caption(["Il", "y", "a", "70%", "de", "gens."]);
		const times = heardTimes(
			tokens,
			heard([
				["il y a", 3, 3.4],
				["70", 3.5, 4],
				["%", 4, 4.2],
				["de", 4.3, 4.4],
				["gens", 4.5, 4.9]
			])
		);
		expect(times?.tokens[0]?.start).toBe(3);
		expect(times?.tokens[3]?.start).toBe(3.5);
		expect(times?.tokens[5]?.end).toBe(4.9);
	});

	it("leaves words past what was heard on their own times", () => {
		const words = Array.from({ length: 40 }, (_, k) => `mot${k}`);
		const tokens = caption(words);
		const half = heard(
			words.slice(0, 20).map((w, k) => [w, 1 + k * 0.5, 1.3 + k * 0.5])
		);
		const times = heardTimes(tokens, half);
		expect(times?.upTo).toBe(19);
		expect(times?.tokens[30]).toEqual(tokens[30]);
		expect(times?.tokens[10]?.start).toBe(6);
	});

	it("ignores a common word heard far from its neighbors' offset", () => {
		// "de" pairs with a heard "de" 3 s off the rest: a chance match.
		const tokens = caption(
			["alpha", "bravo", "charlie", "de", "delta", "echo", "foxtrot"],
			0,
			1
		);
		const times = heardTimes(
			tokens,
			heard([
				["alpha", 0.5, 0.9],
				["bravo", 1.5, 1.9],
				["charlie", 2.5, 2.9],
				["delta", 4.5, 4.9],
				["echo", 5.5, 5.9],
				["de", 6.2, 6.3],
				["foxtrot", 6.5, 6.9]
			])
		);
		const de = times?.tokens[3];
		expect(de?.start).toBeGreaterThan(2.9);
		expect(de?.start).toBeLessThan(4.5);
	});

	it("is null when the recognizer heard something else", () => {
		const tokens = caption(["Parlons", "de", "la", "peste."]);
		expect(
			heardTimes(
				tokens,
				heard([
					["music", 0, 1],
					["playing", 1, 2]
				])
			)
		).toBeNull();
		expect(heardTimes(tokens, [])).toBeNull();
	});

	it("pairs unspaced scripts character by character", () => {
		const tokens: Token[] = [
			{ text: "今日は", start: 0, end: 0.6, space: false },
			{ text: "いい", start: 0.6, end: 1, space: false },
			{ text: "天気。", start: 1, end: 1.6, space: false }
		];
		const times = heardTimes(
			tokens,
			heard([
				["今日", 2, 2.4],
				["は", 2.4, 2.6],
				["いい", 2.6, 3],
				["天気", 3, 3.6]
			])
		);
		expect(times?.tokens.map((t) => t.start)).toEqual([2, 2.6, 3]);
		expect(times?.tokens[2]?.end).toBe(3.6);
	});
});
