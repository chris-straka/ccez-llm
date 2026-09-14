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
	/** Both chrome buttons share one box: the copy glyph brings its
	own height while `$` is bare text, so equal height — not
	line-height games — is what centers them on each other. */
	function texRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)];
		const own = rules.find(
			(rule) => !rule[1]!.includes(".ccez-math-copy") && !/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-tex rule");
		return own[2]!;
	}
	function sharedRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)];
		const shared = rules.find((rule) => rule[1]!.includes(".ccez-math-copy"));
		if (!shared) throw new Error("no shared math chrome rule");
		return shared[2]!;
	}
	it("keeps the source toggle upright", () => {
		expect(texRule()).toMatch(/font-style\s*:\s*normal/);
	});
	it("leaves the toggle text on a real line box", () => {
		expect(texRule()).not.toMatch(/line-height\s*:\s*0/);
	});
	it("sizes both buttons to one shared box", () => {
		expect(sharedRule()).toMatch(/height\s*:\s*1\.3rem/);
	});
});
