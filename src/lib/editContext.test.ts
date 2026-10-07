// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	editContextSupported,
	isImeKey,
	shouldDeferForComposition,
	attachEditContext
} from "./editContext";

describe("shouldDeferForComposition", () => {
	it("defers on textarea isComposing", () => {
		expect(shouldDeferForComposition({ isComposing: true })).toBe(true);
	});
	it("defers on the view-composing signal", () => {
		expect(shouldDeferForComposition({ viewComposing: true })).toBe(true);
	});
	it("submits when neither signal is set", () => {
		expect(shouldDeferForComposition({})).toBe(false);
		expect(
			shouldDeferForComposition({ isComposing: false, viewComposing: false })
		).toBe(false);
	});
});

describe("editContextSupported / attachEditContext", () => {
	it("reports unsupported where the constructor is absent (node/jsdom)", () => {
		expect(editContextSupported()).toBe(false);
	});
	it("falls back to null where unsupported, never throws", () => {
		const ta = document.createElement("textarea");
		expect(attachEditContext(ta)).toBeNull();
	});
});

describe("isImeKey", () => {
	it("flags composing keys, including WebKit's keyCode 229 confirm", () => {
		expect(isImeKey({ isComposing: true, keyCode: 13 })).toBe(true);
		expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
		expect(isImeKey({ isComposing: false, keyCode: 13 })).toBe(false);
		expect(isImeKey({})).toBe(false);
	});
});
