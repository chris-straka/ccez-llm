import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The annotation answer popup renders from `AnnAnswer.svelte`, not
 * the page. The page owns open state, badge-anchor placement, and
 * the add-to-prompt behavior; the component owns the card markup and
 * its surface. Answer text renders as plain text (never {@html}), so
 * model output can't inject markup.
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
		expect(answerSource()).toContain('aria-label="Close answer"');
		expect(pageSource()).not.toContain('class="ann-answer"');
	});

	it("renders answer text as text, never HTML", () => {
		expect(answerSource()).not.toContain("{@html");
		expect(answerSource()).toContain("{answer}");
	});
});
