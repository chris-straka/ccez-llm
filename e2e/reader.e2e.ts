import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Big-word reader: with the setting on, read-aloud and right-click
 * speak open a full-screen phrase view. Follow mode moves on as each
 * phrase finishes; tap mode waits for a tap. Speech is stubbed (each
 * utterance ends after 100ms) so the pacing is deterministic.
 */
const TEXT =
	"Der Bahnhof ist ganz in der Nähe. Gehen Sie geradeaus bis zur Kreuzung.";

async function stubSpeech(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const w = window as unknown as { __spoken: string[] };
		w.__spoken = [];
		const synth = window.speechSynthesis;
		if (!synth) return;
		let pending: number[] = [];
		const clear = () => {
			for (const id of pending) window.clearTimeout(id);
			pending = [];
		};
		synth.speak = ((u: SpeechSynthesisUtterance) => {
			w.__spoken.push(u.text);
			clear();
			pending.push(
				window.setTimeout(
					() => u.onstart?.(new Event("start") as SpeechSynthesisEvent),
					0
				)
			);
			pending.push(
				window.setTimeout(
					() => u.onend?.(new Event("end") as SpeechSynthesisEvent),
					100
				)
			);
		}) as typeof synth.speak;
		synth.cancel = (() => clear()) as typeof synth.cancel;
	});
}

const spoken = (page: Page) =>
	page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);

test("follow mode reads the whole message phrase by phrase", async ({
	page
}) => {
	await stubSpeech(page);
	await seedChat(page, [{ role: "assistant", content: TEXT }], null, {
		readerMode: "follow",
		voiceEngine: "web"
	});
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();

	const reader = page.getByRole("dialog", { name: "Reader" });
	await expect(reader).toBeVisible();
	await expect(reader.locator(".reader-phrase")).toHaveText("Der Bahnhof ist");
	await page.waitForTimeout(250); // overlay fade-in
	await page.screenshot({ path: ".screenshots/reader-desktop.png" });
	await expect(reader.getByText("Done · tap to close")).toBeVisible({
		timeout: 5000
	});
	expect(await spoken(page)).toEqual([
		"Der Bahnhof ist",
		"ganz in der Nähe.",
		"Gehen Sie",
		"geradeaus bis zur",
		"Kreuzung."
	]);
	await reader.click();
	await expect(reader).toBeHidden();
});

test("tap mode from right-click starts at that sentence and waits", async ({
	page
}) => {
	await stubSpeech(page);
	await seedChat(page, [{ role: "assistant", content: TEXT }], null, {
		readerMode: "tap",
		voiceEngine: "web"
	});
	await page.goto("/");
	const word = page.locator("article.assistant .rendered p");
	await expect(word).toBeVisible({ timeout: 60_000 });
	// Right-click on "Kreuzung" (second sentence).
	const box = await word.evaluate((p) => {
		const text = p.firstChild as Text;
		const range = document.createRange();
		const at = (text.textContent ?? "").indexOf("Kreuzung");
		range.setStart(text, at + 2);
		range.setEnd(text, at + 3);
		const r = range.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
	});
	await page.mouse.click(box.x, box.y, { button: "right" });

	const reader = page.getByRole("dialog", { name: "Reader" });
	await expect(reader.locator(".reader-phrase")).toHaveText("Gehen Sie");
	await page.waitForTimeout(400);
	// Spoken once, then it waits for a tap.
	expect(await spoken(page)).toEqual(["Gehen Sie"]);
	await expect(reader.locator(".reader-phrase")).toHaveText("Gehen Sie");
	await page.keyboard.press("Space");
	await expect(reader.locator(".reader-phrase")).toHaveText(
		"geradeaus bis zur"
	);
	await page.keyboard.press("ArrowLeft");
	await expect(reader.locator(".reader-phrase")).toHaveText("Gehen Sie");
	await page.keyboard.press("Escape");
	await expect(reader).toBeHidden();
});

test.describe("phone", () => {
	test.use({
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});
	test("the phrase fills a phone screen", async ({ page }) => {
		await stubSpeech(page);
		await seedChat(page, [{ role: "assistant", content: TEXT }], null, {
			readerMode: "tap",
			voiceEngine: "web"
		});
		await page.goto("/");
		const article = page.locator("article.assistant");
		await expect(article).toBeVisible({ timeout: 60_000 });
		await article.locator(".rendered").tap();
		await article.locator('button[aria-label="Read this message aloud"]').tap();
		const phrase = page.locator(".reader-phrase");
		await expect(phrase).toHaveText("Der Bahnhof ist");
		const r = await phrase.boundingBox();
		expect(r!.width).toBeLessThanOrEqual(412);
		const size = await phrase.evaluate((el) =>
			parseFloat(getComputedStyle(el).fontSize)
		);
		expect(size).toBeGreaterThan(48);
		await page.waitForTimeout(250); // overlay fade-in
		await page.screenshot({ path: ".screenshots/reader-phone.png" });
	});
});
