import { expect, test, type Page } from "@playwright/test";
import { seedChat, toggleSidebar } from "./helpers";

/**
 * Fetching chip: a tool-fetch round shows Fetching (not silence, not
 * Thinking) until the page lands, then the answer streams and the
 * chip retires.
 */
test("tool-fetch round shows the Fetching chip", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "10");
		localStorage.setItem("ccez-mock-fetch-ms", "3000");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("fetch a page for me");
	await page.keyboard.press("Enter");
	const status = page.getByRole("status", { name: "Fetching a page" });
	await expect(status).toBeVisible({ timeout: 10_000 });
	await expect(page.locator("article.assistant .rendered")).toContainText(
		"Mock reply to:",
		{ timeout: 15_000 }
	);
	await expect(status).toHaveCount(0);
});

/**
 * Tool-round retract: pre-fetch chatter streams, then the round
 * retracts it before the fetch runs — the final reply shows the
 * answer only, never the provisional prefix it would replace.
 */
test("tool-fetch round retracts pre-fetch chatter", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-word-ms", "10");
		localStorage.setItem("ccez-mock-fetch-ms", "2000");
		localStorage.setItem("ccez-mock-prefetch-text", "Looking that up. ");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".ta-input").click();
	await page.keyboard.type("fetch a page for me");
	await page.keyboard.press("Enter");
	const status = page.getByRole("status", { name: "Fetching a page" });
	await expect(status).toBeVisible({ timeout: 10_000 });
	const body = page.locator("article.assistant .rendered");
	await expect(body).toContainText("Mock reply to:", { timeout: 15_000 });
	await expect(status).toHaveCount(0);
	await expect(body).toHaveText("Mock reply to: fetch a page for me");
	await expect(body).not.toContainText("Looking that up.");
});

/**
 * Leaving mid-fetch loses nothing: the fetch and the final round
 * finish into the origin chat, and the reply lands intact (no
 * provisional prefix) when its owner returns.
 */
test("mid-fetch switch lands the reply back home", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-mock-word-ms", "10");
		window.localStorage.setItem("ccez-mock-fetch-ms", "3000");
		window.localStorage.setItem("ccez-mock-prefetch-text", "Looking that up. ");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
		);
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "chat-1",
					createdAt: 1,
					replyLang: null,
					messages: [msg("m1", "origin chat opener")]
				},
				{
					id: "chat-2",
					createdAt: 2,
					replyLang: null,
					messages: [msg("m2", "other chat opener")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"origin chat opener",
		{ timeout: 60_000 }
	);
	await page.locator(".ta-input").click();
	await page.keyboard.type("fetch a page for me");
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("status", { name: "Fetching a page" })
	).toBeVisible({ timeout: 10_000 });
	// Away mid-fetch: the other chat shows its own thread, and the
	// origin finishes into storage while nobody watches.
	await switchChat(page, 1);
	await expect(page.locator("article .rendered").first()).toContainText(
		"other chat opener"
	);
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const chats = JSON.parse(
						window.localStorage.getItem("ccez-llm-chats-v1") ?? "[]"
					) as { id: string; messages: unknown[] }[];
					return chats.find((c) => c.id === "chat-1")?.messages.length ?? 0;
				}),
			{ timeout: 30_000 }
		)
		.toBe(3);
	// Back home: the reply landed whole, provisional prefix gone.
	await switchChat(page, 0);
	const body = page.locator("article.assistant .rendered").nth(1);
	await expect(body).toHaveText("Mock reply to: fetch a page for me");
	await expect(body).not.toContainText("Looking that up.");
});

/** Open the chat list if it closed itself, then pick a row. */
async function switchChat(page: Page, nth: number): Promise<void> {
	await page.locator(".ta-input").click();
	const aside = page.locator("aside").first();
	if (await aside.evaluate((el) => el.classList.contains("collapsed"))) {
		await toggleSidebar(page);
	}
	const row = page.locator("aside ul li button.side-chat").nth(nth);
	await expect(row).toBeVisible();
	await row.click();
}
