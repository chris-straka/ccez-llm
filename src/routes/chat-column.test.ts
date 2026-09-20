import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Chat-column invariants for assistant messages.
 *
 * These assert on +page.svelte's <style> source because the behavior
 * they guard — which flex edge the message column docks to on a wide
 * window — is invisible to jsdom (no layout). A past change set
 * `align-self: flex-start` on the base assistant rule to left-align
 * the *text*; on desktop (full-width articles) that docked the whole
 * column to the window's left edge instead of centering it. The text
 * alignment lives in text-align now; the column stays centered, and
 * only shrink-wrapped phone replies left-dock.
 */
function pageStyle(): string {
	const source = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function ruleBody(css: string, selector: string): string {
	const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
	if (!match) throw new Error(`${selector} rule is gone — move the column guard with it`);
	return match[1]!;
}

describe("assistant chat column", () => {
	it("centers the column, left-aligns the text", () => {
		const body = ruleBody(pageStyle(), "article\\.assistant");
		expect(body).toContain("align-self: center");
		expect(body).toContain("text-align: left");
		expect(body).not.toContain("flex-start");
	});

	it("keeps the phone left-dock for shrink-wrapped replies", () => {
		const body = ruleBody(
			pageStyle(),
			"\\.app\\[data-android\\]:not\\(\\[data-fullbleed\\]\\) article\\.assistant"
		);
		expect(body).toContain("width: fit-content");
		expect(body).toContain("align-self: flex-start");
	});
});
