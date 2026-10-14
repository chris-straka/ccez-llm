import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/** A reply in flight stays under the owner's control: delete it,
edit its question, or hold the send button to stop it. */

const streams = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __ccezMockStreams?: number }).__ccezMockStreams
	);

/** Seed one exchange, then send a question whose reply thinks for a
while (firstMs) before its first token. */
async function sendThinking(page: Page, firstMs: number): Promise<void> {
	await seedChat(page, [
		{ role: "user", content: "first question" },
		{ role: "assistant", content: "first answer" }
	]);
	await page.addInitScript(
		(ms) => window.localStorage.setItem("ccez-mock-first-ms", String(ms)),
		firstMs
	);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await page.locator(".ta-input").click();
	await page.keyboard.type("second question");
	await page.keyboard.press("Enter");
	// An instant reply may land before the status ever shows.
	if (firstMs > 0) await expect(page.locator(".sending")).toBeVisible();
}

async function blurAll(page: Page): Promise<void> {
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

test("Shift+D on the thinking line deletes the pending reply", async ({
	page
}) => {
	await sendThinking(page, 30_000);
	await blurAll(page);
	await page.locator(".sending .sending-chip").hover();
	await page.keyboard.press("Shift+D");
	await expect(page.locator(".sending")).toHaveCount(0);
	// The question stays; only the reply that never landed went.
	await expect(page.locator("article")).toHaveCount(3);
	await expect(page.locator("article.user").last()).toContainText(
		"second question"
	);
});

test("⌘Z brings deleted messages back where they were", async ({ page }) => {
	await sendThinking(page, 0);
	await expect(page.locator("article.assistant").last()).toContainText(
		"Mock reply to: second question",
		{ timeout: 10_000 }
	);
	await expect(page.locator(".sending")).toHaveCount(0);
	await expect(page.locator("article")).toHaveCount(4);
	await blurAll(page);
	await page.locator("article.user").first().hover();
	await page.keyboard.press("Shift+D");
	await page.locator("article.assistant").first().hover();
	await page.keyboard.press("Shift+D");
	await expect(page.locator("article")).toHaveCount(2);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(page.locator("article")).toHaveCount(3);
	await page.keyboard.press("ControlOrMeta+z");
	await expect(page.locator("article")).toHaveCount(4);
	await expect(page.locator("article .rendered").first()).toContainText(
		"first question"
	);
	await expect(page.locator("article .rendered").nth(1)).toContainText(
		"first answer"
	);
	// Nothing left to restore: the key passes through.
	await page.keyboard.press("ControlOrMeta+z");
	await expect(page.locator("article")).toHaveCount(4);
});

test("editing the question while it thinks asks again", async ({ page }) => {
	await sendThinking(page, 2500);
	const question = page.locator("article.user").last();
	await question.hover();
	await question
		.locator('.actions button[aria-label="Edit this message"]')
		.click();
	await expect(page.locator(".msg-edit")).toHaveCount(1);
	await page.keyboard.press("ControlOrMeta+a");
	await page.keyboard.type("better question");
	await page.keyboard.press("Enter");
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator("article.assistant").last()).toContainText(
		"Mock reply to: better question",
		{ timeout: 15_000 }
	);
	await expect(page.locator("article")).toHaveCount(4);
	expect(await streams(page)).toBe(2);
});

test("holding the send button stops the reply; unsent text stays", async ({
	page
}) => {
	await sendThinking(page, 30_000);
	await page.keyboard.type("not yet sent");
	const box = await page.locator(".send-btn").boundingBox();
	if (!box) throw new Error("no send button");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(800);
	await page.mouse.up();
	await expect(page.locator(".sending")).toHaveCount(0);
	await expect(page.locator(".toast").last()).toContainText("Reply stopped");
	await expect(page.locator(".ta-input")).toHaveValue("not yet sent");
	// The question stays; no empty reply bubble, no error.
	await expect(page.locator("article")).toHaveCount(3);
	await expect(page.locator("main .messages .error")).toHaveCount(0);
});
