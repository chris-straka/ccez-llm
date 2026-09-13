import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

async function openSettings(page: import("@playwright/test").Page): Promise<void> {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

async function activeProviderId(page: import("@playwright/test").Page): Promise<string> {
	return page.evaluate(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		if (!raw) throw new Error("no settings saved");
		return (JSON.parse(raw) as { activeProviderId: string }).activeProviderId;
	});
}

/** Gemma (on-device) sits beside the cloud options and asks for no key. */
test("on-device Gemma is a keyless provider option", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await openSettings(page);
	const gemma = page.locator('.settings-panel [role="radiogroup"][aria-label="Active provider"] button', {
		hasText: "Gemma (on-device)"
	});
	await expect(gemma).toBeVisible();
	await gemma.click();
	await expect(gemma).toHaveAttribute("aria-checked", "true");
	// Keyless: the hint replaces the password field, not supplements it.
	await expect(page.locator(".settings-panel").getByText(/No key needed/)).toBeVisible();
	await expect(page.locator('.settings-panel input[type="password"]')).toHaveCount(0);
});

/** Dropping offline parks a cloud provider on Gemma; reconnecting restores it. */
test("offline parks on Gemma and online restores", async ({ page, context }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	expect(await activeProviderId(page)).toBe("muse");
	await context.setOffline(true);
	await expect.poll(() => activeProviderId(page), { timeout: 10_000 }).toBe("local-gemma");
	await context.setOffline(false);
	await expect.poll(() => activeProviderId(page), { timeout: 10_000 }).toBe("muse");
});
