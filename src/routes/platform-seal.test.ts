import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Platform seal: `androidUI` (and therefore `data-android`) means any
 * phone — iOS included — while `iosUI` / `data-ios` is iOS-only. Every
 * Android change scoped to the former also ships to iOS, so the iOS
 * divergences below must stay on the iOS gate: moving any of them to
 * the phone gate (or deleting its override) breaks iOS with no test
 * failure anywhere else. These assert on source like
 * actions-reveal.test.ts does, for the same reason — the behavior they
 * guard (which OS a rule reaches) is invisible to jsdom.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

function bodySource(): string {
	return readFileSync(
		new URL("../lib/components/MessageBody.svelte", import.meta.url),
		"utf8"
	);
}

/** Shortcuts dialog moved to ShortcutsModal.svelte with its markup. */
function shortcutsSource(): string {
	return readFileSync(
		new URL("../lib/components/ShortcutsModal.svelte", import.meta.url),
		"utf8"
	);
}

function appHtml(): string {
	return readFileSync(new URL("../app.html", import.meta.url), "utf8");
}

function annotationsSource(): string {
	return readFileSync(
		new URL("../lib/annotations.ts", import.meta.url),
		"utf8"
	);
}

function selMenuSource(): string {
	return readFileSync(
		new URL("../lib/components/SelMenu.svelte", import.meta.url),
		"utf8"
	);
}

/** Composer card moved to Composer.svelte with its markup. */
function composerSource(): string {
	return readFileSync(
		new URL("../lib/components/Composer.svelte", import.meta.url),
		"utf8"
	);
}

describe("platform seal", () => {
	it("defines androidUI as any phone, so data-android means phone", () => {
		const source = pageSource();
		expect(source).toContain(
			"androidUI =\n\t\t\t\tisAndroidUserAgent(navigator.userAgent) ||\n\t\t\t\tisIOSUserAgent(navigator.userAgent)"
		);
		expect(source).toContain("data-android={androidUI || null}");
	});

	it("keeps the Annotate dock on phones (floating menu desktop-only)", () => {
		// The composer dock stays phone-gated (Annotate on iOS, Speak
		// and Inspect on Android); the floating menu is one shell with
		// the platform split inside but never on iOS, where Apple's
		// callout owns the text slot: the Android branch carries
		// Annotate/Copy in the desktop popup's style, desktop keeps
		// Annotate alone.
		// The phone dock gates moved with the composer (prop form);
		// the floating menu gate stays paged.
		expect(composerSource()).toContain("{#if android && hasSelMenu && !preview}");
		expect(pageSource()).toContain("{#if selMenu && !previewing && !iosUI}");
		// The floating menu's platform branches render from
		// `SelMenu.svelte` now; the seal follows the markers.
		const menu = selMenuSource();
		expect(menu).toContain("Phone selection menu: Annotate then Copy");
		expect(menu).toContain("Desktop: Annotate floats above the highlight");
	});

	it("keeps the iOS selection-menu slot split from Android's", () => {
		// The slot math lives in annotations.ts since selMenuPlacement
		// moved there (unit-tested); the seal follows it so the split
		// can't silently merge into the phone gate.
		const source = annotationsSource();
		expect(source).toContain("if (androidUI && !iosUI) {");
		expect(source).toContain("} else if (iosUI) {");
	});

	it("holds the phone dock past its timer while a highlight is live", () => {
		// The rearm decision lives in selSlices.selMenuIdleDecision
		// (unit-tested); the seal follows the timer wiring so the
		// live-highlight hold can't silently drop.
		const source = pageSource();
		expect(source).toContain("selMenuIdleDecision({");
		expect(source).toContain('android: androidUI,');
		expect(source).toContain('(window.getSelection()?.toString() ?? "") !== ""');
	});

	it("keeps the iOS furigana nudge on its own override", () => {
		const css = bodySource();
		expect(css).toContain(":global(.app[data-ios]) .rendered :global(.frt)");
	});

	it("keeps the iOS pinyin fit on its own override", () => {
		const css = bodySource();
		expect(css).toContain(":global(.app[data-ios]) .rendered :global(rt)");
	});
});

describe("android seal", () => {
	it("keeps resizes-content on the viewport meta (keyboard glides, no pan)", () => {
		expect(appHtml()).toContain("interactive-widget=resizes-content");
	});

	it("keeps the Android furigana nudge off the iOS gate", () => {
		const css = bodySource();
		expect(css).toContain(
			":global(.app[data-android]:not([data-ios])) .rendered :global(.frt)"
		);
	});

	it("yields the waypoint slot to the selection dock on phones", () => {
		// The jump trigger moved with the composer (prop form).
		expect(composerSource()).toContain(
			"{#if android && waypointCount > 3 && !hasSelMenu}"
		);
	});
});

describe("desktop seal", () => {
	it("keeps the textarea composer for every UA (no CodeMirror branch)", () => {
		const source = pageSource();
		expect(source).toContain(
			"editor = createTextareaEditor(promptEl, promptOptions());"
		);
		expect(source).not.toContain("createPromptEditor(");
		expect(source).not.toContain("cm-content");
	});
	it("routes provider cycling through the gating contract", () => {
		const source = pageSource();
		const body =
			source.match(/function cycleProvider[\s\S]*?\n\t\}/)?.[0] ?? "";
		expect(body).toContain("visibleProviderIds(");
	});

	it("keeps desktop autofocus (phones never pop the keyboard on launch)", () => {
		const source = pageSource();
		// Always-hide mode also skips the mount steal: the prompt is
		// visible exactly while the composer holds focus.
		expect(source).toContain(
			"if (!androidUI && settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) {"
		);
		expect(source).toContain("editor?.focus();");
	});

	it("keeps the keyboard-shortcuts heading for desktop", () => {
		// Phones get the gestures title; desktop keeps the h2 (which
		// names the dialog for assistive tech via labelledby).
		const source = shortcutsSource();
		expect(source).toContain('{#if !android}<h2 id="shortcuts-heading">');
		expect(source).toContain("Keyboard shortcuts");
		expect(source).toContain(
			'label={android ? "Touch gestures" : "Keyboard shortcuts"}'
		);
		// The page still feeds the dialog the live phone flag.
		expect(pageSource()).toContain("<ShortcutsModal");
		expect(pageSource()).toContain("android={androidUI}");
	});

	it("keeps selection auto-speak desktop-only (phones need the tap)", () => {
		const source = pageSource();
		expect(source).toContain("!androidUI && settings.autoSpeakSelection");
	});

	it("keeps the badge click delegating to the toggle (desktop re-press closes)", () => {
		const source = pageSource();
		expect(source).toContain("function openBadgeClick(");
		expect(source).toContain("openBadge(id, anchor);");
	});
});
