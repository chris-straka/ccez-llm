import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "The quick brown fox jumps over the lazy dog near the riverbank.";

/** Viewport center of the first real word inside a rendered message.
Callers scroll first; measuring never moves anything. */
async function wordCenter(target: Locator): Promise<{ x: number; y: number }> {
	const word = await target.evaluate((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node = walker.nextNode();
		while (node) {
			const text = node as Text;
			const m = /[A-Za-z]{4,}/.exec(text.data);
			if (m) {
				const range = document.createRange();
				range.setStart(text, m.index);
				range.setEnd(text, m.index + m[0].length);
				const r = range.getBoundingClientRect();
				if (r.width > 0 && r.height > 0)
					return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			}
			node = walker.nextNode();
		}
		throw new Error("no word found");
	});
	return word;
}

/** Double-click a real word inside a rendered message. Fixed offsets
keep landing on inter-word gaps, which pick a space and summon no menu. */
async function dblclickWord(page: Page, target: Locator): Promise<void> {
	await target.scrollIntoViewIfNeeded();
	const word = await wordCenter(target);
	await page.mouse.dblclick(word.x, word.y);
}

/** Three short messages: annotating the middle one parks its badge
clear of both chrome strips (badges under the header or composer
take no hits by design). */
async function seedTriple(page: Page): Promise<void> {
	await seedChat(page, [
		{ role: "assistant", content: SENTENCE },
		{ role: "assistant", content: SENTENCE },
		{ role: "assistant", content: SENTENCE }
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

/** Annotate the live pick and file it: menu, card, Enter, badge. */
async function filePickedAnnotation(page: Page): Promise<void> {
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 5_000 });
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	// The filing pill fades out over the badge: wait it out or the
	// click below lands on the dying pill instead of the marker.
	await expect(page.locator(".ann-pop")).toHaveCount(0, { timeout: 5_000 });
}

/** Word-pick, Annotate, file in the middle message: leaves one live
annotation with a badge in the clickable zone. */
async function annotateMiddle(page: Page): Promise<void> {
	await dblclickWord(page, page.locator("article .rendered").nth(1));
	await filePickedAnnotation(page);
}

/** Word-pick, Annotate, file: leaves one live annotation with a badge. */
async function annotateWord(page: Page): Promise<void> {
	await dblclickWord(page, page.locator("article .rendered").first());
	await filePickedAnnotation(page);
}

async function badgeCenter(page: Page): Promise<{ x: number; y: number }> {
	const badge = page.locator("button.ccez-ann-badge").first();
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

/** Badges and their quote washes read interactive on hover. */
test("annotation markers show a pointer cursor", async ({ page }) => {
	await seedTriple(page);
	await annotateMiddle(page);
	const at = await badgeCenter(page);
	await page.mouse.move(at.x, at.y);
	const cursor = await page.evaluate(
		({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
		at
	);
	expect(cursor).toBe("pointer");
});

/** The composer wins over badges: a badge scrolled beneath it takes
no hits — elementFromPoint finds the composer, and clicking there
opens no edit card. */
test("badges slide beneath the composer", async ({ page }) => {
	const para = "The quick brown fox jumps over the lazy dog near the riverbank. ";
	await seedChat(
		page,
		Array.from({ length: 8 }, (_, i) => ({
			role: "assistant" as const,
			content: `Message ${i + 1}: ` + para.repeat(6)
		}))
	);
	await page.goto("/");
	const body = page.locator("article .rendered").last();
	await body.scrollIntoViewIfNeeded();
	// The scrolled-to message can rest under the floating composer:
	// lift it clear, then measure and click with no scroll between.
	await page.evaluate(() => {
		document.querySelector(".messages")!.scrollTop -= 250;
	});
	const word = await wordCenter(body);
	await page.mouse.dblclick(word.x, word.y);
	await filePickedAnnotation(page);
	const probe = await page.evaluate(() => {
		const msgs = document.querySelector(".messages") as HTMLElement | null;
		const badge = document.querySelector("button.ccez-ann-badge") as HTMLElement | null;
		const prompt = document.querySelector(".prompt") as HTMLElement | null;
		if (!msgs || !badge || !prompt) throw new Error("missing layer");
		msgs.scrollTop = msgs.scrollHeight;
		const b = badge.getBoundingClientRect();
		const p = prompt.getBoundingClientRect();
		// Nudge so the badge center sits mid-composer, then ask the
		// hit tree who owns that pixel.
		msgs.scrollTop += b.top + b.height / 2 - (p.top + p.height / 2);
		const c = badge.getBoundingClientRect();
		const x = c.left + c.width / 2;
		const y = c.top + c.height / 2;
		const el = document.elementFromPoint(x, y);
		return {
			x,
			y,
			hitPrompt: !!el?.closest(".prompt"),
			hitBadge: !!el?.closest("button.ccez-ann-badge")
		};
	});
	expect({ hitPrompt: probe.hitPrompt, hitBadge: probe.hitBadge }).toEqual({
		hitPrompt: true,
		hitBadge: false
	});
	await page.mouse.click(probe.x, probe.y);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
});

/** Badge clicks reach the marker and the edit card keeps textarea
focus instead of dropping it. The badge sits mid-thread: edge badges
park under the chrome and take no hits by design (see the composer
test above). */
test("badge click opens the edit card with stable focus", async ({ page }) => {
	await seedTriple(page);
	await annotateMiddle(page);
	const at = await badgeCenter(page);
	await page.mouse.click(at.x, at.y);
	const box = page.locator(".ann-pop textarea");
	await expect(box).toBeVisible({ timeout: 5_000 });
	await expect(box).toBeFocused();
	await page.waitForTimeout(600);
	await expect(box).toBeFocused();
	await expect(page.locator(".ann-pop")).not.toHaveClass(/fresh/);
});

/** The review card toggles on its pill, closes on click-off, and
closes on Escape. */
test("review card closes on click-off and Escape", async ({ page }) => {
	await annotateWord(page);
	const pill = page.locator(".prompt-tools .ann-pill");
	await pill.click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	const main = page.locator("main");
	const box = await main.boundingBox();
	if (!box) throw new Error("main has no box");
	await page.mouse.click(box.x + 40, box.y + 300);
	await expect(page.locator(".ann-wrap.pinned")).toHaveCount(0);
	await pill.click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-wrap.pinned")).toHaveCount(0);
});

/** A review quote click scrolls to the message and blinks the yellow
wash on the annotated text. */
test("review quote jumps to the message with a wash blink", async ({ page }) => {
	const para = `${SENTENCE} `.repeat(6);
	const content = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${para}`).join("\n\n");
	await seedChat(page, [{ role: "assistant", content }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await annotateWord(page);
	// Park at the bottom so the jump has room to travel back up.
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement;
		box.style.scrollBehavior = "auto";
		box.scrollTo({ top: 999999 });
	});
	const top = await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0);
	expect(top).toBeGreaterThan(200);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.locator(".review-quote").first().click();
	// The review closes so the landing clears the composer dock.
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "0");
	// The wash blinks: poll through the cycle until a lit phase shows.
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const mark = document.querySelector("mark.ccez-ann");
					return mark ? getComputedStyle(mark).backgroundColor : "none";
				}),
			{ timeout: 4_000 }
		)
		.toBe("rgb(255, 243, 176)");
	await page.waitForTimeout(800);
	const after = await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0);
	expect(after).toBeLessThan(top - 50);
});

/** Down-jumps land clear of the composer dock: from the top of a long
chat, the quote settles above the prompt (nearest used to strand it
behind the dock) — then a second jump restarts the blink for the
wash read, since the landing outlasts one blink cycle. */
test("down jump lands the quote clear of the dock", async ({ page }) => {
	const para = `${SENTENCE} `.repeat(6);
	const content = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${para}`).join("\n\n");
	await seedChat(page, [{ role: "assistant", content }]);
	// A live draft on the last paragraph (seeded in storage — the UI
	// filing path is covered elsewhere, this test owns the jump).
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [{ id: "ann-late", messageId: "e2e-m0", quote: "Paragraph 11", comment: "" }]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	// Park at the top: the badge must start below the viewport.
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement;
		box.style.scrollBehavior = "auto";
		box.scrollTo({ top: 0 });
	});
	const start = await page.evaluate(() => {
		const badge = document.querySelector("button.ccez-ann-badge");
		return badge instanceof HTMLElement ? badge.getBoundingClientRect().top : -1;
	});
	expect(start).toBeGreaterThan(600);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.locator(".review-quote").first().click();
	// The badge settles fully above the prompt (smooth scroll takes a
	// while over eleven paragraphs).
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const badge = document.querySelector("button.ccez-ann-badge");
					const prompt = document.querySelector(".prompt");
					if (!(badge instanceof HTMLElement) || !(prompt instanceof HTMLElement)) return 999999;
					return badge.getBoundingClientRect().bottom - prompt.getBoundingClientRect().top;
				}),
			{ timeout: 10_000 }
		)
		.toBeLessThanOrEqual(0);
	// A second jump restarts the blink for the wash read.
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.locator(".review-quote").first().click();
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const mark = document.querySelector("mark.ccez-ann");
					return mark ? getComputedStyle(mark).backgroundColor : "none";
				}),
			{ timeout: 4_000 }
		)
		.toBe("rgb(255, 243, 176)");
});

