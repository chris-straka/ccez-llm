import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** Empty-composer caret: a plain textarea owns exactly one native caret,
so no ghost-caret paint can strand a second one. The emptied box keeps
its caret while focused (the only focus signal) and parks it transparent
once focus leaves (data-empty rule). */

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "seed" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside:not(.settings-panel)")).not.toHaveClass(/collapsed/);
	await page.locator('aside:not(.settings-panel) button[aria-label="New chat"]').click();
	await page.locator(".ta-input").first().click();
});

test("emptied composer keeps a live caret while focused, parks it on blur", async ({
	page
}) => {
	const box = page.locator(".ta-input").first();
	await page.keyboard.type("R");
	await expect(box).toHaveValue("R");
	// The user's timing: delete while the caret is in its visible phase
	// (native blink restarts visible on every keystroke, ~1s cycle).
	await page.waitForTimeout(1100);
	await page.keyboard.press("Backspace");
	await expect(box).toHaveValue("");
	// Focused empty box keeps its blink: the cursor is the only focus
	// signal, and hiding it would strand the caret invisibly.
	const focusedColor = await page.evaluate(
		() => getComputedStyle(document.querySelector(".ta-input") as HTMLElement).caretColor
	);
	expect(focusedColor).not.toBe("rgba(0, 0, 0, 0)");
	// Focus out: the parked box shows no stray caret.
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	const parkedColor = await page.evaluate(
		() => getComputedStyle(document.querySelector(".ta-input") as HTMLElement).caretColor
	);
	expect(parkedColor).toBe("rgba(0, 0, 0, 0)");
});
