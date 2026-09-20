import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Sidebar chrome must never select: long-presses on chat titles, the
 * + button, and the Settings button raise app text selection instead
 * of the row tap. jsdom has no selection UI, so like
 * actions-reveal.test.ts this asserts on +page.svelte's <style>
 * source: one rule covering all three, with the webkit prefix for
 * mobile Safari.
 */
function pageStyle(): string {
	const source = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("sidebar chrome selection", () => {
	it("pins user-select none on the chat list, new-chat, and settings", () => {
		const css = pageStyle();
		for (const selector of ["aside ul", "aside button.new", "aside button.side-settings"]) {
			expect(css).toContain(selector);
		}
		const rules = [...css.matchAll(/([^{}]+)\{([^}]*user-select:\s*none[^}]*)}/g)];
		const covered = rules.some(
			(rule) =>
				rule[1]!.includes("aside ul") &&
				rule[1]!.includes("aside button.new") &&
				rule[1]!.includes("aside button.side-settings") &&
				rule[2]!.includes("-webkit-user-select: none")
		);
		expect(covered).toBe(true);
	});
});
