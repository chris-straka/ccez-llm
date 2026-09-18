// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	ANN_HIGHLIGHT_D1,
	ANN_HIGHLIGHT_D2,
	ANN_HIGHLIGHT_D3,
	ANN_HIGHLIGHT_NAME,
	highlightsSupported,
	liveWashRanges,
	paintAnnotationWash,
	clearAnnotationWash,
	clearAnnotationWashes,
	sameWashRanges,
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
	it("fade-in walks D3, D1, then live (fast, ~100ms)", () => {
		expect(washRampSchedule("in")).toEqual([
			ANN_HIGHLIGHT_D3,
			ANN_HIGHLIGHT_D1,
			ANN_HIGHLIGHT_NAME
		]);
	});
	it("fade-out walks D1, D2, D3, then clears (~140ms)", () => {
		expect(washRampSchedule("out")).toEqual([
			ANN_HIGHLIGHT_D1,
			ANN_HIGHLIGHT_D2,
			ANN_HIGHLIGHT_D3,
			null
		]);
	});
	it("graded names stay distinct from the live name", () => {
		expect(
			new Set([ANN_HIGHLIGHT_NAME, ANN_HIGHLIGHT_D1, ANN_HIGHLIGHT_D2, ANN_HIGHLIGHT_D3]).size
		).toBe(4);
	});
	it("paint/clear accept a graded name, clear-all never throws", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		const range = document.createRange();
		range.selectNodeContents(root);
		expect(paintAnnotationWash([range], ANN_HIGHLIGHT_D2)).toBe(false);
		expect(() => clearAnnotationWash(ANN_HIGHLIGHT_D3)).not.toThrow();
		expect(() => clearAnnotationWashes()).not.toThrow();
	});
	it("sameWashRanges matches identical endpoints only", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		document.body.appendChild(root);
		const text = root.firstChild!;
		const at = (a: number, b: number) => {
			const r = document.createRange();
			r.setStart(text, a);
			r.setEnd(text, b);
			return r;
		};
		expect(sameWashRanges([at(0, 5)], [at(0, 5)])).toBe(true);
		expect(sameWashRanges([at(0, 5)], [at(0, 6)])).toBe(false);
		expect(sameWashRanges([at(1, 5)], [at(0, 5)])).toBe(false);
		expect(sameWashRanges([], [])).toBe(true);
		expect(sameWashRanges([at(0, 5)], [])).toBe(false);
		root.remove();
	});
	it("liveWashRanges is empty where unsupported", () => {
		expect(liveWashRanges()).toEqual([]);
	});
	it("selectionRanges is empty with no live selection", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		document.body.appendChild(root);
		expect(selectionRanges(root)).toEqual([]);
		root.remove();
	});
});
