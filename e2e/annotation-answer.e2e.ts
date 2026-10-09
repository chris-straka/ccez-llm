import { expect, test, type Page } from "./fixtures";
import { dragQuote, seedChat } from "./helpers";

/**
 * Instant annotation questions: filing fires the annotation's own
 * separate request at once (the badge holds blue while waiting,
 * never blinking), and the reply lands as its answer (orange) —
 * no send involved, nothing staged.
 */
async function askAtFile(page: Page, question: string): Promise<void> {
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill(question);
	await page.keyboard.press("Enter");
	await expect(pop).toHaveCount(0);
	// The reply lands as the answer: blue turns orange. A failed
	// ask banners in the composer instead — surface its text, not
	// a bare timeout.
	await page.waitForFunction(
		() =>
			document.querySelector("button.ccez-ann-badge.ans-ready") ||
			document.querySelector(".error-banner"),
		{ timeout: 30_000 }
	);
	// Absent banners never resolve: bound the read, or its default
	// auto-wait burns the test budget and the real assertion below
	// evaluates during teardown.
	const bannered = await page
		.locator(".error-banner")
		.textContent({ timeout: 1_000 })
		.catch(() => null);
	expect(bannered, "annotation ask failed").toBeNull();
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toBeVisible({
		timeout: 10_000
	});
}

