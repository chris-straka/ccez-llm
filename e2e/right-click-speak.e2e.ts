import { expect, test } from "./fixtures";
import { seedChat, settleScroller } from "./helpers";

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
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.toEqual(["paragraph for you:", "汉语是"]);
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
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toEqual(["gamma"]);
	expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
});

test("right-click on CJK repoints a missed highlight onto the clicked word", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "日本語でお答えします" }
	]);
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
	const sel = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(sel).toContain("答");
	expect(texts.join("")).toContain(sel);
});

test("right-click press that extends the highlight repoints the new word", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "声调很难学" }]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	// Pin a live selection on 声调, then press right on 很: a press
	// micro-drag extends the old highlight instead of replacing it
	// (the OS grows the anchor), so extend it the same way here and
	// let the real release fire contextmenu.
	await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const node = p?.firstChild;
		if (!p || !node || node.nodeType !== Node.TEXT_NODE)
			throw new Error("no text to select");
		const range = document.createRange();
		range.setStart(node, 0);
		range.setEnd(node, 2);
		const live = window.getSelection();
		live?.removeAllRanges();
		live?.addRange(range);
	});
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE)
			throw new Error("no text node");
		const range = document.createRange();
		range.setStart(text, 2);
		range.setEnd(text, 3);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	// A press micro-drag grows the old anchor instead of replacing
	// it — headless Chromium never drag-extends on the right button,
	// so grow it the same way synchronously inside the press (after
	// the app's own press snapshot, before the engine default): the
	// release then fires contextmenu off the extended range, exactly
	// like the OS does on a real trackpad.
	await page.evaluate(() => {
		window.addEventListener(
			"mousedown",
			() => {
				const p = document.querySelector("article.assistant .rendered p");
				const node = p?.firstChild;
				if (!p || !node || node.nodeType !== Node.TEXT_NODE)
					throw new Error("no text to extend");
				const range = document.createRange();
				range.setStart(node, 0);
				range.setEnd(node, 3);
				const live = window.getSelection();
				live?.removeAllRanges();
				live?.addRange(range);
			},
			{ once: true, capture: true }
		);
	});
	await page.mouse.click(point.x, point.y, { button: "right" });
	// The press grew the highlight it should have replaced: the
	// point-anchored word wins, never the expanded span.
	const resel = () =>
		page.evaluate(() => window.getSelection()?.toString() ?? "");
	await expect.poll(resel, { timeout: 10_000 }).toContain("很");
	await expect.poll(resel, { timeout: 10_000 }).not.toContain("声调");
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain("很");
});

/** Select `quote` inside the nth rendered message (badge and ruby
text skipped, like the app's own quote text) and return its center. */
async function selectQuote(
	page: import("@playwright/test").Page,
	quote: string,
	nth = 0
): Promise<{ x: number; y: number }> {
	await settleScroller(page);
	const point = await page.evaluate(
		({ quote, nth }) => {
			const body = document.querySelectorAll("article .rendered")[nth];
			if (!body) throw new Error("no rendered message");
			const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const node = walker.currentNode as Text;
				if (node.parentElement?.closest("[data-ann-badge], rt, rp, .frt"))
					continue;
				const i = (node.textContent ?? "").indexOf(quote);
				if (i < 0) continue;
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + quote.length);
				const live = window.getSelection();
				live?.removeAllRanges();
				live?.addRange(range);
				// First line fragment: a wrapped range's union box can
				// center between lines, off the highlight.
				const rect = range.getClientRects()[0];
				if (!rect) return null;
				return {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2
				};
			}
			return null;
		},
		{ quote, nth }
	);
	if (!point) throw new Error(`quote ${quote} not found`);
	return point;
}

const JA_NEWS =
	"トランプ米大統領が11日に発表した「エネルギー停戦」合意は、紛争当事者との綿密なすり合わせを欠いた独断的な宣言であった疑いが深まっている。";

test("right-click a highlight beside an annotation badge reads only the highlight", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: JA_NEWS }]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-ja",
						messageId: "e2e-m0",
						quote: "綿密な",
						comment: ""
					}
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
		timeout: 60_000
	});
	const at = await selectQuote(page, "すり合わせ");
	await page.mouse.click(at.x, at.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 30_000 })
		.not.toHaveLength(0);
	// The badge's number never reaches the voice: the sentence-correct
	// kana covers exactly the highlight.
	expect(await spoken(page)).toEqual(["すりあわせ"]);
	expect(await spokenLang(page)).toEqual(["ja-JP"]);
});

test("right-click the Japanese half of a mixed bullet reads only the highlight", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"- She's changed a lot - 彼女はすごく変わった\n- That book changed my life - その本は私の人生を変えた\n- change your mind - 考えを変える"
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered li").nth(1)).toBeVisible({
		timeout: 60_000
	});
	const at = await selectQuote(page, "その本は私の人生を変えた");
	await page.mouse.click(at.x, at.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 30_000 })
		.not.toHaveLength(0);
	const texts = await spoken(page);
	expect(texts.join("")).not.toMatch(/[A-Za-z]/);
	expect(texts.join("")).toBe("そのほんはわたしのじんせいをかえた");
	expect(await spokenLang(page)).toEqual(["ja-JP"]);
});

const KO_JA_PLURALS = [
	"한국어의 들과 일본어의 たち는 둘 다 복수를 나타냅니다.",
	"",
	"- 한국어에서 들은 접미사이고, 일본어로는 接尾辞라고 합니다.",
	"- 日本語: 〜達は人に付く接尾辞です。",
	"- 例: 子供達、私達"
].join("\n");

test("right-click kanji in the Korean line of a Korean/Japanese answer reads Japanese", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: KO_JA_PLURALS }]);
	await page.goto("/");
	await expect(page.locator("article .rendered li").nth(1)).toBeVisible({
		timeout: 60_000
	});
	// The first 接尾辞 sits in the Korean bullet: hangul around it
	// once picked the Korean voice and pinyin.
	const at = await selectQuote(page, "接尾辞");
	await page.mouse.click(at.x, at.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 30_000 })
		.not.toHaveLength(0);
	expect(await spoken(page)).toEqual(["せつびじ"]);
	expect(await spokenLang(page)).toEqual(["ja-JP"]);
	// Furigana panels, never pinyin.
	await expect(page.locator(".sel-pinyin").first()).toContainText("せつびじ");
});

test("right-click a bare kanji word in the Korean line speaks Japanese", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: KO_JA_PLURALS }]);
	await page.goto("/");
	await expect(page.locator("article .rendered li").nth(1)).toBeVisible({
		timeout: 60_000
	});
	// No highlight: the word under the cursor reads instantly, in the
	// voice its message's Japanese decides, never the Korean one.
	const at = await selectQuote(page, "尾");
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await page.mouse.click(at.x, at.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 30_000 })
		.not.toHaveLength(0);
	expect((await spoken(page)).join("")).toContain("尾");
	expect(await spokenLang(page)).toEqual(["ja-JP"]);
});

test("right-click a wave-dash suffix reads its kana once", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: KO_JA_PLURALS }]);
	await page.goto("/");
	await expect(page.locator("article .rendered li").nth(1)).toBeVisible({
		timeout: 60_000
	});
	const at = await selectQuote(page, "〜達");
	await page.mouse.click(at.x, at.y, { button: "right" });
	await expect
		.poll(() => spoken(page), { timeout: 30_000 })
		.not.toHaveLength(0);
	expect(await spoken(page)).toEqual(["たち"]);
	expect(await spokenLang(page)).toEqual(["ja-JP"]);
});
