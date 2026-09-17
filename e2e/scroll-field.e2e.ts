import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/** Scroll mode must own the stage, not typing: command letters in a
native field have to land as text (the focus-drop report typed over
scroll mode entered via find-cycling/Ctrl+G and lost d/i/j/k/u/g). */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
});

/** Enter scroll mode from the composer (mount focuses it: seeds run idle-hide off). */
async function enterScroll(page: Page): Promise<void> {
	await page.locator(".ta-input").first().click();
	await page.keyboard.press("Control+g");
	await expect(page.locator("article.selected")).toHaveCount(1);
}

test("scroll mode keeps field keys in settings", async ({ page }) => {
	await enterScroll(page);
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const target = page.locator(".settings-panel textarea").first();
	await expect(target).toBeVisible();
	await target.click();
	await expect(target).toBeFocused();
	await page.keyboard.type("dijk", { delay: 60 });
	await expect(target).toHaveValue(/dijk/);
	await expect(target).toBeFocused();
});

/** Open-list chat keys (j/k/l/Space/Delete) typed in a settings field
must land as text — the list owns its keys, not typing. */
test("open list keeps field keys in settings", async ({ page }) => {
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const target = page.locator(".settings-panel textarea").first();
	await expect(target).toBeVisible();
	await target.click();
	await expect(target).toBeFocused();
	await page.keyboard.type("jkl", { delay: 60 });
	await expect(target).toHaveValue(/jkl/);
	await expect(target).toBeFocused();
});

test("scroll mode keeps field keys in the badge edit card", async ({ page }) => {
	// File one annotation first (edit mode throughout).
	await page.locator("article .rendered").first().selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.locator(".ann-pop textarea").fill("seed note");
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	// Now enter scroll mode, open the EDIT card, and type command letters.
	await enterScroll(page);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	const area = page.locator(".ann-pop textarea");
	await expect(area).toBeFocused();
	await area.click();
	await page.keyboard.type("dudg", { delay: 60 });
	await expect(area).toHaveValue(/dudg/);
	await expect(area).toBeFocused();
});
