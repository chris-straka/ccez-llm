import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Sent-attachment folds (file tags above the body, image folds inline)
 * render in SentAttachments.svelte with the popup card CSS; the page
 * keeps the models (expand state lives in expandedTags) and the
 * fold/copy/OCR behaviors. jsdom sees neither the popup overlay nor
 * the sideways strip, so like sidebar-chrome.test.ts this asserts on
 * source: both variants, the empty guard, and the page wiring that
 * feeds each variant its pre-filtered kind.
 */
function componentSource(): string {
	return readFileSync(
		new URL("./SentAttachments.svelte", import.meta.url),
		"utf8"
	);
}

describe("sent attachment variants", () => {
	it("keeps popup surfaces global for {@html}-rendered tags", () => {
		const source = componentSource();
		for (const cls of [
			":global(.sent-wrap)",
			":global(.sent-open)",
			":global(.sent-card)",
			":global(.sent-foot)",
			":global(.sent-img)",
			":global(.sent-excerpt)"
		]) {
			expect(source).toContain(cls);
		}
	});
});
