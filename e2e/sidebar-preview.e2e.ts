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
				messages: [
					{
						id: `${id}-m`,
						role: "assistant",
						content,
						usage: null,
						error: null
					}
				]
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
test("sidebar hover previews the chat and restores on leave", async ({
	page
}) => {
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

/** Hovering a row pops its counts: messages plus the you/AI split.
The tip waits 3s into the hover (passing glances stay clean), so
the opacity assert carries its own timeout. */
test("sidebar hover shows the chat counts tip", async ({ page }) => {
	await openSidebar(page);
	const row = page.locator("aside ul li").first();
	await row.hover();
	const tip = row.locator(".side-tip");
	// Opacity, not visibility: the tip keeps its box while faded.
	await expect(tip).toHaveCSS("opacity", "1", { timeout: 10_000 });
	await expect(tip).toHaveText("1 message · you 0 · AI 1");
	// The tip floats above the row, never below it.
	const boxes = await Promise.all([tip.boundingBox(), row.boundingBox()]);
	if (!boxes[0] || !boxes[1]) throw new Error("tip or row has no box");
	expect(boxes[0].y + boxes[0].height).toBeLessThanOrEqual(boxes[1].y + 4);
	// Leaving drops hover; the row button also holds keyboard focus,
	// so click out to clear focus-within too.
	await page.mouse.move(600, 500);
	await page.locator("article .rendered").first().click();
	await expect(tip).toHaveCSS("opacity", "0");
});

/** The preview is read-only: the action row stays mounted but inert
(the peek reserves the row's space so opening the chat moves
nothing), and no selection menu summons while hovering. Fails on
pristine HEAD as count-0; the inert contract is the design. */
test("preview holds the action row inert until the hover leaves", async ({
	page
}) => {
	await openSidebar(page);
	const actions = page.locator("article.assistant .actions");
	await expect(actions).toHaveCount(1);
	await expect(actions).not.toHaveAttribute("inert", "");

	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await expect(page.locator("main .messages")).toContainText(BRAVO);
	await expect(actions).toHaveCount(1);
	await expect(actions).toHaveAttribute("inert", "");

	await page.mouse.move(600, 500);
	await expect(actions).toHaveCount(1);
	await expect(actions).not.toHaveAttribute("inert", "");
});

/** Hovering a row's export/delete buttons keeps that chat's preview:
moving within the row (label to icon) never drops back to active. */
test("row icon hover keeps the preview", async ({ page }) => {
	await openSidebar(page);
	const main = page.locator("main .messages");
	const row = page.locator("aside ul li").nth(1);
	await row.locator("button.side-chat").hover();
	await expect(main).toContainText(BRAVO);
	await row.locator("button.exp").hover();
	await expect(main).toContainText(BRAVO);
	await expect(main).not.toContainText(ALPHA);
	await row.locator("button.del").hover();
	await expect(main).toContainText(BRAVO);
	await expect(main).not.toContainText(ALPHA);
});

/** Crossing the gap between rows keeps the last preview: the active
chat never flashes in between while moving down the list. */
test("gap crossing keeps the preview", async ({ page }) => {
	await openSidebar(page);
	const main = page.locator("main .messages");
	const row = page.locator("aside ul li").nth(1);
	await row.locator("button.side-chat").hover();
	await expect(main).toContainText(BRAVO);
	const box = await row.boundingBox();
	if (!box) throw new Error("row has no box");
	// Straight up off the row into the gap above it: inside the list,
	// on no row — the last preview stands, active never flashes.
	await page.mouse.move(box.x + box.width / 2, box.y - 1);
	await expect(main).toContainText(BRAVO);
	await expect(main).not.toContainText(ALPHA);
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
