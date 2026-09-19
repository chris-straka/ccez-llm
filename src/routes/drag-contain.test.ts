import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Mid-drag containment must cover the whole contained article. KaTeX
 * bodies and folded labels declare their own user-select:text, which
 * overrules the inline none containDragTo sets on the article's
 * .rendered — and off-window drags extend the selection with no
 * selectionchange for the JS trim to see, so only engine-level CSS
 * stops the paint wandering into other messages' math. That behavior
 * is invisible to jsdom (no layout, no selection engine), so this
 * asserts on +page.svelte's <style> source the way
 * actions-reveal.test.ts does.
 */
function pageStyle(): string {
	const source = readFileSync(
		new URL("./+page.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("mid-drag containment", () => {
	it("covers descendants that declare their own selectability", () => {
		const css = pageStyle();
		const rule = css.match(
			/:global\(\.rendered\[data-drag-none\]\)[^{]*\{([^}]*)\}/
		);
		expect(
			rule,
			"drag-none containment rule is gone — off-window drags paint other messages' math"
		).toBeTruthy();
		expect(rule![1]).toMatch(/user-select\s*:\s*none\s*!important\s*;/);
		expect(rule![1]).toMatch(/-webkit-user-select\s*:\s*none\s*!important\s*;/);
	});
});
