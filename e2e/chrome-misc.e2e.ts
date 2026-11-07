import { expect, test } from "./fixtures";
import { seedChat, setSettingValue, settingValue } from "./helpers";

/**
 * Chrome misc: CSS-trivia one-liners collected from chrome.e2e.ts and
 * android-touch.e2e.ts (rerun tooltip, drawer transform) and
 * chrome.e2e.ts (slider reset, width-label keep, top-bar double-click).
 */

async function openWithMessages(
	page: import("@playwright/test").Page,
	messages: { role: "user" | "assistant"; content: string }[]
) {
	await seedChat(page, messages);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
}

async function openSettings(page: import("@playwright/test").Page) {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

/**
 * Phone-origin one-liners (from android-touch.e2e.ts): the drawer swipe
 * is phone-gated, so these two keep the S24 UA + viewport.
 */
test.describe("phone", () => {
	test.use({
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("rerun tooltip is just Rerun", async ({ page }) => {
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
			const msg = (id: string, role: string, content: string) => ({
				id,
				role,
				content,
				usage: null,
				error: null
			});
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "chat-a",
						createdAt: 1,
						replyLang: null,
						messages: [msg("m1", "user", "do it")]
					}
				])
			);
		});
		await page.goto("/");
		await page.locator("article").first().waitFor();
		const rerun = page
			.locator('article .actions button[data-tip="Rerun"]')
			.first();
		await expect(rerun).toBeVisible();
		expect(await rerun.getAttribute("aria-label")).toBe("Rerun");
	});
});
/** Clicking a stepper's name never changes its value; only the
buttons, keys, and the Reset link do. */
test("clicking a setting's name keeps the value", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	await setSettingValue(page, "Text size percent", 250);
	await page
		.locator(".settings-panel .setting-label", { hasText: /^Text size$/ })
		.click();
	expect(await settingValue(page, "Text size percent")).toBe(250);
	await page
		.locator(".settings-panel .setting-label", { hasText: /^Chat width$/ })
		.click();
	expect(await settingValue(page, "Chat width in rem")).toBe(36);
	await page
		.locator('.settings-panel button[title="Reset to the default size"]')
		.click();
	expect(await settingValue(page, "Text size percent")).toBe(100);
});
test("top bar shows no text and survives a double-click", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	const header = page.locator("main > header");
	await expect(header).toBeVisible();
	await expect(header).toHaveText(/^\s*$/);
	await expect(page.locator("header .app-title")).toHaveCount(0);
	// Browser build has no shell zoom (Tauri-only no-op): the strip
	// stays put and stays empty — drive the double-click by dispatch,
	// which still runs the zoom path.
	await header.evaluate((el) =>
		el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
	);
	await expect(header).toHaveText(/^\s*$/);
});
