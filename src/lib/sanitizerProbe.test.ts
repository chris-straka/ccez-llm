import { describe, it, expect } from "vitest";
import {
	judgeSanitizerShape,
	nativeSanitizerStatus,
	shouldUseNativeSanitizer
} from "./sanitizerProbe";

describe("native Sanitizer investigation", () => {
	it("keeps DOMPurify where no constructor exists", () => {
		const status = judgeSanitizerShape({
			hasConstructor: false,
			supportsBaselineConfig: false,
			supportsCustomElementsAndDataAttrs: false
		});
		expect(status.available).toBe(false);
		expect(status.equivalent).toBe(false);
	});
	it("keeps DOMPurify where present but not equivalent (current Chromium)", () => {
		const status = judgeSanitizerShape({
			hasConstructor: true,
			supportsBaselineConfig: true,
			supportsCustomElementsAndDataAttrs: false
		});
		expect(status.available).toBe(true);
		expect(status.equivalent).toBe(false);
	});
	it("would adopt only when present and equivalent", () => {
		const status = judgeSanitizerShape({
			hasConstructor: true,
			supportsBaselineConfig: true,
			supportsCustomElementsAndDataAttrs: true
		});
		expect(status.equivalent).toBe(true);
	});
	it("live runtime verdict keeps DOMPurify", () => {
		expect(nativeSanitizerStatus().equivalent).toBe(false);
		expect(shouldUseNativeSanitizer()).toBe(false);
	});
});
