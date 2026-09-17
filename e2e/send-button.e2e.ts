import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Send button carries the reply state: a plain arrow with no language,
 * the language flag while one is set (clicking still sends; the number
 * key repeats to clear). The old top-left pill is gone.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
});

test("arrow by default, flag while a language is set", async ({ page }) => {
	const send = page.locator(".send-btn");
	await expect(send).toHaveText("↑", { ignoreCase: false });
	await expect(page.locator(".lang-chip").first()).toHaveCount(0);
	const menu = page.locator(".lang-menu > button").first();
	await menu.click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	const badge = (await list.locator(".badge").last().innerText()).trim();
	await list.locator("button").last().click();
	await expect(send).toContainText(badge);
	await expect(send).not.toContainText("↑");
	// Picking the active option again clears back to the arrow.
	await menu.click();
	await expect(list).toBeVisible();
	await list.locator("button.selected").click();
	await expect(send).toHaveText("↑");
});
