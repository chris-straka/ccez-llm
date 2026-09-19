import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Desktop summon kit — user-visible output half (study-sheet print).
 * The native half (tray, global hotkey, single instance, `ccez://`
 * handling, caffeinate) needs the Mac shell, so these specs pin what
 * the browser preview CAN show: the print-only study sheet that File
 * → Print Study Sheet opens, and its graceful absence on screen.
 *
 * Print emulation flips the `@media print` rules in
 * `src/routes/+page.svelte`: the app chrome hides and only
 * `#study-sheet-print` renders — Save as PDF in that dialog is the
 * print-to-PDF path.
 */

test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "Explain être" },
		{ role: "assistant", content: "Être means to be." }
	]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
});

test("study sheet section stays out of layout on screen", async ({ page }) => {
	const sheet = page.locator("#study-sheet-print");
	await expect(sheet).toBeHidden();
});

test("print media shows only the study sheet with the chat text", async ({
	page
}) => {
	await page.emulateMedia({ media: "print" });
	const sheet = page.locator("#study-sheet-print");
	await expect(sheet).toBeVisible();
	await expect(sheet.locator("h1")).toContainText("Explain être");
	await expect(sheet).toContainText("Être means to be.");
	await expect(sheet.locator("h2").first()).toContainText("You");
	// App chrome hides under print media — the sheet is the sole node.
	await expect(page.locator("main")).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	await expect(sheet).toBeHidden();
});

test("empty chats still render a titled sheet under print media", async ({
	page
}) => {
	await page.emulateMedia({ media: "print" });
	await expect(page.locator("#study-sheet-print h1")).toBeVisible();
	await page.emulateMedia({ media: "screen" });
});
