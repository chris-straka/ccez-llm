import { test, expect } from "@playwright/test";
import { seedChat, toggleSidebar } from "./helpers";

/** Gutter double-click on a fresh (empty) chat: with no articles, the
hero text anchors the column, and the bare main below the 60%-capped
messages pane is gutter too — not dead space. */

test("gutter double-click opens the chat list anywhere left of the column", async ({
	page
}) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const aside = page.locator("aside:not(.settings-panel)");
	await expect(aside).toHaveClass(/collapsed/);
	// Below the hero zone: bare <main>, past the messages pane's cap.
	const main = await page.locator("main").boundingBox();
	if (!main) throw new Error("no main box");
	await page.mouse.dblclick(main.x + 10, main.y + main.height - 250);
	await expect(aside).not.toHaveClass(/collapsed/, { timeout: 10_000 });
	// Back to collapsed, then the classic strip beside the hero.
	await toggleSidebar(page);
	await expect(aside).toHaveClass(/collapsed/);
	const box = await page.locator(".messages").boundingBox();
	if (!box) throw new Error("no messages box");
	await page.mouse.dblclick(box.x + 10, box.y + 120);
	await expect(aside).not.toHaveClass(/collapsed/, { timeout: 10_000 });
});

/** Double-clicking open space below the thread focuses the composer:
margins hit-test to the scroller, so the gap past the last message
summons the prompt (a real text pick lands on text instead). */
test("double-clicking below the thread focuses the composer", async ({
	page
}) => {
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
		.poll(
			() => page.evaluate(() => !!document.activeElement?.closest?.(".prompt")),
			{
				timeout: 10_000
			}
		)
		.toBe(true);
});

/** Dragging inside an Arabic (RTL) paragraph keeps the selection in
that paragraph: starting top-right and moving left/down past the
first sentence must not sweep up the English line above it. */
test("arabic drag stays inside the arabic paragraph", async ({ page }) => {
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"Here is an Arabic paragraph for your practice:\n\nكُلَّ يَوْمٍ أَتَعَلَّمُ اللُّغَةَ الْعَرَبِيَّةَ فِي الْمَكْتَبَةِ. فِي الصَّبَاحِ أَقْرَأُ دَرْسًا جَدِيدًا."
		}
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toBeVisible({ timeout: 60_000 });
	const para = body.locator("p", { hasText: "كُلَّ" });
	const box = await para.boundingBox();
	if (!box) throw new Error("no arabic paragraph box");
	// Start top-right (the reading start in RTL) and drag left/down
	// past the first sentence, like the report.
	await page.mouse.move(box.x + box.width - 4, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + 4, box.y + box.height - 8, { steps: 12 });
	await page.mouse.up();
	const sel = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(sel).not.toContain("Here is an Arabic");
	expect(sel).toContain("يَوْمٍ");
});
