import { describe, expect, it } from "vitest";
import { partialReading, splitCompoundReading } from "./kanjiSplit";

describe("splitCompoundReading", () => {
	it("splits a compound along each kanji's reading", () => {
		expect(splitCompoundReading("露軍", "ろぐん")).toEqual(["ろ", "ぐん"]);
		expect(splitCompoundReading("攻撃", "こうげき")).toEqual(["こう", "げき"]);
		expect(splitCompoundReading("接尾辞", "せつびじ")).toEqual([
			"せつ",
			"び",
			"じ"
		]);
	});

	it("follows the sound changes compounds make", () => {
		// Small っ on a non-final kanji, rendaku and half-voicing.
		expect(splitCompoundReading("一歩", "いっぽ")).toEqual(["いっ", "ぽ"]);
		expect(splitCompoundReading("学校", "がっこう")).toEqual(["がっ", "こう"]);
		expect(splitCompoundReading("手紙", "てがみ")).toEqual(["て", "がみ"]);
		expect(splitCompoundReading("鼻血", "はなぢ")).toEqual(["はな", "ぢ"]);
	});

	it("lets one kanji take an unlisted share beside exact readings", () => {
		expect(splitCompoundReading("日本", "にほん")).toEqual(["に", "ほん"]);
	});

	it("keeps jukujikun whole", () => {
		expect(splitCompoundReading("今日", "きょう")).toBeNull();
		expect(splitCompoundReading("大人", "おとな")).toBeNull();
		expect(splitCompoundReading("一人", "ひとり")).toBeNull();
	});

	it("gives a lone kanji its whole reading", () => {
		expect(splitCompoundReading("露", "つゆ")).toEqual(["つゆ"]);
		expect(splitCompoundReading("", "つゆ")).toBeNull();
	});
});

describe("partialReading", () => {
	it("reads a kanji picked out of a compound by its share", () => {
		expect(partialReading("露軍", "ろぐん", 0, 1)).toBe("ろ");
		expect(partialReading("露軍", "ろぐん", 1, 2)).toBe("ぐん");
		expect(partialReading("接尾辞", "せつびじ", 1, 3)).toBe("びじ");
	});

	it("keeps the whole reading when covered, unsplittable, or kana-bearing", () => {
		expect(partialReading("露軍", "ろぐん", 0, 2)).toBe("ろぐん");
		expect(partialReading("今日", "きょう", 0, 1)).toBe("きょう");
		expect(partialReading("お茶", "おちゃ", 1, 2)).toBe("おちゃ");
	});
});
