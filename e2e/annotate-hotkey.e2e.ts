import { expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Word selection plus A files an annotation with "?" staged as the
 * note — send to file the question, or type over it. (Phones
 * double-tap the word; desktop drags it: both leave a live
 * selection, which is what owns A.) Bare-message A still toggles
 * aids.
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
