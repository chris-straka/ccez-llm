import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Phone viewports can't fit the 15-language Europe list above the
 * pills, so on touch it renders as a capped sheet: the whole list box
 * must stay inside the viewport (it used to fly off the top).
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 },
	hasTouch: true,
	isMobile: true
});

test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({ timeout: 60_000 });
});

test("europe list stays inside a phone viewport", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(412);
	expect(box!.y + box!.height).toBeLessThanOrEqual(915);
});

/** Picking a language must not hand focus to the composer on phones:
auto-focus pops the keyboard over it instead of pushing it up. */
test("picking a language leaves the composer unfocused", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "French" }).click();
	await expect(list).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input")).not.toBeFocused();
});

/** The last menu hugs the right edge: its long nowrap names used to
trail off the page (left-anchored like the rest). */
test("classics list stays inside a phone viewport", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Classics")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const box = await list.boundingBox();
	expect(box, "language list has a box").toBeTruthy();
	expect(box!.y).toBeGreaterThanOrEqual(0);
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(412);
	expect(box!.y + box!.height).toBeLessThanOrEqual(915);
});
