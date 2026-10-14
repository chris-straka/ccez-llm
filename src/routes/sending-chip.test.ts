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

describe("sending chip restyle", () => {
	/** Plain status text, no backplate: the pill is gone on purpose
	(instant-reading chrome the owner rejected), and the color lives
	on the dots instead — a three-hue sequence in both themes. */
	it("carries no backplate", () => {
		const css = pageStyle();
		const chip = css.match(/\.sending-chip\s*\{([^}]*)\}/);
		expect(
			chip,
			"no .sending-chip rule — the chip lost its layout"
		).toBeTruthy();
		expect(
			chip![1],
			".sending-chip regained a background — the pill must stay gone"
		).not.toMatch(/background/);
	});
	it("names dot colors as tokens (dot 1 is the accent)", () => {
		// Palette rule (see docs/design/colors.md): components name tokens,
		// never bare accent hexes — dot 1 rides var(--accent), dots 2-3
		// the per-theme thinking tokens with hex fallback lines.
		const css = pageStyle();
		const rule = (n: number) => {
			const match = css.match(
				new RegExp(
					`\\.sending \\.tdots span:nth-child\\(${n}\\)\\s*\\{([^}]*)\\}`
				)
			);
			expect(match, `dot ${n} has no color rule`).toBeTruthy();
			return match![1]!;
		};
		expect(rule(1)).toMatch(/color\s*:\s*var\(--accent\)/);
		expect(rule(2)).toMatch(/color\s*:\s*var\(--thinking-2\)/);
		expect(rule(3)).toMatch(/color\s*:\s*var\(--thinking-3\)/);
	});
});
