import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Capture chord without a backend (browser preview): the chord fires,
 * the flow reaches for the bridge, and the failure toasts instead of
 * crashing — the composer keeps working. The shell path (real
 * capture→OCR→send) cannot run headless; decisions, template, and
 * staging rules are pinned unit-side (keybindings, nativeCapture).
 */
test("capture chord degrades to an error toast in the preview", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Control+Shift+O");
	const err = page.locator("button.toast.error").first();
	await expect(err).toBeVisible({ timeout: 10_000 });
	// The page survives: dismiss and type in the composer.
	await err.click();
	await expect(err).toHaveCount(0, { timeout: 10_000 });
});
