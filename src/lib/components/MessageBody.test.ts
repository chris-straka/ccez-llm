import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Folded code chrome: a folded block is label-only, so the copy and Run
 * buttons hide with the pre instead of floating over the collapsed label.
 *
 * Asserts on MessageBody.svelte's <style> source because visibility under
 * `data-folded` is a layout fact jsdom cannot see (same reason
 * actions-reveal.test.ts reads +page.svelte's <style>).
 */
function bodyStyle(): string {
	const source = readFileSync(new URL("./MessageBody.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageBody.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("folded code chrome", () => {
	it("hides the copy and run buttons when the block is folded", () => {
		const css = bodyStyle();
		const hiding = [...css.matchAll(/([^{}]*\.ccez-code\[data-folded="1"\][^{}]*)\{([^}]*)\}/g)].filter(
			(rule) => /display\s*:\s*none/.test(rule[2]!)
		);
		const selectors = hiding.map((rule) => rule[1]).join(",");
		expect(selectors).toContain(".ccez-code-copy");
		expect(selectors).toContain(".ccez-code-run");
	});
});

describe("math chrome alignment", () => {
	/** The `$` source toggle sits upright in the copy glyph's zero line
	box: italic skewed the mark and a taller line box offset its center. */
	function texRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)];
		const own = rules.find(
			(rule) => !rule[1]!.includes(".ccez-math-copy") && !/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-tex rule");
		return own[2]!;
	}
	it("keeps the source toggle upright", () => {
		expect(texRule()).toMatch(/font-style\s*:\s*normal/);
	});
	it("shares the copy glyph's zero line box", () => {
		expect(texRule()).toMatch(/line-height\s*:\s*0/);
	});
});
