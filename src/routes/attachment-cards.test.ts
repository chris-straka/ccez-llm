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

function stripStyle(): string {
	const match = stripSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Attachments.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("pasted-text cards", () => {
	it("renders pasted text as a card, like images", () => {
		expect(stripSource()).toContain(
			'class:card={(att.kind === "image" && !!att.dataUrl) || pasted}'
		);
	});
	it("centers strip pills instead of stretching them to card height", () => {
		const css = stripStyle();
		const strip = css.match(/\.attachments\s*\{([^}]*)\}/);
		expect(strip?.[1]).toMatch(/align-items\s*:\s*center/);
	});
});
