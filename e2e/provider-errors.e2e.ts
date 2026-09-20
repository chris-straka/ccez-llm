import { expect, test, type Page } from "@playwright/test";
import { dragQuote, seedChat } from "./helpers";

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
		const parsed = stored
			? (JSON.parse(stored) as Record<string, unknown>)
			: {};
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
	await page.locator(".ta-input").click();
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
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await send(page, "hello provider");
	const err = page.locator("article.assistant .error").first();
	await expect(err).toContainText("HTTP 401", { timeout: 30_000 });
	await expect(err).toContainText("deepseek");
	await expect(
		page.locator('article.assistant button[aria-label="Retry"]').first()
	).toBeVisible();
});

test("429 rate-limit retries without duplicating the reply", async ({
	page
}) => {
	await page.route("**/chat/completions", (route) =>
		route.fulfill({
			status: 429,
			contentType: "application/json",
			body: JSON.stringify({
				error: { message: "rate limit exceeded", code: 429 }
			})
		})
	);
	await seedKeyedProvider(page);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await send(page, "hello rate limit");
	const err = page.locator("article.assistant .error").first();
	await expect(err).toContainText("HTTP 429", { timeout: 30_000 });
	// Retry re-attempts the same reply slot: still one assistant article,
	// still failing with the same status, never a stacked duplicate.
	await page
		.locator('article.assistant button[aria-label="Retry"]')
		.first()
		.click();
	await expect(err).toContainText("HTTP 429", { timeout: 30_000 });
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator("article.user")).toHaveCount(1);
});

/** Blank-key deepseek with the mock flag removed (real resolve path). */
async function seedBlankKeyProvider(page: Page): Promise<void> {
	await seedChat(page, []);
	await page.addInitScript(() => {
		window.localStorage.removeItem("ccez-mock-provider");
		const stored = window.localStorage.getItem("ccez-llm-settings-v1");
		const parsed = stored
			? (JSON.parse(stored) as Record<string, unknown>)
			: {};
		parsed["activeProviderId"] = "deepseek";
		parsed["providers"] = {
			...((parsed["providers"] as Record<string, unknown> | undefined) ?? {}),
			deepseek: {
				baseUrl: "https://api.deepseek.com",
				apiKey: "",
				model: "deepseek-chat",
				models: []
			}
		};
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(parsed));
	});
}

test("blank key locks the composer and explains on tap", async ({ page }) => {
	await seedBlankKeyProvider(page);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	// Locked: the field takes no typing and names the missing key.
	const composer = page.locator(".ta-input").first();
	await expect(composer).toBeDisabled({ timeout: 10_000 });
	await expect(composer).toHaveAttribute(
		"placeholder",
		"Set an API key in Settings to chat"
	);
	// Tapping the locked prompt explains instead of focusing — no user
	// message is stored, so nothing is lost to a doomed turn.
	await page.locator(".prompt").click();
	await expect(page.locator(".error-banner").first()).toContainText(
		"Set an API key first",
		{ timeout: 10_000 }
	);
	await expect(composer).toHaveValue("");
	await expect(page.locator("article.user")).toHaveCount(0);
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
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply to:",
		{
			timeout: 20_000
		}
	);
	await expect(page.locator("article")).toHaveCount(2);
});

/** Row error text follows text size only with the button opt-in: at
enlarged text it stays fixed until "Scale message buttons with text
size" is checked. */
test("row error text scales only with the button opt-in", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({
				hoverAssistantActions: true,
				hoverUserActions: true,
				fontScale: 1.5
			})
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-err",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "e2e-m0",
							role: "assistant",
							content: "stalled",
							usage: null,
							error: "Load failed"
						}
					]
				}
			])
		);
	});
	await page.goto("/");
	const err = page.locator("article.assistant .error");
	await expect(err).toBeVisible({ timeout: 60_000 });
	const px = (): Promise<number> =>
		err.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	expect(await px()).toBeLessThan(14);
	await page.keyboard.press("Meta+,");
	const check = page.locator(
		'.settings-panel label:has-text("Scale message buttons with text size") input'
	);
	await expect(check).toBeVisible({ timeout: 5_000 });
	await check.check();
	expect(await px()).toBeGreaterThan(18);
});

/** A failed turn never locks annotations out: the error lands on the
reply, and filing a note on settled text keeps working after it. */
test("annotating still works after a failed turn", async ({ page }) => {
	await page.route("**/chat/completions", (route) =>
		route.fulfill({
			status: 401,
			contentType: "application/json",
			body: JSON.stringify({ error: { message: "invalid api key", code: 401 } })
		})
	);
	await seedKeyedProvider(page);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await send(page, "hello provider");
	const err = page.locator("article.assistant .error").first();
	await expect(err).toContainText("HTTP 401", { timeout: 30_000 });
	await dragQuote(page, 0, "hello provider");
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible({ timeout: 5_000 });
	await menu.locator('button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
});
