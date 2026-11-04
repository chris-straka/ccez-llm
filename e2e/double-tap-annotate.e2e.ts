import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

/** A phone double-tap on a word selects it and annotates it at once
(its word card asked for); double-tapping it again opens that card
instead of a second note (owner, 2026-11-04). */
test("double-tapping a word annotates it; again opens its card", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "Ce qui va changer pour les lycéens." }
	]);
	await page.addInitScript(() => {
		localStorage.setItem(
			"ccez-mock-reply",
			JSON.stringify({
				meaning: "students at a lycée",
				parts: [],
				facts: [],
				lang: "fr"
			})
		);
	});
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const box = await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered")!;
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) {
			const at = n.textContent!.indexOf("lycéens");
			if (at < 0) continue;
			const r = document.createRange();
			r.setStart(n, at + 2);
			r.setEnd(n, at + 3);
			const b = r.getBoundingClientRect();
			return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		}
		throw new Error("no word");
	});
	const doubleTap = async (): Promise<void> => {
		await page.touchscreen.tap(box.x, box.y);
		await page.waitForTimeout(120);
		await page.touchscreen.tap(box.x, box.y);
	};
	await doubleTap();
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toHaveCount(1, { timeout: 10_000 });
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toBeVisible({
		timeout: 10_000
	});
	await page.screenshot({ path: ".screenshots/double-tap-annotated.png" });
	// Again on the same word: its card, not a second note.
	await page.touchscreen.tap(20, 880);
	await page.waitForTimeout(500);
	await doubleTap();
	await expect(page.locator(".ann-answer.placed")).toBeVisible({
		timeout: 5_000
	});
	await expect(badge).toHaveCount(1);
	await expect(page.locator(".ann-answer-head")).toHaveText(
		"students at a lycée"
	);
	await page.screenshot({ path: ".screenshots/double-tap-card.png" });
});
