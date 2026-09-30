import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Learner news mode: on an empty chat, picking a reply language
 * trades the welcome text for story cards under the pill rail. The
 * browser preview has no shell transport, so these pin entry, the
 * honest needs-shell state, and the exit — the live feed and
 * session launches are shell-only.
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
