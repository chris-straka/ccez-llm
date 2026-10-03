import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";

function fourTurns(): Array<{ role: "user" | "assistant"; content: string }> {
	return [0, 1, 2, 3].flatMap((n) => [
		{ role: "user" as const, content: `question ${n}` },
		{ role: "assistant" as const, content: `answer ${n}` }
	]);
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, fourTurns());
	await page.goto("/");
	await expect(page.locator('nav[aria-label="Waypoints"]')).toBeVisible({
		timeout: 60_000
	});
});

test("trigger hides while the menu is up, returns after", async ({ page }) => {
	const wrap = page.locator(".wp-wrap");
	const btn = page.locator(".wp-btn");
	const menu = page.locator(".wp-menu");

	await wrap.hover();
	await expect(menu).toHaveCSS("visibility", "visible");
	await expect(btn).toHaveCSS("opacity", "0");

	await page.mouse.move(2, 2);
	await expect(menu).toHaveCSS("visibility", "hidden");
});

test("toolbar jump icon stays desktop-hidden", async ({ page }) => {
	await expect(page.locator(".wp-jump")).toBeHidden();
});

test("pinned menu dismisses on outside press", async ({ page }) => {
	const btn = page.locator(".wp-btn");
	const menu = page.locator(".wp-menu");

	// Pin via keyboard (hover hides the trigger): focus, Enter.
	await btn.focus();
	await btn.press("Enter");
	await expect(menu).toHaveCSS("visibility", "visible");
	await expect(btn).toHaveCSS("opacity", "0");

	await page.mouse.click(10, 300);
	await expect(menu).toHaveCSS("visibility", "hidden");
});
