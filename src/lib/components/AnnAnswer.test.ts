import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The annotation answer popup renders from `AnnAnswer.svelte`, not
 * the page. The page owns open state, badge-anchor placement below
 * the word, the readings line, and fade-out; the component owns the
 * card markup and its surface. The quote itself never renders here
 * (the highlighted word upstream is the title). Answer text renders
 * as text (never {@html}); the readings line is the only HTML, and
 * it is locally generated and sanitized upstream. No close button:
 * clicking off the card (or Esc) closes it.
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
		expect(answerSource()).toContain('aria-label="Add answer to prompt"');
		expect(pageSource()).not.toContain('class="ann-answer"');
	});

	it("carries no quote title and no close button", () => {
		expect(answerSource()).not.toContain("ann-answer-quote");
		expect(answerSource()).not.toContain("Close answer");
		expect(answerSource()).not.toContain("{quote}");
	});

	it("renders answer text as text, readings as upstream HTML", () => {
		expect(answerSource()).toContain("{answer}");
		expect(answerSource()).not.toContain("{@html answer}");
		expect(answerSource()).toContain("{@html readingsHtml}");
	});

	it("fades in on mount and out while closing", () => {
		expect(answerSource()).toContain("ann-answer-in");
		expect(answerSource()).toContain("closing");
	});

	it("paints an opaque surface, pinned for stark contrast", () => {
		expect(answerSource()).not.toMatch(/rgba\(255,\s*255,\s*255,\s*0\./);
		expect(answerSource()).not.toMatch(/rgba\(30,\s*30,\s*32,\s*0\./);
		expect(answerSource()).toContain("prefers-contrast");
	});
});
