import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";
import { MOCK_NEWS_RSS_LONG, seedMockShell } from "./mock-shell";

/**
 * A translated desk on a phone: the first three headlines translate
 * before the cards show, the rest when their card scrolls into view
 * (owner, 2026-11-08: "I generally only look at the first two").
 */
test("a phone translates three headlines first, the rest as they scroll in", async ({
	page
}) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await seedChat(page, []);
	await seedMockShell(page, MOCK_NEWS_RSS_LONG);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page
		.locator(".lang-list")
		.getByRole("menuitem", { name: "Danish" })
		.click();
	const news = page.locator('.study-modes button[aria-label="News"]');
	if (await news.count()) await news.click();
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	const desk = panel.getByRole("button", { name: /, translated$/ }).first();
	if (await desk.count()) await desk.click();
	const cards = panel.locator(".news-card");
	await expect(cards).toHaveCount(8, { timeout: 10_000 });
	for (const i of [0, 1, 2])
		await expect(cards.nth(i)).toContainText(
			`[Danish] Headline number ${i + 1}`
		);
	await expect(cards.nth(7)).toHaveAttribute(
		"aria-label",
		"Headline translating"
	);
	await page.screenshot({ path: test.info().outputPath("first-three.png") });
	await cards.nth(7).scrollIntoViewIfNeeded();
	await expect(cards.nth(7)).toContainText("[Danish] Headline number 8", {
		timeout: 10_000
	});
	await page.screenshot({ path: test.info().outputPath("scrolled.png") });
});
