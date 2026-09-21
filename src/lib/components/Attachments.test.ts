import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The attachment strip (pills, image/pasted-text cards, drag gesture)
 * renders from `Attachments.svelte`, not the page. The page owns the
 * attachments array, the expanded-pill set, the drag flag, the OCR busy
 * id, and the editor/toast side effects; the component owns the strip
 * markup, the card buttons, and their surfaces. Svelte scoping binds
 * CSS to the component that renders it, so the `.attachments` rules
 * moved with the markup — a paged rule would silently stop matching
 * (see the toast red-pairing regression that set this precedent).
 * The inline error line stays paged in the shared `.error` look.
 */
function attachmentsSource(): string {
	return readFileSync(new URL("./Attachments.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function attachmentsStyle(): string {
	const match = attachmentsSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Attachments.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("attachments strip extraction", () => {
	it("renders the strip from the component, not the page", () => {
		expect(attachmentsSource()).toContain('class="attachments"');
		expect(attachmentsSource()).toContain('class="paste-body"');
		expect(attachmentsSource()).toContain('class="ocr-btn"');
		expect(attachmentsSource()).toContain('class="card-btn"');
		expect(attachmentsSource()).toContain('aria-label="Remove attachment"');
		expect(attachmentsSource()).toContain('aria-label="Copy attachment"');
		expect(attachmentsSource()).toContain('aria-label="Recognize text in image"');
		// The page keeps JS guard strings (querySelector(":scope >
		// .attachments")) and the inline error line, but no strip
		// element of its own.
		expect(pageSource()).toContain("<Attachments");
		expect(pageSource()).not.toContain('class="attachments"');
		expect(pageSource()).not.toContain('class="paste-body"');
		expect(pageSource()).not.toContain('class="ocr-btn"');
		expect(pageSource()).toContain('class="error attach-error"');
	});

	it("keeps the strip surfaces scoped to the component", () => {
		const css = attachmentsStyle();
		expect(css).toMatch(/\.attachments\s*\{[^}]*position:\s*absolute/);
		expect(css).toContain(".attachments li.card");
		expect(css).toContain(".attachments .ocr-btn:disabled");
		expect(css).toContain(".file-kind");
		expect(css).toContain(".attachments.composer-idle");
		expect(pageStyle()).not.toMatch(/\.attachments\s*\{/);
		expect(pageStyle()).not.toContain(".file-kind");
	});
});
