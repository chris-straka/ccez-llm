import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "The quick brown fox jumps over the lazy dog near the riverbank.";

/** Word-pick, Annotate, file: leaves one live annotation with a badge. */
async function annotateWord(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 100, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 5_000 });
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	// The filing pill fades out over the badge: wait it out or the
	// click below lands on the dying pill instead of the marker.
	await expect(page.locator(".ann-pop")).toHaveCount(0, { timeout: 5_000 });
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
	await annotateWord(page);
	const at = await badgeCenter(page);
	await page.mouse.move(at.x, at.y);
	const cursor = await page.evaluate(
		({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)!).cursor,
		at
	);
	expect(cursor).toBe("pointer");
});

/** Badge clicks reach the marker (not the header strip) and the edit
card keeps textarea focus instead of dropping it. */
test("badge click opens the edit card with stable focus", async ({ page }) => {
	await annotateWord(page);
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

/** A click anywhere on the item (not just the quote) jumps: the
comment body navigates with the same wash blink. Buttons keep
their own clicks, drag-selects stay picks (covered below). */
test("review item body click jumps to the mark", async ({ page }) => {
	await annotateWord(page);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	await page.locator(".review-comment").first().click();
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

/** A jump scrolls the mark itself, minimally: the badge goes by
`nearest` (an already-visible mark stays put), never by message
`center` (which overshoots past the mark in a long message). The
item click fires programmatically here — a real click would first
scroll the card itself into view and confound the reading. */
test("jump scrolls the badge itself, minimally", async ({ page }) => {
	await page.addInitScript(() => {
		const seen: string[] = [];
		const orig = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (
			opts?: ScrollIntoViewOptions | boolean
		): void {
			seen.push(
				`${(this as Element).matches?.("button.ccez-ann-badge")}:${JSON.stringify(opts)}`
			);
			(window as unknown as { __siv?: string[] }).__siv = seen;
			orig.call(this, opts);
		};
	});
	await page.reload();
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await annotateWord(page);
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap.pinned .review")).toBeVisible();
	// Drop the filing word-pick: a live selection would (correctly)
	// make the item press read as a pick instead of a jump.
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await page.evaluate(() => (document.querySelector(".review-comment") as HTMLElement | null)?.click());
	await page.waitForTimeout(500);
	const seen = await page.evaluate(
		() => (window as unknown as { __siv?: string[] }).__siv ?? []
	);
	expect(seen).toContain('true:{"block":"nearest","behavior":"smooth"}');
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
