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

/**
 * Capture enable checkbox: on by default, persists off across reload.
 * The composer button never renders in the preview (no backend probe),
 * so this pins the settings half of the kill-switch here.
 */
test("capture checkbox persists and the preview shows no button", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	// No backend answers in the preview: no capture button, ever.
	await expect(page.locator(".prompt .capture-btn")).toHaveCount(0);
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const box = page
		.locator(".settings-panel")
		.getByText("Enable screen-capture OCR (global shortcut + composer button)");
	await expect(box).toBeVisible();
	const input = page.locator(
		'.settings-panel label.check:has-text("Enable screen-capture OCR") input[type="checkbox"]'
	);
	await expect(input).toBeChecked();
	await input.uncheck();
	// The seed rewrites settings on every load, so persistence pins
	// to storage here (the load half rides settings.test.ts).
	await expect
		.poll(
			async () =>
				page.evaluate(
					() =>
						(
							JSON.parse(
								window.localStorage.getItem("ccez-llm-settings-v1") ?? "{}"
							) as Record<string, unknown>
						).captureEnabled
				),
			{ timeout: 10_000 }
		)
		.toBe(false);
});

/**
 * A seeded-off checkbox renders unchecked: the kill-switch reads the
 * stored value, never a hardcoded default.
 */
test("seeded-off capture checkbox renders unchecked", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }], null, {
		captureEnabled: false
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	await expect(
		page.locator(
			'.settings-panel label.check:has-text("Enable screen-capture OCR") input[type="checkbox"]'
		)
	).not.toBeChecked();
});
