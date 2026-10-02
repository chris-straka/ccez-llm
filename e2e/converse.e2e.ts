import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const TRANSCRIPT = "hello can you hear me";
const REPLY = "Yes I hear you well.";

/** Skip where the mic gate hides the toggle (same guard as mic-toggle). */
async function requireRecognition(page: Page): Promise<void> {
	const hasRecognition = await page.evaluate(
		() => !!(window.SpeechRecognition || window.webkitSpeechRecognition)
	);
	test.skip(!hasRecognition, "no speech recognition in this browser");
}

/**
 * Stub speechSynthesis.speak: record the text and end at once (browser
 * TTS has no audio to hear, and the loop's re-listen rides onend).
 */
async function armSpeechStub(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as Record<string, unknown>).__spoken = seen;
		const synth = window.speechSynthesis;
		synth.speak = (u: SpeechSynthesisUtterance) => {
			seen.push(u.text);
			window.setTimeout(() => {
				try {
					u.onstart?.(new Event("start"));
				} catch {
					/* stub only */
				}
				try {
					u.onend?.(new Event("end"));
				} catch {
					/* stub only */
				}
			}, 0);
		};
	});
}

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			((window as unknown as Record<string, unknown>).__spoken as string[]) ??
			[]
	);
}

/**
 * Hang later recognitions forever: after the first (mock-transcript)
 * turn the key is removed, and the re-listen must neither send again
 * nor error — it just waits, deterministically.
 */
async function armHangingRecognition(page: Page): Promise<void> {
	await page.addInitScript(() => {
		class HangingRecognition {
			lang = "";
			interimResults = false;
			onresult: null = null;
			onerror: null = null;
			onend: null = null;
			start(): void {
				/* listens forever */
			}
			stop(): void {
				/* nothing to stop */
			}
		}
		const w = window as unknown as Record<string, unknown>;
		w.SpeechRecognition = HangingRecognition;
		w.webkitSpeechRecognition = HangingRecognition;
	});
}

test("converse runs a hands-free turn and re-listens until Esc", async ({
	page
}) => {
	await seedChat(page, [], null, { voiceEngine: "web" });
	await armSpeechStub(page);
	await armHangingRecognition(page);
	await page.addInitScript(
		(seed: { transcript: string; reply: string }) => {
			localStorage.setItem("ccez-mock-word-ms", "10");
			localStorage.setItem("ccez-mock-reply", seed.reply);
			localStorage.setItem("ccez-mock-transcript", seed.transcript);
		},
		{ transcript: TRANSCRIPT, reply: REPLY }
	);
	await page.goto("/");
	await requireRecognition(page);
	const toggle = page.locator(".prompt-tools .converse-btn");
	await expect(toggle).toBeVisible({ timeout: 60_000 });
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await page
		.locator(".prompt")
		.screenshot({ path: ".screenshots/converse-idle.png" });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	// The utterance sends as the user's message. One turn only: the
	// mock hook consumes the transcript on read, so the re-listen
	// hangs instead of sending again.
	const user = page.locator("article.user .rendered");
	await expect(user).toContainText(TRANSCRIPT, { timeout: 15_000 });
	// The reply streams in and reads back through speech.
	const assistant = page.locator("article.assistant .rendered");
	await expect(assistant).toContainText("Yes I hear you", { timeout: 15_000 });
	await expect
		.poll(() => spoken(page).then((lines) => lines.length), {
			timeout: 15_000
		})
		.toBeGreaterThan(0);
	expect((await spoken(page)).join("")).toContain("Yes I hear you");
	// Readback done: the loop listens again (nothing more sends).
	await expect(toggle).toHaveAttribute("title", "Listening — stop (Esc)", {
		timeout: 15_000
	});
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await page
		.locator(".prompt")
		.screenshot({ path: ".screenshots/converse-live.png" });
	// Esc stops the loop; the transcript stays filed, nothing sends.
	await page.keyboard.press("Escape");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
});

test("Esc stops converse listening with nothing sent", async ({ page }) => {
	await seedChat(page, [], null, { voiceEngine: "web" });
	await armHangingRecognition(page);
	await page.goto("/");
	await requireRecognition(page);
	const toggle = page.locator(".prompt-tools .converse-btn");
	await expect(toggle).toBeVisible({ timeout: 60_000 });
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await page.keyboard.press("Escape");
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await expect(page.locator("article.user")).toHaveCount(0);
	await expect(page.locator("article.assistant")).toHaveCount(0);
});
