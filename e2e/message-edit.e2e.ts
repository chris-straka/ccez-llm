import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Own-message edits stay in place: saving rewrites the message and
 * nothing else — no resend, no later-message churn — and a message
 * under edit never folds.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "original question" },
		{ role: "assistant", content: "first answer" },
		{ role: "assistant", content: "second answer" }
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
});

async function openUserEdit(page: Page): Promise<void> {
	const article = page.locator("article.user").first();
	await article.hover();
	await article.locator('button[aria-label="Edit this message"]').click();
	await expect(page.locator(".msg-edit .ta-input").first()).toBeVisible({ timeout: 10_000 });
}

test("saving an edit rewrites in place without resending", async ({ page }) => {
	await openUserEdit(page);
	await page.locator(".msg-edit .ta-input").first().click();
	await page.keyboard.press("ControlOrMeta+a");
	await page.keyboard.type("edited question");
	await page.locator('.msg-edit-bar button:has-text("Save")').click();
	// The edit box closes and the message shows the new text...
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator("article.user .rendered").first()).toContainText("edited question");
	// ...with no resend: same three messages, later ones untouched.
	await expect(page.locator("article")).toHaveCount(3);
	await expect(page.locator("article.assistant .rendered").nth(0)).toContainText("first answer");
	await expect(page.locator("article.assistant .rendered").nth(1)).toContainText("second answer");
	await expect(page.locator(".sending")).toHaveCount(0);
});

test("a message under edit never folds", async ({ page }) => {
	await openUserEdit(page);
	const article = page.locator("article.user").first();
	// The actions row below the edit box stays live: its fold button
	// must not fold the message out from under the draft.
	await article.locator('button[aria-label="Fold this message"]').click();
	await expect(page.locator(".msg-edit")).toHaveCount(1);
	await expect(article).not.toHaveClass(/folded-msg/);
	// The F key shares the same gate.
	await page.keyboard.press("f");
	await expect(page.locator(".msg-edit")).toHaveCount(1);
	await expect(article).not.toHaveClass(/folded-msg/);
	// Saving still works afterwards.
	await page.locator('.msg-edit-bar button:has-text("Save")').click();
	await expect(page.locator(".msg-edit")).toHaveCount(0);
});
