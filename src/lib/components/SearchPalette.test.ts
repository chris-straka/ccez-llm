import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The command palette renders from `SearchPalette.svelte` through the
 * shared `Modal.svelte` shell, not the page. The page owns the palette
 * object, element focus, and the search behaviors; the component owns
 * the dialog markup, the hit list, and their surfaces. Svelte scoping
 * binds CSS to the component that renders it, so the search rules
 * moved with the markup — a paged rule would silently stop matching
 * (see the toast red-pairing regression that set this precedent).
 * The box seating (`.search-palette`) lives in `Modal.svelte` with
 * the other dialog chrome.
 */
function paletteSource(): string {
	return readFileSync(
		new URL("./SearchPalette.svelte", import.meta.url),
		"utf8"
	);
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function paletteStyle(): string {
	const match = paletteSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("SearchPalette.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("search palette extraction", () => {
	it("renders the dialog from the component, not the page", () => {
		expect(paletteSource()).toContain('class="search-input"');
		expect(paletteSource()).toContain('class="search-results"');
		expect(paletteSource()).toContain('class="search-hit"');
		expect(paletteSource()).toContain("No matches.");
		// The box variant rides the shared shell as a class prop (the
		// box renders in Modal.svelte — a missing pass silently drops
		// the seating).
		expect(paletteSource()).toContain('cardClass="search-palette"');
		expect(pageSource()).toContain("<SearchPalette");
		expect(pageSource()).not.toContain('class="search-input"');
		expect(pageSource()).not.toContain('class="search-results"');
		// The page keeps the palette object, focus, and behaviors.
		expect(pageSource()).toContain("palette.open = true;");
		expect(pageSource()).toContain("searchInputEl?.focus()");
	});

	it("keeps the dialog surfaces scoped to the components", () => {
		const css = paletteStyle();
		expect(css).toContain(".search-input");
		expect(css).toContain(".search-input:focus-visible");
		expect(css).toContain(".search-hit.cursor");
		expect(css).toContain(".search-status");
		const modal = readFileSync(
			new URL("./Modal.svelte", import.meta.url),
			"utf8"
		);
		expect(modal).toContain(".search-palette");
		expect(pageStyle()).not.toContain(".search-input");
		expect(pageStyle()).not.toContain(".search-hit");
	});
});
