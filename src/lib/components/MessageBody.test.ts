import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Folded code chrome: a folded block is label-only, so the copy and Run
 * buttons hide with the pre instead of floating over the collapsed label.
 *
 * Asserts on MessageBody.svelte's <style> source because visibility under
 * `data-folded` is a layout fact jsdom cannot see (same reason
 * actions-reveal.test.ts reads +page.svelte's <style>).
 */
function bodyStyle(): string {
	const source = readFileSync(new URL("./MessageBody.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageBody.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("folded code chrome", () => {
	it("hides the copy and run buttons when the block is folded", () => {
		const css = bodyStyle();
		const hiding = [...css.matchAll(/([^{}]*\.ccez-code\[data-folded="1"\][^{}]*)\{([^}]*)\}/g)].filter(
			(rule) => /display\s*:\s*none/.test(rule[2]!)
		);
		const selectors = hiding.map((rule) => rule[1]).join(",");
		expect(selectors).toContain(".ccez-code-copy");
		expect(selectors).toContain(".ccez-code-run");
	});
	it("keeps folded labels selectable text", () => {
		// Labels inherit the messages' user-select:none; without
		// this a label drag can never start, so folding reads
		// as unhighlightable.
		const css = bodyStyle();
		for (const kind of ["code", "math"]) {
			const end = new RegExp(`\\(\\.ccez-${kind}-foldedlabel\\)$`);
			const rules = [...css.matchAll(
				new RegExp(`([^{}]*\\.ccez-${kind}-foldedlabel[^{}]*)\\{([^}]*)\\}`, "g")
			// Theme overrides share the tail selector but carry no
			// layout of their own — only the base rule counts.
			)].filter((rule) => end.test(rule[1]!.trim()) && !/html\[/.test(rule[1]!));
			expect(rules, `no base .ccez-${kind}-foldedlabel rule`).not.toHaveLength(0);
			for (const rule of rules) expect(rule[2]).toMatch(/user-select\s*:\s*text/);
		}
	});
	it("never unfolds off a label drag", () => {
		// Unfolding detaches the just-drawn highlight (and strands
		// the menu): drags and clicks over a live highlight keep
		// selecting, only selection-free clicks unfold.
		const source = readFileSync(new URL("./MessageBody.svelte", import.meta.url), "utf8");
		expect(source).toContain("if (unfoldedDrag || blockHoldsHighlight(mathWrap)) return;");
		expect(source).toContain("if (unfoldedDrag || blockHoldsHighlight(codeBlock)) return;");
	});
});

describe("math chrome alignment", () => {
	/** Both chrome buttons share one box: the copy glyph brings its
	own height while `$` is bare text, so equal height — not
	line-height games — is what centers them on each other. */
	function texRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)];
		const own = rules.find(
			(rule) => !rule[1]!.includes(".ccez-math-copy") && !/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-tex rule");
		return own[2]!;
	}
	function sharedRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)];
		const shared = rules.find((rule) => rule[1]!.includes(".ccez-math-copy"));
		if (!shared) throw new Error("no shared math chrome rule");
		return shared[2]!;
	}
	function copyRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-copy[^{}]*)\{([^}]*)\}/g)];
		const own = rules.find(
			(rule) => !rule[1]!.includes(".ccez-math-tex") && !/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-copy rule");
		return own[2]!;
	}
	/** Base display-body rule (not the folded, raw-view, or inline overrides). */
	function mathBodyRule(): string {
		const css = bodyStyle();
		const rules = [...css.matchAll(/([^{}]*\.ccez-math-body[^{}]*)\{([^}]*)\}/g)];
		const base = rules.find(
			(rule) =>
				/\(\.ccez-math-body\)$/.test(rule[1]!.trim()) &&
				!/inline|data-folded|data-math-raw/.test(rule[1]!)
		);
		if (!base) throw new Error("no base .ccez-math-body rule");
		return base[2]!;
	}
	it("keeps the source toggle upright", () => {
		expect(texRule()).toMatch(/font-style\s*:\s*normal/);
	});
	it("leaves the toggle text on a real line box", () => {
		expect(texRule()).not.toMatch(/line-height\s*:\s*0/);
	});
	it("sizes both buttons to one shared box", () => {
		expect(sharedRule()).toMatch(/height\s*:\s*1\.3rem/);
		expect(sharedRule()).toMatch(/width\s*:\s*1\.3rem/);
	});
	it("centers the chrome pair on top instead of pinning the right edge", () => {
		expect(copyRule()).toMatch(/left\s*:\s*calc\(50%/);
		expect(texRule()).toMatch(/right\s*:\s*calc\(50%/);
	});
	it("clears the chrome with top room, not a right gutter", () => {
		expect(mathBodyRule()).toMatch(/padding\s*:\s*2\.2rem/);
		expect(mathBodyRule()).not.toMatch(/3\.4rem/);
	});
});

describe("preview mounts", () => {
	it("renders settled bodies while sidebar-previewing (no entrance fade)", () => {
		// The aid-swap fade replays on every mount, including hover
		// previews — over latex chrome it reads as the buttons
		// stirring. jsdom can't see the animation, so pin the wiring:
		// previews skip the class entirely.
		const source = readFileSync(new URL("./MessageBody.svelte", import.meta.url), "utf8");
		expect(source).toContain("class:aid-swap={!preview}");
	});
});