test("staged question asks on send and the reply lands as its answer", async ({
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
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
	await expect(card.getByRole("button", { name: "Close answer" })).toHaveCount(
		0
	);
	// The card fades in below the word, never covering it.
	const fade = await card.evaluate((el) => getComputedStyle(el).animationName);
	expect(fade).toContain("ann-answer-in");
	const badgeBox = await ready.boundingBox();
	const cardBox = await card.boundingBox();
	expect(badgeBox).toBeTruthy();
	expect(cardBox).toBeTruthy();
	expect(cardBox!.y).toBeGreaterThanOrEqual(badgeBox!.y + badgeBox!.height);
	// The answer also displays always under its dock row (green
	// annotated-text chip plus the reply text) — never popup-only.
	// The dock lists pinned rows only, so a second Enter pins
	// first (the card stays open through approval).
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.locator(".prompt-tools .ann-pill").click();
	const dock = page.locator(".ann-wrap .review");
	await expect(dock).toHaveCSS("opacity", "1");
	await expect(page.locator(".review-quote.annotated").first()).toBeVisible();
	await expect(page.locator(".review-answer").first()).toContainText(
		"Mock reply to:"
	);
});

/** The badge keeps its number: opening the card reads, a second
Enter (a double-click's second press) pins the annotation into the
send, a further re-press unpins it again (double-click toggles),
the dock's Unpin removes it again. The sent message carries
the approved block (quote, question, answer). */
test("badge re-press pins the send, dock Unpin removes it", async ({
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
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	// Nothing pinned: the badge keeps its number, no pill anywhere.
	const badge = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(badge).toHaveText("1");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	// Keyboard-open the card (no press — pointer hits die on the
	// sticky header): the badge keeps its number.
	await badge.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await expect(badge).toHaveText("1");
	// A second Enter pins (the double-click path): number stays,
	// pill rises with its count, and the card stays open
	// (approval is not dismissal).
	await page.keyboard.press("Enter");
	await expect(badge).toHaveText("1");
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toHaveAttribute("aria-label", "1 annotation");
	await expect(card).toBeVisible();
	// A further re-press unpins again (double-click toggles):
	// number stays, pill gone, card still open.
	await page.keyboard.press("Enter");
	await expect(badge).toHaveText("1");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await expect(card).toBeVisible();
	// And back: re-press pins once more.
	await page.keyboard.press("Enter");
	await expect(pill).toHaveAttribute("aria-label", "1 annotation");
	// The dock's Unpin removes again: number stays, pill gone.
	await pill.click();
	await page.locator('button:has-text("Unpin")').click();
	await expect(badge).toHaveText("1");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	// Pin once more and send: the send carries the approved block.
	// Display splits it out of the message text into the sent-refs
	// card, so the proof is the card, not raw block text.
	await badge.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveAttribute(
		"aria-label",
		"1 annotation"
	);
	await page.keyboard.press("Escape");
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.type("go");
	await page.locator(".send-btn").click();
	const refs = page.locator("article.user .ann-refs").last();
	await expect(refs).toBeVisible({ timeout: 30_000 });
	await refs.locator(".ann-refs-pill").click();
	await expect(refs.locator(".ann-refs-item")).toHaveCount(1);
	await expect(refs).toContainText("riverbank");
	await expect(refs).toContainText("what lives here?");
});

/** An unpinned annotation never reaches the send: filing and
answering leave the prompt bare. */
test("unapproved annotations never bake into a send", async ({ page }) => {
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.type("go");
	await page.locator(".send-btn").click();
	// The text goes out bare with no sent-refs card: nothing rode
	// along (display splits baked blocks out, so the card's absence
	// is the proof, not the raw text).
	const sent = page.locator("article.user .rendered").last();
	await expect(sent).toContainText("go", { timeout: 30_000 });
	await expect(page.locator("article.user .ann-refs")).toHaveCount(0);
});

/** A reload resets pins: a stale approval can't ride a later send,
while the answer itself persists orange. */
test("answered annotations stay orange across a reload", async ({ page }) => {
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toBeVisible({
		timeout: 10_000
	});
	// Pin with a second Enter, then reload: the answer persists
	// orange but the pin resets — no pill, nothing riding the
	// next send. The badge keeps its number throughout.
	const badge = page.locator("button.ccez-ann-badge.ans-ready");
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(badge).toHaveText("1");
	await page.keyboard.press("Enter");
	await expect(badge).toHaveText("1");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveAttribute(
		"aria-label",
		"1 annotation"
	);
	await page.reload();
	await expect(article).toBeVisible({ timeout: 60_000 });
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toBeVisible({
		timeout: 10_000
	});
	await expect(page.locator("button.ccez-ann-badge.ans-waiting")).toHaveCount(
		0
	);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
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

/** The open answer owns its quote's wash: moving the mouse off the
badge leaves the highlight up for as long as the card reads, and
closing the card releases it. */
test("open answer keeps its quote washed until the card closes", async ({
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
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	// Open off the badge (focus + Enter: a synthetic click can't land,
	// the sticky header covers the marker — the mouse-away half below
	// is the real pointer path under test).
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	const washed = (): Promise<boolean> =>
		page.evaluate(() =>
			["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"].some(
				(n) =>
					(
						window as unknown as {
							CSS?: { highlights?: { has(n: string): boolean } };
						}
					).CSS?.highlights?.has(n) ?? false
			)
		);
	// Park clear of badge and card, past the hover-clear hysteresis:
	// the wash must still paint while the card reads.
	await page.mouse.move(8, 8);
	await page.waitForTimeout(400);
	await expect.poll(washed, { timeout: 5_000 }).toBe(true);
	await expect(card).toBeVisible();
	// Clicking off closes the card and releases the wash with the fade.
	const pt = await page.evaluate(() => {
		const main = document.querySelector("main")!.getBoundingClientRect();
		return { x: Math.round(main.width / 2), y: Math.round(main.height - 20) };
	});
	await page.mouse.move(pt.x, pt.y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(card).toHaveCount(0, { timeout: 5_000 });
	await expect.poll(washed, { timeout: 5_000 }).toBe(false);
});

/** Waiting badges breathe while the ask flies; the answer lands with
a single glow ring, then the mark rests steady orange. (Computed
animation names are substring-matched: Svelte may suffix keyframes.) */
test("waiting badge breathes until the answer lands glowing", async ({
	page
}) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "12000");
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what lives here?");
	await page.keyboard.press("Enter");
	await expect(pop).toHaveCount(0);
	const animName = (sel: string): Promise<string> =>
		page.evaluate((s: string) => {
			const el = document.querySelector(s);
			return el ? getComputedStyle(el).animationName : "";
		}, sel);
	// The filed badge waits blue and breathes (motion = in-flight).
	const waiting = page.locator("button.ccez-ann-badge.ans-waiting");
	await expect(waiting).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(() => animName("button.ccez-ann-badge.ans-waiting"), {
			timeout: 5_000
		})
		.toContain("ccez-ann-breathe");
	// The answer lands orange with one arrival ring, then rests.
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 30_000 });
	await expect(ready).toHaveClass(/arrived/);
	await expect
		.poll(() => animName("button.ccez-ann-badge.ans-ready"), {
			timeout: 5_000
		})
		.toContain("ccez-ann-arrive");
});

/** Reduced motion keeps the waiting pulse (opacity only, slower):
a still badge can't say it's loading. */
test("waiting badge still breathes under reduced motion", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "12000");
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "riverbank");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("A");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill("what lives here?");
	await page.keyboard.press("Enter");
	const waiting = page.locator("button.ccez-ann-badge.ans-waiting");
	await expect(waiting).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(() => waiting.evaluate((el) => getComputedStyle(el).animationName), {
			timeout: 5_000
		})
		.toContain("ccez-ann-breathe");
});

