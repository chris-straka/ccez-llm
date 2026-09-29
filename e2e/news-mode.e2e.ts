import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Learner news mode: on an empty chat, picking a reply language
 * trades the welcome text for story cards under the pill rail. The
 * browser preview has no shell transport, so these pin entry, the
 * honest needs-shell state, and the exit — the live feed and
 * session launches are shell-only.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
});

test("empty-chat language pick opens news, close returns to welcome", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "French" }).click();
	// Welcome text goes away, the panel rails under the pills.
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("French news");
	await expect(page.locator(".empty-state h1")).toHaveCount(0);
	// No shell in the preview: the honest state, not a spinner.
	await expect(panel).toContainText("needs the app shell");
	// The ✕ drops back to the welcome screen.
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.locator(".empty-state h1")).toBeVisible();
});

test("unsupported language shows the no-edition note", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Classics")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "Latin" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("no Latin edition yet");
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
});

test("picking a second language switches the panel over", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "French" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toContainText("French news", { timeout: 10_000 });
	await page.locator('.lang-menu button:has-text("Asia")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "Japanese" }).click();
	await expect(panel).toContainText("Japanese news");
});
