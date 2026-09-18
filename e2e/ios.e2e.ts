import { test, expect, type Page } from "@playwright/test";

test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
	viewport: { width: 390, height: 844 }
});

async function seedUserTest(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [{ id: "m1", role: "user", content: "Test", usage: null, error: null }]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article.user .bubble").first()).toBeVisible({ timeout: 60_000 });
}

test.describe("ios parity", () => {
	/** iPhones ride the phone UI: the data-android gate (which also
	feeds the keyboard pin and the plain-bubble dock) plus data-ios. */
	test("iphone gets the phone ui gates", async ({ page }) => {
		await seedUserTest(page);
		const gates = await page.evaluate(() => {
			const app = document.querySelector(".app");
			return {
				android: app?.hasAttribute("data-android") ?? false,
				ios: app?.hasAttribute("data-ios") ?? false
			};
		});
		expect(gates.android).toBe(true);
		expect(gates.ios).toBe(true);
	});

	/** Same right-edge dock as Android: the last row button (Rerun)
	shares the text's right edge instead of hanging past it. */
	test("short own message shares its right edge with the row", async ({ page }) => {
		await seedUserTest(page);
		const edges = await page.evaluate(() => {
			const text = document.querySelector("article.user .bubble .rendered");
			const rerun = document.querySelector('article.user .actions button[data-tip="Rerun"]');
			if (!text || !rerun) throw new Error("missing text or rerun");
			return {
				textRight: text.getBoundingClientRect().right,
				rerunRight: rerun.getBoundingClientRect().right
			};
		});
		expect(Math.abs(edges.textRight - edges.rerunRight)).toBeLessThanOrEqual(2);
	});
});
