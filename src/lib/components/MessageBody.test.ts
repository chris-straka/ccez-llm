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
	const source = readFileSync(
		new URL("./MessageBody.svelte", import.meta.url),
		"utf8"
	);
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageBody.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("folded code chrome", () => {
	it("hides the copy and run buttons when the block is folded", () => {
		const css = bodyStyle();
		const hiding = [
			...css.matchAll(
				/([^{}]*\.ccez-code\[data-folded="1"\][^{}]*)\{([^}]*)\}/g
			)
		].filter((rule) => /display\s*:\s*none/.test(rule[2]!));
		const selectors = hiding.map((rule) => rule[1]).join(",");
		expect(selectors).toContain(".ccez-code-copy");
		expect(selectors).toContain(".ccez-code-run");
	});
	it("caps folded previews to a few words on phones", () => {
		// A full first line is a paragraph on a 360px column: phones
		// clip the preview far earlier, desktop keeps the whole line.
		const css = bodyStyle();
		expect(css).toMatch(/\.folded-preview[\s\S]*?22ch/);
		expect(css).toContain(".app[data-android]");
	});
	it("keeps folded labels non-selectable chrome", () => {
		// Labels are chrome, not content: quoting `latex · N LOC`
		// annotates nothing and badges orphan on unfold — so labels
		// never select (clicks still unfold; picks start unfolded).
		const css = bodyStyle();
		for (const kind of ["code", "math"]) {
			const end = new RegExp(`\\(\\.ccez-${kind}-foldedlabel\\)$`);
			const rules = [
				...css.matchAll(
					new RegExp(
						`([^{}]*\\.ccez-${kind}-foldedlabel[^{}]*)\\{([^}]*)\\}`,
						"g"
					)
					// Theme overrides share the tail selector but carry no
					// layout of their own — only the base rule counts.
				)
			].filter((rule) => end.test(rule[1]!.trim()) && !/html\[/.test(rule[1]!));
			expect(rules, `no base .ccez-${kind}-foldedlabel rule`).not.toHaveLength(
				0
			);
			for (const rule of rules)
				expect(rule[2]).toMatch(/user-select\s*:\s*none/);
		}
	});
	it("hides the run button on Android but keeps it on iOS and desktop", () => {
		// No usable local runner in the Android sandbox: runnable
		// fences keep copy alone there. iOS keeps the button (the
		// browser fallback stamps the no-runner reason instead).
		const css = bodyStyle();
		const hiding = [
			...css.matchAll(/([^{}]*\.ccez-code-run[^{}]*)\{([^}]*)\}/g)
		].filter((rule) => /display\s*:\s*none/.test(rule[2]!));
		const android = hiding.filter((rule) =>
			rule[1]!.includes(".app[data-android]")
		);
		expect(
			android,
			"no android-gated rule hides .ccez-code-run"
		).not.toHaveLength(0);
		for (const rule of android)
			expect(rule[1], "android run-button rule must spare iOS").toContain(
				":not([data-ios])"
			);
	});
	it("never unfolds off a label drag", () => {
		// Unfolding detaches the just-drawn highlight (and strands
		// the menu): drags and clicks over a live highlight keep
		// selecting, only selection-free clicks unfold.
		const source = readFileSync(
			new URL("./MessageBody.svelte", import.meta.url),
			"utf8"
		);
		expect(source).toContain(
			"if (unfoldedDrag || blockHoldsHighlight(mathWrap)) return;"
		);
		expect(source).toContain(
			"if (unfoldedDrag || blockHoldsHighlight(codeBlock)) return;"
		);
	});
});

describe("math chrome alignment", () => {
	/** Both chrome buttons share one box: the copy glyph brings its
	own height while `$` is bare text, so equal height — not
	line-height games — is what centers them on each other. */
	function texRule(): string {
		const css = bodyStyle();
		const rules = [
			...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)
		];
		const own = rules.find(
			(rule) =>
				!rule[1]!.includes(".ccez-math-copy") &&
				!/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-tex rule");
		return own[2]!;
	}
	function sharedRule(): string {
		const css = bodyStyle();
		const rules = [
			...css.matchAll(/([^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g)
		];
		const shared = rules.find((rule) => rule[1]!.includes(".ccez-math-copy"));
		if (!shared) throw new Error("no shared math chrome rule");
		return shared[2]!;
	}
	function copyRule(): string {
		const css = bodyStyle();
		const rules = [
			...css.matchAll(/([^{}]*\.ccez-math-copy[^{}]*)\{([^}]*)\}/g)
		];
		const own = rules.find(
			(rule) =>
				!rule[1]!.includes(".ccez-math-tex") &&
				!/hover|data-folded/.test(rule[1]!)
		);
		if (!own) throw new Error("no base .ccez-math-copy rule");
		return own[2]!;
	}
	/** Base display-body rule (not the folded, raw-view, or inline overrides). */
	function mathBodyRule(): string {
		const css = bodyStyle();
		const rules = [
			...css.matchAll(/([^{}]*\.ccez-math-body[^{}]*)\{([^}]*)\}/g)
		];
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
	/** Inline chrome rule (not the absolute display pair): both
	buttons self-center on the line, so the `$` text button and the
	svg copy button sit on each other while the equation keeps the
	row's baseline rhythm. */
	function inlineChromeRule(): string {
		const css = bodyStyle();
		const rules = [
			...css.matchAll(
				/([^{}]*\.ccez-math-inline[^{}]*\.ccez-math-tex[^{}]*)\{([^}]*)\}/g
			)
		];
		const own = rules.find((rule) => rule[1]!.includes(".ccez-math-copy"));
		if (!own) throw new Error("no inline math chrome rule");
		return own[2]!;
	}
	it("self-centers the inline pair instead of baselining them", () => {
		expect(inlineChromeRule()).toMatch(/align-self\s*:\s*center/);
		expect(inlineChromeRule()).not.toMatch(/vertical-align\s*:\s*baseline/);
	});
});

