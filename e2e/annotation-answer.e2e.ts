import { expect, test } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Annotation remodel: filing a note fires a separate model request
 * (the mock answers), the badge reads ready, clicking it opens the
 * answer in context, and Add to prompt files it into the composer.
 */
test("filed question answers in context and joins the prompt", async ({
	page
}) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	const selText = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selText.trim().length).toBeGreaterThan(0);
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("a");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what lives here?");
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toBeVisible({ timeout: 15_000 });
	// Slow mock one-shot: blue while waiting, orange on arrival. A
	// failed request banners in the composer instead — surface its
	// text, not a bare timeout.
	await expect(
		page.locator("button.ccez-ann-badge.ans-waiting")
	).toBeVisible({ timeout: 10_000 });
	// The waiting badge pulses its request in flight.
	const pulse = await page
		.locator("button.ccez-ann-badge.ans-waiting")
		.evaluate((el) => getComputedStyle(el).animationName);
	expect(pulse).toContain("ann-badge-wait");
	await page.waitForFunction(
		() =>
			document.querySelector("button.ccez-ann-badge.ans-ready") ||
			document.querySelector(".error-banner"),
		{ timeout: 15_000 }
	);
	// Absent banners never resolve: bound the read, or its default
	// auto-wait burns the test budget and the real assertion below
	// evaluates during teardown.
	const bannered = await page
		.locator(".error-banner")
		.textContent({ timeout: 1_000 })
		.catch(() => null);
	expect(bannered, "answer request failed").toBeNull();
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 10_000 });
	// The thread sits top-scrolled under the sticky header, which
	// intercepts pointer events over the badge: keyboard-activate
	// instead (buttons act on Enter without hit-testing).
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await expect(card).toContainText("Mock reply to:");
	// No quote title, no close button: the highlighted word
	// upstream is the title, click-off closes.
	await expect(card.locator(".ann-answer-quote")).toHaveCount(0);
	await expect(
		card.getByRole("button", { name: "Close answer" })
	).toHaveCount(0);
	// The card fades in below the word, never covering it.
	const fade = await card.evaluate(
		(el) => getComputedStyle(el).animationName
	);
	expect(fade).toContain("ann-answer-in");
	const badgeBox = await ready.boundingBox();
	const cardBox = await card.boundingBox();
	expect(badgeBox).toBeTruthy();
	expect(cardBox).toBeTruthy();
	expect(cardBox!.y).toBeGreaterThanOrEqual(badgeBox!.y + badgeBox!.height);
	await card.getByRole("button", { name: "Add answer to prompt" }).click();
	await expect(page.locator(".prompt .ta-input")).toHaveValue(
		/Mock reply to:/,
		{ timeout: 15_000 }
	);
	await expect(card).toHaveCount(0);
});

/** Clicking off the answer card fades it out (no close button):
a plain click on empty thread space unmounts it past the ramp. */
test("clicking off the answer closes it", async ({ page }) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("a");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what lives here?");
	await page.keyboard.press("Enter");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 20_000 });
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	// Plain click on empty thread space (below the messages, not a
	// drag): the card fades out and unmounts.
	const pt = await page.evaluate(() => {
		const main = document.querySelector("main")!.getBoundingClientRect();
		return { x: Math.round(main.width / 2), y: Math.round(main.height - 20) };
	});
	await page.mouse.move(pt.x, pt.y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(card).toHaveCount(0, { timeout: 5_000 });
});

/** A Chinese quote earns a pinyin readings line above the answer:
local, sync, no extra request. */
test("chinese answer shows a pinyin readings line", async ({ page }) => {
	test.setTimeout(120_000);
	await seedChat(page, [{ role: "assistant", content: "雨过天晴" }]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "雨过");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("a");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what does this mean?");
	await page.keyboard.press("Enter");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 20_000 });
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	const readings = card.locator(".ann-answer-readings");
	await expect(readings).toBeVisible({ timeout: 10_000 });
	await expect(readings.locator("ruby rt").first()).toContainText("yǔ");
});
