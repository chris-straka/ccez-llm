import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Text recognition: the native bridge where one exists (macOS Vision,
 * Windows WinRT, Linux system Tesseract), otherwise the in-client
 * Tesseract fallback. The action's text lands in the composer as
 * selectable text for the pinyin/furigana pipeline. These specs run in
 * the browser preview (no Tauri shell), so they exercise the fallback
 * live — engine fetch included — while the native pass stays
 * unverified on device by design.
 */

/** Drop a canvas-painted text image onto the composer (high-contrast
 * print the fallback engine reads reliably). */
async function dropTextImage(page: Page, text: string): Promise<void> {
	await page.evaluate((words) => {
		const canvas = document.createElement("canvas");
		canvas.width = 600;
		canvas.height = 160;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D unavailable");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, 600, 160);
		ctx.fillStyle = "#000000";
		ctx.font = "64px sans-serif";
		ctx.fillText(words, 30, 105);
		return new Promise<void>((resolve, reject) => {
			canvas.toBlob((blob) => {
				try {
					if (!blob) throw new Error("canvas produced no blob");
					const transfer = new DataTransfer();
					transfer.items.add(new File([blob], "words.png", { type: "image/png" }));
					const target = document.querySelector(".prompt");
					if (!target) throw new Error("missing composer");
					target.dispatchEvent(
						new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
					);
					resolve();
				} catch (error) {
					reject(error);
				}
			}, "image/png");
		});
	}, text);
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
});

test("image attachments offer text recognition", async ({ page }) => {
	await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/attach.bmp");
	const item = page.locator(".attachments li").first();
	await expect(item).toBeVisible({ timeout: 10_000 });
	await expect(item.locator('button[aria-label="Recognize text in image"]')).toBeVisible();
});

test("history card OCR reports a textless image without the Mac shell", async ({ page }) => {
	// A sent message's expanded card carries a working OCR button:
	// the pixel carries no text, so the fallback reports the miss
	// (this also pins the delegated click reaching the stored
	// attachment).
	const pixel =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	await page.addInitScript((url) => {
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-m0",
							role: "assistant",
							content:
								"Welcome to the chat. This preface pushes the tagged turn below the fixed app header.",
							usage: null,
							error: null
						},
						{
							id: "e2e-m1",
							role: "user",
							content: "[Pasted image] what do you see here?",
							usage: null,
							error: null,
							attachments: [
								{
									id: "e2e-img-0",
									name: "shot.png",
									mime: "image/png",
									kind: "image",
									dataUrl: url,
									text: null,
									width: 1,
									height: 1,
									tokens: 85
								}
							]
						},
						{ id: "e2e-m2", role: "assistant", content: "a picture", usage: null, error: null }
					]
				}
			])
		);
	}, pixel);
	await page.reload();
	const tag = page.locator("article.user .sent-fold").first();
	await expect(tag).toBeVisible({ timeout: 60_000 });
	await tag.click();
	const card = page.locator("article.user .sent-open").first();
	await expect(card).toBeVisible();
	await card.locator("button", { hasText: "OCR" }).click();
	await expect(page.locator(".toast")).toContainText("No text found", { timeout: 120_000 });
});

test("recognition falls back live without the Mac shell", async ({ page }) => {
	await dropTextImage(page, "hello 123");
	const item = page.locator(".attachments li").first();
	await expect(item).toBeVisible({ timeout: 10_000 });
	const ocr = item.locator('button[aria-label="Recognize text in image"]');
	await ocr.click();
	// No shell here, so the in-client fallback runs (engine fetch on
	// first use — generous timeout): the words land in the composer
	// and the button re-enables, no stuck busy state.
	await expect(page.locator(".ta-input").first()).toHaveValue(/hello/, {
		ignoreCase: true,
		timeout: 120_000
	});
	await expect(ocr).toBeEnabled({ timeout: 10_000 });
	await expect(page.locator('p.error[role="alert"]')).toHaveCount(0);
});
