import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** Gutter double-click on a fresh (empty) chat: with no articles, the
hero text anchors the column, and the bare main below the 60%-capped
messages pane is gutter too — not dead space. */

test("gutter double-click opens the chat list anywhere left of the column", async ({
	page
}) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const aside = page.locator("aside:not(.settings-panel)");
	await expect(aside).toHaveClass(/collapsed/);
	// Below the hero zone: bare <main>, past the messages pane's cap.
	const main = await page.locator("main").boundingBox();
	if (!main) throw new Error("no main box");
	await page.mouse.dblclick(main.x + 10, main.y + main.height - 250);
	await expect(aside).not.toHaveClass(/collapsed/, { timeout: 10_000 });
	// Back to collapsed, then the classic strip beside the hero.
	await page.keyboard.press("Meta+b");
	await expect(aside).toHaveClass(/collapsed/);
	const box = await page.locator(".messages").boundingBox();
	if (!box) throw new Error("no messages box");
	await page.mouse.dblclick(box.x + 10, box.y + 120);
	await expect(aside).not.toHaveClass(/collapsed/, { timeout: 10_000 });
});
