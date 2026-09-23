import { expect, test, type Page } from "@playwright/test";
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
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toBeVisible({ timeout: 10_000 });
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
	// The answer also displays always under its dock row (green
	// annotated-text chip plus the reply text) — never popup-only.
	// The dock lists pinned rows only, so a second Enter pins
	// first (the card stays open through approval).
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.locator(".prompt-tools .ann-pill").click();
	const dock = page.locator(".ann-wrap .review");
	await expect(dock).toHaveCSS("opacity", "1");
	await expect(
		page.locator(".review-quote.annotated").first()
	).toBeVisible();
	await expect(page.locator(".review-answer").first()).toContainText(
		"Mock reply to:"
	);
});

/** The badge keeps its number: opening the card reads, a second
Enter (a double-click's second press) pins the annotation into the
send, the dock's Unpin removes it again. The sent message carries
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
test("answered annotations stay orange across a reload", async ({
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
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toBeVisible({ timeout: 10_000 });
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
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toBeVisible({ timeout: 10_000 });
	await expect(
		page.locator("button.ccez-ann-badge.ans-waiting")
	).toHaveCount(0);
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
		page.evaluate(
			() =>
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
		page.evaluate(
			(s: string) => {
				const el = document.querySelector(s);
				return el ? getComputedStyle(el).animationName : "";
			},
			sel
		);
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
			(document
				.querySelector(".ann-answer")!
				.getBoundingClientRect().y as number) <
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
	await expect(page.locator("button.ccez-ann-badge.ans-ready")).toHaveCount(
		2,
		{ timeout: 30_000 }
	);
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

/** An answer at the viewport bottom scrolls the thread instead of
flipping above: the card always hangs below its quote. */
test("bottom answer scrolls the thread to make room", async ({ page }) => {
	test.setTimeout(120_000);
	const paras = Array.from(
		{ length: 12 },
		(_, i) => `filler paragraph number ${i} with enough words to wrap`
	);
	await seedChat(page, [
		...paras.map((content) => ({ role: "assistant" as const, content })),
		{ role: "assistant", content: "the last riverbank holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	// Short viewport: the last quote sits where the card cannot
	// fit below it, so opening must scroll the thread.
	await page.setViewportSize({ width: 1280, height: 500 });
	await page.waitForTimeout(300);
	const articles = page.locator("article.assistant");
	await expect(articles.last()).toBeVisible({ timeout: 60_000 });
	// Below the fold: jump near the bottom instantly (smooth
	// scrolling would carry the content out from under the
	// synthetic drag), leaving scroll room below so the card has
	// somewhere to scroll into — at max scroll no scroll could help.
	// Then settle before the drag starts.
	await page.evaluate(() => {
		const article = document.querySelectorAll("article.assistant")[12];
		if (!(article instanceof HTMLElement)) throw new Error("no article");
		let el: HTMLElement | null = article;
		while (el) {
			const parent = el.parentElement;
			if (
				parent instanceof HTMLElement &&
				parent.scrollHeight > parent.clientHeight + 4
			) {
				parent.scrollTop =
					parent.scrollHeight - parent.clientHeight - 80;
				break;
			}
			el = parent;
		}
	});
	await page.waitForTimeout(300);
	// Second-to-last article: visible with scroll room below it
	// (the last line has no room to scroll into at max scroll).
	await dragQuote(page, 11, "paragraph number 11");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	// Shift+A opens the box (bare A files and sends at once now).
	await page.keyboard.press("A");
	await askAtFile(page, "what lives here?");
	const ready = page.locator("button.ccez-ann-badge.ans-ready");
	const scrolled = async (): Promise<number> =>
		page.evaluate(() => {
			let el: Element | null = document.querySelector(
				"article.assistant:last-of-type"
			);
			while (el) {
				if (
					el instanceof HTMLElement &&
					el.scrollHeight > el.clientHeight + 4
				)
					return el.scrollTop;
				el = el.parentElement;
			}
			return -1;
		});
	// Open once to measure the real card height, then close and
	// park the quote at an exact +60px overflow: the reopen must
	// scroll the thread by it instead of flipping above.
	await ready.focus();
	await page.keyboard.press("Enter");
	const card = page.locator(".ann-answer");
	await expect(card).toBeVisible({ timeout: 10_000 });
	const measured = await page.evaluate(() => {
		const el = document.querySelector(".ann-answer");
		const badge = document.querySelector("[data-ann-badge]");
		const qr = badge?.parentElement?.getBoundingClientRect();
		const scrollerOf = (node: Element | null): HTMLElement | null => {
			let el: Element | null = node;
			while (el) {
				const parent = el.parentElement;
				if (
					parent instanceof HTMLElement &&
					parent.scrollHeight > parent.clientHeight + 4
				)
					return parent;
				el = parent;
			}
			return null;
		};
		const scroller = scrollerOf(badge);
		return {
			cardH: el?.getBoundingClientRect().height ?? null,
			quoteBottom: qr?.bottom ?? null,
			vh: window.innerHeight,
			top: scroller?.scrollTop ?? null
		};
	});
	expect(measured.cardH).not.toBeNull();
	expect(measured.quoteBottom).not.toBeNull();
	expect(measured.top).not.toBeNull();
	const wantOverflow = 60;
	const quoteWant =
		(measured.vh as number) - 8 + wantOverflow - 2 - (measured.cardH as number);
	expect(quoteWant).toBeGreaterThan(0);
	await page.keyboard.press("Escape");
	await expect(card).toHaveCount(0);
	await page.evaluate(
		({ want }) => {
			const badge = document.querySelector("[data-ann-badge]");
			const qr = badge?.parentElement?.getBoundingClientRect();
			if (!qr) throw new Error("no quote rect");
			let el: Element | null = badge;
			while (el) {
				const parent = el.parentElement;
				if (
					parent instanceof HTMLElement &&
					parent.scrollHeight > parent.clientHeight + 4
				) {
					parent.scrollTop += qr.bottom - want;
					break;
				}
				el = parent;
			}
		},
		{ want: quoteWant }
	);
	await page.waitForTimeout(300);
	const before = await scrolled();
	await ready.focus();
	await page.keyboard.press("Enter");
	await expect(card).toBeVisible({ timeout: 10_000 });
	await expect
		.poll(() => scrolled(), { timeout: 10_000 })
		.toBeGreaterThan(before);
	// The whole card fits in the viewport below its quote.
	const cardBox = await card.boundingBox();
	const vh = await page.evaluate(() => window.innerHeight);
	expect(cardBox).not.toBeNull();
	expect((cardBox?.y ?? 0) + (cardBox?.height ?? 1e9)).toBeLessThanOrEqual(
		vh - 8
	);
});
