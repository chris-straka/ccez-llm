import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Stylesheet invariants for the hover-only message action rows.
 *
 * These assert on MessageActions.svelte's <style> source (moved with the
 * row) because the behavior they guard — compositor-layer promotion
 * during the opacity fade — is invisible to jsdom (no layout, no
 * layers). The row must fade with opacity only (never
 * transform/translate/animation, or the buttons visibly shift mid-fade)
 * and must carry will-change so the layer exists before the fade
 * starts. will-change looks like removable dead weight; it is not.
 */
/** Action-row chrome moved to MessageActions.svelte with its styles. */
function rowSource(): string {
	return readFileSync(
		new URL("../lib/components/MessageActions.svelte", import.meta.url),
		"utf8"
	);
}

function rowStyle(): string {
	const match = rowSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageActions.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Thread column moved to ThreadView.svelte with its styles. */
function threadSource(): string {
	return readFileSync(
		new URL("../lib/components/ThreadView.svelte", import.meta.url),
		"utf8"
	);
}

function threadStyle(): string {
	const match = threadSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("ThreadView.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Article row moved to MessageArticle.svelte with its styles. */
function articleSource(): string {
	return readFileSync(
		new URL("../lib/components/MessageArticle.svelte", import.meta.url),
		"utf8"
	);
}

function articleStyle(): string {
	const match = articleSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("MessageArticle.svelte has no <style> block");
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("hover-only message actions", () => {
	it("reveals when the message is hovered, not just the button row", () => {
		const css = rowStyle();
		expect(css).toContain(":global(article.user:hover) .actions");
		expect(css).toContain(":global(article.assistant:hover) .actions");
	});

	it("keeps the row up while its message is speaking", () => {
		const css = rowStyle();
		expect(css).toContain(":global(article.user.speaking) .actions");
		expect(css).toContain(":global(article.assistant.speaking) .actions");
	});

	it("keeps the row up while an aid loads", () => {
		// Whitespace-blind: the formatter may wrap selector lists.
		const css = rowStyle().replace(/\s+/g, " ");
		expect(css).toContain(":global(article.user.aid-loading) .actions");
		expect(css).toContain(":global(article.assistant.aid-loading) .actions");
	});

	it("keeps will-change on the hover-hidden rows", () => {
		const css = rowStyle();
		const block = css.match(
			/:global\(main\.hover-user\) :global\(article\.user\) \.actions,\s*:global\(main\.hover-assistant\) :global\(article\.assistant\) \.actions\s*\{([^}]*)\}/
		);
		expect(
			block,
			"hover-hidden .actions rule is gone or restyled — move will-change with it, don't drop it"
		).toBeTruthy();
		expect(block![1]).toMatch(/opacity\s*:\s*0\s*;/);
		expect(block![1]).toMatch(/will-change\s*:\s*opacity\s*;/);
	});

	it("scales the icon glyphs with the text-size opt-in", () => {
		const css = rowStyle();
		// Text buttons track at 85% of the message size by default
		// (user decision: the row reads quieter than its text), so
		// only the fixed-size logo icons still need the opt-in — and
		// they must follow it, or larger text leaves tiny icons.
		// Growth damps a fifth — full tracking overshoots the text.
		expect(css).toContain("calc(0.92rem * var(--font-scale, 1) * 0.85)");
		const glyph = css.match(
			/:global\(main\.scale-actions\) \.actions \.icon-btn[^{]*\{([^}]*)\}/
		);
		expect(
			glyph,
			"scale-actions glyph rule is gone — move it with the text rule"
		).toBeTruthy();
		expect(glyph![1]).toMatch(
			/height\s*:\s*calc\(1\.05rem \* \(1 \+ \(min\(var\(--font-scale/
		);
	});

	it("caps opt-in glyph scaling like the bubble", () => {
		// Uncapped, 800% type domes the glyphs into towers; the cap
		// keeps them proportional past 200%. Text buttons need no
		// cap: at 85% of the message size they scale WITH the text,
		// never past it.
		const css = rowStyle();
		const glyph = css.match(
			/:global\(main\.scale-actions\) \.actions \.icon-btn[^{]*\{([^}]*)\}/
		);
		expect(glyph, "scale-actions glyph rule is gone").toBeTruthy();
		expect(glyph![1]).toMatch(/min\(var\(--font-scale/);
	});

	it("never moves the buttons with transform, translate, or animation", () => {
		const css = rowStyle();
		// The tooltip bubble (::after) intentionally rises; everything else
		// touching .actions must be motion-free so the fade can't shift.
		const offenders = css
			.split("\n")
			.filter((line) => line.includes(".actions"))
			.filter((line) => !line.includes("::after"))
			.filter((line) => /(transform|translate|animation)\s*:/.test(line));
		expect(offenders).toEqual([]);
	});
});

describe("message spacing and overscroll", () => {
	it("fixes the list gap unless button scaling opts into growth", () => {
		const css = threadStyle();
		// Non-opt-in rules only: the scale-actions twin matches the
		// same tail selector and must not trip the fixed assertion.
		const gaps = [...css.matchAll(/([^{}]*)\.messages\s*\{([^}]*)\}/g)]
			.filter(
				(rule) =>
					/gap\s*:/.test(rule[2] ?? "") &&
					!(rule[1] ?? "").includes("scale-actions")
			)
			.map((rule) => rule[2]);
		expect(gaps, "no .messages gap rule").not.toHaveLength(0);
		for (const gap of gaps) expect(gap).not.toMatch(/var\(--font-scale/);
		const scaled = css.match(
			/:global\(main\.scale-actions\) \.messages\s*\{([^}]*)\}/
		);
		expect(
			scaled,
			"opt-in scaled gap is gone — huge type domes the air"
		).toBeTruthy();
		expect(scaled![1]).toMatch(/gap\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("fixes the between-pair separation unless button scaling opts in", () => {
		// The row rules moved with the article (paged main ancestor
		// renders global there).
		const css = articleStyle();
		const margins = [...css.matchAll(/([^{}]*?)article\.user\s*\{([^}]*)\}/g)]
			.filter(
				(rule) =>
					/margin-top\s*:/.test(rule[2] ?? "") &&
					!(rule[1] ?? "").includes("scale-actions")
			)
			.map((rule) => rule[2]);
		expect(margins, "no article.user margin-top rule").not.toHaveLength(0);
		for (const margin of margins)
			expect(margin).not.toMatch(/var\(--font-scale/);
		const scaled = css.match(
			/:global\(main\.scale-actions\) article\.user\s*\{([^}]*)\}/
		);
		expect(scaled, "opt-in scaled separation is gone").toBeTruthy();
		expect(scaled![1]).toMatch(/margin-top\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("reserves tail overscroll outside the empty hero's zone", () => {
		const css = threadStyle();
		const spacer = css.match(
			/:global\(main:not\(\.empty\)\) \.messages::after\s*\{([^}]*)\}/
		);
		expect(
			spacer,
			"overscroll spacer is gone — the tail docks hard again"
		).toBeTruthy();
		expect(spacer![1]).not.toMatch(/var\(--font-scale/);
		const scaled = css.match(
			/:global\(main\.scale-actions:not\(\.empty\)\) \.messages::after\s*\{([^}]*)\}/
		);
		expect(scaled, "opt-in scaled spacer is gone").toBeTruthy();
		expect(scaled![1]).toMatch(/height\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("never scrolls the row vertically, at any text size", () => {
		const css = rowStyle();
		// Both row rules (desktop nowrap + touch): tooltips below the
		// row must not make it scrollable up and down — clip the axis
		// (never scrolls) while the paint margin lets them show.
		const desktop = css.match(
			/:global\(\.app:not\(\[data-android\]\)\) \.actions\s*\{([^}]*)\}/
		);
		expect(desktop, "desktop actions rule is gone").toBeTruthy();
		expect(desktop![1]).toMatch(/overflow-y\s*:\s*clip/);
		expect(desktop![1]).toMatch(/overflow-clip-margin/);
		expect(css).toMatch(
			/@media \(hover: none\)\s*\{[^}]*\.actions\s*\{[^}]*overflow-y\s*:\s*clip/
		);
	});
});

describe("aid-button text size", () => {
	it("holds aid labels at the resting size unless the opt-in is on", () => {
		// Furigana/pinyin/tashkeel labels mirror the fixed icon glyphs:
		// with the toggle off, message-text growth must never dome them.
		const css = rowStyle();
		const fixed = css.match(/\.actions button\.aid-btn\s*\{([^}]*)\}/);
		expect(fixed, "fixed aid-btn rule is gone").toBeTruthy();
		expect(fixed![1]).toMatch(/font-size\s*:\s*calc\(0\.92rem \* 0\.85\)/);
		expect(fixed![1]).not.toMatch(/--font-scale/);
		const scaled = css.match(
			/:global\(main\.scale-actions\) \.actions button\.aid-btn\s*\{([^}]*)\}/
		);
		expect(scaled, "opt-in scaled aid-btn rule is gone").toBeTruthy();
		expect(scaled![1]).toMatch(/font-size\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("marks every aid label button, run and revert alike", () => {
		// Each aid onclick (model run/revert, local pin/unpin) lives on
		// a button tag carrying aid-btn: the fixed-size rule above keys
		// off the class, so an unmarked aid button would track text.
		const row = rowSource();
		for (const call of [
			"actions.unpinModelAid()",
			"actions.runModelAid(aidId)",
			"actions.unpinLocalAid(localKind)",
			"actions.pinLocalAid(localKind)"
		]) {
			const at = row.indexOf(call);
			if (at === -1) throw new Error(`aid call gone: ${call}`);
			const open = row.lastIndexOf("<button", at);
			if (open === -1) throw new Error(`no button tag for ${call}`);
			expect(row.slice(open, at), `${call} button lost aid-btn`).toContain(
				"aid-btn"
			);
		}
	});
});
