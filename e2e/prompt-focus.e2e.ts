import { expect, test, type Page } from "./fixtures";
import { pinMacPlatform, toggleSidebar } from "./helpers";

/** The prompt keeps or takes focus wherever typing comes next: a new
chat opens ready to type, and stepping chats from a focused prompt
stays in the prompt. Seeded with the owner's always-hide prompt, the
setting under which a dropped focus also hides the composer. */

async function seedTwoChats(page: Page): Promise<void> {
	await pinMacPlatform(page);
	await page.addInitScript(() => {
		const chat = (id: string, createdAt: number, text: string) => ({
			id,
			createdAt,
			replyLang: null,
			messages: [
				{
					id: `${id}-m0`,
					role: "user",
					content: `${text} question`,
					usage: null,
					error: null
				},
				{
					id: `${id}-m1`,
					role: "assistant",
					content: `${text} answer`,
					usage: null,
					error: null
				}
			]
		});
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1, sidebarCollapsed: true })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([chat("e2e-a", 1, "Alpha"), chat("e2e-b", 2, "Beta")])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
}

const promptFocused = (page: Page): Promise<boolean> =>
	page.evaluate(() => !!document.activeElement?.closest?.(".prompt .ta-input"));

async function expectPromptFocused(page: Page): Promise<void> {
	await expect.poll(() => promptFocused(page)).toBe(true);
	// And it stays: a late park or re-render must not take it back.
	await page.waitForTimeout(400);
	expect(await promptFocused(page)).toBe(true);
	await expect(page.locator(".prompt .ta-input")).toBeVisible();
}

async function focusPrompt(page: Page): Promise<void> {
	await page.keyboard.press("i");
	await expectPromptFocused(page);
}

test("a new chat from the prompt opens focused", async ({ page }) => {
	await seedTwoChats(page);
	await focusPrompt(page);
	await page.keyboard.press("Control+Alt+n");
	await expect(page.locator("article")).toHaveCount(0);
	await expectPromptFocused(page);
});

test("a new chat while reading opens focused", async ({ page }) => {
	await seedTwoChats(page);
	await focusPrompt(page);
	await page.keyboard.press("Escape");
	await expect.poll(() => promptFocused(page)).toBe(false);
	await page.keyboard.press("Meta+Shift+n");
	await expect(page.locator("article")).toHaveCount(0);
	await expectPromptFocused(page);
});

test("a new chat from the chats list opens focused", async ({ page }) => {
	await seedTwoChats(page);
	await toggleSidebar(page);
	await page
		.locator('aside:not(.settings-panel) button[aria-label="New chat"]')
		.click();
	await expect(page.locator("article")).toHaveCount(0);
	await expectPromptFocused(page);
});

/** Settings docks beside the chat and parks the prompt: a new chat
brings you home from it like it does from the chats list. */
test("a new chat with settings open opens focused", async ({ page }) => {
	await seedTwoChats(page);
	await page.keyboard.press("Meta+Comma");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	await page.locator(".settings-panel").focus();
	await page.keyboard.press("Control+Alt+n");
	await expect(page.locator("article")).toHaveCount(0);
	await expectPromptFocused(page);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
});

test("stepping chats from a focused prompt keeps it focused", async ({
	page
}) => {
	await seedTwoChats(page);
	await focusPrompt(page);
	await page.keyboard.press("Meta+Shift+k");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question"
	);
	await expectPromptFocused(page);
	await page.keyboard.press("Meta+Shift+j");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Beta question"
	);
	await expectPromptFocused(page);
});

test("stepping chats while reading stays out of the prompt", async ({
	page
}) => {
	await seedTwoChats(page);
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur()
	);
	await page.keyboard.press("Meta+Shift+k");
	await expect(page.locator("article .rendered").first()).toContainText(
		"Alpha question"
	);
	await page.waitForTimeout(400);
	expect(await promptFocused(page)).toBe(false);
});

/** WebKit leaves focus on the page when a composer button is pressed
(here: a press on the composer, then the editor blurring to
nowhere). The composer stays up while it's in use, and the next
press anywhere else hides it, focusout or not. */
test("a press on the composer keeps it up; a press elsewhere hides it", async ({
	page
}) => {
	await seedTwoChats(page);
	await focusPrompt(page);
	const press = (selector: string) =>
		page.evaluate((selector) => {
			document
				.querySelector(selector)
				?.dispatchEvent(
					new PointerEvent("pointerdown", { bubbles: true, button: 0 })
				);
		}, selector);
	await press(".prompt");
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur()
	);
	await page.waitForTimeout(2_000);
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/);
	await press("article .rendered");
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/);
});

/** Clicking into the prompt and straight onto the text used to leave
it up: the blur landed inside the composer press's grace and was
skipped. The press on the text clears that grace. */
test("clicking from the prompt straight onto the text hides it", async ({
	page
}) => {
	await seedTwoChats(page);
	await focusPrompt(page);
	await page.evaluate(() => {
		const down = () =>
			new PointerEvent("pointerdown", { bubbles: true, button: 0 });
		document.querySelector(".prompt")?.dispatchEvent(down());
		document.querySelector("article .rendered")?.dispatchEvent(down());
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await expect(page.locator(".prompt")).toHaveClass(/prompt-idle/);
});
