import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The answer card: model output renders as text (never {@html}), the
 * reply takes the whole card (no tools, no close button: click-off or
 * Esc closes, E rewords), and its sizing rides the popup setting.
 * Asserted on source: jsdom sees neither CSS nor the template's
 * {@html} choice.
 */
function answerSource(): string {
	return readFileSync(new URL("./AnnAnswer.svelte", import.meta.url), "utf8");
}

describe("annotation answer card", () => {
	it("renders answer text as text, never HTML", () => {
		// Each answer line renders through a text binding.
		expect(answerSource()).toContain("{line}");
		expect(answerSource()).not.toContain("{@html");
	});

	it("carries no buttons: the reply takes the whole card", () => {
		expect(answerSource()).not.toContain("<button");
	});

	it("reads at message size with the popup-size setting on top", () => {
		expect(answerSource()).toMatch(
			/\.ann-answer\s*\{[^}]*font-size:\s*calc\(0\.92rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
	});

	it("sizes border-box so padding never spills past the viewport", () => {
		// The page sizes the card to the clear width: content-box
		// padding pushed the card past the edge on narrow phones.
		expect(answerSource()).toMatch(/\.ann-answer\s*\{[^}]*box-sizing:\s*border-box/);
	});

	it("rings the card so it never dissolves into the thread", () => {
		// The card sat edgeless on the thread (the shadow alone didn't
		// seat it on phones); the hairline is the overlay edge shared
		// with the selection menu, stark-contrast keeps its stronger one.
		expect(answerSource()).toMatch(
			/\.ann-answer\s*\{[^}]*border-color:\s*var\(--line-overlay\)/
		);
	});
});
