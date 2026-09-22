import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

declare global {
	interface Window {
		__cancelCalls: number;
	}
}

/**
 * Deleting the message that's playing stops its audio: the reply
 * must not keep talking over its own grave.
 */
test("deleting the playing message stops its audio", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ voiceEngine: "web" })
		);
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
	await seedChat(page, [
		{
			role: "assistant",
			content: "hello there, this message will be deleted mid-speech"
		}
	]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();
	await expect(
		article.locator('button[aria-label="Stop reading aloud"]')
	).toBeVisible({ timeout: 10_000 });
	// Focus off the button (buttons keep their own keys): the
	// hovered-message hotkeys below need the article focused.
	await article.locator(".rendered").click();
	await article.hover();
	const before = await page.evaluate(() => window.__cancelCalls);
	await page.keyboard.press("Shift+D");
	await expect(article).toHaveCount(0);
	const after = await page.evaluate(() => window.__cancelCalls);
	expect(after).toBeGreaterThan(before);
});