/** The open answer card rides the thread: scrolling moves the
card with its quote (fixed plus scroll-delta tracking reads as
absolute), never stranding it over other messages. */
test("answer card scrolls with its quote", async ({ page }) => {
	test.setTimeout(120_000);
	const filler = (i: number) => ({
		role: "assistant" as const,
		content: `filler message ${i} pads the thread so it scrolls — a second line for height`
	});
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" },
		...Array.from({ length: 24 }, (_, i) => filler(i))
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant").first();
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "riverbank");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	const before = await card.boundingBox();
	expect(before).not.toBeNull();
	// Scroll the thread (the card's own document point moves up):
	// the card must follow by the same delta, still open.
	const delta = await page.evaluate(() => {
		const anchor = document.querySelector("article.assistant");
		let el: HTMLElement | null = anchor instanceof HTMLElement ? anchor : null;
		while (el) {
			if (el.scrollHeight > el.clientHeight + 8) break;
			el = el.parentElement;
		}
		if (!el) return null;
		el.scrollTop += 300;
		return 300;
	});
	expect(delta).toBe(300);
	await expect(card).toBeVisible({ timeout: 5_000 });
	// The scroll event plus the Svelte flush land async: wait for
	// the ride instead of reading mid-flight.
	const startY = before!.y;
	await page.waitForFunction(
		(y: number) =>
			document.querySelector(".ann-answer") &&
			(document.querySelector(".ann-answer")!.getBoundingClientRect()
				.y as number) <
				y - 280,
		startY,
		{ timeout: 5_000 }
	);
	const after = await card.boundingBox();
	expect(after).not.toBeNull();
	expect(before!.y - after!.y).toBeGreaterThan(280);
	expect(before!.y - after!.y).toBeLessThan(320);
});

/** A restart relaunches filed-but-unanswered asks: the waiting
badge fires on boot and turns orange on its own, while an already
answered draft never refires (its seeded answer survives). */
test("restart resumes unanswered annotation asks", async ({ page }) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-wait",
						messageId: "e2e-m0",
						quote: "riverbank",
						comment: "what lives here?",
						at: 0
					},
					{
						id: "ann-done",
						messageId: "e2e-m0",
						quote: "fog",
						comment: "?",
						answer: "seeded answer",
						at: 0
					}
				]
			})
		);
	});
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant").first();
	await expect(article).toBeVisible({ timeout: 60_000 });
	// Both badges stamp; the answered one is orange from boot.
	const badges = page.locator("button.ccez-ann-badge");
	await expect(badges).toHaveCount(2, { timeout: 10_000 });
	// The waiting ask relaunches on boot: blue turns orange alone.
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toHaveCount(2, {
		timeout: 30_000
	});
	// And the answered draft never refired: opening its badge
	// shows the seeded answer (a refire would mock-overwrite it).
	const done = page.locator("button.ccez-ann-badge.ans-ready").nth(1);
	await done.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await expect(card).toContainText("seeded answer");
});

