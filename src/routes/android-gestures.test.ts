import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Android gesture wiring guards (source-pinned, like
 * actions-reveal): filing and double-tap must never move the
 * thread, and answer-card selections must reach the native OS
 * menu bridge.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

/** Badge open moved to annotate-mode.svelte.ts (STAGE 1). */
function annotateModeSource(): string {
	return readFileSync(
		new URL("../lib/annotate-mode.svelte.ts", import.meta.url),
		"utf8"
	);
}

describe("android gesture wiring", () => {
	it("never scrolls to the action row on double-tap", () => {
		// The menu owns the whole gesture; dragging the view down
		// to the buttons disoriented phone readers.
		expect(pageSource()).not.toContain("scrollActionsIntoView");
	});

	it("never scrolls when filing an annotation", () => {
		// The view stays where the reader put it; hoisting the
		// quote above the keyboard yanked long threads.
		expect(pageSource()).not.toContain("scrollQuoteIntoEditView");
	});

	it("reports answer-card selections to the native OS menu", () => {
		// Without the card root, the Activity shows its empty dummy
		// menu instead of Copy / Cut / Paste on card text.
		expect(pageSource()).toMatch(
			/reportOsMenu\(\s*\[promptEl,\s*settingsEl,\s*document\.querySelector\("\.ann-answer"\)\]/
		);
	});

	it("toasts Loading — nothing else — on a blue badge tap", () => {
		// The answer is still on the wire: no card opens, and the
		// review dock must not open either (it used to strand the
		// tap there).
		expect(annotateModeSource()).toMatch(
			/if \(this\.deps\.isPhone\(\) && !this\.deps\.isIOS\(\) && current && !current\.answer\) \{\s+this\.deps\.toast\("Loading"\);\s+return;\s+\}/
		);
	});

	it("deletes any filed badge after a still 2s hold", () => {
		const source = pageSource();
		// Every filed badge holds to delete, blue or orange — the
		// rule lives in canHoldDeleteBadge, checked both at arm
		// time and at fire time.
		expect(
			source.match(
				/if \(!canHoldDeleteBadge\(drafts\.list\.find\(\(a\) => a\.id === id\)\)\)/g
			)?.length
		).toBe(2);
		expect(source).toMatch(
			/badgeHoldTimer = setTimeout\(\(\) => \{[\s\S]*?annotateMode\.removeAnnotation\(id\);[\s\S]*?\}, 2000\);/
		);
		// The trailing compatibility press can't reopen the gone badge.
		expect(source).toContain("badgeHoldFired !== null");
	});

	it("never summons a sidebar off the news chip rail", () => {
		// The region flags scroll horizontally: a sideways stroke
		// there scrolls the rail, never the drawers (same ownership
		// as the action row and code blocks).
		const source = pageSource();
		expect(source).toContain("const chipSwipe = isNewsChipsTarget(target);");
		expect(source).toMatch(
			/start\.rowSwipe \|\| start\.codeSwipe \|\| start\.chipSwipe\s+\? null/
		);
	});

	it("ticks haptics on the annotate-button hold", () => {
		// The instant (hold/right-click) path skips annotate()'s
		// own phone tick, so the page action ticks the hold that
		// filed — otherwise the hold felt like nothing happened.
		expect(pageSource()).toMatch(
			/annotateInstant: \(\) => \{[\s\S]*?buzzTap\(\);[\s\S]*?annotateMode\.annotate\("", true\);/
		);
	});

	it("zones news taps outside empty (no focus, no switcher)", () => {
		// Story taps delegate to flickZoneOfTarget (pinned in
		// events.test.ts): tap focuses nothing, hold selects for
		// the annotate menu instead of the quick switcher.
		expect(pageSource()).toMatch(
			/return flickZoneOfTarget\(\s+target,\s+\(el\) => annotateMode\.articleOf\(el\) !== null\s+\);/
		);
	});

	it("resolves CJK double-taps through the point-anchored range first", () => {
		// Aid readings split the DOM: the caret can land on a reading
		// instead of the base char (no selection, no handles). The
		// span engine stays as the fallback.
		const source = pageSource();
		const run = source.slice(source.indexOf("if (msgTapSeq.count === 2) {"));
		expect(run).toMatch(
			/const cjk = cjkWordRangeAtPoint\(\s*ended\.clientX,\s*ended\.clientY\s*\);/
		);
		expect(run).toContain("pick?.addRange(cjk);");
	});
});
