import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone language-sheet centering invariants.
 *
 * Asserted on +page.svelte source because the behavior they guard —
 * the fixed sheet centering between screen top and composer — is
 * invisible to jsdom (no layout, no viewport). Europe/Asia never
 * fit between their pill and the composer, so the sheet centers in
 * that band instead of starting at the top: equal inline
 * top/bottom plus auto vertical margins do the centering.
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
	it("centers with auto vertical margins, not a top dock", () => {
		const css = pageStyle();
		expect(css).toMatch(
			/\.lang-list-fixed\s*\{[^}]*margin-top:\s*auto[^}]*margin-bottom:\s*auto/
		);
		expect(css).not.toMatch(
			/\.lang-list-fixed\s*\{[^}]*(?<!margin-)bottom:\s*auto/
		);
	});

	it("anchors the sheet with top and bottom offsets", () => {
		const source = pageSource();
		expect(source).toContain("bottom: ${langMenuAnchor.bottom}px;");
		expect(source).toContain("window.innerHeight - composerTop + 8");
	});
});
