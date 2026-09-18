// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	ANN_HIGHLIGHT_NAME,
	highlightsSupported,
	paintAnnotationWash,
	clearAnnotationWash,
	selectionRanges
} from "./annHighlights";

describe("CSS.highlights annotation wash", () => {
	it("exposes a stable highlight name", () => {
		expect(ANN_HIGHLIGHT_NAME).toBe("ccez-ann");
	});
	it("reports unsupported in jsdom (no Highlights API)", () => {
		expect(highlightsSupported()).toBe(false);
	});
	it("paint falls back to false where unsupported, never throws", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		const range = document.createRange();
		range.selectNodeContents(root);
		expect(paintAnnotationWash([range])).toBe(false);
		expect(paintAnnotationWash([])).toBe(false);
	});
	it("clear is a safe no-op where unsupported", () => {
		expect(() => clearAnnotationWash()).not.toThrow();
	});
	it("selectionRanges is empty with no live selection", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		document.body.appendChild(root);
		expect(selectionRanges(root)).toEqual([]);
		root.remove();
	});
});
