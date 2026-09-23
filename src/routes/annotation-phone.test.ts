import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone annotation invariants (Android/iOS share the phone UI).
 *
 * Layout and gesture facts jsdom cannot see, so these assert on
 * +page.svelte source like the other route style tests:
 * - marker taps must survive the tap-out rule (the capture-phase
 *   press opens the dock before the bubble-phase tap-out check runs,
 *   so badges need an explicit carve-out or every tap opens and
 *   cancels its dock in the same gesture);
 * - the pending create (composer owns the screen) must wash its quote;
 * - assistant messages shrink-wrap below the full-bleed text size.
 * Filed notes never transplant on phones: badge taps open the dock
 * on the row, and pinned questions bake into the send (pin-only —
 * no staged pill anywhere).
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
	it("opens the dock on the tapped row, never a transplant", () => {
		// Marker taps file nothing into the composer: with no answer
		// yet the badge opens the review dock on the row (the badge's
		// own re-press toggles shut instead), and no filed-note
		// transplant — nor any staged pill — exists anymore.
		const source = pageSource();
		expect(source).not.toContain("editAnnotationInPrompt({ id }");
		expect(source).not.toContain("stagedAnnId");
		expect(source).toContain("function openBadge(");
		expect(source).toContain("reviewOpen = true;");
	});
});

describe("phone creates wash their quote", () => {
	it("feeds the in-prompt create into the wash id", () => {
		// The wash feeds the row through the article now: the page
		// computes it per message, the article forwards it. Filed
		// notes never wash (no transplant, no dock edit).
		expect(pageSource()).toMatch(/promptAnnWashId\(\) \?\?\s+hoverBadgeId/);
		expect(articleSource()).toContain("washId={washId ?? null}");
	});
	it("washes the pending filing", () => {
		// The branches live in annotations.promptAnnWashIdFor
		// (unit-tested); the seal follows the wiring so the pending
		// filing can't silently drop its wash.
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
