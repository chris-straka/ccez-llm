import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { dragQuote, seedChat, toggleSidebar } from "./helpers";

/** Two chats: the seeded one plus an empty second, so specs can
switch away and back through the chat list. */
async function seedTwoChats(page: Page, content: string): Promise<void> {
	await seedChat(page, [{ role: "assistant", content }]);
	await page.addInitScript(() => {
		const raw = localStorage.getItem("ccez-llm-chats-v1") ?? "[]";
		const chats = JSON.parse(raw) as unknown[];
		if (chats.length === 1)
			localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					...chats,
					{
						id: "e2e-chat-b",
						createdAt: 2,
						replyLang: null,
						messages: [
							{
								id: "e2e-b0",
								role: "assistant",
								content: "A second chat about something else entirely",
								usage: null,
								error: null
							}
						]
					}
				])
			);
	});
}

/** Pick a chat row from the list (rows run oldest first). */
async function openChat(page: Page, row: number): Promise<void> {
	const aside = page.locator("aside").first();
	if (await aside.evaluate((el) => el.classList.contains("collapsed")))
		await toggleSidebar(page);
	await expect(aside).not.toHaveClass(/collapsed/);
	await page.locator("aside ul li button.side-chat").nth(row).click();
}

/** Shift+A over a Japanese sentence: the note box takes the caret
and keeps it once the readings panels (and their kanji tint) land. */
test("shift A on a japanese sentence focuses the note box", async ({
	page
}) => {
	test.setTimeout(180_000);
	await seedChat(page, [
		{
			role: "assistant",
			content: "日本語の発音は難しいですが、話す練習がとても楽しいです。"
		}
	]);
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	await dragQuote(page, 0, "日本語の発音は難しい");
	await expect(page.locator(".sel-menu")).toBeVisible({ timeout: 10_000 });
	await page.keyboard.press("A");
	const box = page.locator(".ann-pop.fresh textarea");
	await expect(box).toBeVisible({ timeout: 10_000 });
	// Several kanji groups: one panel each, tinted in the document.
	await expect(page.locator(".sel-pinyin").nth(1)).toBeVisible({
		timeout: 120_000
	});
	await expect(page.locator(".rendered .frbt0").first()).toBeVisible();
	await expect(box).toBeFocused();
	await page.keyboard.type("why");
	await expect(box).toHaveValue("why");
});

/** A note still waiting for its answer survives both A keys: bare A
does nothing, Shift+A then Esc leaves it to finish loading. */
test("a loading note survives A and an escaped Shift+A", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "the riverbank at dawn holds the fog" }
	]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "4000");
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});
	const badge = page.locator("article.assistant button.ccez-ann-badge");
	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("a");
	await expect(badge).toHaveCount(1);
	await expect(badge).not.toHaveClass(/ans-ready/);
	const id = await badge.getAttribute("data-ann-badge");

	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("a");
	await page.waitForTimeout(300);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(badge).toHaveCount(1);
	await expect(badge).toHaveAttribute("data-ann-badge", id ?? "");

	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("A");
	await expect(page.locator(".ann-pop.fresh")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(badge).toHaveCount(1);
	await expect(badge).toHaveAttribute("data-ann-badge", id ?? "");
	await expect(badge).toHaveClass(/ans-ready/, { timeout: 10_000 });
});

/** Leaving a chat closes its selection menu and review dock, and a
note's answer keeps loading while another chat is open. */
test("chat switches close annotation surfaces and answers keep loading", async ({
	page
}) => {
	await seedTwoChats(page, "the riverbank at dawn holds the fog");
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
	});
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({
		timeout: 60_000
	});

	await dragQuote(page, 0, "riverbank");
	await expect(page.locator(".sel-menu")).toBeVisible();
	await openChat(page, 1);
	await expect(page.locator("article.assistant")).toContainText("second chat");
	await expect(page.locator(".sel-menu")).toHaveCount(0);

	// File a note, then leave before its answer lands.
	await openChat(page, 0);
	await toggleSidebar(page);
	await dragQuote(page, 0, "riverbank");
	await page.keyboard.press("a");
	const badge = page.locator("article.assistant button.ccez-ann-badge");
	await expect(badge).toHaveCount(1);
	await expect(badge).not.toHaveClass(/ans-ready/);
	// The blue badge opens the review dock on its row.
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-wrap.pinned")).toHaveCount(1);
	await openChat(page, 1);
	await expect(page.locator(".ann-wrap.pinned")).toHaveCount(0);
	await page.waitForTimeout(3500);
	await openChat(page, 0);
	// Answered while away: orange at once, no second 2.5s request.
	await expect(badge).toHaveClass(/ans-ready/, { timeout: 1000 });
	await expect(page.locator(".ann-wrap.pinned")).toHaveCount(0);
});
