import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Draft annotations belong to one chat: leaving files them away,
restoring them on return, and the other chat's composer stays clean. */
test("annotation drafts stay with their chat", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Kyoto is an old capital with many temples and quiet gardens" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });

	// File one draft annotation (unsent) in chat A.
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const draft = page.locator(".prompt-tools .ann-wrap");
	await expect(draft).toHaveCount(1);

	// New chat B: composer starts clean.
	await page.locator(".ta-input").click();
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.locator('button[aria-label="New chat"]').click();
	await expect(page.locator(".hero")).toBeVisible();
	await expect(page.locator(".prompt-tools .ann-wrap")).toHaveCount(0);

	// Back to chat A: the draft is restored, not duplicated. New chats
	// append at the bottom (see newChat), so A is still the first row.
	const rows = page.locator("aside ul li button.side-chat");
	await rows.nth(0).click();
	await expect(page.locator(".prompt-tools .ann-wrap")).toHaveCount(1);
});
