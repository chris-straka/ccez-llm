import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Error toasts pair red both ways: light red on light theme, dark
 * red on dark. Forced through the message copy path with no
 * clipboard (every other failure path shares flashErrorToast).
 */
for (const theme of ["light", "dark"] as const) {
	test(`failed copy toasts red on ${theme}`, async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "copy me" }]);
		await page.addInitScript(() => {
			Object.defineProperty(window.navigator, "clipboard", { value: null, configurable: true });
		});
		await page.addInitScript(
			(name: string) => {
				const raw = window.localStorage.getItem("ccez-llm-settings-v1") ?? "{}";
				window.localStorage.setItem(
					"ccez-llm-settings-v1",
					JSON.stringify({ ...JSON.parse(raw), theme: name })
				);
			},
			theme
		);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
		const row = page.locator("article.assistant").first();
		await row.hover();
		await row.locator('button[aria-label="Copy as plain text"]').click();
		const toast = page.locator(".toast.error");
		await expect(toast).toBeVisible({ timeout: 10_000 });
		await expect(toast).toContainText("Couldn't copy to the clipboard.");
		await expect(toast).toHaveCSS(
			"background-color",
			theme === "light" ? "rgb(253, 236, 234)" : "rgb(61, 16, 8)"
		);
		await expect(toast).toHaveCSS(
			"color",
			theme === "light" ? "rgb(148, 37, 10)" : "rgb(255, 180, 162)"
		);
	});
}

/** Plain confirmations clear fast (3s): the toast appears, then hides
well before the error delay. */
test("plain toast clears fast", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [{ role: "assistant", content: "copy me" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	const row = page.locator("article.assistant").first();
	await row.hover();
	await row.locator('button[aria-label="Copy as plain text"]').click();
	const toast = page.locator(".toast:not(.error)");
	await expect(toast).toContainText("Copied", { timeout: 10_000 });
	await expect(toast).toBeHidden({ timeout: 6_000 });
});

/** Failures hold the long delay (8s): still up past the plain toast's
expiry, gone on their own later. */
test("error toast outlives the plain delay", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "copy me" }]);
	await page.addInitScript(() => {
		Object.defineProperty(window.navigator, "clipboard", { value: null, configurable: true });
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	const row = page.locator("article.assistant").first();
	await row.hover();
	await row.locator('button[aria-label="Copy as plain text"]').click();
	const toast = page.locator(".toast.error");
	await expect(toast).toBeVisible({ timeout: 10_000 });
	// Past the plain 3s delay the failure is still up...
	await page.waitForTimeout(4500);
	await expect(toast).toBeVisible();
	// ...and clears on the long delay.
	await expect(toast).toBeHidden({ timeout: 10_000 });
});
