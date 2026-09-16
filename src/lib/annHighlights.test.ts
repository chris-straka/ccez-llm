// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	ANN_HIGHLIGHT_NAME,
	JUMP_HIGHLIGHT_NAME,
	highlightsSupported,
	paintAnnotationWash,
	clearAnnotationWash,
	paintJumpWash,
	clearJumpWash,
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
	it("jump flash has its own name, never the badge wash's", () => {
		expect(JUMP_HIGHLIGHT_NAME).toBe("ccez-ann-jump");
		expect(JUMP_HIGHLIGHT_NAME).not.toBe(ANN_HIGHLIGHT_NAME);
	});
	it("jump paint falls back to false where unsupported, never throws", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		const range = document.createRange();
		range.selectNodeContents(root);
		expect(paintJumpWash(range)).toBe(false);
		expect(() => clearJumpWash()).not.toThrow();
	});
	it("selectionRanges is empty with no live selection", () => {
		const root = document.createElement("div");
		root.textContent = "hello world";
		document.body.appendChild(root);
		expect(selectionRanges(root)).toEqual([]);
		root.remove();
	});
});
