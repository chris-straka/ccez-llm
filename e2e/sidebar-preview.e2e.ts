import { expect, test, type Page } from "@playwright/test";

const ALPHA = "Alpha active-chat message";
const BRAVO = "Bravo preview-chat message";

/** Two chats: the first is active on load (loadChats lands on chats[0]). */
async function seedTwoChats(page: Page): Promise<void> {
	await page.addInitScript(
		({ a, b }: { a: string; b: string }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			const chat = (id: string, content: string) => ({
				id,
				createdAt: 1,
				replyLang: null,
				messages: [{ id: `${id}-m`, role: "assistant", content, usage: null, error: null }]
			});
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([chat("chat-a", a), chat("chat-b", b)])
			);
		},
		{ a: ALPHA, b: BRAVO }
	);
}

async function openSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
}

test.beforeEach(async ({ page }) => {
	await seedTwoChats(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

/** Hovering a sidebar row previews that chat; leaving restores the active one. */
test("sidebar hover previews the chat and restores on leave", async ({ page }) => {
	await openSidebar(page);
	const main = page.locator("main .messages");
	await expect(main).toContainText(ALPHA);

	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await expect(main).toContainText(BRAVO);
	await expect(main).not.toContainText(ALPHA);

	await page.mouse.move(600, 500);
	await expect(main).toContainText(ALPHA);
	await expect(main).not.toContainText(BRAVO);
});

/** The preview is read-only: no action row, no selection menu while hovering. */
test("preview hides the action row until the hover leaves", async ({ page }) => {
	await openSidebar(page);
	const actions = page.locator("article.assistant .actions");
	await expect(actions).toHaveCount(1);

	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await expect(page.locator("main .messages")).toContainText(BRAVO);
	await expect(actions).toHaveCount(0);

	await page.mouse.move(600, 500);
	await expect(actions).toHaveCount(1);
});

/** Clicking a hovered row selects it: the preview sticks after the hover leaves. */
test("clicking a previewed row makes it the active chat", async ({ page }) => {
	await openSidebar(page);
	const rows = page.locator("aside ul li button.side-chat");
	await rows.nth(1).hover();
	await expect(page.locator("main .messages")).toContainText(BRAVO);

	await rows.nth(1).click();
	await page.mouse.move(600, 500);
	await expect(page.locator("main .messages")).toContainText(BRAVO);
	await expect(page.locator("main .messages")).not.toContainText(ALPHA);
	await expect(rows.nth(1)).toHaveClass(/active/);
});
