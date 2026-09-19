import { expect, test, type Page } from "@playwright/test";

/**
 * Reload persistence: chat history and sidebar state survive a reload.
 *
 * NOTE: these tests deliberately do NOT use seedChat — addInitScript
 * seeds re-run on every reload, which would restore the seed instead
 * of proving the app persisted its own state. Storage is seeded once
 * via evaluate after first boot, then the reload boots from storage
 * exactly like a real restart.
 */

const CHATS_KEY = "ccez-llm-chats-v1";
const SETTINGS_KEY = "ccez-llm-settings-v1";

async function seedChats(page: Page): Promise<void> {
	await page.evaluate((key: string) => {
		window.localStorage.setItem(
			key,
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-m0",
							role: "user",
							content: "persisted question alpha",
							usage: null,
							error: null
						},
						{
							id: "e2e-m1",
							role: "assistant",
							content: "persisted answer beta",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	}, CHATS_KEY);
}

test("history survives a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await seedChats(page);
	await page.reload();
	await expect(page.locator("article.user .rendered").first()).toContainText(
		"persisted question alpha",
		{ timeout: 60_000 }
	);
	await expect(
		page.locator("article.assistant .rendered").first()
	).toContainText("persisted answer beta");
	await expect(page.locator("article")).toHaveCount(2);
});

test("sent messages persist across a reload", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("a message that must survive reload");
	await page.keyboard.press("Enter");
	// Gate on completion, not first tokens: the finished reply persists
	// in the stream's `finally`, so reloading on partial text would only
	// prove the user message survived.
	await expect(page.locator("article.assistant .rendered")).toHaveText(
		"Mock reply to: a message that must survive reload",
		{ timeout: 15_000 }
	);
	await expect(page.locator(".sending")).toHaveCount(0);
	// The mock flag is an init script (test-only); the messages below are
	// the app's own persisted state, reloaded with no seeding.
	await page.reload();
	await expect(page.locator("article.user .rendered").first()).toContainText(
		"a message that must survive reload",
		{ timeout: 60_000 }
	);
	await expect(
		page.locator("article.assistant .rendered").first()
	).toContainText("Mock reply to: a message that must survive reload");
	await expect(page.locator("article")).toHaveCount(2);
});

test("theme choice survives a reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	// NOTE: sidebar collapse is NOT covered here on purpose — the app
	// forces `sidebarCollapsed = true` at boot by design ("always starts
	// closed"), so it can never survive a reload. Theme is a genuinely
	// persisted setting: pick the non-default Dark, then reload.
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await panel.locator("fieldset.theme button", { hasText: "Dark" }).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	// The choice persists asynchronously; wait for the stored value.
	await expect
		.poll(
			async () =>
				page.evaluate((key) => {
					const raw = window.localStorage.getItem(key);
					return raw ? (JSON.parse(raw) as { theme?: string }).theme : null;
				}, SETTINGS_KEY),
			{ timeout: 15_000 }
		)
		.toBe("dark");
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
