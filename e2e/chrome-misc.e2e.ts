import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

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
test("dragging the text slider upward resets to 100 percent", async ({
	page
}) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator(
		'.settings-panel input[aria-label="Text size percent"]'
	);
	await slider.fill("250");
	await expect(slider).toHaveValue("250");
	const box = await slider.boundingBox();
	expect(box).toBeTruthy();
	await slider.dispatchEvent("pointerdown", {
		clientY: box!.y + box!.height / 2
	});
	await slider.dispatchEvent("pointerup", {
		clientY: box!.y + box!.height / 2 - 120
	});
	await expect(slider).toHaveValue("100");
});
test("clicking the chat-width label text keeps the value", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator(
		'.settings-panel input[aria-label="Chat width in rem"]'
	);
	await slider.fill("60");
	await expect(slider).toHaveValue("60");
	// NOTE: the inner `has` selector must be relative — an absolute
	// `.settings-panel …` inner selector never matches inside a label.
	const label = page
		.locator(".settings-panel label")
		.filter({ has: page.locator('input[aria-label="Chat width in rem"]') });
	const box = await label.boundingBox();
	expect(box).toBeTruthy();
	// Top-left of the label is the label text row, clear of the
	// slider, readout, and reset button: the value must survive.
	await page.mouse.click(box!.x + 20, box!.y + 10);
	await expect(slider).toHaveValue("60");
	// The inner reset button still restores the default.
	await page.locator(".settings-panel button", { hasText: "(36)" }).click();
	await expect(slider).toHaveValue("36");
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

/** Fullscreen toggles on Meta+E (and Ctrl+Meta+F) in the shell; the
browser build keeps the chord for the shell and passes it through. */
test("Meta+E toggles fullscreen", async ({ page }) => {
	// Plain ⌘E is shell-only in the chord table; unreachable here.
	test.skip(true, "toggle-fullscreen chord is shell-only");
	await openWithMessages(page, [{ role: "assistant", content: "hi" }]);
	await page.keyboard.press("Meta+e");
	await expect
		.poll(() => page.evaluate(() => !!document.fullscreenElement), {
			timeout: 5_000
		})
		.toBe(true);
	await page.keyboard.press("Meta+e");
	await expect
		.poll(() => page.evaluate(() => !!document.fullscreenElement), {
			timeout: 5_000
		})
		.toBe(false);
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
