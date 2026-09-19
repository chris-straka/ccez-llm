import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Phone composer discipline: Enter is a carriage return (only the
 * send button submits), and a fresh chat's prompt is the reference
 * size — text alone may grow it, and sending must return the
 * emptied composer to that reference, never strand it taller.
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
	// Phones never send from the keyboard: the send button submits.
	await page.locator(".send-btn").click();
	await expect(page.locator("article.assistant .rendered").first()).toBeVisible({ timeout: 30_000 });
	await expect(page.locator(".sending")).toHaveCount(0, { timeout: 30_000 });
	const after = await page.evaluate(() => {
		const el = document.querySelector(".prompt");
		return el ? el.getBoundingClientRect().height : -1;
	});
	expect(Math.abs(after - fresh)).toBeLessThanOrEqual(4);
});

test("tapping the empty composer never grows it", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	const fresh = (await prompt.boundingBox())?.height ?? -1;
	expect(fresh).toBeGreaterThan(0);
	await page.locator(".prompt .ta-input").click();
	await expect(page.locator(".prompt .ta-input")).toBeFocused();
	const focused = await page.evaluate(() => {
		const el = document.querySelector(".prompt");
		return el ? el.getBoundingClientRect().height : -1;
	});
	// No gap ramp, no base min-height floor on focus: an empty box
	// holds its fresh-chat size until text grows it.
	expect(Math.abs(focused - fresh)).toBeLessThanOrEqual(2);
});

test("phone Enter inserts a newline instead of sending", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await page.keyboard.type("one");
	await page.keyboard.press("Enter");
	await page.keyboard.type("two");
	await expect(box).toHaveValue("one\ntwo");
	await expect(page.locator("article.user")).toHaveCount(0);
});
