import { expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Furigana survives the answer card: annotating Japanese, answering,
 * and opening the card must leave the readings panel for the quote
 * on top — hittable at its own center, never buried under the card.
 * (The card hangs over the same highlight it answers.)
 */
test("answer card leaves the furigana panel on top", async ({ page }) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"夜は日記を書きます。日本語の発音は難しいですが、話す練習がとても楽しいです。"
		}
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "500");
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "日記");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("A");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what does this mean?");
	await page.keyboard.press("Enter");
	await expect(pop).toHaveCount(0);
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toBeVisible({ timeout: 30_000 });
	await page
		.locator("button.ccez-ann-badge.ans-ready")
		.first()
		.focus();
	await page.keyboard.press("Enter");
	await expect(
		page.locator(".ann-wrap.pinned .review, .ann-answer")
	).toBeVisible({ timeout: 10_000 });
	// The panel carries the reading and paints above the card
	// hanging over the same highlight. (Hit-testing can't prove
	// it: panels are pointer-events-none by design, so
	// elementFromPoint skips them — paint order does the proof:
	// both are fixed in the root context, higher z wins.)
	const panel = page.locator(".sel-pinyin", { hasText: "にっき" }).first();
	await expect(panel).toBeVisible({ timeout: 10_000 });
	const order = await panel.evaluate((el) => {
		const box = el.getBoundingClientRect();
		const card = document.querySelector(".ann-answer");
		if (!(card instanceof HTMLElement)) return "no-card";
		const cb = card.getBoundingClientRect();
		const overlaps = !(
			box.right < cb.left ||
			box.left > cb.right ||
			box.bottom < cb.top ||
			box.top > cb.bottom
		);
		return JSON.stringify({
			panelZ: getComputedStyle(el).zIndex,
			cardZ: getComputedStyle(card).zIndex,
			overlaps
		});
	});
	expect(order).not.toBe("no-card");
	const { panelZ, cardZ, overlaps } = JSON.parse(order) as {
		panelZ: string;
		cardZ: string;
		overlaps: boolean;
	};
	expect(overlaps).toBe(true);
	expect(Number(panelZ)).toBeGreaterThan(Number(cardZ));
});
