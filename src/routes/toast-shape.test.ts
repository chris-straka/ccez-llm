import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Toast shape invariants.
 *
 * Asserted on source because the behavior they guard — the pill-to-card
 * radius switch past TOAST_LONG_CHARS — is invisible to jsdom (no
 * layout, no wrapping). A long toast that keeps the 999px stadium
 * radius reads broken on phones, so copy over the threshold rides the
 * same 12px card radius as the app's other surfaces. Markup, gating,
 * and surfaces all moved together into `Toasts.svelte` (Svelte scoping
 * binds the rules to the buttons).
 */
function toastsStyle(): string {
	const match = toastsSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Toasts.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function toastsSource(): string {
	return readFileSync(
		new URL("../lib/components/Toasts.svelte", import.meta.url),
		"utf8"
	);
}

describe("long toasts", () => {
	it("wraps long copy into a card radius, not the pill", () => {
		const css = toastsStyle();
		expect(css).toContain(".toast.long");
		expect(css).toMatch(/\.toast\.long\s*\{\s*border-radius:\s*12px/);
	});

	it("gates the class on the toastLong helper, both slots", () => {
		const source = toastsSource();
		expect(source).toContain("toastLong(notices.toast.message)");
		expect(source).toContain("toastLong(notices.errorToast.message)");
	});
});
