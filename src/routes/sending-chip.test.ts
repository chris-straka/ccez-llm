import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Stylesheet invariants for the thinking/sending chip's elapsed count.
 *
 * These assert on +page.svelte's <style> source because the behavior they
 * guard — hidden until hover, revealed on hover — is invisible to jsdom
 * (no hover, no layout). The count must not tick away in the corner
 * unasked: it hides by default, reveals on chip hover, and stays visible
 * on touch clients that have no hover to ask with.
 */
function pageStyle(): string {
	const match = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8").match(
		/<style>([\s\S]*)<\/style>/,
	);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("sending chip elapsed count", () => {
	it("hides the count until the chip is hovered", () => {
		const css = pageStyle();
		const hidden = css.match(/\.sending-chip \.sending-elapsed\s*\{([^}]*)\}/);
		expect(hidden, "default .sending-elapsed rule is gone — keep the count hidden until hover").toBeTruthy();
		expect(hidden![1]).toContain("display: none");
		const hover = css.match(/\.sending-chip:hover \.sending-elapsed\s*\{([^}]*)\}/);
		expect(hover, "hover reveal is gone — the count must appear on chip hover").toBeTruthy();
		expect(hover![1]).toContain("display: inline");
	});

	it("keeps the count visible on touch clients with no hover", () => {
		const css = pageStyle();
		const touch = css.match(/@media \(hover: none\) \{[^}]*\.sending-chip \.sending-elapsed\s*\{([^}]*)\}/);
		expect(touch, "@media (hover: none) fallback is gone — touch must always show the count").toBeTruthy();
		expect(touch![1]).toContain("display: inline");
	});
});