/** A Chinese answer spawns the right-click pinyin panel above the
quote (never a quote repeated in the card): local, sync, no extra
request. */
test("chinese answer spawns the pinyin panel above the quote", async ({
	page
}) => {
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what does this mean?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	// No quote line in the card (the mock answer echoes its context,
	// so only the repeated-quote element is assertable): the
	// highlighted word upstream is the title.
	await expect(card.locator(".ann-answer-readings")).toHaveCount(0);
	// The right-click pinyin popup appears above the hanzi.
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("yǔ");
	await expect(panel).not.toContainText("雨过");
	// The card hangs below the quote, never covering it.
	const cardBox = await card.boundingBox();
	const quoteBottom = await page.evaluate(() => {
		const live = window.getSelection();
		const rect =
			live && live.rangeCount > 0
				? live.getRangeAt(0).getBoundingClientRect()
				: null;
		return rect?.bottom ?? null;
	});
	expect(cardBox).not.toBeNull();
	expect(quoteBottom).not.toBeNull();
	expect((cardBox?.y ?? -1) >= (quoteBottom ?? 1e9)).toBe(true);
});

/** Clicking a Chinese answer's badge spawns the pinyin panel above
the quote just like the keyboard path: the mouseup after the press
must not clear the live selection the panel rides on. */
test("badge click spawns the pinyin panel above the quote", async ({
	page
}) => {
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
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what does this mean?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	// Real mouse click (mousedown + mouseup), not keyboard Enter.
	await ready.click();
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	// The pinyin popup appears above the hanzi and survives the click.
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("yǔ");
	await expect(panel).not.toContainText("雨过");
	// Clicking off closes the card and drops its pinyin panel with it.
	await article.click({ position: { x: 5, y: 5 } });
	await expect(card).toHaveCount(0);
	await expect(panel).toHaveCount(0);
});

/** A quote living in two same-reply paragraphs resolves its own: the
Chinese 旅行 (second match) opens its paragraph's pinyin, never the
Japanese paragraph's furigana. */
test("second-occurrence quote opens its own paragraph's readings", async ({
	page
}) => {
	test.setTimeout(120_000);
	await seedChat(page, [
		{
			role: "assistant",
			content: "日本語の旅行は楽しいです。\n\n北京旅行很好。"
		}
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	// Rect of the second 旅行 (the Chinese one): badge chrome stays
	// out so offsets map onto visible text, like quoteRect.
	const rect = await page.evaluate(() => {
		const root = document.querySelectorAll("article .rendered")[0];
		if (!root) throw new Error("no article");
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			const parent = node.parentNode;
			if (parent instanceof Element && parent.closest("[data-ann-badge]"))
				continue;
			if (node instanceof Text) texts.push(node);
		}
		const hay = texts.map((t) => t.textContent ?? "").join("");
		const first = hay.indexOf("旅行");
		const at = hay.indexOf("旅行", first + 1);
		if (at < 0) throw new Error("second match missing");
		const nodeAt = (flat: number): [Text, number] => {
			let rest = flat;
			for (const t of texts) {
				const len = (t.textContent ?? "").length;
				if (rest <= len) return [t, rest];
				rest -= len;
			}
			const last = texts[texts.length - 1];
			if (!last) throw new Error("no text");
			return [last, (last.textContent ?? "").length];
		};
		const [startNode, startOff] = nodeAt(at);
		const [endNode, endOff] = nodeAt(at + 2);
		const range = document.createRange();
		range.setStart(startNode, startOff);
		range.setEnd(endNode, endOff);
		return range.getBoundingClientRect().toJSON() as {
			x: number;
			y: number;
			width: number;
			height: number;
		};
	});
	await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
	await page.mouse.down();
	await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
		steps: 8
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what does this mean?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await ready.click();
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	// Pinyin for the Chinese quote (lǚ), never Japanese furigana.
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("lǚ");
});

/** Creating a Chinese annotation shows its pinyin panel above the
quote while the pill is open (pinned past the pill's focus
collapse); cancelling drops both. */
test("creating a chinese annotation shows its pinyin panel", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "雨过天晴" }]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await dragQuote(page, 0, "雨过");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the create box empty (bare A files and sends at
	// once now): the Han quote earns its pinyin panel above it while
	// creating.
	await page.keyboard.press("A");
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await expect(pop.locator("textarea")).toHaveValue("");
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("yǔ");
	// Cancelling the pill drops its pinned panel with it.
	await page.keyboard.press("Escape");
	await expect(pop).toHaveCount(0);
	await expect(panel).toHaveCount(0);
});

