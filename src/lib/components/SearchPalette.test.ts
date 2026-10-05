import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The command palette's surfaces live in `SearchPalette.svelte`, its
 * hit list in `SearchResults.svelte`.
 * Svelte scoping binds CSS to the component that renders it, so a
 * paged rule would silently stop matching (see the toast
 * red-pairing regression that set this precedent). The box seating
 * (`.search-palette`) lives in `Modal.svelte` with the other dialog
 * chrome.
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

describe("search palette surfaces", () => {
	it("keeps the dialog surfaces scoped to the components", () => {
		const css = paletteStyle();
		expect(css).toContain(".search-input");
		expect(css).toContain(".search-input:focus-visible");
		// The hit list (shared with the phone switcher) styles itself.
		const results = readFileSync(
			new URL("./SearchResults.svelte", import.meta.url),
			"utf8"
		);
		expect(results).toContain(".search-hit.cursor");
		expect(results).toContain(".search-status");
		const modal = readFileSync(
			new URL("./Modal.svelte", import.meta.url),
			"utf8"
		);
		expect(modal).toContain(".search-palette");
		expect(pageStyle()).not.toContain(".search-input");
		expect(pageStyle()).not.toContain(".search-hit");
	});
});
