import { describe, expect, it } from "vitest";
import { dueItems, practiceNote } from "./weakSpots";

describe("weak spots in replies", () => {
	const statuses = {
		"de:beschließen": "learning",
		"de:verhaften": "learning",
		"de:allerdings": "learning",
		"de:trotzdem": "learning",
		"de:wasser": "known",
		"fr:lugubre": "learning"
	};
	const now = 1_000_000;
	const review = {
		"de\tverhaften": { due: now - 10, lapses: 2 },
		"de\tallerdings": { due: now + 86_400, lapses: 5 },
		"de\ttrotzdem": { due: now - 99, lapses: 0 }
	};
	it("missed most first, then overdue, then never reviewed; never one not due", () => {
		expect(dueItems("de-DE", statuses, review, now)).toEqual([
			"verhaften",
			"trotzdem",
			"beschließen"
		]);
		expect(dueItems("de", statuses, review, now, 1)).toEqual(["verhaften"]);
		expect(dueItems("fr", statuses, review, now)).toEqual(["lugubre"]);
		expect(dueItems("ja", statuses, review, now)).toEqual([]);
	});
	it("asks for them naturally, unannounced", () => {
		const note = practiceNote("de", ["verhaften", "trotzdem"]);
		expect(note).toContain("German");
		expect(note).toContain("verhaften, trotzdem");
		expect(practiceNote("de", [])).toBe("");
	});
});
