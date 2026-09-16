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

test("recognition degrades cleanly without the Mac shell", async ({ page }) => {
	await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/attach.bmp");
	const item = page.locator(".attachments li").first();
	await expect(item).toBeVisible({ timeout: 10_000 });
	const ocr = item.locator('button[aria-label="Recognize text in image"]');
	await ocr.click();
	// No shell here: the bridge rejects, the friendly error renders in
	// the attachments block, and the button re-enables — no stuck
	// busy state, no throw into teardown.
	await expect(page.locator('p.error[role="alert"]')).toBeVisible({ timeout: 10_000 });
	await expect(ocr).toBeEnabled({ timeout: 10_000 });
});
