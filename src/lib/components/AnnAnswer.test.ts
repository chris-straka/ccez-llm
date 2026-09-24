import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The annotation answer popup renders from `AnnAnswer.svelte`, not
 * the page. The page owns open state, below-quote placement, and
 * fade-out; the component owns the card markup and its surface.
 * The quote itself never renders here (the highlighted word
 * upstream is the title, with Han readings in the panels above
 * it). Answer text renders as text (never {@html}). No close
 * button: clicking off the card (or Esc) closes it. The card
 * carries no tools at all: the reply takes the whole card
 * (rewording is the E key, a second Enter on the badge pins).
 */
function answerSource(): string {
	return readFileSync(new URL("./AnnAnswer.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

describe("annotation answer extraction", () => {
	it("renders the answer card from the component, not the page", () => {
		expect(answerSource()).toContain('class="ann-answer"');
		expect(pageSource()).not.toContain('class="ann-answer"');
	});

	it("carries no tools: the reply takes the whole card", () => {
		expect(answerSource()).not.toContain("<button");
		expect(answerSource()).not.toContain("ann-answer-pin");
		expect(answerSource()).not.toContain("ontogglepin");
	});

	it("carries no quote title and no close button", () => {
		expect(answerSource()).not.toContain("ann-answer-quote");
		expect(answerSource()).not.toContain("Close answer");
		expect(answerSource()).not.toContain("{quote}");
	});

	it("carries no pencil either: rewording is the E key", () => {
		expect(answerSource()).not.toContain("ann-answer-edit");
		expect(answerSource()).not.toContain("onedit");
	});

	it("renders answer text as text, never HTML", () => {
		expect(answerSource()).toContain("{answer}");
		expect(answerSource()).not.toContain("{@html answer}");
		expect(answerSource()).not.toContain("{@html");
		expect(answerSource()).not.toContain("readingsHtml");
		expect(answerSource()).not.toContain("ann-answer-readings");
	});

	it("fades in on mount and out while closing", () => {
		expect(answerSource()).toContain("ann-answer-in");
		expect(answerSource()).toContain("closing");
	});

	it("floats near-opaque, fully opaque only for stark contrast", () => {
		expect(answerSource()).toMatch(/rgba\(255,\s*255,\s*255,\s*0\.98\)/);
		expect(answerSource()).toMatch(/rgba\(30,\s*30,\s*32,\s*0\.98\)/);
		expect(answerSource()).toContain("prefers-contrast");
	});

	it("rides the popup-size setting on top of message text", () => {
		expect(answerSource()).toMatch(
			/\.ann-answer\s*\{[^}]*font-size:\s*calc\(1rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
	});
});
