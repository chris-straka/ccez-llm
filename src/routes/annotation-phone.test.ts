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

/** Article row moved to MessageArticle.svelte with its styles. */
function articleSource(): string {
	return readFileSync(
		new URL("../lib/components/MessageArticle.svelte", import.meta.url),
		"utf8"
	);
}

function articleStyle(): string {
	const match = articleSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageArticle.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("phone marker taps survive tap-out", () => {
	it("exempts badges in the mousedown tap-out rule", () => {
		const source = pageSource();
		const rule = source.match(
			/window\.addEventListener\("mousedown", \(event\) => \{\s*\/\/ Badge presses never tap out[\s\S]*?\n\t\t\}\);/
		);
		expect(
			rule,
			"mousedown tap-out rule is gone or reshaped — keep the badge carve-out with it"
		).toBeTruthy();
		expect(rule![0]).toContain("[data-ann-badge]");
	});
	it("exempts badges in the touchstart tap-out rule", () => {
		const source = pageSource();
		expect(source).toContain(
			"Badges never tap out either (see the mousedown twin)"
		);
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
		// The wash feeds the row through the article now: the page
		// computes it per message, the article forwards it.
		expect(pageSource()).toMatch(/promptAnnWashId\(\) \?\?\s+editingId \?\?/);
		expect(articleSource()).toContain("washId={washId ?? null}");
	});
	it("washes pending filings and saved notes alike", () => {
		// The branches live in annotations.promptAnnWashIdFor
		// (unit-tested); the seal follows the wiring so neither the
		// pending filing nor the saved note can silently drop.
		expect(pageSource()).toContain(
			"promptAnnWashIdFor(promptAnnEdit, pendingAnn?.id ?? null)"
		);
	});
});

describe("phone assistant width", () => {
	it("marks the full-bleed text size on the app root", () => {
		expect(pageSource()).toContain(
			"data-fullbleed={(androidUI && settings.fontScale >= FULLBLEED_FONT_SCALE) ||\n\t\tnull}"
		);
	});
	it("shrink-wraps assistant messages below full-bleed", () => {
		// The row rules moved with the article (paged app ancestor
		// renders global there).
		const css = articleStyle();
		const rule = css.match(
			/:global\(\.app\[data-android\]\):not\(\[data-fullbleed\]\) article\.assistant\s*\{([^}]*)\}/
		);
		expect(rule, "assistant shrink-wrap rule is gone or reshaped").toBeTruthy();
		expect(rule![1]).toMatch(/width\s*:\s*fit-content/);
	});
});
