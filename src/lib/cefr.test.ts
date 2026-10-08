import { describe, it, expect } from "vitest";
import { isCefrLevel, stepLevel } from "./cefr";

describe("cefr", () => {
	it("steps one level and holds at the ends", () => {
		expect(stepLevel("B2", -1)).toBe("B1");
		expect(stepLevel("B2", 1)).toBe("C1");
		expect(stepLevel("A1", -1)).toBe("A1");
		expect(stepLevel("C2", 1)).toBe("C2");
	});
	it("recognises levels", () => {
		expect(isCefrLevel("B1")).toBe(true);
		expect(isCefrLevel("B3")).toBe(false);
	});
});
