import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Toast shape invariants.
 *
 * Asserted on +page.svelte source because the behavior they guard —
 * the pill-to-card radius switch past TOAST_LONG_CHARS — is
 * invisible to jsdom (no layout, no wrapping). A long toast that
 * keeps the 999px stadium radius reads broken on phones, so copy
 * over the threshold rides the same 12px card radius as the app's
 * other surfaces.
 */
function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("long toasts", () => {
	it("wraps long copy into a card radius, not the pill", () => {
		const css = pageStyle();
		expect(css).toContain(".toast.long");
		expect(css).toMatch(/\.toast\.long\s*\{\s*border-radius:\s*12px/);
	});

	it("gates the class on the toastLong helper, both slots", () => {
		const source = pageSource();
		expect(source).toContain("toastLong(notices.toast.message)");
		expect(source).toContain("toastLong(notices.errorToast.message)");
	});
});
