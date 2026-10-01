import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The shortcuts modal's surfaces live in `ShortcutsModal.svelte`.
 * Svelte scoping binds CSS to the component that renders it, so a
 * paged rule would silently stop matching (see the toast
 * red-pairing regression that set this precedent).
 */
function modalSource(): string {
	return readFileSync(
		new URL("./ShortcutsModal.svelte", import.meta.url),
		"utf8"
	);
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function modalStyle(): string {
	const match = modalSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("ShortcutsModal.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("shortcuts modal surfaces", () => {
	it("keeps the dialog surfaces scoped to the component", () => {
		const css = modalStyle();
		expect(css).toContain(".shortcuts-filter");
		expect(css).toContain(".shortcuts-filter:focus-visible");
		expect(css).toMatch(/\.keys\s*\{[^}]*display:\s*grid/);
		expect(css).toContain(".keys dd");
		expect(pageStyle()).not.toContain(".shortcuts-filter");
		expect(pageStyle()).not.toMatch(/\.keys\s*\{/);
	});
});
