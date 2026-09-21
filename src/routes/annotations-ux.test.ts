import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Annotation-UX invariants that jsdom cannot see (no layout, no layers,
 * no hover engine), asserted on source instead.
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

function messageBodyStyle(): string {
	const source = readFileSync(
		new URL("../lib/components/MessageBody.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageBody.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Popover (AnnPop) and review dock (ReviewDock) renders moved out of
 * +page.svelte with their markup and styles; the assertions below
 * follow them (same contracts, new homes).
 */
function annPopSource(): string {
	return readFileSync(
		new URL("../lib/components/AnnPop.svelte", import.meta.url),
		"utf8"
	);
}

function componentStyle(source: string, name: string): string {
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error(`${name} has no <style> block`);
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function reviewDockSource(): string {
	return readFileSync(
		new URL("../lib/components/ReviewDock.svelte", import.meta.url),
		"utf8"
	);
}

function sentRefsSource(): string {
	return readFileSync(
		new URL("../lib/components/SentRefs.svelte", import.meta.url),
		"utf8"
	);
}

describe("annotation badge font-size tracking", () => {
	it("scales numbered badges with the message font size", () => {
		// Dampened tracking (never compounding rem): the badge rule must
		// read the message scale instead of pinning an absolute size.
		const css = messageBodyStyle();
		expect(css).toContain("button.ccez-ann-badge");
		expect(css).toContain("var(--font-scale, 1)");
	});
});

describe("annotation badge RTL mirror", () => {
	it("mirrors badge geometry and tail for RTL quotes", () => {
		const css = messageBodyStyle();
		expect(css).toContain("button.ccez-ann-badge.rtl");
		expect(css).toContain("right: 100%");
		expect(css).toContain("polygon(62% 0, 0 0, 100% 100%)");
	});
});

describe("annotation edit Save animation", () => {
	it("animates the popover Save symmetrically on hover in/out", () => {
		const css = componentStyle(annPopSource(), "AnnPop.svelte");
		// Symmetric means the transition lives on the base rule, not
		// :hover (a hover-only transition snaps back on leave).
		expect(css).toMatch(/\.ann-save\s*\{[^}]*transition:/);
		expect(css).toContain(".ann-save:hover");
	});

	it("animates the review edit buttons symmetrically on hover in/out", () => {
		const css = componentStyle(reviewDockSource(), "ReviewDock.svelte");
		expect(css).toMatch(/\.review-edit-actions button\s*\{[^}]*transition:/);
	});

	it("keeps the review edit textarea readable in dark mode", () => {
		const source = reviewDockSource();
		// The field surface is near-black; the edit box must override it.
		expect(source).toContain(':global(html[data-theme="dark"]) .review textarea');
		expect(source).toMatch(
			/\.review textarea\s*\{[^}]*background:\s*#3a3a3c/
		);
	});
});

describe("annotation create wiring", () => {
	it("snaps the create marker to word edges before the menu reads it", () => {
		const source = pageSource();
		expect(source).toContain("snapSelectionToWordEdges(live)");
	});

	it("centers narrow create boxes, keeps cursor placement for wide ones", () => {
		const source = pageSource();
		expect(source).toContain("placeAnnPopX({");
	});

	it("ends the phone create pill with a Save button", () => {
		const source = annPopSource();
		// The fresh pill is textarea + mic only on desktop (Enter
		// files); phones get an explicit submit at the end because
		// the software enter key is unreliable for filing.
		const fresh = source.match(/#if pop\.fresh\}[\s\S]*?\{:else\}/);
		expect(fresh?.[0]).toBeDefined();
		expect(fresh?.[0]).toContain("{#if android}");
		expect(fresh?.[0]).toContain("ann-pill-save");
		expect(fresh?.[0]).toContain("actions.save");
		// The page still wires that action to the real save path.
		expect(pageSource()).toContain("save: saveAnnPop");
	});
});

describe("annotations-only messages", () => {
	it("renders an em-dash body with the annotation UI above it", () => {
		const source = pageSource();
		expect(source).toContain("REFS_ONLY_BODY");
	});
});

describe("review pencil hover", () => {
	it("signals with color only — no background, glow, or underline", () => {
		const css = componentStyle(reviewDockSource(), "ReviewDock.svelte");
		expect(css).toMatch(/button\.review-pencil\s*\{[^}]*transition:/);
		const hover =
			css.match(/button\.review-pencil:hover\s*\{[^}]*\}/)?.[0] ?? "";
		expect(hover).toContain("color:");
		expect(hover).not.toContain("background");
		expect(hover).not.toContain("drop-shadow");
		expect(hover).not.toContain("filter");
		expect(css).toMatch(
			/button\.review-copy:hover\s*\{[^}]*text-decoration:\s*none/
		);
	});
});

describe("review delete button", () => {
	it("is a centered close icon going Clear-all red, never underlined", () => {
		const source = reviewDockSource();
		expect(source).toContain('class="review-del"');
		expect(source).toContain('kind="close"');
		const css = componentStyle(source, "ReviewDock.svelte");
		expect(css).toMatch(/button\.review-del\s*\{[^}]*align-self:\s*center/);
		const hover = css.match(/button\.review-del:hover\s*\{[^}]*\}/)?.[0] ?? "";
		expect(hover).toContain("var(--danger)");
		expect(hover).toMatch(/text-decoration:\s*none/);
	});
});

describe("review quote clipping and link contract", () => {
	it("lets the quote button shrink so long quotes clip, and links it on hover", () => {
		// The dock quote moved to ReviewDock; the refs quote to
		// SentRefs (message-anchored popover card).
		const dockCss = componentStyle(reviewDockSource(), "ReviewDock.svelte");
		const css = componentStyle(sentRefsSource(), "SentRefs.svelte");
		// flex-shrink re-opts out of the generic head-button pin —
		// without it the quote stretched the card instead of clipping.
		expect(dockCss).toMatch(/button\.review-quote\s*\{[^}]*flex-shrink:\s*1/);
		expect(dockCss).toMatch(
			/button\.review-quote:hover\s*\{[^}]*text-decoration:\s*underline/
		);
		expect(css).toMatch(
			/\.ann-refs-quote:hover\s*\{[^}]*text-decoration:\s*underline/
		);
	});

	it("fades quote underlines instead of snapping them", () => {
		const dockCss = componentStyle(reviewDockSource(), "ReviewDock.svelte");
		const css = componentStyle(sentRefsSource(), "SentRefs.svelte");
		// The line is always drawn but transparent at rest: color (not
		// the line) ramps on hover, on both cards.
		for (const [sel, src] of [
			["button\\.review-quote", dockCss],
			["\\.ann-refs-quote", css]
		] as const) {
			expect(src).toMatch(
				new RegExp(`${sel}\\s*\\{[^}]*text-decoration-color:\\s*transparent`)
			);
			expect(src).toMatch(
				new RegExp(
					`${sel}:hover\\s*\\{[^}]*text-decoration-color:\\s*currentcolor`
				)
			);
		}
	});

	it("lights all three icons on the same color beat", () => {
		const css = componentStyle(reviewDockSource(), "ReviewDock.svelte");
		for (const sel of [
			"button\\.review-copy",
			"button\\.review-del",
			"button\\.review-pencil"
		]) {
			expect(css).toMatch(new RegExp(`${sel}\\s*\\{[^}]*transition:\\s*color`));
		}
	});
});

describe("sent-message annotation count", () => {
	it("scales the refs count with the message font size", () => {
		const css = componentStyle(sentRefsSource(), "SentRefs.svelte");
		expect(css).toMatch(/\.ann-refs-pill\s*\{[^}]*var\(--font-scale, 1\)/);
	});
});

describe("off-chat drag clamp", () => {
	it("trims selections whose press started off-chat on every change", () => {
		const source = pageSource();
		expect(source).toContain("clampOffChatDrag()");
		expect(source).toContain("clampDragAnchorToFocusLine");
		expect(source).toContain("offChatDragArmed = false");
	});
});
