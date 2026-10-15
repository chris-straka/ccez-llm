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
async function seedEmpty(page: import("@playwright/test").Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible();
}

/** Synthetic horizontal swipe (untrusted TouchEvents hit window listeners). */
async function swipeX(
	page: import("@playwright/test").Page,
	x0: number,
	x1: number
): Promise<void> {
	await page.evaluate(
		({ x0, x1 }: { x0: number; x1: number }) => {
			const touch = (x: number, y: number) =>
				new Touch({
					identifier: 9,
					target: document.body,
					clientX: x,
					clientY: y
				});
			window.dispatchEvent(
				new TouchEvent("touchstart", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(x0, 600)]
				})
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x1, 604)]
				})
			);
		},
		{ x0, x1 }
	);
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
	test("drawers slide on transform, never pop", async ({ page }) => {
		await seedEmpty(page);
		const sheet = await page
			.locator("aside:has(button.new)")
			.evaluate((el) => getComputedStyle(el).transition);
		expect(sheet).toContain("transform");
		await swipeX(page, 408, 268);
		const panel = page.locator(".settings-panel");
		await expect(panel).not.toHaveClass(/closed/);
		const transition = await panel.evaluate(
			(el) => getComputedStyle(el).transition
		);
		expect(transition).toContain("transform");
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

/** Fullscreen toggles on Ctrl+Meta+F everywhere (⌘E edits the newest
own message now — shell-only, unreachable here). The round-trip needs
real window chrome, so it stays pinned-but-skipped. */
test("Ctrl+Meta+F toggles fullscreen", async ({ page }) => {
	test.skip(true, "fullscreen round-trip needs real window chrome");
	await openWithMessages(page, [{ role: "assistant", content: "hi" }]);
	await page.keyboard.press("Meta+Control+f");
	await expect
		.poll(() => page.evaluate(() => !!document.fullscreenElement), {
			timeout: 5_000
		})
		.toBe(true);
	await page.keyboard.press("Meta+Control+f");
	await expect
		.poll(() => page.evaluate(() => !!document.fullscreenElement), {
			timeout: 5_000
		})
		.toBe(false);
});
