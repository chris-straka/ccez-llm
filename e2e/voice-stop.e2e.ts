import { expect, test, type Locator, type Page } from "./fixtures";
import { seedChat, toggleSidebar } from "./helpers";

declare global {
	interface Window {
		__cancelCalls: number;
	}
}

/**
 * Every way out of a reading stops the voice: deleting the message,
 * opening the shortcuts sheet over it, the composer's voice button,
 * and leaving for another chat. Headless speech queues nothing, so
 * the proof is a speechSynthesis.cancel call plus the row's stop
 * button going away.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(
		page,
		[
			{
				role: "assistant",
				content: "hello there, this message is being read aloud"
			}
		],
		null,
		{ voiceEngine: "web" }
	);
	await page.addInitScript(() => {
		window.__cancelCalls = 0;
		const synth = window.speechSynthesis;
		if (synth) {
			const origCancel = synth.cancel.bind(synth);
			Object.defineProperty(synth, "cancel", {
				value: () => {
					window.__cancelCalls++;
					try {
						origCancel();
					} catch {
						/* headless has nothing queued */
					}
				},
				configurable: true
			});
		}
	});
	await page.goto("/");
});

/** Start reading the seeded reply; returns its article. */
async function startReading(page: Page): Promise<Locator> {
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();
	await expect(
		article.locator('button[aria-label="Stop reading aloud"]')
	).toBeVisible({ timeout: 10_000 });
	return article;
}

async function cancelCalls(page: Page): Promise<number> {
	return page.evaluate(() => window.__cancelCalls);
}

test("deleting the playing message stops its audio", async ({ page }) => {
	const article = await startReading(page);
	// Focus off the button (buttons keep their own keys): the
	// hovered-message hotkeys below need the article focused.
	await article.locator(".rendered").click();
	await article.hover();
	const before = await cancelCalls(page);
	await page.keyboard.press("Shift+D");
	await expect(article).toHaveCount(0);
	expect(await cancelCalls(page)).toBeGreaterThan(before);
});

test("middle-click shortcuts toggle stops the voice", async ({ page }) => {
	const article = await startReading(page);
	const before = await cancelCalls(page);
	const box = await article.boundingBox();
	await page.mouse.click(box!.x + 4, box!.y + 4, { button: "middle" });
	await expect(page.locator(".shortcuts-filter")).toBeVisible();
	expect(await cancelCalls(page)).toBeGreaterThan(before);
	await expect(
		article.locator('button[aria-label="Stop reading aloud"]')
	).toHaveCount(0);
});

test("composer voice button stops speech mid-reading", async ({ page }) => {
	const article = await startReading(page);
	const before = await cancelCalls(page);
	await page.locator("button.voice-float").click();
	expect(await cancelCalls(page)).toBeGreaterThan(before);
	await expect(page.locator("button.voice-float")).toHaveAttribute(
		"aria-label",
		"Toggle voice readback"
	);
	await expect(
		article.locator('button[aria-label="Stop reading aloud"]')
	).toHaveCount(0);
});

test("switching chats stops the voice", async ({ page }) => {
	await startReading(page);
	const before = await cancelCalls(page);
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.locator('button[aria-label="New chat"]').click();
	await expect(page.locator(".hero")).toBeVisible();
	expect(await cancelCalls(page)).toBeGreaterThan(before);
});
