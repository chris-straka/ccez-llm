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
				hasText: "ML Kit (on-device)"
			}
		)
	).toHaveCount(0);
});

/** A phone browser without the shell hides the Gemma pill (same
mount-probe gating as the desktop test above: no bridge, no offer) —
only the keyed cloud options list. */
test("android browser without the shell hides the Gemma pill", async ({
	browser
}) => {
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
		const pills = page.locator(
			'.settings-panel [role="radiogroup"][aria-label="Active provider"] button'
		);
		await expect(
			pills.filter({ hasText: "ML Kit (on-device)" })
		).toHaveCount(0);
		// The keyed cloud options still list.
		await expect(pills.first()).toBeVisible();
		// Offline narrows to Gemma alone, which stays hidden without
		// the shell: nothing lists, honestly — no provider can work.
		await ctx.setOffline(true);
		await expect(pills).toHaveCount(0);
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
		.toBe("local-mlkit");
	await context.setOffline(false);
	await expect
		.poll(() => activeProviderId(page), { timeout: 10_000 })
		.toBe("muse");
});
