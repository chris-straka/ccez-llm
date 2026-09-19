import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-click reads aloud on desktop: a live selection first, else the
 * whole message (a playing message stops instead) — and the native menu
 * is never blocked (no preventDefault), so Copy stays available beside
 * speech.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked = [];
		const synth = window.speechSynthesis;
		if (synth) {
			const origSpeak = synth.speak.bind(synth);
			void origSpeak;
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(
					utterance.text
				);
			}) as typeof synth.speak;
		}
		window.addEventListener("contextmenu", (event) => {
			setTimeout(() => {
				(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked.push(
					event.defaultPrevented
				);
			}, 0);
		});
	});
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
});

async function spoken(
	page: import("@playwright/test").Page
): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

test("right-click with a selection reads the selection, menu unblocked", async ({
	page
}) => {
	const para = page.locator("article.assistant .rendered p").first();
	await para.dblclick({ position: { x: 10, y: 10 } });
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected.length).toBeGreaterThan(0);
	// The double-click summons the Annotate menu over the paragraph's
	// top edge; dismiss it (Escape keeps the highlight) so the
	// right-click lands on the selected text, not a menu button.
	await page.keyboard.press("Escape");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	const reselected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(reselected).toBe(selected);
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + 10, box.y + 10, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toContain(selected);
	// The recorder pushes off a nested timeout, so poll for it instead
	// of asserting immediately (cold-compile flakes otherwise).
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked ??
						[]
				),
			{ timeout: 10_000 }
		)
		.toEqual([false]);
});

test("right-click on a word reads just that word", async ({ page }) => {
	const para = page.locator("article.assistant .rendered p").first();
	// Aim at the first word's own pixels ("alpha").
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE)
			throw new Error("no text node");
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 5);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.not.toHaveLength(0);
	const texts = await spoken(page);
	expect(texts.join(" ").replace(/\s+/g, " ").trim()).toBe("alpha");
	// Word speech rides the per-quote path: the article marks
	// speaking-sel, and a second right-click stops it silently.
	await expect(page.locator("article.assistant.speaking-sel")).toBeVisible({
		timeout: 10_000
	});
	const count = (await spoken(page)).length;
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect(page.locator("article.assistant.speaking-sel")).toBeHidden({
		timeout: 10_000
	});
	expect(await spoken(page)).toHaveLength(count);
});

test("right-click on message open space reads the whole message", async ({
	page
}) => {
	const para = page.locator("article.assistant .rendered p").first();
	// The paragraph box is wider than its text: its far-right padding
	// is message space with no word under the cursor.
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, {
		button: "right"
	});
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.not.toHaveLength(0);
	const texts = await spoken(page);
	expect(texts.join(" ").replace(/\s+/g, " ")).toContain(
		"alpha beta gamma delta"
	);
});

test("right-click a playing message stops it instead", async ({ page }) => {
	const para = page.locator("article.assistant .rendered p").first();
	// Open message space starts the whole-message read (word pixels
	// would take the per-quote path instead).
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	const point = { x: box.x + box.width - 4, y: box.y + box.height / 2 };
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect(page.locator("article.assistant.speaking")).toBeVisible({
		timeout: 10_000
	});
	const count = (await spoken(page)).length;
	// Same message, still no selection: stops instead of restarting.
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect(page.locator("article.assistant.speaking")).toBeHidden({
		timeout: 10_000
	});
	expect(await spoken(page)).toHaveLength(count);
});
