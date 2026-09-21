import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The new-annotations dock renders from `ReviewDock.svelte`, not the
 * page. The page owns the annotations array, the open/edit/highlight
 * ids, the draft, and the save/quote/copy/remove behaviors; the
 * component owns the dock markup, the inline editor, and their
 * surfaces. Svelte scoping binds CSS to the component that renders
 * it, so the `.review`/`.ann-wrap` rules moved with the markup — a
 * paged rule would silently stop matching (see the toast red-pairing
 * regression that set this precedent).
 */
function dockSource(): string {
	return readFileSync(new URL("./ReviewDock.svelte", import.meta.url), "utf8");
}

function composerSource(): string {
	return readFileSync(new URL("./Composer.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function dockStyle(): string {
	const match = dockSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("ReviewDock.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("review dock extraction", () => {
	it("renders the dock from the component, not the page", () => {
		expect(dockSource()).toContain('class="ann-wrap"');
		expect(dockSource()).toContain('class="review"');
		expect(dockSource()).toContain("Clear all");
		expect(dockSource()).toContain('aria-label="Edit annotation {n + 1}"');
		// The dock usage moved into the composer with the tools row;
		// the page renders the composer instead.
		expect(composerSource()).toContain("<ReviewDock");
		expect(pageSource()).toContain("<Composer");
		expect(pageSource()).not.toContain('class="ann-wrap"');
		expect(pageSource()).not.toContain('class="review-item"');
		// The page keeps the array, ids, draft, and behaviors.
		expect(pageSource()).toContain("let annotations = $state");
		expect(pageSource()).toContain("function saveEdit");
		expect(pageSource()).toContain("function reviewQuoteClick");
	});

	it("keeps the dock surfaces scoped to the component", () => {
		const css = dockStyle();
		expect(css).toContain(".ann-wrap .review");
		expect(css).toContain(".review-item.highlight");
		expect(css).toContain(".review-edit-actions button:last-child");
		expect(css).toContain(".ann-wrap.pinned .review");
		expect(pageStyle()).not.toMatch(/\.review\s*\{/);
		expect(pageStyle()).not.toContain(".review-item");
		expect(pageStyle()).not.toContain(".ann-wrap .review");
	});
});
