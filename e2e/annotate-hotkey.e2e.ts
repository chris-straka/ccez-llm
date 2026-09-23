import { expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Word selection plus A files and sends at once — no pill, no staged
 * note. (Phones double-tap the word; desktop drags it: both leave a
 * live selection, which is what owns A.) Hovering a word with no
 * selection sends it the same way; Shift+A opens the create box
 * empty instead. Bare-message A still toggles aids.
 */
test("selected word plus A sends at once", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	const selText = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selText.trim().length).toBeGreaterThan(0);
	// Hands off the prompt: a focused composer eats the A into typed
	// text. Blurring keeps the selection (Escape might dismiss it).
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur?.()
	);
	// Steal :hover outright (the summoned menu does this on its own
	// when it opens under a stationary cursor): the live selection
	// still owns A with no hover index at all.
	await page.mouse.move(2, 2);
	await expect
		.poll(() =>
			page.evaluate(
				() => document.querySelector("article.assistant:hover") === null
			)
		)
		.toBe(true);
	await page.keyboard.press("a");
	// No pill ever opens; the badge files (the answer request may
	// banner without a dev key, but filing never depends on it).
	// The selection menu never opens either.
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
		timeout: 10_000
	});
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Hovering a word (no selection) plus A files and sends the
hovered word at once — the word selects itself first, then the
request fires with no pill in between. */
test("hovered word plus A sends at once", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	// Hands off the prompt first: a focused composer eats the A
	// into typed text (correct product behavior — typing is
	// typing). Escape drops its caret without hiding it.
	await page.keyboard.press("Escape");
	// Mid-word hover with no selection anywhere: resolve the
	// word's own caret rect so the pointer lands on a glyph, not a
	// gap (gaps keep the old aids behavior, which files nothing
	// here).
	const pt = await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered");
		if (!el) return null;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const i = (node.textContent ?? "").indexOf("riverbank");
			if (i >= 0) {
				const r = document.createRange();
				r.setStart(node, i + 2);
				r.setEnd(node, i + 3);
				const rect = r.getBoundingClientRect();
				return {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2
				};
			}
		}
		return null;
	});
	if (!pt) throw new Error("word has no caret rect");
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await page.mouse.move(pt.x, pt.y);
	await page.keyboard.press("a");
	// No pill ever opens; the badge files (the answer request may
	// banner without a dev key, but filing never depends on it).
	// The selection menu never opens either: the quote travels
	// through selMenu state, which clears in the same tick.
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
		timeout: 10_000
	});
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Hovering a Japanese word plus A files it and hangs its
furigana above the kanji — never stranded at the viewport corner
(a zero-area anchor rect must never place a panel). */
test("hovered japanese word plus A hangs furigana above it", async ({
	page
}) => {
	test.setTimeout(180_000);
	await seedChat(page, [{ role: "assistant", content: "今日は春です" }]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Escape");
	// Mid-kanji hover with no selection: caret rect of 春 so the
	// pointer lands on the glyph, not a gap.
	const pt = await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered");
		if (!el) return null;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (node.parentElement?.tagName === "RT") continue;
			const i = (node.textContent ?? "").indexOf("春");
			if (i >= 0) {
				const r = document.createRange();
				r.setStart(node, i);
				r.setEnd(node, i + 1);
				const rect = r.getBoundingClientRect();
				return {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2
				};
			}
		}
		return null;
	});
	if (!pt) throw new Error("word has no caret rect");
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await page.mouse.move(pt.x, pt.y);
	await page.keyboard.press("a");
	// Filed instantly: the badge stamps (readings may resolve or
	// not — either way no panel may strand at the corner).
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
		timeout: 10_000
	});
	const panels = page.locator(".sel-pinyin");
	await expect(panels.locator(".spr").first()).toBeVisible({
		timeout: 120_000
	});
	// Every panel hangs right above the kanji (a hairline gap),
	// inside the viewport — never the (8, 0) corner.
	const kanji = await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered");
		if (!el) return null;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (node.parentElement?.tagName === "RT") continue;
			const i = (node.textContent ?? "").indexOf("春");
			if (i >= 0) {
				const r = document.createRange();
				r.setStart(node, i);
				r.setEnd(node, i + 1);
				const rect = r.getBoundingClientRect();
				return { top: rect.top, left: rect.left, right: rect.right };
			}
		}
		return null;
	});
	if (!kanji) throw new Error("kanji lost its rect");
	const gaps = await panels.evaluateAll((els) =>
		els.map((el) => {
			const r = (el as HTMLElement).getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
		})
	);
	expect(gaps.length).toBeGreaterThan(0);
	for (const g of gaps) {
		expect(g.top).toBeGreaterThan(8);
		expect(g.left).toBeGreaterThan(8);
		expect(kanji.top - g.bottom).toBeLessThanOrEqual(24);
		expect(g.left).toBeLessThanOrEqual(kanji.right);
		expect(g.right).toBeGreaterThanOrEqual(kanji.left);
	}
	// No menu ever opens on the instant path either.
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Shift+A opens the create box with nothing staged — over a live
selection, or over a hovered word that selects itself first. */
test("shift A opens an empty create box", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("A");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await expect(pop.locator("textarea")).toHaveValue("");
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});
