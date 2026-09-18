// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	ANN_HIGHLIGHT_DIM,
	ANN_HIGHLIGHT_FAINT,
	ANN_HIGHLIGHT_NAME,
	highlightsSupported,
	paintAnnotationWash,
	clearAnnotationWash,
	clearAnnotationWashes,
	selectionRanges,
	washRampSchedule
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
	it("fade-in lands faint then live (fast, ~100ms)", () => {
		expect(washRampSchedule("in")).toEqual([ANN_HIGHLIGHT_FAINT, ANN_HIGHLIGHT_NAME]);
	});
	it("fade-out steps dim, faint, then clears (~150ms)", () => {
		expect(washRampSchedule("out")).toEqual([ANN_HIGHLIGHT_DIM, ANN_HIGHLIGHT_FAINT, null]);
	});
	it("graded names stay distinct from the live name", () => {
		expect(new Set([ANN_HIGHLIGHT_NAME, ANN_HIGHLIGHT_DIM, ANN_HIGHLIGHT_FAINT]).size).toBe(3);
	});
	it("paint/clear accept a graded name, clear-all never throws", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		const range = document.createRange();
		range.selectNodeContents(root);
		expect(paintAnnotationWash([range], ANN_HIGHLIGHT_DIM)).toBe(false);
		expect(() => clearAnnotationWash(ANN_HIGHLIGHT_FAINT)).not.toThrow();
		expect(() => clearAnnotationWashes()).not.toThrow();
	});
	it("selectionRanges is empty with no live selection", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		document.body.appendChild(root);
		expect(selectionRanges(root)).toEqual([]);
		root.remove();
	});
});