/** Only the quote navigates: clicking the note (or the row's number)
jumps nowhere — no wash, no scroll, the review stays open. */
test("review note click does not jump", async ({ page }) => {
	await annotateWord(page);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	const top = await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0);
	await page.locator(".review-comment").first().click();
	await page.locator(".review-num").first().click();
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0)).toBe(top);
	await expect(page.locator("mark.ccez-ann")).toHaveCount(0);
	await expect(page.locator(".review-item.highlight")).toHaveCount(0);
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
});

/** Picks rooted in the review card are never annotatable: selecting
note text summons no menu, leaves the native pick exactly as drawn
(stays copyable), and the trailing click does not jump (a live
selection is a pick, not a press). */
test("selecting review text summons no menu and stays put", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 100, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 5_000 });
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	const draft = page.locator(".ann-pop textarea");
	await expect(draft).toBeVisible({ timeout: 5_000 });
	await draft.fill("a note worth keeping");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	// The filing pill fades first (see annotateWord): clicking
	// through the fade would hit the badge instead of the pill.
	await expect(page.locator(".ann-pop")).toHaveCount(0, { timeout: 5_000 });
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	const comment = page.locator(".review-comment").first();
	const cbox = await comment.boundingBox();
	if (!cbox) throw new Error("comment has no box");
	await page.mouse.move(cbox.x + 2, cbox.y + cbox.height / 2);
	await page.mouse.down();
	await page.mouse.move(cbox.x + cbox.width - 2, cbox.y + cbox.height / 2, { steps: 6 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).not.toBe("");
	await expect(page.locator(".review-item.highlight")).toHaveCount(0);
});

