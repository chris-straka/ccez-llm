import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The annotation pill (create + edit card) renders from `AnnPop.svelte`,
 * not the page. The page owns pop state, the draft seed, and the save
 * paths; the component owns the pill markup, the field, the grow
 * action, and their surfaces. Svelte scoping binds CSS to the component
 * that renders it, so the `.ann-pop` rules moved with the markup — a
 * paged rule would silently stop matching (see the toast red-pairing
 * regression that set this precedent). The grow action moved too: it
 * only ever sized the pill field.
 */
function pillSource(): string {
	return readFileSync(new URL("./AnnPop.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function pillStyle(): string {
	const match = pillSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("AnnPop.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("annotation pill extraction", () => {
	it("renders the pill from the component, not the page", () => {
		expect(pillSource()).toContain('class="ann-pop"');
		expect(pillSource()).toContain('aria-label="Save annotation"');
		expect(pillSource()).toContain("function growPill");
		expect(pillSource()).toContain("Dictate annotation");
		expect(pageSource()).toContain("<AnnPop");
		expect(pageSource()).not.toContain('class="ann-pop"');
		expect(pageSource()).not.toContain("function growPill");
		// The page keeps pop state, the draft seed, and save paths.
		expect(pageSource()).toContain("let annPop = $state");
		expect(pageSource()).toContain("function saveAnnPop");
		expect(pageSource()).toContain("annPopBox?.focus");
	});

	it("edit-card save is an icon twin, never a text button", () => {
		expect(pillSource()).toContain('kind="save"');
		expect(pillSource()).not.toContain(">Save<");
	});

	it("keeps the pill surfaces scoped to the component", () => {
		const css = pillStyle();
		expect(css).toMatch(/\.ann-pop\s*\{[^}]*position:\s*fixed/);
		expect(css).toContain(".ann-pop.fresh");
		expect(css).toContain(".ann-save:hover");
		expect(css).toContain("@keyframes ann-pop-in");
		expect(pageStyle()).not.toMatch(/\.ann-pop\s*\{/);
		expect(pageStyle()).not.toContain(".ann-save");
		expect(pageStyle()).not.toContain("@keyframes ann-pop-in");
	});

	it("rides the popup-size setting on top of message text", () => {
		const css = pillStyle();
		// Both roots (create pill, edit card) multiply message text
		// by the setting, so huge type does not force huge popups.
		// Inner fields ride em and stay untouched.
		expect(css).toMatch(
			/\.ann-pop\.fresh\s*\{[^}]*font-size:\s*calc\(1rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
		expect(css).toMatch(
			/\.ann-pop:not\(\.fresh\)\s*\{[^}]*font-size:\s*calc\(1rem \* var\(--font-scale, 1\) \* var\(--annpop-scale, 1\)\)/
		);
		// The var is set on .app from settings (same track as the
		// prompt font), never hardcoded in the component.
		expect(pageSource()).toContain("--annpop-scale: {settings.annPopScale ?? 1}");
	});
});
