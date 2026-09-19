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

function appHtml(): string {
	return readFileSync(new URL("../app.html", import.meta.url), "utf8");
}

function annotationsSource(): string {
	return readFileSync(
		new URL("../lib/annotations.ts", import.meta.url),
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
		// The composer dock stays phone-gated (Annotate on iOS, Inspect
		// on Android); the floating menu is one shell with the platform
		// split inside but never on iOS, where Apple's callout owns the
		// text slot: the Android branch carries Copy/Annotate/Speak in
		// the desktop popup's style, desktop keeps Annotate alone.
		const source = pageSource();
		expect(source).toContain("{#if androidUI && selMenu && !previewing}");
		expect(source).toContain("{#if selMenu && !previewing && !iosUI}");
		expect(source).toContain("Phone selection menu: the native callout is");
		expect(source).toContain("Desktop: Annotate floats above the highlight");
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
		const source = pageSource();
		expect(source).toContain(
			'if (androidUI && (window.getSelection()?.toString() ?? "") !== "") {'
		);
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
		const source = pageSource();
		expect(source).toContain(
			"{#if androidUI && points.length > 3 && !selMenu}"
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
		const source = pageSource();
		expect(source).toContain(
			'{#if !androidUI}<h2 id="shortcuts-heading">\n\t\t\t\t\t\t\tKeyboard shortcuts\n\t\t\t\t\t\t</h2>{/if}'
		);
		expect(source).toContain(
			'aria-label={androidUI ? "Touch gestures" : undefined}'
		);
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
