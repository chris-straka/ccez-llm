import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The character Inspect overlay renders from `InspectOverlay.svelte`
 * through the shared `Modal.svelte` shell, not the page. The page owns
 * the open character, the stroke vectors, the step, and the locale
 * default; the component owns the overlay markup, the stepper, the
 * locale toggle, and their surfaces. Svelte scoping binds CSS to the
 * component that renders it, so the `.inspect-*` rules moved with the
 * markup — a paged rule would silently stop matching (see the toast
 * red-pairing regression that set this precedent). The box seating
 * (`.inspect-modal`) lives in `Modal.svelte` with the other dialog
 * chrome.
 */
function inspectSource(): string {
	return readFileSync(
		new URL("./InspectOverlay.svelte", import.meta.url),
		"utf8"
	);
}

function pageSource(): string {
	return readFileSync(
		new URL("../../routes/+page.svelte", import.meta.url),
		"utf8"
	);
}

function inspectStyle(): string {
	const match = inspectSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("InspectOverlay.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("inspect overlay extraction", () => {
	it("renders the overlay from the component, not the page", () => {
		expect(inspectSource()).toContain('id="inspect-heading"');
		expect(inspectSource()).toContain('class="inspect-stepper"');
		expect(inspectSource()).toContain('class="inspect-decomp"');
		expect(inspectSource()).toContain('aria-label="Close character inspect"');
		// The box variant rides the shared shell as a class prop (the
		// box renders in Modal.svelte — a missing pass silently drops
		// the narrow seating).
		expect(inspectSource()).toContain('cardClass="inspect-modal"');
		expect(pageSource()).toContain("<InspectOverlay");
		expect(pageSource()).not.toContain('id="inspect-heading"');
		expect(pageSource()).not.toContain('class="inspect-stepper"');
		expect(pageSource()).not.toContain('class="inspect-decomp"');
		// The page keeps the open character, vectors, step, default.
		expect(pageSource()).toContain("let inspectChar");
		expect(pageSource()).toContain("function strokeStep");
	});

	it("keeps the overlay surfaces scoped to the components", () => {
		const css = inspectStyle();
		expect(css).toContain(".inspect-body");
		expect(css).toContain(".inspect-svg path.painted");
		expect(css).toContain(".inspect-stepper button:disabled");
		expect(css).toContain(".inspect-decomp-group");
		const modal = readFileSync(
			new URL("./Modal.svelte", import.meta.url),
			"utf8"
		);
		expect(modal).toContain(".inspect-modal");
		expect(pageStyle()).not.toContain(".inspect-body");
		expect(pageStyle()).not.toContain(".inspect-stepper");
		expect(pageStyle()).not.toContain(".inspect-decomp");
	});
});
