import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/** Settings → Licenses: the app's license, the data and fonts with
their sources, and every library behind a filter; Esc closes it and
leaves Settings open. */
test("licenses list the data sources and every library", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("ControlOrMeta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await panel.getByRole("button", { name: "Licenses" }).click();
	const sheet = page.getByRole("dialog", { name: "Licenses" });
	await expect(
		sheet.getByText("MIT License, © 2026 Chris Straka")
	).toBeVisible();
	await expect(
		sheet.getByText(
			"JMdict, Electronic Dictionary Research and Development Group"
		)
	).toBeVisible();
	await expect(sheet.locator(".lic-libs summary")).toHaveText([
		/App libraries \(JavaScript\)\s*\d+/,
		/Native libraries \(Rust\)\s*\d+/
	]);
	await page.screenshot({ path: ".screenshots/licenses-1440.png" });
	// Filtering opens the lists on the matches.
	await sheet.getByLabel("Filter libraries").fill("katex");
	await expect(sheet.locator(".lic-table li").first()).toContainText("katex");
	await page.keyboard.press("Escape");
	await expect(sheet).toHaveCount(0);
	await expect(panel).not.toHaveClass(/closed/);
});
