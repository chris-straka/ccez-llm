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
		expect(dockSource()).toContain("Clear pinned");
		// The dock usage moved into the composer with the tools row;
		// the page renders the composer instead.
		expect(composerSource()).toContain("<ReviewDock");
		expect(pageSource()).toContain("<Composer");
		expect(pageSource()).not.toContain('class="ann-wrap"');
		expect(pageSource()).not.toContain('class="review-item"');
		// The page keeps the array, ids, and behaviors.
		expect(pageSource()).toContain("let annotations = $state");
		expect(pageSource()).toContain("function reviewQuoteClick");
	});

	it("keeps the dock surfaces scoped to the component", () => {
		const css = dockStyle();
		expect(css).toContain(".ann-wrap .review");
		expect(css).toContain(".review-item.highlight");
		expect(css).toContain(".ann-wrap.pinned .review");
		expect(pageStyle()).not.toMatch(/\.review\s*\{/);
		expect(pageStyle()).not.toContain(".review-item");
		expect(pageStyle()).not.toContain(".ann-wrap .review");
	});

	it("edits through the card, never inline in the dock", () => {
		const source = dockSource();
		// The pencil opens the edit card (reword-and-re-ask); no
		// textarea ever mounts in the dock itself.
		expect(source).toContain("review-pencil");
		expect(source).not.toContain("review-edit-actions");
		expect(source).not.toContain("<textarea");
	});

	it("rows jump, copy, unpin, reword, and delete — answers always show", () => {
		const source = dockSource();
		// Pinned rows only: pinning happens by double-clicking the
		// badge, so no per-row Add exists — Unpin is the only prompt
		// action, gated on answered rows like the pencil.
		expect(source).toContain("canPinAnnotation(ann)");
		expect(source).not.toContain("Add to prompt");
		expect(source).not.toContain("actions.pin(ann.id)");
		expect(source).toContain("actions.unpin(ann.id)");
		// No omit/include toggle: deleting is the only removal.
		expect(source).not.toContain("setExcluded");
		expect(source).not.toContain("review-omit");
		expect(source).not.toContain("Omit");
		// The orange pencil rewords answered rows (saving re-asks).
		expect(source).toContain("review-pencil");
		expect(source).toContain("actions.editOrange(ann.id)");
		// Quote jump, copy, and delete stay on every row; answers
		// display always under their question.
		expect(source).toContain("actions.quote(ann)");
		expect(source).toContain("review-copy");
		expect(source).toContain("review-del");
		expect(source).toContain("review-answer");
		const css = dockStyle();
		expect(css).toContain(".review-add");
		expect(css).not.toContain(".review-omit");
		expect(css).toContain(".review-answer");
		expect(css).toContain(".review-quote.annotated");
	});
});
