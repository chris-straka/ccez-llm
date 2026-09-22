import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Fetching chip: a tool-fetch round shows Fetching (not silence, not
 * Thinking) until the page lands, then the answer streams and the
 * chip retires.
 */
test("tool-fetch round shows the Fetching chip", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "10");
		localStorage.setItem("ccez-mock-fetch-ms", "3000");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("fetch a page for me");
	await page.keyboard.press("Enter");
	const status = page.getByRole("status", { name: "Fetching a page" });
	await expect(status).toBeVisible({ timeout: 10_000 });
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply to:",
		{ timeout: 15_000 }
	);
	await expect(status).toHaveCount(0);
});
