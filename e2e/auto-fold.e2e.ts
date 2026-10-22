import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";

/** Settings' fold-older rule: older messages fold, the newest of each
role stays open, and a hand unfold sticks. Off by default. */
const thread = [
	{ role: "user" as const, content: "first question" },
	{ role: "assistant" as const, content: "first answer" },
	{ role: "user" as const, content: "second question" },
	{ role: "assistant" as const, content: "second answer" }
];

test("nothing folds by default", async ({ page }) => {
	await seedChat(page, thread);
	await page.goto("/");
	await expect(page.locator("article").nth(3)).toBeVisible({ timeout: 60_000 });
	await expect(page.locator("article.folded-msg")).toHaveCount(0);
});

test("older AI replies fold; the newest and my messages stay open", async ({
	page
}) => {
	await seedChat(page, thread, null, { autoFoldAssistant: true });
	await page.goto("/");
	const articles = page.locator("article");
	await expect(articles.nth(3)).toBeVisible({ timeout: 60_000 });
	await expect(articles.nth(1)).toHaveClass(/folded-msg/);
	await expect(articles.nth(3)).not.toHaveClass(/folded-msg/);
	await expect(articles.nth(0)).not.toHaveClass(/folded-msg/);
	await expect(articles.nth(2)).not.toHaveClass(/folded-msg/);
});

test("my older messages fold too when that box is on", async ({ page }) => {
	await seedChat(page, thread, null, {
		autoFoldAssistant: true,
		autoFoldOwn: true
	});
	await page.goto("/");
	const articles = page.locator("article");
	await expect(articles.nth(3)).toBeVisible({ timeout: 60_000 });
	await expect(articles.nth(0)).toHaveClass(/folded-msg/);
	await expect(articles.nth(1)).toHaveClass(/folded-msg/);
	await expect(articles.nth(2)).not.toHaveClass(/folded-msg/);
	await expect(articles.nth(3)).not.toHaveClass(/folded-msg/);
});

test("a new reply folds the previous one", async ({ page }) => {
	await seedChat(page, thread, null, { autoFoldAssistant: true });
	await page.goto("/");
	const articles = page.locator("article");
	await expect(articles.nth(3)).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("third question");
	await page.keyboard.press("Enter");
	await expect(articles.nth(5)).toContainText("Mock reply", {
		timeout: 30_000
	});
	await expect(articles.nth(3)).toHaveClass(/folded-msg/);
	await expect(articles.nth(5)).not.toHaveClass(/folded-msg/);
});
