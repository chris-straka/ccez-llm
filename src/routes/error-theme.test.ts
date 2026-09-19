import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Crash-page theme invariant: +error.svelte renders outside the themed
 * app shell (no tokens, no data-theme), so token-driven colors fall
 * back to the framework default — unstyled light. The page is
 * dark-always instead; assert on source because jsdom never renders
 * the crash route.
 */
function errorStyle(): string {
	const source = readFileSync(
		new URL("./+error.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+error.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("crash page theme", () => {
	it("paints dark without relying on app tokens", () => {
		const css = errorStyle();
		expect(css).toContain("background: #1c1c1e");
		expect(css).toContain("color: #f2f2f7");
		expect(css).not.toContain("var(--bg");
		expect(css).not.toContain("var(--ink");
	});
});
