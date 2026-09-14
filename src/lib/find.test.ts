import { describe, it, expect } from "vitest";
import { emptyFind, stepFindCursor } from "./find";

describe("emptyFind", () => {
	it("closes the bar with a cleared query and cursor", () => {
		expect(emptyFind()).toEqual({ open: false, query: "", cursor: 0 });
	});
});

describe("stepFindCursor", () => {
	it("steps and wraps past either end", () => {
		expect(stepFindCursor(3, 0, 1)).toBe(1);
		expect(stepFindCursor(3, 2, 1)).toBe(0);
		expect(stepFindCursor(3, 0, -1)).toBe(2);
		expect(stepFindCursor(3, 1, -1)).toBe(0);
		expect(stepFindCursor(1, 0, 1)).toBe(0);
		expect(stepFindCursor(1, 0, -1)).toBe(0);
	});
});
