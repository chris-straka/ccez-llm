import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Baked-annotation refs card renders in SentRefs.svelte; the page
 * keeps the pop flag, the row-edit state (it focuses the box and
 * guards other gestures on it), the blink, and the behaviors. Like
 * the sidebar search box, pop/edit/box cross as bindables: the card
 * toggles here, the draft and its focus bind here.
 */
function componentSource(): string {
	return readFileSync(new URL("./SentRefs.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

describe("sent refs state contract", () => {
	it("binds pop, draft, and box while reading edit and blink", () => {
		const source = componentSource();
		expect(source).toContain("popOpen = $bindable(null)");
		expect(source).toContain('editDraft = $bindable("")');
		expect(source).toContain("editBox = $bindable(null)");
		// The toggle writes straight through the bindable.
		expect(source).toContain("popOpen = popOpen === msgId ? null : msgId");
		expect(source).toContain("bind:value={editDraft}");
		expect(source).toContain("bind:this={editBox}");
	});

	it("delegates clear, jump, copy, and row edit through actions", () => {
		const source = componentSource();
		expect(source).toContain("clearAll: () => void");
		expect(source).toContain("quoteClick: (quote: string, n: number) => void");
		expect(source).toContain("copy: (quote: string, comment: string) => void");
		expect(source).toContain("startEdit: (ref: AnnotationRef) => void");
		expect(source).toContain("saveEdit: () => void");
		expect(source).toContain("cancelEdit: () => void");
		// Desktop-only pencil; phones keep a clean jump target.
		expect(source).toContain("{#if !android}");
		expect(source).toContain("data-refs-pencil={ref.n}");
	});

	it("keeps article seating global until the article extracts", () => {
		const source = componentSource();
		expect(source).toContain(":global(article):has(.ann-refs)");
		expect(source).toContain(":global(article.user) .ann-refs");
		expect(source).toContain(":global(article.user) .ann-refs-pop");
	});

	it("feeds the card from the page with live message state", () => {
		const page = pageSource();
		expect(page).toContain("<SentRefs");
		expect(page).toContain("bind:popOpen={refsPopOpen}");
		expect(page).toContain("bind:editDraft={refsEditDraft}");
		expect(page).toContain("bind:editBox={refsEditBox}");
		expect(page).toContain("editing={refsEditing}");
		expect(page).toContain("blink={refsBlink}");
		expect(page).toContain("quoteClick: (quote: string, n: number) =>");
		expect(page).toContain("startEdit: (ref: { n: number; comment: string }) =>");
	});
});
