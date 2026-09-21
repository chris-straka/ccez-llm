import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The shortcuts modal renders from `ShortcutsModal.svelte` through
 * the shared `Modal.svelte` shell, not the page. The page owns the
 * open flag, the filter reset, and ⌘F focus; the component owns the
 * list, the field, and their surfaces. Svelte scoping binds CSS to
 * the component that renders it, so the filter/keys rules moved with
 * the markup — a paged rule would silently stop matching (see the
 * toast red-pairing regression that set this precedent). The dialog
 * head row stays shared paged until the palette and inspect dialogs
 * move through the shell.
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

describe("shortcuts modal extraction", () => {
	it("renders the dialog from the component, not the page", () => {
		expect(modalSource()).toContain('class="shortcuts-filter"');
		expect(modalSource()).toContain('class="keys"');
		expect(modalSource()).toContain('id="shortcuts-heading"');
		expect(modalSource()).toContain("No matches");
		expect(pageSource()).toContain("<ShortcutsModal");
		expect(pageSource()).not.toContain('class="shortcuts-filter"');
		expect(pageSource()).not.toContain('class="keys"');
		// The page keeps the open flag, the filter reset, and ⌘F focus.
		expect(pageSource()).toContain("shortcutQuery = \"\";");
		expect(pageSource()).toContain("shortcutInput.focus()");
	});

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
