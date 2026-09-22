import { test, expect } from "@playwright/test";

/**
 * Retrying a failed reply (or rerunning) reuses the user message in
 * place: previous articles keep their DOM nodes instead of remounting
 * (the full-list flash). Only the fresh reply mounts.
 */
test("retry keeps previous articles mounted", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "m1",
							role: "user",
							content: "hello",
							usage: null,
							error: null
						},
						{
							id: "m2",
							role: "assistant",
							content: "",
							usage: null,
							error: "boom"
						}
					]
				}
			])
		);
	});
	await page.goto("/");
	// Icon-only row button (glyph + tip, no text node).
	const retry = page.locator('button[aria-label="Retry"]');
	await expect(retry).toBeVisible();
	await page.evaluate(() => {
		document.querySelectorAll("article").forEach((a, i) => (a.__mark = i));
	});
	await retry.click();
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.waitForTimeout(1500);
	const marks = await page.evaluate(() =>
		[...document.querySelectorAll("article")].map((a) => a.__mark ?? "lost")
	);
	expect(marks[0]).toBe(0);
	expect(await page.locator("article .rendered").count()).toBeGreaterThan(0);
});
