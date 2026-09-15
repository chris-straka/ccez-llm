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

function panelSource(name: string): string {
	return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

describe("shared settings ownership", () => {
	// The three panels mutate the one shared settings proxy in place
	// (see hydrateSecrets in SettingsPanel: shared-mutable is the
	// design, not an accident). Declaring the prop $bindable names
	// that contract so Svelte stops warning ownership_invalid_mutation
	// on every slider/checkbox write.
	for (const name of ["DefaultsPanel.svelte", "ProviderPanel.svelte", "AppearancePanel.svelte"]) {
		it(`${name} declares its settings prop bindable`, () => {
			expect(panelSource(name)).toMatch(/let\s*\{\s*settings\s*=\s*\$bindable\(\)/);
		});
	}
});

describe("updates section", () => {
	// Web builds have no updater shell: the whole section (copy and
	// button alike) stays out, instead of a dead "nothing to check".
	it("renders the section only off the web route", () => {
		const source = panelSource("UpdatesPanel.svelte");
		const gate = source.indexOf('{#if updateRoute.kind !== "none"}');
		const section = source.indexOf("<section");
		if (gate === -1) throw new Error("no off-web gate for the updates section");
		if (section === -1) throw new Error("no updates section");
		expect(section).toBeGreaterThan(gate);
		expect(source).not.toMatch(/nothing to check/);
	});
	it("places the updates column by section identity, not :last-of-type", () => {
		// On web the updates section is gone, so the keys block would
		// match :last-of-type itself and slide into column 2.
		const css = panelsCss();
		expect(css).not.toMatch(/section:last-of-type/);
		expect(css).toMatch(/section\[aria-labelledby="updates-heading"\] > h2/);
		expect(css).toMatch(/section\[aria-labelledby="updates-heading"\] > button/);
	});
});

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
