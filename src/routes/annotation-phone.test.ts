import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone annotation-edit invariants (Android/iOS share the phone UI).
 *
 * Layout and gesture facts jsdom cannot see, so these assert on
 * +page.svelte source like the other route style tests:
 * - marker taps must survive the tap-out rule (the capture-phase
 *   press opens the edit before the bubble-phase tap-out check runs,
 *   so badges need an explicit carve-out or every tap opens and
 *   cancels its edit in the same gesture);
 * - in-prompt edits (composer owns the screen) must wash their quote;
 * - assistant messages shrink-wrap below the full-bleed text size.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("phone marker taps survive tap-out", () => {
	it("exempts badges in the mousedown tap-out rule", () => {
		const source = pageSource();
		const rule = source.match(
			/window\.addEventListener\("mousedown", \(event\) => \{\s*\/\/ Badge presses never tap out[\s\S]*?\n\t\t\}\);/
		);
		expect(rule, "mousedown tap-out rule is gone or reshaped — keep the badge carve-out with it").toBeTruthy();
		expect(rule![0]).toContain('[data-ann-badge]');
	});
	it("exempts badges in the touchstart tap-out rule", () => {
		const source = pageSource();
		expect(source).toContain("Badges never tap out either (see the mousedown twin)");
	});
	it("starts marker-tap edits with an empty composer", () => {
		// Review-pencil edits keep loading the saved comment; marker
		// taps rewrite from empty (the wash shows what is rewritten).
		const source = pageSource();
		expect(source).toContain('editAnnotationInPrompt({ id }, "");');
	});
});

describe("phone edits wash their quote", () => {
	it("feeds the in-prompt edit into the wash id", () => {
		expect(pageSource()).toContain("promptAnnWashId() ?? editingId");
	});
	it("washes pending filings and saved notes alike", () => {
		const source = pageSource();
		const fn = source.match(/function promptAnnWashId\(\): string \| null \{([\s\S]*?)\n\t\}/);
		expect(fn, "promptAnnWashId is gone or reshaped — keep both branches with it").toBeTruthy();
		expect(fn![1]).toContain("pendingAnn");
		expect(fn![1]).toContain("promptAnnEdit.id");
	});
});

describe("phone assistant width", () => {
	it("marks the full-bleed text size on the app root", () => {
		expect(pageSource()).toContain("data-fullbleed={androidUI && settings.fontScale >= FULLBLEED_FONT_SCALE");
	});
	it("shrink-wraps assistant messages below full-bleed", () => {
		const css = pageStyle();
		const rule = css.match(
			/\.app\[data-android\]:not\(\[data-fullbleed\]\) article\.assistant\s*\{([^}]*)\}/
		);
		expect(rule, "assistant shrink-wrap rule is gone or reshaped").toBeTruthy();
		expect(rule![1]).toMatch(/width\s*:\s*fit-content/);
	});
});
