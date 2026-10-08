import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Learner news renders from `NewsPanel.svelte`; its behavior (grid,
 * skeletons, staging a story, starting a session) is pinned in
 * `e2e/news-mode.e2e.ts`. Only what neither jsdom nor Playwright can
 * observe is checked here: the stylesheet's motion and color rules.
 */
function panelCss(): string {
	const source = readFileSync(new URL("./NewsPanel.svelte", import.meta.url), "utf8");
	return source.split("<style>")[1] ?? "";
}

describe("news panel stylesheet", () => {
	it("animates only transform and opacity, and stops under reduced motion", () => {
		const css = panelCss();
		const keyframes = css.match(/@keyframes[^{]+\{[\s\S]*?\n\t\t?\}/g) ?? [];
		expect(keyframes.length).toBeGreaterThan(0);
		for (const block of keyframes) {
			const props = [...block.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
			for (const prop of props) expect(["transform", "opacity"]).toContain(prop);
		}
		expect(css).toContain("prefers-reduced-motion: reduce");
		expect(css).toContain("animation: none !important");
		expect(css).toContain("transition: none !important");
	});

	it("paints only theme tokens, never raw hex", () => {
		const css = panelCss();
		const hexes = css.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) ?? [];
		// Every hex is a first-paint fallback directly above its var.
		for (const hex of hexes) {
			const idx = css.indexOf(hex);
			const after = css.slice(idx, idx + 120);
			expect(after).toContain("var(--");
		}
		expect(css).toContain("var(--ink)");
		expect(css).toContain("var(--muted)");
		expect(css).toContain("var(--accent)");
		expect(css).toContain("var(--bg-raised)");
	});
});
