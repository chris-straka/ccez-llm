import { expect, test, type Page } from "./fixtures";

/**
 * Each chat keeps its own scroll position: across chat switches and
 * across reloads. A chat left mid-thread comes back mid-thread, never
 * at the bottom.
 */

const PHONE = {
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
};

/** Two long chats, seeded once per context (a reload keeps the store). */
async function seedLong(page: Page): Promise<void> {
	await page.addInitScript(() => {
		if (window.localStorage.getItem("ccez-llm-chats-v1")) return;
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
		);
		const para =
			"A paragraph long enough to wrap over several lines in the column, so the thread grows tall and every message takes real room on screen.";
		const thread = (tag: string) =>
			Array.from({ length: 24 }, (_, i) => ({
				id: `${tag}-m${i}`,
				role: i % 2 === 0 ? "user" : "assistant",
				content: `${tag} message ${i}. ${para} ${para}`,
				usage: null,
				error: null
			}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-a", createdAt: 1, replyLang: null, messages: thread("A") },
				{ id: "e2e-b", createdAt: 2, replyLang: null, messages: thread("B") },
				{
					id: "e2e-c",
					createdAt: 3,
					replyLang: null,
					messages: thread("C").slice(0, 2)
				}
			])
		);
	});
}

const scroller = (page: Page) => page.locator("main .messages");

/** Rest the column, then read its scrollTop. */
async function restingTop(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				const el = document.querySelector("main .messages") as HTMLElement;
				let last = el.scrollTop;
				const check = () => {
					if (el.scrollTop === last) resolve(el.scrollTop);
					else {
						last = el.scrollTop;
						setTimeout(check, 300);
					}
				};
				setTimeout(check, 300);
			})
	);
}

async function gap(page: Page): Promise<number> {
	return scroller(page).evaluate(
		(el) => el.scrollHeight - el.clientHeight - el.scrollTop
	);
}

async function pickChat(page: Page, name: string): Promise<void> {
	const aside = page.locator("aside:has(button.side-chat)");
	if (await aside.evaluate((el) => el.classList.contains("collapsed")))
		await page.keyboard.press("Meta+Shift+BracketLeft");
	await expect(aside).not.toHaveClass(/collapsed/);
	await page
		.locator("aside ul li button.side-chat", { hasText: name })
		.first()
		.click();
	await expect(page.locator("article").first()).toContainText(name);
	// Phones fold the drawer on a pick; desktop folds it here too, so
	// the column width (and so the wrap) matches the scroll that filed.
	if (!(await aside.evaluate((el) => el.classList.contains("collapsed"))))
		await page.keyboard.press("Meta+Shift+BracketLeft");
	await expect(aside).toHaveClass(/collapsed/);
}

async function run(page: Page): Promise<void> {
	await seedLong(page);
	await page.goto("/");
	await expect(page.locator("article").first()).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator("article").first()).toContainText("A message 0");
	// Never opened before: A boots at its bottom. Park it mid-thread.
	await restingTop(page);
	expect(await gap(page)).toBeLessThanOrEqual(2);
	await scroller(page).evaluate((el) => {
		el.scrollTo({ top: 1500, behavior: "instant" });
	});
	const parked = await restingTop(page);
	expect(parked).toBeGreaterThan(1000);
	expect(await gap(page)).toBeGreaterThan(500);

	// B: never opened, lands at its bottom (the newest message).
	await pickChat(page, "B message 0");
	await restingTop(page);
	expect(await gap(page)).toBeLessThanOrEqual(2);

	// Back to A: exactly where it was left.
	await pickChat(page, "A message 0");
	expect(Math.abs((await restingTop(page)) - parked)).toBeLessThanOrEqual(2);

	// A reload keeps it too.
	await page.reload();
	await expect(page.locator("article").first()).toContainText("A message 0", {
		timeout: 60_000
	});
	expect(Math.abs((await restingTop(page)) - parked)).toBeLessThanOrEqual(2);

	// B was left at its bottom: it comes back at its bottom.
	await pickChat(page, "B message 0");
	await restingTop(page);
	expect(await gap(page)).toBeLessThanOrEqual(2);
	await pickChat(page, "A message 0");
	expect(Math.abs((await restingTop(page)) - parked)).toBeLessThanOrEqual(2);

	// A short chat left at its bottom must not lend its stuck state
	// to A: a resize after the switch keeps A on its line.
	await pickChat(page, "C message 0");
	await restingTop(page);
	await pickChat(page, "A message 0");
	await restingTop(page);
	const size = page.viewportSize();
	if (!size) throw new Error("no viewport");
	await page.setViewportSize({ width: size.width, height: size.height - 120 });
	await restingTop(page);
	expect(await gap(page)).toBeGreaterThan(500);
	expect(Math.abs((await restingTop(page)) - parked)).toBeLessThanOrEqual(130);
}

test("desktop: a chat keeps its scroll across switches and reloads", async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await run(page);
});

test.describe("phone", () => {
	test.use(PHONE);
	test("phone: a chat keeps its scroll across switches and reloads", async ({
		page
	}) => {
		await run(page);
	});
});
