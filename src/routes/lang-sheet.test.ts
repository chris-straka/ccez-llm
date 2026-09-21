import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone language-sheet anchoring invariants.
 *
 * Asserted on +page.svelte source because the behavior they guard —
 * the fixed sheet dropping under its pill or centering on the
 * screen — is invisible to jsdom (no layout, no viewport). Short
 * lists drop under their pill like a plain menu; long ones
 * (Europe/Asia never fit between pill and composer) center on the
 * screen via top:50% plus translateY(-50%). A top/bottom pair is
 * forbidden — an over-constrained fixed box stretches full-band
 * (margins compute to zero) and reads as a massive empty panel.
 */
function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("phone language sheet", () => {
	it("centers long lists with top:50% plus translateY", () => {
		const css = pageStyle();
		expect(css).toMatch(
			/\.lang-list-fixed\s*\{[^}]*top:\s*50%[^}]*transform:\s*translateY\(-50%\)/
		);
	});

	it("drops short lists with no translate", () => {
		const css = pageStyle();
		expect(css).toMatch(
			/\.lang-list-fixed\.lang-list-drop\s*\{[^}]*transform:\s*none/
		);
	});

	it("never pins a top/bottom pair on the fixed sheet", () => {
		const css = pageStyle();
		const blocks = [
			...css.matchAll(/\.lang-list-fixed[^{]*\{([^}]*)\}/g)
		].map((m) => m[1] ?? "");
		expect(blocks.length).toBeGreaterThan(0);
		for (const block of blocks) {
			const hasTop = /(^|;|\s)top\s*:/.test(block);
			const hasBottom = /(^|;|\s)bottom\s*:/.test(block);
			expect(
				!(hasTop && hasBottom && !/bottom\s*:\s*auto/.test(block)),
				"top+bottom pair stretches the sheet"
			);
		}
	});

	it("anchors the sheet with left, max-height, and drop-only top", () => {
		const source = pageSource();
		expect(source).toContain("left: ${langMenuAnchor.left}px;");
		expect(source).toContain("max-height: ${langMenuAnchor.maxH}px;");
		expect(source).toContain('langMenuAnchor.mode === "drop"');
		expect(source).not.toContain("langMenuAnchor.bottom");
	});
});
