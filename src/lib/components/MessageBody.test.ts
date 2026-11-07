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
