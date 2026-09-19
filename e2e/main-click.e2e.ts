import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Clicking into the main chat collapses both sidebars (settings panel
 * and chats list), landing the click on a full-width conversation.
 * Key presses wait for the prompt editor: the window key handler only
 * attaches once it mounts, so an early chord would be lost to a race.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
});

test("clicking the main chat collapses the chats sidebar", async ({ page }) => {
	const aside = page.locator("aside").first();
	await page.keyboard.press("Meta+b");
	await expect(aside).not.toHaveClass(/collapsed/);

	await page.locator(".empty-state h1").click();
	await expect(aside).toHaveClass(/collapsed/);
});

test("clicking the main chat closes the settings panel", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await page.keyboard.press("Meta+,");
	await expect(panel).not.toHaveClass(/closed/);

	await page.locator(".empty-state h1").click();
	await expect(panel).toHaveClass(/closed/);
});

/**
 * A click into the chat closes settings even while the reply streams:
 * tokens must never swallow the click-off-to-close.
 */
test("clicking the main chat closes the settings panel mid-stream", async ({
	page
}) => {
	const filler = Array.from({ length: 30 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `filler message number ${i} with enough words to take vertical space in the thread`
	}));
	await page.addInitScript(
		({ msgs }: { msgs: Array<{ role: string; content: string }> }) => {
			window.localStorage.setItem("ccez-mock-word-ms", "1500");
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: null,
						messages: msgs.map((m, i) => ({
							id: `e2e-m${i}`,
							role: m.role,
							content: m.content,
							usage: null,
							error: null
						}))
					}
				])
			);
		},
		{ msgs: filler }
	);
	await page.reload();
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const panel = page.locator(".settings-panel");
	await page.locator(".ta-input").first().click();
	await page.keyboard.type("mid-stream close probe");
	await page.keyboard.press("Enter");
	const body = page.locator("article.assistant .rendered").last();
	await expect(body).toContainText("Mock reply", { timeout: 15_000 });
	// Open settings while tokens are still arriving (1.5s a word),
	// then click into the chat: the close must land mid-stream.
	await page.keyboard.press("Meta+,");
	await expect(panel).not.toHaveClass(/closed/);
	// Guard: the stream is genuinely still running at click time.
	const partial = ((await body.textContent()) ?? "").trim();
	expect(partial.length).toBeGreaterThan(0);
	expect(partial).not.toBe("Mock reply to: mid-stream close probe");
	// Forced (no stability wait): the events must dispatch mid-stream.
	// Click the user's own message, not the streaming one.
	await page.locator("article.user .rendered").last().click({ force: true });
	// Proof the click landed mid-stream: tokens still arriving after.
	const after = ((await body.textContent()) ?? "").trim();
	expect(after).not.toBe("Mock reply to: mid-stream close probe");
	await expect(panel).toHaveClass(/closed/);
	// And it stays closed when the stream lands: completion handlers
	// must not resurrect the panel.
	await expect(body).toHaveText("Mock reply to: mid-stream close probe", {
		timeout: 30_000
	});
	await expect(panel).toHaveClass(/closed/);
});

test("shift-cmd-comma mirrors cmd-comma on the settings panel", async ({
	page
}) => {
	const panel = page.locator(".settings-panel");
	await page.keyboard.press("Meta+,");
	await expect(panel).not.toHaveClass(/closed/);
	await page.keyboard.press("Meta+,");
	await expect(panel).toHaveClass(/closed/);

	await page.keyboard.press("Shift+Meta+,");
	await expect(panel).not.toHaveClass(/closed/);
	await page.keyboard.press("Shift+Meta+,");
	await expect(panel).toHaveClass(/closed/);
});
