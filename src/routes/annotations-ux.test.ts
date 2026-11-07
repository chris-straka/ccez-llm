import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/** Badge/wash paint lives global in app.css (chat + headlines share
every rule), so badge assertions read it, not the component. */
function appCss(): string {
	const source = readFileSync(new URL("../app.css", import.meta.url), "utf8");
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
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
		const css = appCss();
		const badge = [
			...css.matchAll(/([^{}]*button\.ccez-ann-badge[^{}]*)\{([^{}]*)\}/g)
		].find((rule) => !/ans-|rtl|fresh|arrived|::after/.test(rule[1]!));
		expect(badge?.[2]).toContain("var(--font-scale, 1)");
	});
});

describe("annotation badge RTL mirror", () => {
	it("mirrors badge geometry and tail for RTL quotes", () => {
		const css = appCss();
		expect(css).toContain("button.ccez-ann-badge.rtl");
		expect(css).toContain("right: 100%");
		expect(css).toContain("polygon(62% 0, 0 0, 100% 100%)");
	});
});

describe("headline badge twins", () => {
	it("paints stamped headline marks exactly like message marks", () => {
		// Every badge/wash rule in app.css covers both scopes in one
		// rule sharing its declarations: one look, two selectors.
		const css = appCss();
		const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
		for (const inner of [
			".ccez-ann-anchor",
			"button.ccez-ann-badge",
			"button.ccez-ann-badge.ans-waiting",
			"button.ccez-ann-badge.ans-ready",
			"button.ccez-ann-badge::after",
			"button.ccez-ann-badge.rtl",
			"button.ccez-ann-badge.rtl::after",
			"button.ccez-ann-badge.fresh",
			"button.ccez-ann-badge.ans-waiting.fresh",
			"button.ccez-ann-badge.ans-ready.arrived",
			"mark.ccez-ann",
			"mark.ccez-ann.fresh",
			"mark.ccez-ann.leaving",
			"mark.ccez-ann-flash",
			"mark.ccez-ann-flash.fading"
		]) {
			const shared = rules.some((rule) => {
				const sels = rule[1]!.split(",").map((s) => s.trim());
				return (
					sels.includes(`.rendered ${inner}`) &&
					sels.includes(`.news-card-title ${inner}`)
				);
			});
			expect(shared, inner).toBe(true);
		}
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
});

describe("sent-message annotation count", () => {
	it("scales the refs count with the message font size", () => {
		const css = componentStyle(sentRefsSource(), "SentRefs.svelte");
		expect(css).toMatch(/\.ann-refs-pill\s*\{[^}]*var\(--font-scale, 1\)/);
	});
});
