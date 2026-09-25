import { expect, test } from "@playwright/test";

/**
 * Area picker without a backend (browser preview): the route renders
 * the transparent overlay with its hint, and Esc degrades to the
 * desktop-app note instead of hanging. The shell path (draw → save)
 * cannot run headless.
 */
test("area picker renders its hint in the preview", async ({ page }) => {
	await page.goto("/area-pick");
	await expect(
		page.getByText("Drag to set the square", { exact: false })
	).toBeVisible({ timeout: 60_000 });
	// Esc submits with no backend: the desktop-app note renders.
	await page.keyboard.press("Escape");
	await expect(
		page.getByText("Area picking needs the desktop app.", { exact: false })
	).toBeVisible({ timeout: 10_000 });
});
