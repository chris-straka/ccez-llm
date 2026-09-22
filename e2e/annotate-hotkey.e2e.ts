import { expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Word selection plus A files an annotation with "?" staged as the
 * note — send to file the question, or type over it. (Phones
 * double-tap the word; desktop drags it: both leave a live
 * selection, which is what owns A.) Hovering a word with no
 * selection plus A files and sends at once, no pill; Shift+A opens
 * the create box empty instead. Bare-message A still toggles aids.
 */
test("selected word plus A stages a question note", async ({ page }) => {
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
	await page.keyboard.press("a");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await expect(pop.locator("textarea")).toHaveValue("?");
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
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
		timeout: 10_000
	});
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
