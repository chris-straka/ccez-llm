import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Sent-attachment folds (file tags above the body, image folds inline)
 * render in SentAttachments.svelte with the popup card CSS; the page
 * keeps the models (expand state lives in expandedTags) and the
 * fold/copy/OCR behaviors. jsdom sees neither the popup overlay nor
 * the sideways strip, so like sidebar-chrome.test.ts this asserts on
 * source: both variants, the empty guard, and the page wiring that
 * feeds each variant its pre-filtered kind.
 */
function componentSource(): string {
	return readFileSync(
		new URL("./SentAttachments.svelte", import.meta.url),
		"utf8"
	);
}


function threadSource(): string {
	return readFileSync(new URL("./ThreadView.svelte", import.meta.url), "utf8");
}


function articleSource(): string {
	return readFileSync(new URL("./MessageArticle.svelte", import.meta.url), "utf8");
}

describe("sent attachment variants", () => {
	it("renders file tags and inline image folds from pre-filtered models", () => {
		const source = componentSource();
		expect(source).toContain('variant: "tags" | "inline"');
		expect(source).toContain('{#if variant === "tags"}');
		expect(source).toContain("{:else}");
		// Empty models render nothing: the old outer guards live here.
		expect(source).toContain("{#if models.length > 0}");
		// Both folds share the card; only the inline fold exposes it.
		expect(source).toContain("class=\"sent-tags\"");
		expect(source).toContain("class=\"sent-inline\"");
		expect(source).toContain("aria-expanded={m.open}");
		expect(source.match(/aria-expanded=/g)?.length).toBe(1);
	});

	it("delegates fold, copy, and OCR through one actions contract", () => {
		const source = componentSource();
		expect(source).toContain("toggle: (id: string) => void");
		expect(source).toContain("copy: (att: Attachment) => void");
		expect(source).toContain("recognize: (att: Attachment) => void");
		expect(source).toContain("actions.toggle(m.id)");
		expect(source).toContain("actions.copy(att)");
		expect(source).toContain("actions.recognize(att)");
		// OCR spins on the page busy flag, never locally.
		expect(source).toContain("disabled={ocrBusyId === att.id}");
	});

	it("keeps popup surfaces global for {@html}-rendered tags", () => {
		const source = componentSource();
		for (const cls of [
			":global(.sent-wrap)",
			":global(.sent-open)",
			":global(.sent-card)",
			":global(.sent-foot)",
			":global(.sent-img)",
			":global(.sent-excerpt)"
		]) {
			expect(source).toContain(cls);
		}
	});

	it("feeds each variant its kind from the page through the article", () => {
		// Both usages moved into the row with the article; the page
		// computes the pre-filtered models per message.
		const row = articleSource();
		expect(row).toContain('variant="tags"');
		expect(row).toContain('variant="inline"');
		expect(row).toContain("models={textModels}");
		expect(row).toContain("models={imageModels}");
		expect(row).toContain("attachments={msg.attachments ?? []}");
		const thread = threadSource();
		expect(thread).toContain('m.kind === "text"');
		expect(thread).toContain('m.kind === "image"');
		expect(thread).toContain("<MessageArticle");
	});
});
