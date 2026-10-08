import { describe, expect, it } from "vitest";
import { diffGuess, diffWords, heardShare, type DiffOp } from "./listenDiff";

const kinds = (ops: DiffOp[]): string => ops.map((o) => o.kind).join(" ");

describe("diffGuess", () => {
	it("a perfect guess is all ok, whatever the case and punctuation", () => {
		const d = diffGuess("Nous couvrons ce sujet de manière approfondie.", "nous couvrons ce sujet de manière approfondie", "fr");
		expect(kinds(d.ops)).toBe("ok ok ok ok ok ok ok");
		expect(d.got).toBe(7);
		expect(d.total).toBe(7);
		expect(heardShare(d)).toBe(1);
	});

	it("accents and elisions typed loosely count as heard (near)", () => {
		const d = diffGuess("Il a été interrogé sur la possibilité d'une épidémie", "il a ete interroge sur la possibilite dune epidemie", "fr");
		expect(d.ops.filter((o) => o.kind === "near").map((o) => o.ref)).toEqual([
			"été",
			"interrogé",
			"possibilité",
			"d'une",
			"épidémie"
		]);
		expect(d.got).toBe(d.total);
	});

	it("marks missed words where they were skipped", () => {
		const d = diffGuess("Parlons de la peste. Donald Trump a été interrogé", "parlons de la peste Trump a été interrogé", "fr");
		expect(d.ops.find((o) => o.kind === "missed")?.ref).toBe("Donald");
		expect(d.got).toBe(8);
		expect(d.total).toBe(9);
	});

	it("pairs a mishearing with the word it replaced", () => {
		const d = diffGuess("Ce qui est incroyable, c'est que Trump", "ce qui est incroyable c'est quand Trump", "fr");
		const wrong = d.ops.filter((o) => o.kind === "wrong");
		expect(wrong).toEqual([{ kind: "wrong", ref: "que", guess: "quand" }]);
	});

	it("keeps unrelated words as a miss plus an extra rather than a pairing", () => {
		const d = diffGuess("la peste mortelle", "la chat peste", "fr");
		expect(kinds(d.ops)).toBe("ok extra ok missed");
	});

	it("an empty guess misses everything; a skip scores zero", () => {
		const d = diffGuess("On partira pas.", "", "fr");
		expect(kinds(d.ops)).toBe("missed missed missed");
		expect(heardShare(d)).toBe(0);
	});

	it("German umlauts and ß fold for near matches", () => {
		const d = diffGuess("Die Straße ist schön", "die strasse ist schon", "de");
		expect(kinds(d.ops)).toBe("ok near ok near");
	});

	it("Japanese and Chinese diff per character", () => {
		expect(diffWords("今日は雨です。", "ja")).toEqual(["今", "日", "は", "雨", "で", "す"]);
		const d = diffGuess("今日は雨です。", "今日は飴です", "ja");
		expect(kinds(d.ops)).toBe("ok ok ok wrong ok ok");
		expect(diffGuess("我们走吧", "我们走", "zh").got).toBe(3);
	});

	it("Russian and other spaced scripts split on spaces", () => {
		const d = diffGuess("Мы говорим о чуме.", "мы говорим о чуме", "ru");
		expect(d.got).toBe(4);
	});

	it("an empty transcript is fully heard", () => {
		expect(heardShare(diffGuess("", "anything", "fr"))).toBe(1);
	});
});