describe("badge hover hysteresis", () => {
	/** Edge tremor fires over/out crossings tens of ms apart; an
	instant clear flashes the wash (reads as the marker flickering).
	The null wash waits out the tremor while badge-to-badge slides
	stay instant — owned once for all bodies (see hoverWash), so a
	gapped cross-message slide can't clobber the fresh wash. Asserts
	on source: jsdom sees no hover (behavior lives in
	hoverWash.test.ts). */
	function washSource(): string {
		return readFileSync(new URL("../hoverWash.ts", import.meta.url), "utf8");
	}
	function bodySource(): string {
		return readFileSync(
			new URL("./MessageBody.svelte", import.meta.url),
			"utf8"
		);
	}
	it("delays the null wash instead of clearing on mouseout", () => {
		const source = washSource();
		expect(source).toMatch(/HOVER_WASH_CLEAR_MS\s*=\s*\d+/);
		expect(source).toMatch(/timer\s*=\s*setTimeout/);
	});
	it("cancels the pending clear on re-enter", () => {
		const source = washSource();
		expect(source).toMatch(/clearTimeout\(timer\)/);
	});
	it("bodies route hover through the shared machine", () => {
		expect(bodySource()).toContain("$lib/hoverWash");
	});
});

describe("preview mounts", () => {
	it("renders settled bodies while sidebar-previewing (no entrance fade)", () => {
		// The aid-swap fade replays on every mount, including hover
		// previews — over latex chrome it reads as the buttons
		// stirring. jsdom can't see the animation, so pin the wiring:
		// previews skip the class entirely.
		const source = readFileSync(
			new URL("./MessageBody.svelte", import.meta.url),
			"utf8"
		);
		expect(source).toContain("class:aid-swap={!preview}");
	});
});

describe("CJK leading follows rendered readings", () => {
	/** Tall while ruby renders, tight when aids toggle off: the 2.7
	reservation must live on aid-tall (rendered), never on aid-space
	(availability) — or untoggled CJK goes tall again. jsdom has no
	layout, so pin the wiring on source like the folded-chrome
	tests above. */
	it("binds the tall class on availability AND the rendered flag", () => {
		const source = readFileSync(
			new URL("./MessageBody.svelte", import.meta.url),
			"utf8"
		);
		expect(source).toContain("class:aid-tall={aidSpace && aidTall}");
	});
	it("tracks rendered readings instead of latching", () => {
		const source = readFileSync(
			new URL("./MessageBody.svelte", import.meta.url),
			"utf8"
		);
		expect(source).toMatch(/aidTall = localAids\.length > 0;/);
		expect(source).not.toMatch(/if \(localAids\.length > 0\) aidTall = true;/);
	});
	it("keeps line-height off the availability rule and on the tall rule", () => {
		const css = bodyStyle();
		const tall = [
			...css.matchAll(/([^{}]*\.rendered\.aid-tall[^{}]*)\{([^}]*)\}/g)
		];
		expect(
			tall,
			"no .rendered.aid-tall rule — tall CJK leading has nowhere to live"
		).not.toHaveLength(0);
		for (const rule of tall) expect(rule[2]).toMatch(/line-height\s*:\s*2\.7/);
		const space = [
			...css.matchAll(/([^{}]*\.rendered\.aid-space[^{}]*)\{([^}]*)\}/g)
		];
		expect(
			space,
			"no .rendered.aid-space rules — availability marks nothing"
		).not.toHaveLength(0);
		for (const rule of space)
			expect(
				rule[2],
				`${rule[1]!.trim()} sets line-height — untoggled CJK goes tall again`
			).not.toMatch(/line-height/);
	});
});
