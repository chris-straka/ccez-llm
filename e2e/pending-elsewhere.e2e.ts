import { expect, test, type Page } from "./fixtures";
import { toggleSidebar } from "./helpers";

/** Two seeded chats (A active) and a slow mock reply: the
first token waits `firstMs`, then words land every `wordMs`. */
async function seedTwoChats(
	page: Page,
	firstMs: number,
	wordMs: number
): Promise<void> {
	await page.addInitScript(
		(timing: { firstMs: number; wordMs: number }) => {
			// Seed once: a reload mid-spec must keep what the app wrote.
			if (window.localStorage.getItem("ccez-llm-chats-v1")) return;
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem("ccez-mock-first-ms", String(timing.firstMs));
			window.localStorage.setItem("ccez-mock-word-ms", String(timing.wordMs));
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({
					hoverAssistantActions: true,
					hoverUserActions: true,
					promptIdleSec: 0
				})
			);
			const msg = (id: string, role: string, content: string) => ({
				id,
				role,
				content,
				usage: null,
				error: null
			});
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "chat-a",
						createdAt: 2,
						replyLang: null,
						title: "Alpha chat",
						messages: [
							msg("a0", "user", "alpha opener"),
							msg("a1", "assistant", "alpha answer")
						]
					},
					{
						id: "chat-b",
						createdAt: 1,
						replyLang: null,
						title: "Bravo chat",
						messages: [
							msg("b0", "user", "bravo opener"),
							msg("b1", "assistant", "bravo answer")
						]
					}
				])
			);
		},
		{ firstMs, wordMs }
	);
}

const sidebar = (page: Page) => page.locator("aside:not(.settings-panel)");
const row = (page: Page, id: string) =>
	sidebar(page).locator(`button.side-chat[data-chat-id="${id}"]`);

/** The list row's in-flight mark (settling waits out the stream). */
async function expectWorking(
	page: Page,
	id: string,
	working: boolean
): Promise<void> {
	if (working) await expect(row(page, id)).toHaveClass(/working/);
	else
		await expect(row(page, id)).not.toHaveClass(/working/, {
			timeout: 20_000
		});
}

/** Screenshot once the list's slide has settled. */
async function shot(page: Page, name: string): Promise<void> {
	await page.waitForFunction(() =>
		[...document.querySelectorAll("aside")].every(
			(el) => el.getAnimations().length === 0
		)
	);
	await page.screenshot({ path: `.screenshots/${name}.png` });
}

async function openChat(page: Page, id: string): Promise<void> {
	if (await sidebar(page).evaluate((el) => el.classList.contains("collapsed")))
		await toggleSidebar(page);
	await expect(sidebar(page)).not.toHaveClass(/collapsed/);
	await row(page, id).click();
	await expect(row(page, id)).toHaveClass(/active/);
}

async function send(page: Page, text: string): Promise<void> {
	await page.locator(".ta-input").click();
	await page.keyboard.type(text);
	await page.keyboard.press("Enter");
}

const lastAssistant = (page: Page) =>
	page.locator("article.assistant").last().locator(".rendered");