/** Seed a chat whose last message carries one answered note on
"riverbank", for placement specs that don't need a live ask. */
async function seedAnsweredLast(page: Page, answer: string): Promise<void> {
	const paras = Array.from(
		{ length: 12 },
		(_, i) => `filler paragraph number ${i} with enough words to wrap`
	);
	await seedChat(page, [
		...paras.map((content) => ({ role: "assistant" as const, content })),
		{ role: "assistant", content: "the annotated riverbank holds the fog" }
	]);
	await page.addInitScript(
		(seed: { answer: string }) => {
			window.localStorage.setItem(
				"ccez-llm-annotations-v1",
				JSON.stringify({
					"e2e-chat": [
						{
							id: "ann-e2e",
							messageId: "e2e-m12",
							quote: "riverbank",
							comment: "what lives here?",
							answer: seed.answer,
							at: 0
						}
					]
				})
			);
		},
		{ answer }
	);
}

/** Scroll the thread to its end, instantly. */
async function scrollThreadToEnd(page: Page): Promise<number> {
	return page.evaluate(() => {
		let el: Element | null = document.querySelector("[data-ann-badge]");
		while (el) {
			const parent = el.parentElement;
			if (
				parent instanceof HTMLElement &&
				parent.scrollHeight > parent.clientHeight + 4
			) {
				parent.style.scrollBehavior = "auto";
				parent.scrollTop = parent.scrollHeight;
				return parent.scrollTop;
			}
			el = parent;
		}
		return -1;
	});
}

async function threadTop(page: Page): Promise<number> {
	return page.evaluate(() => {
		let el: Element | null = document.querySelector("[data-ann-badge]");
		while (el) {
			const parent = el.parentElement;
			if (
				parent instanceof HTMLElement &&
				parent.scrollHeight > parent.clientHeight + 4
			)
				return parent.scrollTop;
			el = parent;
		}
		return -1;
	});
}

/** An answer at the bottom of the thread flips above its word (tail
pointing down at it) instead of running off the edge or scrolling
the page; it stays clear of the badge and inside the window. */
test("bottom answer flips above without moving the thread", async ({
	page
}) => {
	test.setTimeout(120_000);
	await seedAnsweredLast(
		page,
		"riverbank: the land along a river\nLiterally the bank of a river.\nWe walked along the riverbank at dawn."
	);
	await page.goto("/");
	await page.setViewportSize({ width: 1280, height: 600 });
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 60_000 });
	const top = await scrollThreadToEnd(page);
	expect(top).toBeGreaterThan(0);
	await page.waitForTimeout(300);
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await expect(card).toHaveClass(/above/);
	await page.waitForTimeout(250);
	const cardBox = await card.boundingBox();
	const badgeBox = await ready.boundingBox();
	expect(cardBox!.y).toBeGreaterThanOrEqual(0);
	expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(badgeBox!.y);
	expect(await threadTop(page)).toBe(top);
	// The note's first line reads as its headline.
	await expect(card.locator(".ann-answer-head")).toHaveText(
		"riverbank: the land along a river"
	);
});

