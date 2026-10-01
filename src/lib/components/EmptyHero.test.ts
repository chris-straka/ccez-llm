import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Empty-chat hero surfaces live in EmptyHero.svelte; no hero
 * selector stays paged.
 */
function componentSource(): string {
	return readFileSync(new URL("./EmptyHero.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("EmptyHero.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("empty hero surfaces", () => {
	it("keeps no hero selector in page style", () => {
		const css = pageStyle();
		for (const selector of [".empty-state", ".hero", "mock-note"]) {
			expect(css, selector).not.toContain(selector);
		}
	});

	it("keeps the hero surfaces scoped to the hero", () => {
		const css = componentStyle();
		expect(css).toContain(".empty-state");
		expect(css).toContain(".hero");
		expect(css).toContain(".mock-note");
	});
});
