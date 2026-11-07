import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Stylesheet invariants for the thinking/sending chip's elapsed count.
 *
 * These assert on SendingIndicator.svelte's <style> source (moved with
 * the status line) because what they guard is invisible to jsdom (no
 * hover, no layout): the count stays visible on touch clients that
 * have no hover to ask with.
 */
function pageStyle(): string {
	const match = readFileSync(
		new URL("../lib/components/SendingIndicator.svelte", import.meta.url),
		"utf8"
	).match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("SendingIndicator.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("sending chip elapsed count", () => {
	// Hover fade in and out is pinned in streaming-integrity.e2e.ts;
	// only the touch fallback (no hover to ask with) stays here.
	it("keeps the count visible on touch clients with no hover", () => {
		const css = pageStyle();
		const touch = css.match(
			/@media \(hover: none\) \{[^}]*\.sending-chip \.sending-elapsed\s*\{([^}]*)\}/
		);
		expect(
			touch,
			"@media (hover: none) fallback is gone — touch must always show the count"
		).toBeTruthy();
		expect(touch![1]).toMatch(/opacity:\s*0\.8/);
	});
});
