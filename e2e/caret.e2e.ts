import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** Ghost-caret guard: the composer caret must be a single CodeMirror-owned
node, never the bare native caret (whose paint can go stale in the live
renderer when a visible-phase delete empties the box, leaving a second
frozen caret beside the live one). */

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "seed" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside:not(.settings-panel)")).not.toHaveClass(/collapsed/);
	await page.locator('aside:not(.settings-panel) button[aria-label="New chat"]').click();
	await page.locator(".cm-content").first().click();
});

test("visible-phase delete leaves one owned caret, native caret suppressed", async ({
	page
}) => {
	await page.keyboard.type("R");
	await expect(page.locator(".cm-content").first()).toContainText("R");
	// The user's timing: delete while the caret is in its visible phase
	// (native blink restarts visible on every keystroke, ~1s cycle).
	await page.waitForTimeout(1100);
	await page.keyboard.press("Backspace");
	await expect(page.locator(".cm-content").first()).not.toContainText("R");
	// Exactly one drawn caret: no room for a stale second one.
	await expect(page.locator(".prompt .cm-cursor-primary")).toHaveCount(1);
	// The native caret is suppressed at the source of the stale paint.
	const caretColor = await page.evaluate(
		() => getComputedStyle(document.querySelector(".cm-content") as HTMLElement).caretColor
	);
	expect(caretColor).toBe("rgba(0, 0, 0, 0)");
	// Drawn caret spine: 2px, not the 1.2px default.
	const spine = await page.evaluate(
		() =>
			getComputedStyle(document.querySelector(".prompt .cm-cursor-primary") as HTMLElement)
				.borderLeftWidth
	);
	expect(spine).toBe("2px");
	// Model state is sane: empty doc, selection collapsed at zero.
	const sel = await page.evaluate(() => {
		const s = window.getSelection();
		return { anchor: s?.anchorOffset ?? -1, focus: s?.focusOffset ?? -1 };
	});
	expect(sel).toEqual({ anchor: 0, focus: 0 });
});
