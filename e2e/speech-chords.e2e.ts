import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Shift+W/S/P read the word, sentence, paragraph under the mouse
 * point (block-aware: the paragraph stops at the rendered paragraph,
 * never fusing adjacent blocks). Bare letters stay silent.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		const synth = window.speechSynthesis;
		if (synth) {
			let pending: number[] = [];
			const clearPending = () => {
				for (const id of pending) window.clearTimeout(id);
				pending = [];
			};
			const fire = (
				utterance: SpeechSynthesisUtterance,
				name: "start" | "end",
				ms: number
			) => {
				pending.push(
					window.setTimeout(() => {
						if (name === "start")
							utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
						else utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
					}, ms)
				);
			};
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(
					utterance.text
				);
				clearPending();
				fire(utterance, "start", 0);
				fire(utterance, "end", 100);
			}) as typeof synth.speak;
			const origCancel = synth.cancel.bind(synth);
			synth.cancel = (() => {
				clearPending();
				try {
					origCancel();
				} catch {
					// Headless cancel is best-effort; the flags above carry it.
				}
			}) as typeof synth.cancel;
		}
	});
	await seedChat(page, [
		{
			role: "assistant",
			content: "Alpha beta gamma. Delta epsilon zeta.\n\nSecond paragraph here."
		}
	]);
	await page.goto("/");
	await expect(
		page.locator("article.assistant .rendered p").first()
	).toBeVisible({
		timeout: 60_000
	});
});

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

/** Center pixels of a word in the nth rendered paragraph. */
async function wordPoint(
	page: Page,
	word: string,
	paraIndex = 0
): Promise<{ x: number; y: number }> {
	return page.evaluate(
		([w, pi]: [string, number]) => {
			const ps = [
				...document.querySelectorAll("article.assistant .rendered p")
			];
			const p = ps[pi];
			if (!p) throw new Error("no para");
			const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
			let hit: Text | null = null;
			for (let n = walker.nextNode(); n; n = walker.nextNode()) {
				if ((n.textContent ?? "").includes(w)) {
					hit = n as Text;
					break;
				}
			}
			if (!hit) throw new Error("word gone");
			const idx = (hit.textContent ?? "").indexOf(w);
			const range = document.createRange();
			range.setStart(hit, idx);
			range.setEnd(hit, idx + w.length);
			const rect = range.getBoundingClientRect();
			return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
		},
		[word, paraIndex] as [string, number]
	);
}

/** Park the mouse over a word (sets the hover point) with focus
nowhere typing, so the chord hits the message path. */
async function hoverWord(
	page: Page,
	word: string,
	paraIndex = 0
): Promise<void> {
	const pt = await wordPoint(page, word, paraIndex);
	await page.mouse.move(pt.x, pt.y);
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur?.();
	});
}

test("Shift+W reads just the word under the mouse", async ({ page }) => {
	await hoverWord(page, "beta");
	await page.keyboard.press("Shift+W");
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toContain("beta");
});

test("Shift+S reads the sentence under the mouse", async ({ page }) => {
	await hoverWord(page, "beta");
	await page.keyboard.press("Shift+S");
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toContain("Alpha beta gamma.");
});

test("Shift+P reads the rendered paragraph, not the whole message", async ({
	page
}) => {
	await hoverWord(page, "beta");
	await page.keyboard.press("Shift+P");
	// The quote path voices sentence by sentence: the join must equal
	// the rendered paragraph, with nothing from the next block.
	await expect
		.poll(
			async () =>
				(await spoken(page)).join(" ").replace(/\s+/g, " ").trim(),
			{ timeout: 10_000 }
		)
		.toBe("Alpha beta gamma. Delta epsilon zeta.");
});

test("Shift+P over the second paragraph reads that paragraph", async ({
	page
}) => {
	await hoverWord(page, "Second", 1);
	await page.keyboard.press("Shift+P");
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toContain("Second paragraph here.");
});

test("a bare letter reads nothing", async ({ page }) => {
	await hoverWord(page, "beta");
	await page.keyboard.press("w");
	await page.waitForTimeout(500);
	expect(await spoken(page)).toEqual([]);
});
