// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { learningForms, replyWords, stampLearning } from "./learningMarks";

describe("Learning words in replies", () => {
	it("finds them by headword or as written", () => {
		const statuses = {
			"de:beschließen": "learning",
			"de:trotzdem": "learning",
			"de:wasser": "known"
		};
		const heads: Record<string, string> = { beschlossen: "beschließen" };
		const words = replyWords(
			"Sie haben es beschlossen, trotzdem kein Wasser.",
			"de"
		);
		expect(words).toContain("beschlossen");
		const got = learningForms(words, "de", statuses, (w) => heads[w]);
		expect([...got]).toEqual([
			["beschlossen", "beschließen"],
			["trotzdem", "trotzdem"]
		]);
	});
	it("underlines them in the text, not in code or readings, and only whole words", () => {
		const root = document.createElement("div");
		root.innerHTML =
			"<p>Trotzdem ging er. <code>trotzdem</code> trotzdemer</p>";
		stampLearning(root, new Map([["trotzdem", "trotzdem"]]), "de");
		const marks = root.querySelectorAll(".ccez-learning");
		expect(marks.length).toBe(1);
		expect(marks[0]?.textContent).toBe("Trotzdem");
		// Stamping again changes nothing.
		stampLearning(root, new Map([["trotzdem", "trotzdem"]]), "de");
		expect(root.querySelectorAll(".ccez-learning").length).toBe(1);
	});
});
