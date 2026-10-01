import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The attachment strip's surfaces live in `Attachments.svelte`.
 * Svelte scoping binds CSS to the component that renders it, so a
 * paged rule would silently stop matching (see the toast
 * red-pairing regression that set this precedent). The inline error
 * line stays paged in the shared `.error` look.
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

describe("attachments strip surfaces", () => {
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
