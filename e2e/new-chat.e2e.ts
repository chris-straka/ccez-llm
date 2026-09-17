import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/** New-chat sidebar behavior: creation toasts, empty rows stay quiet,
and the count tip answers the row button — never its action buttons. */

async function openSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside:not(.settings-panel)")).not.toHaveClass(/collapsed/);
}

test("minting a chat toasts Chat created", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await openSidebar(page);
	await page.locator('aside:not(.settings-panel) button[aria-label="New chat"]').click();
	await expect(page.locator(".toast")).toHaveText("Chat created");
	// Light default: white card, not the dark-always pill.
	await expect(page.locator(".toast")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("empty chats render no hover tip", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await openSidebar(page);
	await page.locator('aside:not(.settings-panel) button[aria-label="New chat"]').click();
	await openSidebar(page);
	const rows = page.locator("aside:not(.settings-panel) ul li");
	await expect(rows).toHaveCount(2);
	// Only the chat with messages reports counts.
	await expect(page.locator("aside:not(.settings-panel) .side-tip")).toHaveCount(1);
});

test("row tip answers the row button, not its action buttons", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await openSidebar(page);
	const row = page.locator("aside:not(.settings-panel) li:has(.side-tip)").first();
	const tip = row.locator(".side-tip");
	// Drop the keyboard focus the sidebar-open lands on the row:
	// :focus-visible would keep the tip lit through every hover below.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	await expect(tip).toHaveCSS("opacity", "0");
	// Settle the drawer slide and reveal the overlay buttons first:
	// force-hovering mid-slide misses the viewport.
	await row.hover();
	await row.locator("button.exp").hover();
	await expect(tip).toHaveCSS("opacity", "0");
	await row.locator("button.side-chat").hover();
	await expect(tip).toHaveCSS("opacity", "1");
});