/** Leave a chat while its reply is still thinking, work in another
chat (type, send, scroll, edit), and come back: the thinking chip is
still there, the reply streams in where it was asked, and the other
chat's send keeps its own chip. The sidebar marks every chat with a
reply in flight. */
test("a pending reply survives working in another chat", async ({ page }) => {
	await seedTwoChats(page, 8_000, 120);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"alpha opener",
		{ timeout: 60_000 }
	);
	await send(page, "alpha question one");
	await expect(page.locator(".sending")).toBeVisible();
	// The list says chat A is working, chat B is not.
	await toggleSidebar(page);
	await expectWorking(page, "chat-a", true);
	await expectWorking(page, "chat-b", false);

	// Chat B: type, send, edit an old message, scroll.
	await openChat(page, "chat-b");
	await expect(page.locator("article .rendered").first()).toContainText(
		"bravo opener"
	);
	// A's chip never follows the view.
	await expect(page.locator(".sending")).toHaveCount(0);
	await send(page, "bravo question one");
	await expect(page.locator(".sending")).toBeVisible();
	await page.locator("main .messages").evaluate((el) => {
		el.scrollTop = 0;
		el.dispatchEvent(new Event("scroll"));
	});
	await page.locator(".ta-input").click();
	await page.keyboard.type("a draft in bravo");
	await toggleSidebar(page);
	await expectWorking(page, "chat-a", true);
	await expectWorking(page, "chat-b", true);
	// Picture with nothing hovered or focused in the list (row
	// buttons and tips cover the timestamp line on hover).
	await page.mouse.move(900, 500);
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await expect(sidebar(page).locator(".side-tip").first()).toHaveCSS(
		"opacity",
		"0"
	);
	await shot(page, "pending-list");

	// Back to A while it still thinks: the chip is there.
	await openChat(page, "chat-a");
	await expect(page.locator("article.user").last()).toContainText(
		"alpha question one"
	);
	await expect(page.locator(".sending")).toBeVisible();
	// Still the live placeholder: no action row on a reply that has
	// not arrived (B's newer send must not demote it). Hover it for
	// the picture: a demoted one shows its buttons under nothing.
	await expect(
		page.locator("article.assistant").last().locator(".actions")
	).toHaveCount(0);
	// (The status stands for the empty row on hover.)
	await page.locator(".sending").hover();
	await shot(page, "pending-a-back");
	await expect(page.locator(".sending")).toBeVisible();
	// Then the reply streams in here, in A.
	await expect(lastAssistant(page)).toContainText("Mock reply to:", {
		timeout: 15_000
	});
	await expect(lastAssistant(page)).toContainText("alpha question one");
	await expectWorking(page, "chat-a", false);

	// B got its own reply, never A's.
	await openChat(page, "chat-b");
	await expect(lastAssistant(page)).toContainText("bravo question one", {
		timeout: 20_000
	});
	await expect(page.locator("article")).toHaveCount(4);
	await expect(page.locator("article", { hasText: "alpha" })).toHaveCount(0);
	await expectWorking(page, "chat-b", false);
	await openChat(page, "chat-a");
	await expect(page.locator("article")).toHaveCount(4);
	await expect(page.locator("article", { hasText: "bravo" })).toHaveCount(0);
});

/** Both chats streaming at once: each view streams its own text, and
the older send stays the live streaming row (Japanese, so a demoted
row would grow reading-aid buttons mid-stream). */
test("two chats stream at once and each keeps its own text", async ({
	page
}) => {
	await seedTwoChats(page, 300, 500);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toContainText(
		"alpha opener",
		{ timeout: 60_000 }
	);
	await send(page, "alpha 東京 は どこ です か 今日 は いい 天気 です ね");
	await expect(lastAssistant(page)).toContainText("Mock", { timeout: 10_000 });
	await toggleSidebar(page);
	await openChat(page, "chat-b");
	await send(page, "bravo streaming question with plenty of words");
	await expect(lastAssistant(page)).toContainText("Mock", { timeout: 10_000 });
	// Back to A mid-stream: its text keeps growing in view (the
	// streaming row, not a frozen copy).
	await openChat(page, "chat-a");
	const before = (await lastAssistant(page).textContent()) ?? "";
	await expect
		.poll(
			async () => ((await lastAssistant(page).textContent()) ?? "").length,
			{
				timeout: 10_000
			}
		)
		.toBeGreaterThan(before.length);
	await page.locator("article.assistant").last().hover();
	await shot(page, "pending-both-streaming");
	// Still the streaming row while B streams too: reading aids wait
	// for the settled reply. (Counted once, not retried: B settling
	// first would hide a demoted row.)
	expect(
		await page.locator("article.assistant").last().locator(".aid-btn").count()
	).toBe(0);
	await expect(lastAssistant(page)).toContainText("天気 です ね", {
		timeout: 20_000
	});
	// Settled: the reading aids arrive (so the check above can fail).
	await expect(
		page.locator("article.assistant").last().locator(".aid-btn").first()
	).toBeAttached();
	await openChat(page, "chat-b");
	await expect(lastAssistant(page)).toContainText("bravo streaming question", {
		timeout: 20_000
	});
	await expect(page.locator("article", { hasText: "alpha" })).toHaveCount(0);
});
