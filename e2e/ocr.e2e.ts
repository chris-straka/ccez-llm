import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * On-device OCR (macOS Vision bridge): image attachments offer a
 * "Recognize text in image" action whose text lands in the composer as
 * selectable text for the pinyin/furigana pipeline. These specs run in
 * the browser preview (no Tauri shell), so they pin the user-visible
 * affordance and its graceful degradation — never a recognition pass,
 * which needs the Mac app (unverified on device by design).
 */

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
});

test("image attachments offer text recognition", async ({ page }) => {
	await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/attach.bmp");
	const item = page.locator(".attachments li").first();
	await expect(item).toBeVisible({ timeout: 10_000 });
	await expect(item.locator('button[aria-label="Recognize text in image"]')).toBeVisible();
});

test("history card OCR explains without the Mac shell", async ({ page }) => {
	// A sent message's expanded card carries a working OCR button:
	// without the shell the same calm toast explains (this also pins
	// the delegated click reaching the stored attachment).
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
						{ id: "e2e-m1", role: "assistant", content: "a picture", usage: null, error: null }
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
	await expect(page.locator(".toast")).toContainText("needs the Mac app", { timeout: 10_000 });
});

test("recognition degrades cleanly without the Mac shell", async ({ page }) => {
	await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/attach.bmp");
	const item = page.locator(".attachments li").first();
	await expect(item).toBeVisible({ timeout: 10_000 });
	const ocr = item.locator('button[aria-label="Recognize text in image"]');
	await ocr.click();
	// No shell here: the support probe fails first, so a calm toast
	// explains — no red inline error, no stuck busy state, no throw
	// into teardown.
	await expect(page.locator(".toast")).toContainText("needs the Mac app", { timeout: 10_000 });
	await expect(ocr).toBeEnabled({ timeout: 10_000 });
	await expect(page.locator('p.error[role="alert"]')).toHaveCount(0);
});
