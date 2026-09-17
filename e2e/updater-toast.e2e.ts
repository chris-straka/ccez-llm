import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Stub the Tauri shell with no updater backend: the update check
rejects, exercising the failure readout like a broken updater would. */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string) => {
				throw new Error(`unmocked command: ${cmd}`);
			}
		};
	});
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

/** Update checks report through the auto-dismissing page toast —
never an inline popup that shoves the settings layout around. */
test("update check toasts instead of popping the layout", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	const height = () =>
		panel.evaluate((el) => {
			const inner = el.querySelector(".settings-inner");
			return (inner ?? el).scrollHeight;
		});
	const before = await height();
	await panel.locator('button:has-text("Check for updates")').click();
	await expect(page.locator(".toast")).toContainText("Dev builds don't check for updates");
	await expect(panel.locator("p.result")).toHaveCount(0);
	// No inline status block grew the panel content.
	await expect.poll(height).toBe(before);
});
