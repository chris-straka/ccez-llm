import { expect, test, type Page } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

/**
 * Staged annotation questions: filing never sends anything (the
 * badge holds steady blue, never blinking), the inclusion chip's
 * pencil stages the wording, and the send bundles it into one
 * request whose reply lands as the annotation's answer (orange).
 */
async function askThroughSend(
	page: Page,
	question: string
): Promise<void> {
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	await pop.locator("textarea").fill(question);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge.ans-waiting");
	await expect(badge).toBeVisible({ timeout: 15_000 });
	// Steady blue: no request fires on file, nothing ever blinks.
	const pulse = await badge.evaluate(
		(el) => getComputedStyle(el).animationName
	);
	expect(pulse).not.toContain("ann-badge-wait");
	// The question rides the send as an inclusion chip; its pencil
	// stages the exact wording into the send-prompt pill.
	const chip = page.locator(".inclusion-chip");
	await expect(chip).toBeVisible({ timeout: 10_000 });
	await chip.locator("button").click();
	const pill = page.locator(".staged-pill");
	await expect(pill).toBeVisible({ timeout: 10_000 });
	await expect(pill.locator(".staged-quote")).not.toBeEmpty();
	await expect(pill.locator("textarea")).toHaveValue(question);
	await page.locator(".send-btn").click();
	// The reply lands as the answer: blue turns orange. A failed
	// send banners in the composer instead — surface its text, not
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
	expect(bannered, "staged send failed").toBeNull();
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
	await askThroughSend(page, "what lives here?");
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
	await askThroughSend(page, "what lives here?");
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
	await askThroughSend(page, "what does this mean?");
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
	await askThroughSend(page, "what lives here?");
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
