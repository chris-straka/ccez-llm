import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Popup sizing is a CSS contract jsdom can't see, so it is asserted
 * on source (see AGENTS.md).
 */
function pillSource(): string {
	return readFileSync(new URL("./AnnPop.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function pillStyle(): string {
	const match = pillSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("AnnPop.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("annotation pill", () => {
	it("rides the popup-size setting on top of message text", () => {
		const css = pillStyle();
		// Both roots (create pill, edit card) multiply message text
		// by the setting, so huge type does not force huge popups.
		// Inner fields ride em and stay untouched.
		expect(css).toMatch(
			/\.ann-pop\.fresh\s*\{[^}]*font-size:\s*calc\(1rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
		expect(css).toMatch(
			/\.ann-pop:not\(\.fresh\)\s*\{[^}]*font-size:\s*calc\(1rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
		// The var is set on .app from settings (same track as the
		// prompt font), never hardcoded in the component.
		expect(pageSource()).toContain("--annpop-scale: {settings.annPopScale ?? 1}");
	});
});
