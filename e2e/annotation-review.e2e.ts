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
