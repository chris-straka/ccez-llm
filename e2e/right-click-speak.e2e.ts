import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-click reads aloud on desktop: a live selection first, else the
 * word under the cursor — open message space reads nothing (a
 * playing word restarts instead of stopping) — and the app owns the
 * gesture, so the native menu stays suppressed by design (fields
 * keep theirs).
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		(window as unknown as { __spokenLang: string[] }).__spokenLang = [];
		(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked = [];
		const synth = window.speechSynthesis;
		if (synth) {
			// Faithful utterance lifecycle: the app drives its speaking
			// marks off onstart/onend, so a record-only stub strands
			// every speaking class. Cancel drops pending ends, like the
			// queue-clear it shadows.
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
						if (name === "start") utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
						else utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
					}, ms)
				);
			};
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(
					utterance.text
				);
				(window as unknown as { __spokenLang: string[] }).__spokenLang.push(
					utterance.lang
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

async function spokenLang(
	page: import("@playwright/test").Page
): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spokenLang: string[] }).__spokenLang ?? []
	);
}

test("right-click with a selection reads the selection, app menu owned", async ({
	page
}) => {
	const para = page.locator("article.assistant .rendered p").first();
	await para.dblclick({ position: { x: 10, y: 10 } });
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected.length).toBeGreaterThan(0);
	// The double-click summons the Annotate menu over the paragraph's
	// top edge; Escape drops the menu and (by design, click-away
	// parity) the highlight with it. Re-select programmatically so
	// the right-click lands on selected text with no menu in the way
	// (programmatic ranges summon nothing).
	await page.keyboard.press("Escape");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.evaluate((text) => {
		const p = document.querySelector("article.assistant .rendered p");
		const node = p?.firstChild;
		if (!p || !node || node.nodeType !== Node.TEXT_NODE)
			throw new Error("no text to reselect");
		const idx = (node.textContent ?? "").indexOf(text);
		if (idx < 0) throw new Error("selection text gone");
		const range = document.createRange();
		range.setStart(node, idx);
		range.setEnd(node, idx + text.length);
		const live = window.getSelection();
		live?.removeAllRanges();
		live?.addRange(range);
	}, selected);
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
	// of asserting immediately (cold-compile flakes otherwise). Desktop
	// right-click belongs to the app (speech, folds), so the native
	// menu stays suppressed by design — fields and phones keep theirs.
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
		.toEqual([true]);
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
	// Same word, still no selection: restarts instead of stopping.
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toHaveLength(count + 1);
	await expect(page.locator("article.assistant.speaking-sel")).toBeVisible({
		timeout: 10_000
	});
});

test("right-click on message open space does nothing", async ({ page }) => {
	const para = page.locator("article.assistant .rendered p").first();
	// The paragraph box is wider than its text: its far-right padding
	// is message space with no word under the cursor — not a listen
	// moment, so no read starts (words and selections still read).
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, {
		button: "right"
	});
	await page.waitForTimeout(2000);
	expect(await spoken(page)).toEqual([]);
});

test("right-click mixed message reads each line in its own voice", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "paragraph for you:\n汉语是" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	// Open space reads nothing now, so select the whole message:
	// the selection path reads each line in its own voice.
	await page.evaluate(() => {
		const el = document.querySelector("article.assistant .rendered");
		if (!el) throw new Error("no rendered message");
		const range = document.createRange();
		range.selectNodeContents(el);
		const live = window.getSelection();
		live?.removeAllRanges();
		live?.addRange(range);
	});
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
		button: "right"
	});
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toEqual([
		"paragraph for you:",
		"汉语是"
	]);
	// The Han line keeps its Chinese voice under the English seed —
	// never the message fallback.
	const langs = await spokenLang(page);
	expect(langs).toHaveLength(2);
	expect(langs[0]?.startsWith("en")).toBe(true);
	expect(langs[1]).toBe("zh-CN");
});

test("right-click an isolated CJK word reads just that word", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "我没有书" }]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	// Aim at 没 inside the unspaced run: segmentation must yield
	// 没有, not the whole clause (the old maximal-run expansion
	// read everything, so the word itself was unreachable).
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE)
			throw new Error("no text node");
		const range = document.createRange();
		range.setStart(text, 1);
		range.setEnd(text, 2);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.not.toHaveLength(0);
	expect(await spoken(page)).toEqual(["没有"]);
});

test("right-click a playing word restarts it", async ({ page }) => {
	const para = page.locator("article.assistant .rendered p").first();
	// A word click starts the per-quote read (open message space
	// reads nothing now).
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
	await expect(page.locator("article.assistant.speaking-sel")).toBeVisible({
		timeout: 10_000
	});
	const count = (await spoken(page)).length;
	// Same word, still no selection: a second right-click restarts
	// the read instead of stopping it.
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toHaveLength(count + 1);
	await expect(page.locator("article.assistant.speaking-sel")).toBeVisible({
		timeout: 10_000
	});
});

test("right-click outside a live selection reads the word under the cursor", async ({
	page
}) => {
	const para = page.locator("article.assistant .rendered p").first();
	// Seed text is "alpha beta gamma delta": pin a live selection on
	// "alpha" (the engine's right-mousedown neighbor pick on WebKit),
	// then right-click squarely on "gamma".
	await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const node = p?.firstChild;
		if (!p || !node || node.nodeType !== Node.TEXT_NODE)
			throw new Error("no text to select");
		const range = document.createRange();
		range.setStart(node, 0);
		range.setEnd(node, 5);
		const live = window.getSelection();
		live?.removeAllRanges();
		live?.addRange(range);
	});
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
		"alpha"
	);
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE)
			throw new Error("no text node");
		const words = (text.textContent ?? "").split(" ");
		const start = words[0]!.length + 1 + words[1]!.length + 1;
		const range = document.createRange();
		range.setStart(text, start);
		range.setEnd(text, start + words[2]!.length);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	await page.mouse.click(point.x, point.y, { button: "right" });
	// The click missed the highlight, so the word wins — and the stale
	// wash drops so the highlight never contradicts the audio.
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toEqual(["gamma"]);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
		""
	);
});

test("right-click on CJK repoints a missed highlight onto the clicked word", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "日本語でお答えします" }]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	// Pin a live selection on 日本語, then right-click squarely on 答.
	await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const node = p?.firstChild;
		if (!p || !node || node.nodeType !== Node.TEXT_NODE)
			throw new Error("no text to select");
		const range = document.createRange();
		range.setStart(node, 0);
		range.setEnd(node, 3);
		const live = window.getSelection();
		live?.removeAllRanges();
		live?.addRange(range);
	});
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE)
			throw new Error("no text node");
		const idx = (text.textContent ?? "").indexOf("答");
		if (idx < 0) throw new Error("no 答 to click");
		const range = document.createRange();
		range.setStart(text, idx);
		range.setEnd(text, idx + 1);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	await page.mouse.click(point.x, point.y, { button: "right" });
	// The audio reads the clicked word, and the wash repoints onto
	// that same word — highlight and audio never disagree.
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.not.toHaveLength(0);
	const texts = await spoken(page);
	const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(sel).toContain("答");
	expect(texts.join("")).toContain(sel);
});
