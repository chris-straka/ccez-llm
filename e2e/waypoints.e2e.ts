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
	// The open panel hides its trigger, except a keyboard-focused one
	// (:focus-visible keeps it, so focus never sits on an invisible
	// toggle). Whether Enter after a programmatic focus counts as
	// keyboard focus varies run to run, so check the rule for both.
	const focusVisible = await btn.evaluate((el) => el.matches(":focus-visible"));
	await expect(btn).toHaveCSS("opacity", focusVisible ? "1" : "0");

	await page.mouse.click(10, 300);
	await expect(menu).toHaveCSS("visibility", "hidden");
});