/** Review rows stay one line: the quote cuts with an ellipsis,
the note scrolls sideways, and the copy icon sits at the row's
end (no dead space for it to float in). */
test("review rows are one line with copy at the end", async ({ page }) => {
	await annotateWord(page);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	const style = await page.evaluate(() => {
		const q = document.querySelector(".review-quote") as HTMLElement | null;
		const c = document.querySelector(".review-comment") as HTMLElement | null;
		const qs = q ? getComputedStyle(q) : null;
		const cs = c ? getComputedStyle(c) : null;
		return {
			quote:
				qs?.whiteSpace === "nowrap" &&
				qs?.textOverflow === "ellipsis" &&
				qs?.overflow === "hidden",
			note: cs?.whiteSpace === "nowrap" && cs?.overflowX === "auto"
		};
	});
	expect(style).toEqual({ quote: true, note: true });
	const order = await page.evaluate(() => {
		const head = document.querySelector(".review-head");
		const copy = head?.querySelector(".review-copy")?.getBoundingClientRect();
		const quote = head?.querySelector(".review-quote")?.getBoundingClientRect();
		return copy && quote ? copy.x > quote.x : false;
	});
	expect(order).toBe(true);
});

/** The note stays readable on both themes: it rides the quiet voice
(#6e6e73 on the white light card, #98989f on the dark card) instead
of the pale dark-card grey, which washes out on white. */
for (const theme of ["light", "dark"] as const) {
	test(`review note reads on ${theme}`, async ({ page }) => {
		await page.addInitScript(
			(name: string) => {
				const raw = window.localStorage.getItem("ccez-llm-settings-v1") ?? "{}";
				window.localStorage.setItem(
					"ccez-llm-settings-v1",
					JSON.stringify({ ...JSON.parse(raw), theme: name })
				);
			},
			theme
		);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		await annotateWord(page);
		await page.locator(".prompt-tools .ann-pill").click();
		await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
		await expect(page.locator(".review-comment").first()).toHaveCSS(
			"color",
			theme === "light" ? "rgb(110, 110, 115)" : "rgb(152, 152, 159)"
		);
	});
}

/** A jump leaves an already-clear mark exactly where it is: no scroll
fires at all, but the wash still blinks (the jump happened). Never by
message `center` (which overshoots past the mark in a long message).
The quote click fires programmatically here — a real click would first
scroll the card itself into view and confound the reading. */
test("jump leaves a clear mark exactly where it is", async ({ page }) => {
	await page.reload();
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await annotateWord(page);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	// Drop the filing word-pick: a live selection would (correctly)
	// make the quote press read as a pick instead of a jump.
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	const top = await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0);
	await page.evaluate(() => (document.querySelector(".review-quote") as HTMLElement | null)?.click());
	// The wash still blinks: the jump happened, it just had nowhere to go.
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const mark = document.querySelector("mark.ccez-ann");
					return mark ? getComputedStyle(mark).backgroundColor : "none";
				}),
			{ timeout: 4_000 }
		)
		.toBe("rgb(255, 243, 176)");
	expect(await page.evaluate(() => document.querySelector(".messages")?.scrollTop ?? 0)).toBe(top);
});

/** A quote whose message is gone toasts instead of jumping nowhere. */
test("orphaned review quote toasts that the annotation is gone", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{ id: "ann-ghost", messageId: "e2e-missing", quote: "gone", comment: "stale note" }
				]
			})
		);
	});
	await page.reload();
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.locator(".review-quote").first().click();
	await expect(page.locator(".toast")).toContainText("Annotation no longer exists", {
		timeout: 5_000
	});
});