/** A note taller than the room on either side caps its height and
scrolls inside the card: never cut off, never pushing the page. */
test("tall answer caps its height and scrolls inside", async ({ page }) => {
	test.setTimeout(120_000);
	const answer = Array.from(
		{ length: 30 },
		() => "the riverbank holds its fog through the morning light"
	).join(". ");
	await seedAnsweredLast(page, answer);
	await page.goto("/");
	await page.setViewportSize({ width: 1280, height: 420 });
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 60_000 });
	const top = await scrollThreadToEnd(page);
	await page.waitForTimeout(300);
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await page.waitForTimeout(250);
	const fit = await page.evaluate(() => {
		const el = document.querySelector(".ann-answer")!;
		const body = el.querySelector(".ann-answer-body")!;
		const r = el.getBoundingClientRect();
		return {
			top: r.top,
			bottom: r.bottom,
			vh: window.innerHeight,
			scrolls: body.scrollHeight > body.clientHeight + 4
		};
	});
	expect(fit.top).toBeGreaterThanOrEqual(0);
	expect(fit.bottom).toBeLessThanOrEqual(fit.vh);
	expect(fit.scrolls).toBe(true);
	expect(await threadTop(page)).toBe(top);
});

/** Bottom badge press: WebKit's trailing click (fired after the
preventDefaulted mousedown; Chromium eats it) can land off-badge on
a common ancestor once the card mounts over the press. It must not shut the card it just opened — the
opening press's own click is never a click-off. (Chromium cannot
fire that trailing click itself, so the test dispatches its exact
shape: a non-drag click at the press point, targeted off-card and
off-badge, inside the window.) */
test("below-fold badge press survives its own trailing click", async ({
	page
}) => {
	test.setTimeout(120_000);
	const paras = Array.from(
		{ length: 12 },
		(_, i) => `filler paragraph number ${i} with enough words to wrap`
	);
	await seedChat(page, [
		...paras.map((content) => ({ role: "assistant" as const, content })),
		{ role: "assistant", content: "the annotated riverbank holds the fog" }
	]);
	// Long seeded answer: a tall card that cannot fit below a
	// composer-parked badge, so the open must scroll the thread.
	const answer = Array.from(
		{ length: 18 },
		() => "the riverbank holds its fog through the morning light"
	).join(". ");
	await page.addInitScript(
		(seed: { answer: string }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem(
				"ccez-llm-annotations-v1",
				JSON.stringify({
					"e2e-chat": [
						{
							id: "ann-e2e",
							messageId: "e2e-m12",
							quote: "riverbank",
							comment: "what lives here?",
							answer: seed.answer,
							at: 0
						}
					]
				})
			);
		},
		{ answer }
	);
	await page.goto("/");
	// Short viewport: the last quote sits where the tall card
	// cannot fit below it, so opening must scroll the thread.
	await page.setViewportSize({ width: 1280, height: 500 });
	const articles = page.locator("article.assistant");
	await expect(articles.last()).toBeVisible({ timeout: 60_000 });
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(ready).toBeVisible({ timeout: 10_000 });
	const scrolled = async (): Promise<number> =>
		page.evaluate(() => {
			let el: Element | null = document.querySelector(
				"article.assistant:last-of-type"
			);
			while (el) {
				if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 4)
					return el.scrollTop;
				el = el.parentElement;
			}
			return -1;
		});
	// Instant scrolling throughout: focusing the below-fold badge
	// scrolls it into view, and a smooth ramp would still be moving
	// the thread when the park below measures the press point.
	await page.evaluate(() => {
		const el = document.querySelector(".messages");
		if (el instanceof HTMLElement) el.style.scrollBehavior = "auto";
	});
	// Open once to measure the real card height, then close: the
	// park below needs it to predict the overflow.
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	const cardH = await page.evaluate(
		() =>
			document.querySelector(".ann-answer")?.getBoundingClientRect().height ??
			null
	);
	expect(cardH).not.toBeNull();
	await page.keyboard.press("Escape");
	await expect(card).toHaveCount(0);
	// Park the badge just above the fixed composer (clickable,
	// never under it), with the tall card overflowing the fold.
	// The thread eases programmatic jumps (smooth scrolling), so
	// pin instant first — otherwise the park is still animating
	// when the press below measures its point.
	const parked = await page.evaluate((h: number) => {
		const badge = document.querySelector("[data-ann-badge]");
		const prompt = document.querySelector(".prompt");
		if (!(badge instanceof HTMLElement) || !(prompt instanceof HTMLElement))
			return null;
		const top = prompt.getBoundingClientRect().top;
		const wantBottom = top - 12;
		let el: Element | null = badge;
		while (el) {
			const parent = el.parentElement;
			if (
				parent instanceof HTMLElement &&
				parent.scrollHeight > parent.clientHeight + 4
			) {
				parent.style.scrollBehavior = "auto";
				parent.scrollTop += badge.getBoundingClientRect().bottom - wantBottom;
				break;
			}
			el = parent;
		}
		const r = badge.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2);
		const y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return {
			x,
			y,
			clickable: hit instanceof Element && !!hit.closest("[data-ann-badge]"),
			overflow: r.bottom + 2 + h - (window.innerHeight - 8)
		};
	}, cardH as number);
	expect(parked).not.toBeNull();
	// Preconditions: the badge takes a real press, and the card
	// cannot fit below it (it flips above, over the press point's
	// neighbourhood, so the trailing click is the risky shape).
	expect(parked!.clickable).toBe(true);
	expect(parked!.overflow).toBeGreaterThan(20);
	await page.waitForTimeout(300);
	// Real press on the badge: mousedown opens the card, mouseup
	// follows with the pointer unmoved. The thread never scrolls
	// to make room (the card flips instead).
	const topBefore = await scrolled();
	await page.mouse.move(parked!.x, parked!.y);
	await page.mouse.down();
	await expect(card).toBeVisible({ timeout: 10_000 });
	await page.mouse.up();
	expect(await scrolled()).toBe(topBefore);
	// WebKit's trailing click in its exact shape: a non-drag click
	// at the press point, targeted at the common ancestor (main)
	// the displaced mouseup yields — off-card, off-badge.
	await page.evaluate(
		({ x, y }) => {
			document.querySelector("main")!.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					screenX: x,
					screenY: y,
					clientX: x,
					clientY: y
				})
			);
		},
		{ x: parked!.x, y: parked!.y }
	);
	// Past the 160ms fade-out: a shut card would be gone by now.
	await page.waitForTimeout(500);
	await expect(card).toBeVisible();
	// The guard expires: a later click-off still closes. The point
	// must sit under neither card nor badge (topmost element in
	// main, outside both), or the click is not a click-off.
	await page.waitForTimeout(800);
	const off = await page.evaluate(() => {
		const main = document.querySelector("main");
		if (!(main instanceof HTMLElement)) return null;
		const r = main.getBoundingClientRect();
		for (let y = r.top + 40; y < r.bottom - 10; y += 40) {
			for (let x = r.left + 40; x < r.right - 10; x += 40) {
				const top = document.elementFromPoint(x, y);
				if (!(top instanceof Element) || !main.contains(top)) continue;
				if (top.closest(".ann-answer, [data-ann-badge]")) continue;
				return { x: Math.round(x), y: Math.round(y) };
			}
		}
		return null;
	});
	expect(off).not.toBeNull();
	await page.mouse.move(off!.x, off!.y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(card).toHaveCount(0, { timeout: 5_000 });
});
