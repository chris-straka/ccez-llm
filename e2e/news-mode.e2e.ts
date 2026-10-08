import { test, expect, type Page } from "./fixtures";
import { dragQuote, seedChat } from "./helpers";
import {
	MOCK_SOURCE_MISS,
	MOCK_TITLE_IMG,
	MOCK_TITLE_MISS,
	MOCK_TITLE_WALL,
	seedMockShell
} from "./mock-shell";

/**
 * Learner news mode: on an empty chat, picking a reply language
 * trades the welcome text for story cards under the pill rail. The
 * browser preview has no shell transport, so the first strand pins
 * entry, the honest needs-shell state, and the exit — while the
 * mock-shell strand below runs the live feed past needs-shell.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".empty-state h1")).toBeVisible({
		timeout: 60_000
	});
});

test("empty-chat language pick opens news, close returns to welcome", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "French" }).click();
	// Welcome text goes away, the panel rails under the pills.
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel).toContainText("français");
	await expect(page.locator(".empty-state h1")).toHaveCount(0);
	// No shell in the preview: the honest state, not a spinner.
	await expect(panel).toContainText("needs the app shell");
	// The ✕ drops back to the welcome screen.
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.locator(".empty-state h1")).toBeVisible();
});

test("fallback language never shows English headlines", async ({ page }) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	const list = page.locator(".lang-list");
	await expect(list).toBeVisible();
	await list.getByRole("menuitem", { name: "Danish" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	// Fallback regions translate; the English note is gone. No
	// shell in the preview: the honest state, not headlines.
	await expect(panel).not.toContainText("headlines in English");
	await expect(panel).toContainText("needs the app shell");
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
});

test("news mode lists from the top: uncentered pane, strip clearance, tail room", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "French" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	// The thread stops being a centered hero: full-height list.
	await expect(page.locator("main.news")).toHaveCount(1);
	const styles = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement;
		const hero = document.querySelector(".empty-state") as HTMLElement;
		const bs = getComputedStyle(box);
		return {
			justify: bs.justifyContent,
			maxH: bs.maxHeight,
			heroMargin: getComputedStyle(hero).marginTop,
			heroNews: hero.classList.contains("news-mode")
		};
	});
	expect(styles.justify).toBe("flex-start");
	expect(styles.maxH).toBe("none");
	expect(styles.heroNews).toBe(true);
	// Strip clearance (1.75rem) and tail clearance (composer + gap,
	// applied async by the resize sync).
	expect(parseFloat(styles.heroMargin)).toBeGreaterThanOrEqual(28);
	const boxPad = () =>
		page.evaluate(
			() =>
				getComputedStyle(document.querySelector(".messages") as HTMLElement)
					.paddingBottom
		);
	await expect.poll(boxPad, { timeout: 5_000 }).not.toBe("0px");
	// Closing restores the centered hero.
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
	await expect(page.locator("main.news")).toHaveCount(0);
	const after = await page.evaluate(() => {
		const bs = getComputedStyle(
			document.querySelector(".messages") as HTMLElement
		);
		return { justify: bs.justifyContent, maxH: bs.maxHeight };
	});
	expect(after.justify).toBe("center");
	expect(after.maxH).not.toBe("none");
	await expect.poll(boxPad, { timeout: 5_000 }).toBe("0px");
});

test("picking a second language switches the panel over", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "French" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toContainText("français", { timeout: 10_000 });
	await page.locator('.lang-menu button:has-text("Asia")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "Japanese" }).click();
	await expect(panel).toContainText("日本語");
});

test("headlines park the composer; summon brings it back over them", async ({
	page
}) => {
	await page.locator('.lang-menu button:has-text("Europe")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "French" }).click();
	const panel = page.locator(".news-panel");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	const prompt = page.locator(".prompt");
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/);
	await expect(panel).toBeVisible();
	// Leaving it empty parks it again: headlines stay uncovered.
	await page.locator(".news-meta").click();
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/);
	await panel.getByRole("button", { name: "Close news" }).click();
	await expect(panel).toHaveCount(0);
	await expect(prompt).not.toHaveClass(/prompt-idle/);
});

/**
 * Mock-shell strand: the bridge (see mock-shell.ts) feeds the live
 * fetch path a two-story feed, so these pin headlines, headline
 * annotation, and image misses without the app shell. The outer
 * seed already loaded once unmocked; the reload replays both init
 * scripts, mock included, before the app boots.
 */
