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
	const source = readFileSync(new URL("../lib/components/MessageBody.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageBody.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
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

describe("annotation edit Save animation", () => {
	it("animates the popover Save symmetrically on hover in/out", () => {
		const css = pageStyle();
		// Symmetric means the transition lives on the base rule, not
		// :hover (a hover-only transition snaps back on leave).
		expect(css).toMatch(/\.ann-save\s*\{[^}]*transition:/);
		expect(css).toContain(".ann-save:hover");
	});

	it("animates the review edit buttons symmetrically on hover in/out", () => {
		const css = pageStyle();
		expect(css).toMatch(/\.review-edit-actions button\s*\{[^}]*transition:/);
	});

	it("keeps the review edit textarea readable in dark mode", () => {
		const css = pageSource();
		// The field surface is near-black; the edit box must override it.
		expect(css).toContain('html[data-theme="dark"]');
		expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?\.review textarea\s*\{[^}]*background:\s*#3a3a3c/);
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
		const source = pageSource();
		// The fresh pill is textarea + mic only on desktop (Enter
		// files); phones get an explicit submit at the end because
		// the software enter key is unreliable for filing.
		const fresh = source.match(/#if annPop\.fresh\}[\s\S]*?\{:else\}/);
		expect(fresh?.[0]).toBeDefined();
		expect(fresh?.[0]).toContain("{#if androidUI}");
		expect(fresh?.[0]).toContain("ann-pill-save");
		expect(fresh?.[0]).toContain("saveAnnPop()");
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
		const css = pageStyle();
		expect(css).toMatch(/button\.review-pencil\s*\{[^}]*transition:/);
		const hover = css.match(/button\.review-pencil:hover\s*\{[^}]*\}/)?.[0] ?? "";
		expect(hover).toContain("color:");
		expect(hover).not.toContain("background");
		expect(hover).not.toContain("drop-shadow");
		expect(hover).not.toContain("filter");
		expect(css).toMatch(/button\.review-copy:hover\s*\{[^}]*text-decoration:\s*none/);
	});
});

describe("review delete button", () => {
	it("is a centered close icon going Clear-all red, never underlined", () => {
		const source = pageSource();
		expect(source).toContain('class="review-del"');
		expect(source).toContain('kind="close"');
		const css = pageStyle();
		expect(css).toMatch(/button\.review-del\s*\{[^}]*align-self:\s*center/);
		const hover = css.match(/button\.review-del:hover\s*\{[^}]*\}/)?.[0] ?? "";
		expect(hover).toContain("#ff453a");
		expect(hover).toMatch(/text-decoration:\s*none/);
	});
});

describe("sent-message annotation count", () => {
	it("scales the refs count with the message font size", () => {
		const css = pageStyle();
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
