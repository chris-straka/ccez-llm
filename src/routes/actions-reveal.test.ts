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
function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

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

function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
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
		const css = rowStyle();
		expect(css).toContain(":global(article.user.aid-loading) .actions");
		expect(css).toContain(":global(article.assistant.aid-loading) .actions");
	});

	it("holds the touch row while aids load or audio runs", () => {
		const source = pageSource();
		const timer = source.match(
			/function armActionsTimer\(id: ChatMsgId\): void \{([\s\S]*?)\n\t\}/
		);
		expect(
			timer,
			"armActionsTimer is gone or reshaped — move the busy hold with it"
		).toBeTruthy();
		const body = timer![1]!;
		// Every in-flight state that owns the row must re-arm, never close.
		for (const state of [
			"aidBusy.has(id)",
			"vocalizing.has(id)",
			"speakingId === id",
			"speakingSelection === id"
		]) {
			expect(body).toContain(state);
		}
		expect(body).toContain("armActionsTimer(id)");
	});

	it("stops speech from the composer button without flipping the setting", () => {
		const source = pageSource();
		const toggle = source.match(
			/function toggleVoice\(\): void \{([\s\S]*?)\n\t\}/
		);
		expect(
			toggle,
			"toggleVoice is gone or reshaped — keep the global stop in it"
		).toBeTruthy();
		const body = toggle![1]!;
		expect(body).toContain("speakingId !== null");
		expect(body).toContain("stopVoice()");
		// The stop path returns before the setting toggle.
		expect(body.indexOf("stopVoice()")).toBeLessThan(
			body.indexOf("setVoiceEnabled")
		);
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

	it("confirms message copy with a bare Copied toast", () => {
		const source = pageSource();
		expect(source).toContain(
			'redactedCopyText(plainBody(content, role, sourcesWanted)),\n\t\t\t"Copied"'
		);
		expect(source).not.toContain("Copied as plain text");
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

/**
 * Chat-switch ordering: picking a previewed row must land directly,
 * never flash the old chat first.
 */
function transitionBody(): string {
	const fn = pageSource().match(
		/function transitionToChat\(id: Parameters<typeof selectChat>\[1\]\): void \{([\s\S]*?)switchChatWithTransition\(mutate/
	);
	expect(
		fn,
		"transitionToChat is gone or reshaped — keep the preview clear and voice stop in it"
	).toBeTruthy();
	return fn![1]!;
}

describe("chat-switch transition", () => {
	it("clears the hover preview inside the switch, never before it", () => {
		// Clearing first renders the old chat for a frame (and the
		// view-transition snapshot catches it), so the mutate block
		// owns the only switch-path clear.
		expect(transitionBody()).toContain("previewChatId = null;");
	});

	it("stops the voice when leaving for another chat", () => {
		expect(transitionBody()).toContain("stopVoice();");
	});

	it("passes previewing into message bodies", () => {
		expect(pageSource()).toContain("preview={previewing}");
	});
});

describe("message spacing and overscroll", () => {
	it("fixes the list gap unless button scaling opts into growth", () => {
		const css = pageStyle();
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
		const scaled = css.match(/main\.scale-actions \.messages\s*\{([^}]*)\}/);
		expect(
			scaled,
			"opt-in scaled gap is gone — huge type domes the air"
		).toBeTruthy();
		expect(scaled![1]).toMatch(/gap\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("fixes the between-pair separation unless button scaling opts in", () => {
		const css = pageStyle();
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
		const scaled = css.match(/main\.scale-actions article\.user\s*\{([^}]*)\}/);
		expect(scaled, "opt-in scaled separation is gone").toBeTruthy();
		expect(scaled![1]).toMatch(/margin-top\s*:\s*calc\([^;]*var\(--font-scale/);
	});

	it("reserves tail overscroll outside the empty hero's zone", () => {
		const css = pageStyle();
		const spacer = css.match(
			/main:not\(\.empty\) \.messages::after\s*\{([^}]*)\}/
		);
		expect(
			spacer,
			"overscroll spacer is gone — the tail docks hard again"
		).toBeTruthy();
		expect(spacer![1]).not.toMatch(/var\(--font-scale/);
		const scaled = css.match(
			/main\.scale-actions:not\(\.empty\) \.messages::after\s*\{([^}]*)\}/
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
		// Buttons render in the row component, handlers stay paged.
		const row = rowSource();
		const wired: Array<[string, string]> = [
			["actions.unpinModelAid()", "unpinModelAid: () => unpinModelAid(msg)"],
			["actions.runModelAid(aidId)", "runModelAidFor(msg, modelId, true)"],
			["actions.unpinLocalAid(localKind)", "unpinLocalAid: (kind: LocalAid) => unpinLocalAid(msg, kind)"],
			["actions.pinLocalAid(localKind)", "pinLocalAid: (kind: LocalAid) => pinLocalAid(msg, kind)"]
		];
		const page = pageSource();
		for (const [call, wiring] of wired) {
			const at = row.indexOf(call);
			if (at === -1) throw new Error(`aid call gone: ${call}`);
			const open = row.lastIndexOf("<button", at);
			if (open === -1) throw new Error(`no button tag for ${call}`);
			expect(row.slice(open, at), `${call} button lost aid-btn`).toContain(
				"aid-btn"
			);
			expect(page, `${call} unwired`).toContain(wiring);
		}
	});
});
