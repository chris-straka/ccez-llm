import { test, expect, type Page } from "./fixtures";
import { dragHeadline, seedChat } from "./helpers";
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
	await expect(panel).toContainText("French news");
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
	await expect(panel).toContainText("French news", { timeout: 10_000 });
	await page.locator('.lang-menu button:has-text("Asia")').click();
	await page.locator(".lang-list").getByRole("menuitem", { name: "Japanese" }).click();
	await expect(panel).toContainText("Japanese news");
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

	test("drag-select plus A files a headline badge", async ({ page }) => {
		await openFrenchNews(page);
		const panel = page.locator(".news-panel");
		await expect(panel.locator(".news-card")).toHaveCount(3);
		await dragHeadline(page, 1, "croissant");
		const selText = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(selText.trim().length).toBeGreaterThan(0);
		// Hands off the prompt: a focused composer eats the A into
		// typed text. Blurring keeps the selection.
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur?.()
		);
		await page.mouse.move(2, 2);
		await page.keyboard.press("a");
		// Instant path: the badge files, no pill, no menu.
		await expect(panel.locator("button.ccez-ann-badge")).toHaveCount(1, {
			timeout: 10_000
		});
		await expect(panel.locator(".news-card.has-marks")).toHaveCount(1);
		await expect(page.locator(".sel-menu")).toHaveCount(0);
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
