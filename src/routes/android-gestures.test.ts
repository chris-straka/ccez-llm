import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Android gesture wiring guards (source-pinned, like
 * actions-reveal): filing and double-tap must never move the
 * thread, and answer-card selections must reach the native OS
 * menu bridge.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("android gesture wiring", () => {
	it("never scrolls to the action row on double-tap", () => {
		// The menu owns the whole gesture; dragging the view down
		// to the buttons disoriented phone readers.
		expect(pageSource()).not.toContain("scrollActionsIntoView");
	});

	it("never scrolls when filing an annotation", () => {
		// The view stays where the reader put it; hoisting the
		// quote above the keyboard yanked long threads.
		expect(pageSource()).not.toContain("scrollQuoteIntoEditView");
	});

	it("reports answer-card selections to the native OS menu", () => {
		// Without the card root, the Activity shows its empty dummy
		// menu instead of Copy / Cut / Paste on card text.
		expect(pageSource()).toMatch(
			/reportOsMenu\(\s*\[promptEl,\s*settingsEl,\s*document\.querySelector\("\.ann-answer"\)\]/
		);
	});
});
