import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Hover-toggle row rhythm: the fieldset carries no bottom margin
 * itself and neither do the row's labels (the generic label margin
 * would stretch the flex row, leaving the boxes centered with slack
 * below them inside the box), the legend keeps its own gap above
 * the row, and the stacked 0.9rem rhythm resumes on the check after
 * the row — so the gap below the row matches every other checkbox
 * gap.
 *
 * Asserts on panels.css source because rhythm is a layout fact jsdom
 * cannot see (same reason MessageBody.test.ts reads <style>).
 */
function panelsCss(): string {
	const source = readFileSync(new URL("./panels.css", import.meta.url), "utf8");
	// Strip CSS comments so prose can't trip the assertions below.
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function ruleBody(css: string, selector: string): string {
	const pattern = new RegExp(
		`([^{}]*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{}]*)\\{([^}]*)\\}`,
		"g"
	);
	const rules = [...css.matchAll(pattern)];
	const own = rules.find((rule) => !rule[1]!.includes(".check + .check"));
	if (!own) throw new Error(`no base ${selector} rule`);
	return own[2]!;
}

describe("hover-row rhythm", () => {
	it("keeps the fieldset bottom margin at zero", () => {
		expect(ruleBody(panelsCss(), "fieldset.hover-row")).toMatch(/margin-bottom\s*:\s*0/);
	});
	it("keeps the row labels margin-free (generic label margin stretches the row)", () => {
		const css = panelsCss();
		const rules = [
			...css.matchAll(/([^{}]*fieldset\.hover-row\s+\.check[^{}]*)\{([^}]*)\}/g)
		].filter((rule) => !rule[1]!.includes("+"));
		if (rules.length === 0) throw new Error("no fieldset.hover-row .check rule");
		expect(rules[0]![2]).toMatch(/margin-bottom\s*:\s*0/);
	});
	it("hands the stacked 0.9rem rhythm to the check after the row", () => {
		const css = panelsCss();
		const sibling = [...css.matchAll(/([^{}]*fieldset\.hover-row\s*\+\s*\.check[^{}]*)\{([^}]*)\}/g)];
		if (sibling.length === 0) throw new Error("no fieldset.hover-row + .check rule");
		expect(sibling[0]![2]).toMatch(/margin-top\s*:\s*0\.9rem/);
	});
});
