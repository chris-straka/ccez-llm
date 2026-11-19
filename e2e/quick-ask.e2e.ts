import { test, expect } from "./fixtures";
import {
	quickAskKept,
	pushQuickAsk,
	seedQuickAskShell
} from "./quick-ask-mock";

/**
 * The Mac's quick Ask window (`/quick-ask`, ⌥Space), headless with a stand-in
 * shell: empty it is just the field; a question goes to the main window
 * with the whole thread; the answer streams in, sources once per site;
 * the window asks to be as tall as what it shows; follow-ups, retry and
 * the keys (Esc, ⌘↵) do what the footer says.
 */
test.use({ viewport: { width: 420, height: 600 } });

test.beforeEach(async ({ page }) => {
	await seedQuickAskShell(page);
	await page.goto("/quick-ask");
	await expect(page.locator(".field")).toBeVisible();
});

type Page = import("@playwright/test").Page;

async function ask(page: Page, q: string) {
	await page.locator(".field").fill(q);
	await page.locator(".field").press("Enter");
}

/** The nth event the page sent, once it has (sending is async). */
async function sent(page: Page, n: number) {
	await expect
		.poll(async () => (await quickAskKept(page)).emitted.length)
		.toBeGreaterThan(n);
	return (await quickAskKept(page)).emitted[n]!;
}

test("empty, the window is just the field", async ({ page }) => {
	const box = await page.locator(".quick-ask").boundingBox();
	expect(box!.height).toBeLessThan(80);
	await expect(page.locator(".thread")).toHaveCount(0);
	await expect(page.locator("footer")).toHaveCount(0);
	await expect
		.poll(async () => (await quickAskKept(page)).sizes.at(-1))
		.toEqual({ width: 420, height: Math.ceil(box!.height) });
});

test("a question goes to the main window; the answer streams in with its sources", async ({
	page
}) => {
	await ask(page, "Quelle est la capitale du Canada ?");
	const first = await sent(page, 0);
	expect(first.event).toBe("quick-ask");
	const payload = first.payload as {
		id: number;
		chat: string;
		messages: unknown[];
	};
	expect(payload.messages).toEqual([
		{ role: "user", content: "Quelle est la capitale du Canada ?" }
	]);
	await expect(page.locator(".progress.on")).toHaveCount(1);
	await pushQuickAsk(page, "quick-ask-delta", {
		id: payload.id,
		text: "La capitale"
	});
	await pushQuickAsk(page, "quick-ask-delta", {
		id: payload.id,
		text: " est Ottawa."
	});
	await expect(page.locator(".a")).toHaveText("La capitale est Ottawa.");
	await pushQuickAsk(page, "quick-ask-done", {
		id: payload.id,
		text: "La capitale du Canada est Ottawa.",
		cited: [
			"https://ottawa.ca/fr",
			"https://www.ottawa.ca/en",
			"https://fr.wikipedia.org/wiki/Ottawa"
		]
	});
	await expect(page.locator(".progress.on")).toHaveCount(0);
	await expect(page.locator(".sources .chip")).toHaveText([
		"ottawa.ca",
		"fr.wikipedia.org"
	]);
	await page.locator(".sources .chip").first().click();
	await expect
		.poll(async () => (await quickAskKept(page)).opened)
		.toEqual(["https://ottawa.ca/fr"]);
	// The window grew with the thread.
	const h = (await page.locator(".quick-ask").boundingBox())!.height;
	await expect
		.poll(async () => (await quickAskKept(page)).sizes.at(-1)?.height)
		.toBe(Math.ceil(h));
	expect(h).toBeGreaterThan(120);
});

test("a follow-up carries the thread; a failure offers Retry", async ({
	page
}) => {
	await ask(page, "Wie spät ist es in Tokio?");
	const first = (await sent(page, 0)).payload as { id: number };
	await pushQuickAsk(page, "quick-ask-done", {
		id: first.id,
		text: "Es ist 3 Uhr nachts.",
		cited: []
	});
	await ask(page, "Und in Berlin?");
	const second = (await sent(page, 1)).payload as {
		id: number;
		messages: unknown[];
	};
	expect(second.messages).toEqual([
		{ role: "user", content: "Wie spät ist es in Tokio?" },
		{ role: "assistant", content: "Es ist 3 Uhr nachts." },
		{ role: "user", content: "Und in Berlin?" }
	]);
	await pushQuickAsk(page, "quick-ask-failed", {
		id: second.id,
		text: "DeepSeek is busy: try again in a moment."
	});
	await expect(page.locator(".failed")).toContainText("DeepSeek is busy");
	await page.locator(".failed .chip").click();
	const again = (await sent(page, 2)).payload as {
		messages: unknown[];
	};
	expect(again.messages.at(-1)).toEqual({
		role: "user",
		content: "Und in Berlin?"
	});
});

test("Esc hides; ⌘↵ opens the thread in Ccez LLM and starts over", async ({
	page
}) => {
	await ask(page, "東京の天気は？");
	const p = (await sent(page, 0)).payload as {
		id: number;
		chat: string;
	};
	await pushQuickAsk(page, "quick-ask-done", {
		id: p.id,
		text: "晴れです。",
		cited: []
	});
	await page.locator(".field").press("Escape");
	await expect.poll(async () => (await quickAskKept(page)).hidden).toBe(1);
	await page.locator(".field").press("Meta+Enter");
	const open = await sent(page, 1);
	expect(open).toMatchObject({
		event: "quick-ask-open",
		payload: { chat: p.chat }
	});
	await expect(page.locator(".thread")).toHaveCount(0);
});
