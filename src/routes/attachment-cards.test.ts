import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Pasted-text attachment cards: the same 12rem image card with the
 * text filling the thumbnail's seat, never a tall pill.
 *
 * Layout facts jsdom cannot see, so these assert on
 * `Attachments.svelte` source like the other route style tests (the
 * strip moved there with its markup and surfaces). The preview
 * clamps to the thumbnail height (4.5rem) with an ellipsis;
 * expanding scrolls in place instead of growing the strip; and the
 * strip centers lesser pills instead of stretching them to card
 * height.
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

function cardPreviewRule(): string {
	const css = stripStyle();
	const rules = [
		...css.matchAll(/([^{}]*li\.card \.paste-body[^{}]*)\{([^}]*)\}/g)
	];
	const base = rules.find((rule) => !rule[1]!.includes(".open"));
	if (!base) throw new Error("no li.card .paste-body rule");
	return base[2]!;
}

describe("pasted-text cards", () => {
	it("renders pasted text as a card, like images", () => {
		expect(stripSource()).toContain(
			'class:card={(att.kind === "image" && !!att.dataUrl) || pasted}'
		);
	});
	it("fills the thumbnail seat with clamped text, never a tall pill", () => {
		const rule = cardPreviewRule();
		expect(rule).toMatch(/flex\s*:\s*1 1 100%/);
		expect(rule).toMatch(/height\s*:\s*4\.5rem/);
		expect(rule).toMatch(/-webkit-line-clamp\s*:\s*4/);
		expect(rule).toMatch(/overflow\s*:\s*hidden/);
	});
	it("scrolls the expanded preview in place instead of growing", () => {
		const css = stripStyle();
		const rules = [
			...css.matchAll(/([^{}]*li\.card \.paste-body\.open[^{}]*)\{([^}]*)\}/g)
		];
		expect(rules).not.toHaveLength(0);
		const body = rules.map((rule) => rule[2]).join(";");
		expect(body).toMatch(/display\s*:\s*block/);
		expect(body).toMatch(/overflow-y\s*:\s*auto/);
		expect(body).not.toMatch(/max-height\s*:\s*8rem/);
	});
	it("centers strip pills instead of stretching them to card height", () => {
		const css = stripStyle();
		const strip = css.match(/\.attachments\s*\{([^}]*)\}/);
		expect(strip?.[1]).toMatch(/align-items\s*:\s*center/);
	});
});
