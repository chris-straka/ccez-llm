import { expect, test } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * A browser whose speech engine fails every utterance (voice-less
 * Linux reports "synthesis-failed") reads as plain copy, never the
 * raw Web Speech code.
 */
test("a failing speech engine reports in plain words", async ({ page }) => {
	await seedChat(
		page,
		[{ role: "assistant", content: "hello there, read me aloud" }],
		null,
		{ voiceEngine: "web" }
	);
	await page.addInitScript(() => {
		const synth = window.speechSynthesis;
		if (!synth) return;
		Object.defineProperty(synth, "getVoices", { value: () => [], configurable: true });
		Object.defineProperty(synth, "speak", {
			value: (u: SpeechSynthesisUtterance) =>
				setTimeout(() =>
					u.dispatchEvent(
						new SpeechSynthesisErrorEvent("error", {
							error: "synthesis-failed",
							utterance: u
						})
					)
				),
			configurable: true
		});
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();
	await expect(page.getByText("No voices on this device")).toBeVisible();
	await expect(page.getByText("synthesis-failed")).toHaveCount(0);
});
