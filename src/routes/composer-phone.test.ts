import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Phone-composer overhaul invariants (mobile-only, desktop untouched).
 * Layout behavior is invisible to jsdom, so these assert on source like
 * annotations-ux.test.ts does. Every visual rule must ride the phone
 * gate (`.app[data-android]`); every focus change must keep the desktop
 * path byte-identical.
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

describe("phone composer two bars", () => {
	it("makes the top bar text-only (no tools reservation on phones)", () => {
		const css = pageStyle();
		expect(css).toContain(".app[data-android] .prompt :global(.ta-input)");
		// The tools live in the row below, so the field drops the
		// desktop right-side reservation instead of squeezing text.
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt :global\(\.ta-input\)\s*\{[^}]*--tools-pad:\s*0rem/
		);
	});

	it("caps the field and never inflates it on focus", () => {
		const css = pageStyle();
		const focusRule = css.match(
			/\.app\[data-android\] \.prompt:focus-within :global\(\.ta-input\)\s*\{[^}]*\}/
		);
		// The old focus rule forced two lines on every tap.
		expect(focusRule?.[0]).toBeDefined();
		expect(focusRule?.[0]).not.toContain("3.4rem");
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt:focus-within :global\(\.ta-input\)\s*\{[^}]*min-height:\s*1\.5rem[^}]*max-height:\s*7\.5rem/
		);
	});

	it("keeps the tools row static below the text as its own bar", () => {
		const css = pageStyle();
		expect(css).toMatch(/\.app\[data-android\] \.prompt-tools\s*\{[^}]*position:\s*static/);
	});

	it("draws no divider between the bars", () => {
		const css = pageStyle();
		const toolsRule = css.match(/\.app\[data-android\] \.prompt-tools\s*\{[^}]*\}/);
		expect(toolsRule?.[0]).toBeDefined();
		expect(toolsRule?.[0]).not.toContain("border-top:");
	});

	it("never parks the composer for open drawers", () => {
		const source = pageSource();
		// The chats list and settings are overlays above the card, so
		// hiding it under them only slid the thread: phones park for a
		// real idle timeout alone, desktop keeps drawer parking.
		expect(source).toMatch(/function promptParked\(\): boolean \{[\s\S]*?if \(androidUI\) return promptIdle;/);
	});

	it("grows the reading column with the chat-width setting", () => {
		const source = pageSource();
		// The old pin ignored the slider; phones floor at today's 46
		// so only increases ever show (portrait columns already bleed).
		expect(source).toContain("androidUI ? Math.max(46, settings.chatWidth ?? 36)");
	});

	it("never collapses the tools bar or its buttons while idle", () => {
		const css = pageStyle();
		// Idle single-bar mode is gone: no rule may hide the row or
		// the send button on :not(:focus-within) outside highlight mode.
		for (const match of css.matchAll(
			/\.app\[data-android\][^{]*:not\(:focus-within\)[^{]*\{[^}]*\}/g
		)) {
			expect(match[0]).not.toContain("max-height: 0");
			expect(match[0]).not.toContain("visibility: hidden");
		}
	});
});

describe("phone button parity", () => {
	it("sizes attach, dictation, and voice to the send seat on phones", () => {
		const css = pageStyle();
		expect(css).toContain(".app[data-android] .attach-btn");
		expect(css).toContain(".app[data-android] .mic-btn");
		expect(css).toContain(".app[data-android] .voice-float");
		expect(css).toMatch(
			/\.app\[data-android\] \.voice-float\s*\{[^}]*width:\s*1\.7rem[^}]*height:\s*1\.7rem/
		);
	});
});

describe("phone highlight dock", () => {
	it("overlays both bars at 50/50 without resizing the card", () => {
		const css = pageStyle();
		// Card-sized overlay: the buttons split it evenly, so the
		// card keeps its idle geometry to the pixel.
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt:has\(\.ann-dock\) \.ann-dock-wrap\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*display:\s*flex/
		);
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt:has\(\.ann-dock\) \.ann-dock\s*\{[^}]*flex:\s*1 1 0[^}]*height:\s*100%/
		);
		// The row's overflow cap lifts while docked, or it clips the
		// overlay to a strip.
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt:has\(\.ann-dock\) \.prompt-tools\s*\{[^}]*overflow:\s*visible/
		);
	});

	it("hides every other tool while the dock owns the row", () => {
		const css = pageStyle();
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .attach-btn");
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .mic-btn");
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .voice-float");
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .wp-jump");
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .send-btn");
		expect(css).toContain(".app[data-android] .prompt:has(.ann-dock) .ann-wrap");
	});

	it("stands the hint down while the dock owns the row", () => {
		const css = pageStyle();
		expect(css).toContain(
			".app[data-android] .prompt:has(.ann-dock) :global(.ta-input::placeholder)"
		);
		expect(css).toMatch(
			/ta-input::placeholder\)[\s\S]*?\{[^}]*color:\s*transparent/
		);
	});
});

describe("phone annotation focus stability", () => {
	it("holds the composer's space while the comment box owns the keyboard", () => {
		const css = pageStyle();
		// Unmounting the card collapses the tail clearance and snaps
		// the thread; visibility keeps the footprint with no taps.
		expect(css).toMatch(
			/\.app\[data-android\] \.prompt\.prompt-hidden\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/
		);
		expect(css).not.toMatch(
			/\.app\[data-android\] \.prompt\.prompt-hidden\s*\{[^}]*display:\s*none/
		);
	});

	it("re-pins the scroll behind phone pill focus (create, mount)", () => {
		const source = pageSource();
		// The popover create path and growPill each restore both the
		// window and the chat scroller on the phone path only. The
		// in-prompt edit paths mount no pill, so there is nothing to
		// re-pin behind them.
		const restores = source.match(/box\.scrollTop = st;/g) ?? [];
		expect(restores.length).toBeGreaterThanOrEqual(2);
		expect(source).toContain("if (androidUI) {");
	});

	it("keeps the desktop focus call a single preventScroll focus", () => {
		const source = pageSource();
		expect(source).toContain(
			"} else {\n\t\t\tvoid tick().then(() => annPopBox?.focus({ preventScroll: true }));"
		);
	});
});

describe("phone composer desktop seal", () => {
	it("keeps the desktop send button overlaid and the dock text-sized", () => {
		const css = pageStyle();
		expect(css).toMatch(/\.send-btn\s*\{[^}]*position:\s*absolute/);
		expect(css).toMatch(/\.ann-dock\s*\{[^}]*font-size:\s*0\.85rem/);
	});

	it("keeps the base prompt-hidden rule for the non-phone path", () => {
		const css = pageStyle();
		expect(css).toMatch(/\.prompt\.prompt-hidden\s*\{[^}]*display:\s*none/);
	});
});
