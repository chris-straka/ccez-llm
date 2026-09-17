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

/** Double-clicking open space below the thread focuses the composer:
margins hit-test to the scroller, so the gap past the last message
summons the prompt (a real text pick lands on text instead). */
test("double-clicking below the thread focuses the composer", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "one" },
		{ role: "assistant", content: "two" }
	]);
	await page.goto("/");
	const last = page.locator("article.assistant");
	await expect(last).toBeVisible({ timeout: 60_000 });
	const box = await last.boundingBox();
	if (!box) throw new Error("no article box");
	await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height + 6);
	await expect
		.poll(() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")), {
			timeout: 10_000
		})
		.toBe(true);
});
