import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Composer card renders in Composer.svelte; the page keeps the editor
 * instance, all composer state, and every behavior. Element refs the
 * page drives (editor mount node, send-button geometry) cross as
 * $bindable, like Sidebar's search/searchEl. The file input lives
 * with the card (the page never touches it); the inline attach error
 * stays paged in the shared `.error` look.
 */
function componentSource(): string {
	return readFileSync(new URL("./Composer.svelte", import.meta.url), "utf8");
}

function componentStyle(): string {
	const source = componentSource();
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("Composer.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

function reviewDockStyle(): string {
	const source = readFileSync(
		new URL("./ReviewDock.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("ReviewDock.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("composer contract", () => {
	it("owns the card, tools, send, and banner from page-owned props", () => {
		const source = componentSource();
		expect(source).toContain("export interface ComposerActions");
		expect(source).toContain('class="prompt"');
		expect(source).toContain('class="prompt-tools"');
		expect(source).toContain('class="send-btn"');
		expect(source).toContain('class="attach-btn"');
		expect(source).toContain('class="mic-btn"');
		expect(source).toContain('class="voice-float"');
		expect(source).toContain('class="capture-btn"');
		expect(source).toContain('class="capture-menu"');
		expect(source).toContain("CaptureMenuState");
		// Three static actions, no window list: the OS picker runs
		// after the pick.
		expect(source).toContain('captureAction({ kind: "fullscreen" })');
		expect(source).toContain(
			'captureAction({ kind: "interactive", mode: "window" })'
		);
		expect(source).toContain(
			'captureAction({ kind: "interactive", mode: "area" })'
		);
		expect(source).not.toContain("menuitemradio");
		expect(source).not.toContain("capturePick");
		expect(source).toContain('class="wp-jump"');
		expect(source).toContain('class="error-banner"');
		expect(source).toContain('class="hidden-input"');
		expect(source).toContain("<ReviewDock");
		// The dock lists double-click-pinned rows, plus the open
		// row while the review sits open (a badge tap opens its
		// row before it is pinned).
		expect(source).toContain("items={dockItems}");
		expect(source).toContain("a.pinnedToPrompt === true");
		// Gates ride props, not page state.
		expect(source).toContain("class:prompt-idle={parked}");
		expect(source).toContain("disabled={!canSubmit && !hasAnnEdit}");
		expect(source).toContain("{#if banner && !android}");
		expect(source).toContain("{#if canMic && micEnabled}");
	});

	it("binds the editor mount and send geometry nodes", () => {
		const source = componentSource();
		expect(source).toContain("promptEl = $bindable()");
		expect(source).toContain("sendBtnEl = $bindable(null)");
		expect(source).toContain("bind:this={promptEl}");
		expect(source).toContain("bind:this={sendBtnEl}");
	});

	it("keeps the editor instance and every behavior paged", () => {
		const page = pageSource();
		expect(page).toContain("<Composer");
		expect(page).toContain("bind:promptEl");
		expect(page).toContain("bind:sendBtnEl");
		expect(page).toContain("createTextareaEditor(promptEl,");
		expect(page).toContain("function promptParked()");
		expect(page).toContain("intakeFiles:");
		expect(page).toContain("holdStart:");
		// The inline error stays paged in the shared error look.
		expect(page).toContain('class="error attach-error"');
	});

	it("keeps no composer selector in page style", () => {
		const css = pageStyle();
		for (const selector of [
			".prompt",
			".send-btn",
			".prompt-tools",
			".ann-dock",
			"hidden-input",
			"wp-jump",
			"attach-btn",
			"mic-btn",
			"voice-float",
			"send-hold"
		]) {
			expect(css, selector).not.toContain(selector);
		}
		// The missing-key banner stays paged above the strip, so it
		// keeps its own error pairing here (the composer's banner
		// pairing lives with its markup).
		expect(css).toMatch(/\.error-banner\s*\{[^}]*background:\s*var\(--error-bg\)/);
		// The in-place message editor moved with the row: its field
		// rules live in `MessageArticle.svelte` now.
		expect(css).not.toContain(".msg-edit-box");
	});

	it("keeps the composer surfaces scoped to the card", () => {
		const css = componentStyle();
		expect(css).toContain(":global(.app[data-android]) .prompt");
		expect(css).toContain(".send-btn");
		expect(css).toContain(".prompt-tools");
		expect(css).toContain(".error-banner");
	});

	it("keeps the field rhythm tight and its scrollbar off the buttons", () => {
		const css = componentStyle();
		// The native caret fills the line box: message rhythm (1.5)
		// would tower over the glyphs, so the field and its
		// placeholder share a closer box.
		const fields = [
			...css.matchAll(/\.prompt\s*:global\(\.ta-input\)\s*\{([^}]*)\}/g)
		].map((match) => match[1] ?? "");
		// Several platform rules share the selector: the main field
		// rule is the one owning the height.
		const field = fields.find((body) => body.includes("field-sizing"));
		expect(field, ".prompt .ta-input rule is gone").toBeTruthy();
		expect(field).toMatch(/line-height:\s*1\.4/);
		const placeholder = css.match(
			/\.prompt\s*:global\(\.ta-input::placeholder\)\s*\{([^}]*)\}/
		);
		expect(placeholder, "placeholder rule is gone").toBeTruthy();
		expect(placeholder![1]).toMatch(/line-height:\s*1\.4/);
		// The native bar hugs the card edge under the floating tools:
		// scrolling works, the bar itself never renders.
		expect(field).toMatch(/scrollbar-width:\s*none/);
		expect(css).toContain(".ta-input::-webkit-scrollbar");
	});

	it("keeps pinned annotations out of the prompt text", () => {
		const source = componentSource();
		// Nothing renders inside the prompt itself: no chips, no
		// staged pill — the annotation button's rising count plus
		// its overlay is the whole surface (the send still bakes
		// pins as context invisibly).
		expect(source).not.toContain("inclusion-chip");
		expect(source).not.toContain("jumpPinned");
		expect(source).not.toContain('class="staged-pill"');
		expect(source).not.toContain("stagedDraft");
		const css = componentStyle();
		expect(css).not.toContain(".staged-pill");
		expect(css).not.toContain(".inclusion-chip");
		// The page passes no inclusions and wires no chip jump.
		const page = pageSource();
		expect(page).not.toContain("inclusionsForPrompt");
		expect(page).not.toContain("jumpPinned");
		expect(page).not.toContain("staged={stagedForPrompt()}");
		expect(page).not.toContain("function stageAnnotation");
		expect(page).not.toContain("function closeStagedAnnotation");
	});
});

describe("composer text reservation", () => {
	it("sizes the mic tier to the measured icon cluster", () => {
		const css = componentStyle();
		// attach + mic + voice measure ~4.9rem in-page (capture adds
		// a fourth icon): each tier keeps ~1rem of breathing room,
		// never ~2rem of dead space that wraps text a word early.
		expect(css).toMatch(
			/\.prompt:has\(\.mic-btn\):has\(\.capture-btn\) :global\(\.ta-input\)\s*\{[^}]*--tools-pad:\s*7\.5rem/
		);
		expect(css).toMatch(
			/\.prompt:has\(\.mic-btn\) :global\(\.ta-input\)\s*\{[^}]*--tools-pad:\s*6rem/
		);
	});

	it("keeps the mic-less base tier at its measured size", () => {
		const css = componentStyle();
		expect(css).toMatch(/--tools-pad:\s*4\.2rem/);
	});

	it("reserves room only for buttons that are actually present", () => {
		const css = componentStyle();
		const dock = reviewDockStyle();
		// The mic tier rides the mic button's DOM presence: no mic,
		// no reservation. The dock tiers ride the wrap's presence.
		expect(css).toContain(".prompt:has(.mic-btn)");
		// The four-icon tier needs the capture button too — the
		// preview (no backend, no button) keeps the three-icon tier.
		expect(css).toContain(".prompt:has(.mic-btn):has(.capture-btn)");
		expect(dock).toContain(":global(.prompt:has(.ann-wrap))");
		expect(dock).toContain(":global(.prompt:has(.mic-btn):has(.ann-wrap))");
	});

	it("composes the jump trigger on top instead of restating tiers", () => {
		const css = componentStyle();
		expect(css).toMatch(/\.prompt:has\(\.wp-jump\)\s*\{[^}]*--tools-extra:\s*1\.8rem/);
		expect(css).toContain("calc(var(--tools-pad) + var(--tools-extra))");
	});

	it("opens the capture menu upward from the tools row", () => {
		const css = componentStyle();
		// The composer sits at the viewport bottom: a downward menu
		// clips off-screen, so the menu anchors above the row.
		expect(css).toMatch(/\.capture-menu\s*\{[^}]*bottom:\s*calc\(100%/);
		expect(css).not.toMatch(/\.capture-menu\s*\{[^}]*top:\s*calc\(100%/);
	});
});
