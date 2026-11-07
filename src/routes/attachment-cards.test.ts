import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Pasted-text attachment cards: the same 12rem image card with the
 * text filling the thumbnail's seat, never a tall pill.
 *
 * Layout facts jsdom cannot see, so these assert on
 * `Attachments.svelte` source like the other route style tests (the
 * strip moved there with its markup and surfaces). Scrolling and
 * preview geometry are covered by the browser tests.
 */
function stripSource(): string {
	return readFileSync(
		new URL("../lib/components/Attachments.svelte", import.meta.url),
		"utf8"
	);
}

describe("pasted-text cards", () => {
	it("renders pasted text as a card, like images", () => {
		expect(stripSource()).toContain(
			'class:card={(att.kind === "image" && !!att.dataUrl) || pasted}'
		);
	});
});
