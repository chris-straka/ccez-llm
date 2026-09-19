import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

async function openSettings(
	page: import("@playwright/test").Page
): Promise<void> {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

async function activeProviderId(
	page: import("@playwright/test").Page
): Promise<string> {
	return page.evaluate(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		if (!raw) throw new Error("no settings saved");
		return (JSON.parse(raw) as { activeProviderId: string }).activeProviderId;
	});
}

/** Desktop has no on-device bridge, so the picker hides the Gemma pill. */
test("desktop settings hide the Gemma pill", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await openSettings(page);
	await expect(
		page.locator(
			'.settings-panel [role="radiogroup"][aria-label="Active provider"] button',
			{
				hasText: "Gemma (on-device)"
			}
		)
	).toHaveCount(0);
});

/** Android lists Gemma beside the cloud options: keyless, with a
readiness note (browser dev has no bridge, so the note names that). */
test("android Gemma is keyless with a readiness note", async ({ browser }) => {
	const ctx = await browser.newContext({
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
	});
	const page = await ctx.newPage();
	try {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await page.goto("/");
		await expect(page.locator(".ta-input").first()).toBeVisible({
			timeout: 60_000
		});
		await openSettings(page);
		const gemma = page.locator(
			'.settings-panel [role="radiogroup"][aria-label="Active provider"] button',
			{ hasText: "Gemma (on-device)" }
		);
		await expect(gemma).toBeVisible();
		await gemma.click();
		await expect(gemma).toHaveAttribute("aria-checked", "true");
		// Keyless: the hint replaces the password field, not supplements it.
		await expect(
			page.locator(".settings-panel").getByText(/No key needed/)
		).toBeVisible();
		await expect(
			page.locator('.settings-panel input[type="password"]')
		).toHaveCount(0);
		// No shell here: the note says on-device chat is unavailable.
		await expect(
			page
				.locator(".settings-panel")
				.getByText(/isn't available on this device/)
		).toBeVisible();
		// Offline narrows the picker to Gemma alone.
		await ctx.setOffline(true);
		await expect(
			page.locator(
				'.settings-panel [role="radiogroup"][aria-label="Active provider"] button'
			)
		).toHaveCount(1);
	} finally {
		await ctx.close();
	}
});

/** Dropping offline parks a cloud provider on Gemma; reconnecting restores it. */
test("offline parks on Gemma and online restores", async ({
	page,
	context
}) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	expect(await activeProviderId(page)).toBe("muse");
	await context.setOffline(true);
	await expect
		.poll(() => activeProviderId(page), { timeout: 10_000 })
		.toBe("local-gemma");
	await context.setOffline(false);
	await expect
		.poll(() => activeProviderId(page), { timeout: 10_000 })
		.toBe("muse");
});
