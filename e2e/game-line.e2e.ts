import { test, expect } from "./fixtures";
import { seedChat } from "./helpers";

test("game-line route explains itself outside the shell", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/game-line");
	await expect(page.locator(".game-line .note")).toHaveText(
		"The game line needs the desktop app.",
		{ timeout: 60_000 }
	);
});

test("game-line toggle degrades to a toast in the browser", async ({
	page
}) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const toggle = panel.locator(
		'label.check:has-text("Game line overlay") input[type="checkbox"]'
	);
	await expect(toggle).toBeVisible();
	await expect(toggle).not.toBeChecked();
	await toggle.click();
	// No shell, so no window: the flag stays off and a toast says why.
	await expect(toggle).not.toBeChecked();
	await expect(page.locator(".toast.error")).toContainText(
		"The game line needs the desktop app."
	);
});
