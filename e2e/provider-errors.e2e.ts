import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Provider failure paths against a keyed (non-mock) provider: HTTP 401
 * and 429 surface the status in the failed reply with a Retry button,
 * and deleting a chat mid-stream aborts its reply without wedging the
 * composer. seedChat always enables the mock provider, so the keyed
 * seed below removes that flag first.
 */

const FAKE_KEY = "sk-e2e-fake-key";

/** Keyed deepseek provider with the mock flag removed (real fetch path). */
async function seedKeyedProvider(page: Page): Promise<void> {
	await seedChat(page, []);
	await page.addInitScript((key: string) => {
		window.localStorage.removeItem("ccez-mock-provider");
		const stored = window.localStorage.getItem("ccez-llm-settings-v1");
		const parsed = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
		parsed["activeProviderId"] = "deepseek";
		parsed["providers"] = {
			...((parsed["providers"] as Record<string, unknown> | undefined) ?? {}),
			deepseek: {
				baseUrl: "https://api.deepseek.com",
				apiKey: key,
				model: "deepseek-flash",
				models: []
			}
		};
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(parsed));
	}, FAKE_KEY);
}

async function send(page: Page, text: string): Promise<void> {
	await page.locator(".cm-content").click();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

test("401 surfaces the provider error with a retry", async ({ page }) => {
	await page.route("**/chat/completions", (route) =>
		route.fulfill({
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({ error: { message: "invalid api key", code: 401 } })
		})
	);
	await seedKeyedProvider(page);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await send(page, "hello provider");
	const err = page.locator("article.assistant .error").first();
	await expect(err).toContainText("HTTP 401", { timeout: 30_000 });
	await expect(err).toContainText("deepseek");
	await expect(
		page.locator("article.assistant button", { hasText: "Retry" }).first()
	).toBeVisible();
});

test("429 rate-limit retries without duplicating the reply", async ({ page }) => {
	await page.route("**/chat/completions", (route) =>
		route.fulfill({
			status: 429,
			contentType: "application/json",
			body: JSON.stringify({ error: { message: "rate limit exceeded", code: 429 } })
		})
	);
	await seedKeyedProvider(page);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await send(page, "hello rate limit");
	const err = page.locator("article.assistant .error").first();
	await expect(err).toContainText("HTTP 429", { timeout: 30_000 });
	// Retry re-attempts the same reply slot: still one assistant article,
	// still failing with the same status, never a stacked duplicate.
	await page.locator("article.assistant button", { hasText: "Retry" }).first().click();
	await expect(err).toContainText("HTTP 429", { timeout: 30_000 });
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator("article.user")).toHaveCount(1);
});

test("deleting the streaming chat aborts its reply, composer keeps working", async ({
	page
}) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-word-ms", "400");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await send(page, "please write a long slow reply for this prompt");
	await expect(page.locator(".sending")).toBeVisible({ timeout: 10_000 });
	// Drop the chat mid-stream via its sidebar delete button.
	await page.keyboard.press("Meta+b");
	const sidebar = page.locator("aside").first();
	await expect(sidebar).not.toHaveClass(/collapsed/);
	await sidebar.locator('button[aria-label="Delete chat"]').first().click();
	// A blank chat lands, no orphaned Thinking, and the composer sends.
	await expect(page.locator(".hero")).toBeVisible({ timeout: 10_000 });
	await expect(page.locator(".sending")).toHaveCount(0);
	await expect(page.locator("article")).toHaveCount(0);
	await send(page, "second attempt after abort");
	await expect(page.locator("article.assistant .rendered")).toContainText("Mock reply to:", {
		timeout: 20_000
	});
	await expect(page.locator("article")).toHaveCount(2);
});
