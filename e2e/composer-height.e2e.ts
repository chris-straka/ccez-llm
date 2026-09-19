import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Phone composer size discipline: a fresh chat's prompt is the
 * reference size, and text alone may grow it. Sending must return
 * the emptied composer to that reference — never strand it taller.
 */
test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

test("emptied composer matches its fresh height", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	const fresh = (await prompt.boundingBox())?.height ?? -1;
	expect(fresh).toBeGreaterThan(0);
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await page.keyboard.type("hello android");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.assistant .rendered").first()).toBeVisible({ timeout: 30_000 });
	await expect(page.locator(".sending")).toHaveCount(0, { timeout: 30_000 });
	const after = await page.evaluate(() => {
		const el = document.querySelector(".prompt");
		return el ? el.getBoundingClientRect().height : -1;
	});
	expect(Math.abs(after - fresh)).toBeLessThanOrEqual(4);
});
