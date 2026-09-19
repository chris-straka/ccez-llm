import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

test.use({
	hasTouch: true,
	isMobile: true,
	// The touch jump trigger (.wp-jump) is UA-gated behind androidUI —
	// hasTouch/isMobile alone leave the desktop tick control up.
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

function fifteenTurns(): Array<{
	role: "user" | "assistant";
	content: string;
}> {
	// Fifteen user turns: the sheet caps at 55vh, so the list must
	// overflow and scroll inside it on a 915px phone viewport.
	return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap((n) => [
		{ role: "user" as const, content: `question ${n}` },
		{ role: "assistant" as const, content: `answer ${n}` }
	]);
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, fifteenTurns());
	await page.goto("/");
	// Composer tools (including the jump trigger) live on the focused
	// second line: tap into the field first.
	await page.locator(".prompt .ta-input").click();
	await expect(page.locator(".wp-jump")).toBeVisible({ timeout: 60_000 });
});

test("jump icon replaces ticks, opens a bottom sheet", async ({ page }) => {
	await expect(page.locator(".wp-btn")).toBeHidden();
	const jump = page.locator(".wp-jump");
	await expect(jump).toHaveAttribute("aria-expanded", "false");

	await jump.tap();
	await expect(jump).toHaveAttribute("aria-expanded", "true");
	const menu = page.locator(".wp-menu");
	await expect(menu).toBeVisible();
	await expect(page.locator(".wp-veil")).toBeVisible();
	// Sheet spans the viewport width, pinned near the bottom.
	const box = await menu.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBeGreaterThan(300);
	expect(box!.y).toBeGreaterThan(300);
});

test("sheet item jumps and closes", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	await page.locator('.wp-menu button[role="menuitem"]').last().tap();
	await expect(page.locator(".wp-menu")).toBeHidden();
	// Picking an item moves focus out, parking the tools: tapping back
	// into the composer returns the trigger.
	await page.locator(".prompt .ta-input").click();
	await expect(page.locator(".wp-jump")).toBeVisible();
});

test("long lists scroll inside the sheet", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	const menu = page.locator(".wp-menu");
	await expect(menu).toBeVisible();
	const overflowing = await menu.evaluate(
		(el) => el.scrollHeight > el.clientHeight + 1
	);
	expect(overflowing).toBe(true);
	await expect(menu.locator('button[role="menuitem"]')).toHaveCount(15);
});

test("veil press dismisses the sheet", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	await expect(page.locator(".wp-menu")).toBeVisible();
	await expect(page.locator(".wp-veil")).toBeVisible();
	// The sheet covers the veil's center: press an uncovered point
	// near the top of the screen.
	await page.touchscreen.tap(40, 60);
	await expect(page.locator(".wp-menu")).toBeHidden();
});
