import { expect, test } from "@playwright/test";

/**
 * Area picker without a backend (browser preview): the route renders
 * the live overlay fallback (no frozen frame arrives — the photo
 * handshake only answers inside the shell), and Esc degrades to the
 * desktop-app note instead of hanging. The shell path (photo → draw
 * → save) cannot run headless; the pixel mapping is pinned
 * unit-side (nativeCapture `scaleRectToDevice`).
 */
test("area picker falls back to the live overlay in the preview", async ({
	page
}) => {
	await page.goto("/area-pick");
	await expect(
		page.getByText("Drag to set the square", { exact: false })
	).toBeVisible({ timeout: 60_000 });
	// No frozen frame outside the shell: no photo layer renders.
	await expect(page.locator("img.area-photo")).toHaveCount(0);
	// Esc submits with no backend: the desktop-app note renders.
	await page.keyboard.press("Escape");
	await expect(
		page.getByText("Area picking needs the desktop app.", { exact: false })
	).toBeVisible({ timeout: 10_000 });
});
