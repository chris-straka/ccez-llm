import { describe, it, expect } from "vitest";
import { emptyPalette } from "./palette";

describe("emptyPalette", () => {
	it("starts closed, cleared, idle, and topped", () => {
		expect(emptyPalette()).toEqual({ open: false, query: "", hits: [], busy: false, cursor: 0 });
	});
});