test.describe("mock shell feed", () => {
	test.beforeEach(async ({ page }) => {
		await seedMockShell(page);
		await page.reload();
		await expect(page.locator(".empty-state h1")).toBeVisible({
			timeout: 60_000
		});
	});

	async function openFrenchNews(page: Page): Promise<void> {
		await page.locator('.lang-menu button:has-text("Europe")').click();
		await page
			.locator(".lang-list")
			.getByRole("menuitem", { name: "French" })
			.click();
	}

	test("headlines render from the mock feed", async ({ page }) => {
		await openFrenchNews(page);
		const panel = page.locator(".news-panel");
		await expect(panel).toBeVisible({ timeout: 10_000 });
		const cards = panel.locator(".news-card");
		await expect(cards).toHaveCount(3);
		await expect(cards.nth(0)).toContainText(MOCK_TITLE_IMG);
		await expect(cards.nth(1)).toContainText(MOCK_TITLE_MISS);
		await expect(cards.nth(2)).toContainText(MOCK_TITLE_WALL);
		await expect(panel).not.toContainText("needs the app shell");
		// The feed-image story renders its picture, no fetch.
		await expect(cards.nth(0).locator("img.news-img")).toBeVisible();
	});

	test("a picked story moves into the chat with its session choices", async ({
		page
	}) => {
		await openFrenchNews(page);
		const panel = page.locator(".news-panel");
		const cards = panel.locator("button.news-card");
		await expect(cards).toHaveCount(3);
		// Cards are click targets, not text: pointer, no selection.
		const look = await cards.nth(1).evaluate((el) => {
			const cs = getComputedStyle(el);
			return { cursor: cs.cursor, select: cs.userSelect };
		});
		expect(look).toEqual({ cursor: "pointer", select: "none" });
		await cards.nth(1).click();
		const stage = panel.locator(".news-stage");
		await expect(stage).toBeVisible();
		await expect(stage).toContainText(MOCK_TITLE_MISS);
		await expect(panel.locator("button.news-card")).toHaveCount(0);
		await expect(stage.getByRole("group", { name: "Level" })).toBeVisible();
		await stage.getByRole("button", { name: "C1" }).click();
		await expect(stage.getByRole("button", { name: "C1" })).toHaveAttribute(
			"aria-pressed",
			"true"
		);
		// Word labels: the session kind picks, Start names it, and
		// length only shows for a summary.
		await expect(stage.getByRole("button", { name: "Start conversation" })).toBeVisible();
		await expect(stage.getByRole("group", { name: "Summary length" })).toHaveCount(0);
		await stage.getByRole("button", { name: "Summary", exact: true }).click();
		await expect(stage.getByRole("group", { name: "Summary length" })).toBeVisible();
		await expect(stage.getByRole("button", { name: "Start summary" })).toBeVisible();
		// Esc takes the story back out; headlines return.
		await page.keyboard.press("Escape");
		await expect(stage).toHaveCount(0);
		await expect(panel.locator("button.news-card")).toHaveCount(3);
	});

	test("the region rule always splits home editions from world desks", async ({
		page
	}) => {
		await openFrenchNews(page);
		const chips = page.locator(".news-chips");
		await expect(chips.locator(".news-sep")).toHaveCount(1);
		// The rule sits right after the last word chip.
		const before = await chips
			.locator(".news-sep")
			.evaluate((el) => (el.previousElementSibling as HTMLElement).classList.contains("icon"));
		expect(before).toBe(false);
	});

	test("image miss settles to a letter tile", async ({ page }) => {
		await openFrenchNews(page);
		const panel = page.locator(".news-panel");
		const cards = panel.locator(".news-card");
		await expect(cards).toHaveCount(3);
		// The imageless story: outlet initial, never a stuck skeleton.
		const tile = cards.nth(1).locator(".news-img-fallback");
		await expect(tile).toBeVisible({ timeout: 10_000 });
		await expect(tile).toHaveText(MOCK_SOURCE_MISS.trim().charAt(0));
		await expect(panel.locator(".news-skel")).toHaveCount(0);
	});

	test("walled story resolves through the hidden leg", async ({ page }) => {
		await openFrenchNews(page);
		const panel = page.locator(".news-panel");
		const cards = panel.locator(".news-card");
		await expect(cards).toHaveCount(3);
		// Direct 403s and the reader walls: the hidden browser is
		// the only leg that can picture this card.
		const img = cards.nth(2).locator("img.news-img");
		await expect(img).toBeVisible({ timeout: 10_000 });
		await expect(cards.nth(2).locator(".news-img-fallback")).toHaveCount(0);
	});
});

test.describe("sent news opener", () => {
	test("reads as one compact tag, not the instructions", async ({ page }) => {
		const opener =
			'🗣️ "Soupçons de peste en Russie" (CNews)\n' +
			"Two named locals open a substantial discussion of the pasted article in French " +
			"at CEFR B2 (Upper intermediate): reactions. Stay in French. [Pasted 3491 chars] ";
		await seedChat(page, [
			{ role: "user", content: opener },
			{ role: "assistant", content: "Bonjour !" }
		]);
		await page.goto("/");
		const tag = page.locator("article.user .news-launch");
		await expect(tag).toBeVisible({ timeout: 60_000 });
		await expect(tag).toContainText("Soupçons de peste en Russie");
		await expect(tag).toContainText("Conversation · B2");
		await expect(page.locator("article.user")).not.toContainText("Two named locals");
		// The headline is a normal message body: his text size, selectable.
		const title = tag.locator(".launch-title .rendered");
		await expect(title).toHaveText("Soupçons de peste en Russie");
		const sizes = await page.evaluate(() => ({
			title: getComputedStyle(document.querySelector(".launch-title .rendered")!).fontSize,
			reply: getComputedStyle(document.querySelector("article.assistant .rendered")!).fontSize
		}));
		expect(sizes.title).toBe(sizes.reply);
		// Unfold shows what was sent; fold returns to the tag.
		await page.locator("article.user").hover();
		await page.locator("article.user").getByRole("button", { name: "Unfold this message" }).click();
		await expect(page.locator("article.user")).toContainText("Two named locals");
		await expect(page.locator("article.user .news-launch")).toHaveCount(0);
		await page.locator("article.user").getByRole("button", { name: "Fold this message" }).click();
		await expect(page.locator("article.user .news-launch")).toBeVisible();
		// Title words annotate like any message: select, then A.
		await dragQuote(page, 0, "peste", ".launch-title .rendered");
		await page.mouse.move(2, 2);
		await page.keyboard.press("a");
		await expect(tag.locator("button.ccez-ann-badge")).toHaveCount(1, { timeout: 10_000 });
	});
});
