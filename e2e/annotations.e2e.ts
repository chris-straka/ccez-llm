import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { dragQuote, quoteRect, seedChat } from "./helpers";

const SENTENCE = "テストを確認しました。何かお手伝いできることはありますか？";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

async function clickText(page: Page, count: 1 | 2 | 3 | 4): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	if (count === 1) await page.mouse.click(box.x + 20, box.y + box.height / 2);
	else if (count === 2)
		await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	else
		await page.mouse.click(box.x + 20, box.y + box.height / 2, {
			clickCount: count
		});
}

/** Spaceless scripts have no words to pick: double-click keeps the
native fragment (and still summons the menu). */
test("double-click in Japanese keeps the word pick", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe("テスト");
});

/** Triple-click keeps native behavior: the whole paragraph is picked. */
test("triple-click in Japanese selects the paragraph", async ({ page }) => {
	await clickText(page, 3);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe(
		"テストを確認しました。何かお手伝いできることはありますか？"
	);
});

/** The paragraph pick holds wherever in it the triple-click lands. */
test("triple-click on the second sentence selects the paragraph", async ({
	page
}) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, {
		clickCount: 3
	});
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe(
		"テストを確認しました。何かお手伝いできることはありますか？"
	);
});

/** The basic flow: drag-select, slide to the menu, click Annotate,
file the pill. The menu and the highlight must survive the slide. */
test("drag, slide to Annotate, and file the pill", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 30, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 160, y, { steps: 8 });
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible({ timeout: 5_000 });
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).not.toBe("");
	const btn = menu.locator('button:has-text("Annotate")');
	const btnBox = await btn.boundingBox();
	if (!btnBox) throw new Error("annotate button has no box");
	await page.mouse.move(
		btnBox.x + btnBox.width / 2,
		btnBox.y + btnBox.height / 2,
		{ steps: 6 }
	);
	const mid = await page.evaluate(() => ({
		menu: !!document.querySelector(".sel-menu"),
		sel: window.getSelection()?.toString() ?? ""
	}));
	expect(mid.menu).toBe(true);
	expect(mid.sel).toBe(selected);
	await btn.click();
	await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
});

/** Plain clicks on blank space drop a stale highlight, never re-summon. */
test("clicking blank space deselects instead of reopening the menu", async ({
	page
}) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	// Past the 6s idle window with no pointer activity: expired.
	await page.waitForTimeout(7000);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(10, 300);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Right-click keeps the highlight without starting audio: the text and
its highlight stay put (the menu itself may dismiss). */
test("right-click keeps the highlighted text", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 150, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.mouse.click(box.x + 60, y, { button: "right" });
	await page.waitForTimeout(400);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).not.toBe("");
});

/** Clicking inside a live highlight clears the highlight AND the menu —
neither strands the other. */
test("clicking inside the highlight clears it with the menu", async ({
	page
}) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 150, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.mouse.click(box.x + 60, y);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Clicking a stale highlight (menu already faded) clears it without
re-summoning the menu. */
test("clicking a stale highlight never brings the menu back", async ({
	page
}) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 170, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 300, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.waitForTimeout(2700);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(box.x + 200, y);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Four clicks: the paragraph pick comes off again and the menu goes
with it instead of stranding. */
test("fourth click clears the paragraph pick and the menu", async ({
	page
}) => {
	await clickText(page, 4);
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Repeats anchor where selected: annotating the second "a" in
"a a" stamps the badge on the second "a", not the first. A
single-character word keeps the range on word edges, so the
create marker's word-snap (which intentionally expands mid-word
cuts like the last "c" of "ccc" to the whole word) leaves it
alone and the repeat disambiguation is what gets exercised. */
test("annotating a repeated character anchors the selected repeat", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "a a" }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	// Real press to normalize the click guard, then a real range over
	// the second "a" before the matching mouseup summons the menu.
	await page.mouse.click(box.x + 10, y);
	await page.mouse.move(box.x + box.width - 2, y);
	await page.mouse.down();
	await page.evaluate(() => {
		const text = document.querySelector("article .rendered p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("no message text");
		window.getSelection()?.setBaseAndExtent(text, 2, text, 3);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const offset = await page.evaluate(() => {
		const badge = document.querySelector("article .rendered [data-ann-badge]");
		const anchor = badge?.parentElement;
		const host = anchor?.closest("p") ?? undefined;
		if (!anchor || !host) return -1;
		let n = 0;
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (anchor.contains(node)) return n;
			n += node.textContent?.length ?? 0;
		}
		return -1;
	});
	// Gap parking (unit-pinned): a lone word parks AFTER itself, so the
	// second "a" anchors at 3 — still the selected repeat (the first
	// would anchor at 1), never on the letter.
	expect(offset).toBe(3);
});

/** The prompt's review card grows up and to the left of its pill —
never right over the send button's airspace — and opens covering the
pill, so the cursor is already inside it. */
test("prompt review card opens up and to the left", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	const card = page.locator(".ann-wrap .review");
	await expect(card).toBeVisible();
	const boxes = await page.evaluate(() => {
		const rect = (sel: string) =>
			document.querySelector(sel)?.getBoundingClientRect();
		const r = rect(".ann-wrap .review");
		const w = rect(".ann-wrap");
		const p = rect(".prompt-tools .ann-pill");
		if (!r || !w || !p) return null;
		return {
			cardRight: r.right,
			cardTop: r.y,
			wrapRight: w.right,
			wrapTop: w.top,
			pillCX: p.x + p.width / 2,
			pillCY: p.y + p.height / 2,
			card: { x: r.x, y: r.y, w: r.width, h: r.height }
		};
	});
	if (!boxes) throw new Error("review card missing boxes");
	// Grows upward from the pill, right-aligned with it.
	expect(boxes.cardTop).toBeLessThan(boxes.wrapTop);
	expect(Math.abs(boxes.cardRight - boxes.wrapRight)).toBeLessThanOrEqual(2);
	// The pill stays exposed below the open card (the card must never
	// cover its own toggle, or click-to-close has no target): the gap
	// is the 0.5rem offset, horizontally the pill sits under the card.
	expect(boxes.pillCX).toBeGreaterThanOrEqual(boxes.card.x);
	expect(boxes.pillCX).toBeLessThanOrEqual(boxes.card.x + boxes.card.w);
	const gap = boxes.wrapTop - (boxes.card.y + boxes.card.h);
	expect(gap).toBeGreaterThan(0);
	expect(gap).toBeLessThanOrEqual(24);
});

/** The sent message's refs card opens covering its number pill. */
test("message refs card opens over its number", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
	await page.locator(".ta-input").click();
	await page.keyboard.type("go");
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	const pill = page.locator("article.user .ann-refs-pill");
	await expect(pill).toHaveText("1");
	await pill.click();
	const card = page.locator("article.user .ann-refs-pop");
	await expect(card).toHaveCSS("opacity", "1");
	const inside = await page.evaluate(() => {
		const rect = (sel: string) =>
			document.querySelector(sel)?.getBoundingClientRect();
		const c = rect("article.user .ann-refs-pop");
		const p = rect("article.user .ann-refs-pill");
		if (!c || !p) return null;
		const cx = p.x + p.width / 2;
		const cy = p.y + p.height / 2;
		return (
			cx >= c.x && cx <= c.x + c.width && cy >= c.y && cy <= c.y + c.height
		);
	});
	expect(inside).toBe(true);
});

/** Hover the prompt pill via coordinates: the open card covers the
pill by design, so locator.hover() can't hit-target it afterwards. */
async function openPromptReview(page: Page): Promise<void> {
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toBeVisible();
	await pill.click();
	await expect(page.locator(".prompt-tools .review")).toHaveCSS("opacity", "1");
}

/** Select a quote and open its comment box through the real UI. */
async function openAnnotate(page: Page, quote: string): Promise<void> {
	await page
		.locator(`article .rendered:has-text("${quote}")`)
		.first()
		.selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
}

/** Clicking off an empty draft cancels: no ghost annotation is filed. */
test("clicking off an empty draft cancels the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.mouse.click(10, 300);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Escape cancels the fresh pill: no badge, no pill. */
test("escape cancels the fresh annotation pill", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(0);
	// Cancel must not strand a wash: the fade ramp settles (hysteresis
	// plus ramp), then no graded name may hold ranges and no DOM marks
	// may remain — an orphaned dim/faint twin reads as a stuck wash
	// and blinks on the next paint.
	await page.waitForTimeout(600);
	const leftover = await page.evaluate(() => {
		const reg = (
			window as unknown as {
				CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
			}
		).CSS?.highlights;
		const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
		return {
			ranges: names.flatMap((n) => [...(reg?.get(n) ?? [])]).length,
			marks: document.querySelectorAll("mark.ccez-ann").length
		};
	});
	expect(leftover.ranges).toBe(0);
	expect(leftover.marks).toBe(0);
});

/** Escape cancels an Arabic draft with no stranded highlight or wash:
RTL washes stamp DOM marks (the registry overpaints Arabic), so an
unwashed mark here reads as a highlight that never went away. */
test("escape cancels an arabic draft cleanly", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "اللغة العربية جميلة والأفكار عميقة" }
	]);
	await page.goto("/");
	await expect(
		page.locator("article .rendered").first()
	).toBeVisible({ timeout: 60_000 });
	await openAnnotate(page, "والأفكار");
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(0);
	await page.waitForTimeout(600);
	const leftover = await page.evaluate(() => {
		const reg = (
			window as unknown as {
				CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
			}
		).CSS?.highlights;
		const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
		return {
			ranges: names.flatMap((n) => [...(reg?.get(n) ?? [])]).length,
			marks: document.querySelectorAll("mark.ccez-ann").length
		};
	});
	expect(leftover.ranges).toBe(0);
	expect(leftover.marks).toBe(0);
});

const AR_PARAGRAPH =
	"Here is an arabic paragraph for you:\n\nاللغة العربية من أجمل لغات العالم وأغناها، فهي لغة القرآن الكريم ولغة الشعر والأدب والحكمة. تتميز بثراء مفرداتها وجمال أسلوبها وقدرتها على التعبير عن أدق المشاعر والأفكار. من تعلمها أدرك سحر بيانها، ومن قرأ أدبها اكتشف كنوزًا من المعرفة والثقافة تمتد عبر قرون طويلة.";

/** Hovering an answered Arabic badge moves nothing: no duplicated
words, no reflow — hovering والأفكار once pulled أدرك up a line
and shoved the quote sideways. */
test("hovering an answered arabic badge moves no text", async ({ page }) => {
	test.setTimeout(120_000);
	await seedChat(page, [{ role: "assistant", content: AR_PARAGRAPH }]);
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-chat-ms", "2500");
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...prev, fontScale: 3.7 })
		);
	});
	await page.goto("/");
	await expect(
		page.locator("article .rendered").first()
	).toBeVisible({ timeout: 60_000 });
	// A second annotation on the message, left waiting (blue): the
	// shift showed with two badges up, mid-restyle.
	await dragQuote(page, 0, "العربية");
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await dragQuote(page, 0, "والأفكار");
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.locator(".ann-pop textarea").fill("what does this mean?");
	await page.keyboard.press("Enter");
	const readies = page.locator("button.ccez-ann-badge.ans-ready");
	await expect(readies).toHaveCount(2, { timeout: 20_000 });
	const ready = readies.nth(1);
	const snap = (): Promise<{
		base: string;
		adrak: number;
		anchors: number;
		marks: number;
		lines: number;
		anchorRect: { x: number; y: number; width: number; height: number } | null;
		sameBadge: boolean;
	}> =>
		page.evaluate(() => {
			const w = window as unknown as { __b?: Element | null };
			const root = document.querySelector("article .rendered");
			const walker = document.createTreeWalker(root ?? document.body, NodeFilter.SHOW_TEXT);
			const parts: string[] = [];
			let node: Node | null;
			while ((node = walker.nextNode())) {
				const parent = node.parentElement;
				if (parent?.closest("[data-ann-badge], rt, rp, .frt, .frb, button"))
					continue;
				parts.push(node.textContent ?? "");
			}
			const base = parts.join("");
			const anchor = document.querySelector("article .rendered span.ccez-ann-anchor");
			const rect = anchor?.getBoundingClientRect();
			const badge = document.querySelector("button.ccez-ann-badge");
			const sameBadge = w.__b === undefined ? true : w.__b === badge;
			w.__b = badge;
			const para = [...(root?.querySelectorAll("p") ?? [])].find((p) =>
				(p.textContent ?? "").includes("والأفكار")
			);
			return {
				base,
				adrak: base.split("أدرك").length - 1,
				anchors: document.querySelectorAll("article .rendered span.ccez-ann-anchor").length,
				marks: document.querySelectorAll("article .rendered mark.ccez-ann").length,
				lines: para?.getClientRects().length ?? -1,
				anchorRect: rect
					? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
					: null,
				sameBadge
			};
		});
	const hoverReady = async (): Promise<void> => {
		const box = await ready.boundingBox();
		if (!box) throw new Error("badge has no box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(600);
	};
	// Park the pointer off-message so the before shot is wash-free.
	await page.mouse.move(4, 4);
	await page.waitForTimeout(600);
	const before = await snap();
	// Cycle the hover: off, on, off, on — a reflow that accumulates
	// (or only shows after a leaving fade) must fail here, not just
	// on the first paint.
	await hoverReady();
	const once = await snap();
	await page.mouse.move(4, 4);
	await page.waitForTimeout(600);
	await hoverReady();
	const after = await snap();
	// The wash legitimately appears; the text must not change.
	expect(after.marks).toBeGreaterThan(0);
	expect(after.base).toBe(before.base);
	expect(after.adrak).toBe(1);
	expect(after.anchors).toBe(2);
	expect(after.sameBadge).toBe(true);
	expect(after.lines).toBe(before.lines);
	expect(once.lines).toBe(before.lines);
	if (!before.anchorRect || !after.anchorRect)
		throw new Error("anchor lost its box on hover");
	for (const key of ["x", "y", "width", "height"] as const) {
		expect(
			Math.abs(after.anchorRect[key] - before.anchorRect[key]),
			`anchor ${key} moved on hover`
		).toBeLessThanOrEqual(1);
	}
});

/** Escape closes the badge edit box without writing. */
test("escape closes the badge edit without saving", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	// Slow the mock answer: the badge clicks below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.locator(".ann-pop textarea").fill("go");
	// File without sending: a send bakes annotations into the outgoing
	// message and clears the live list (withAnnotations), so no badge
	// survives it.
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.type("scratch");
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	// The saved comment is untouched: reopening shows "go", not "goscratch".
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop textarea")).toHaveValue("go");
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	// Click off the badge (the click that opened it left the mouse
	// hovering it, which legitimately keeps the hover wash): closing
	// the edit and leaving must unwash.
	await page.mouse.move(4, 4);
	await page.waitForTimeout(600);
	const leftover = await page.evaluate(() => {
		const reg = (
			window as unknown as {
				CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
			}
		).CSS?.highlights;
		const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
		return names.flatMap((n) => [...(reg?.get(n) ?? [])]).length;
	});
	expect(leftover).toBe(0);
});

/** Enter with no text files the (empty) annotation for submit. */
test("enter with an empty draft files the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
});

/** Flooding the comment box never spills past it: unbroken text wraps. */
test("flooding the comment box stays inside it", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	const box = page.locator(".ann-pop textarea");
	await box.fill("a".repeat(500));
	const sizes = await box.evaluate((el) => ({
		scroll: el.scrollWidth,
		client: el.clientWidth
	}));
	expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
});

/** A grown create-box rounds its corners less: the fresh pill starts
as a 999px capsule, which reads over-rounded once it grows tall. */
test("grown comment box rounds its corners less", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	const pop = page.locator(".ann-pop");
	await expect(pop).not.toHaveClass(/tall/);
	await expect(pop).toHaveCSS("border-radius", "999px");
	// Three lines already drops the capsule (not five).
	await page.locator(".ann-pop textarea").fill("one\ntwo\nthree");
	await expect(pop).toHaveClass(/tall/);
	await expect(pop).toHaveCSS("border-radius", "12px");
	await page.locator(".ann-pop textarea").fill("a".repeat(500));
	await expect(pop).toHaveClass(/tall/);
	await expect(pop).toHaveCSS("border-radius", "12px");
});

/** Draft annotations survive a restart: reload restores badge and pill. */
test("draft annotations survive a reload", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.locator(".ann-pop textarea").fill("go");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await page.reload();
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
});

/** Re-pressing the open badge closes its edit menu like cancel. */
test("badge re-press closes the edit menu", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	// File without sending: a send bakes annotations into the outgoing
	// message and clears the live list (withAnnotations), so no badge
	// survives it.
	// Slow the mock answer: the badge clicks below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});

/** Saving the badge edit writes the new comment back to the annotation. */
test("badge save files the edited comment", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	// Slow the mock answer: the badge clicks below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const openMenu = async (): Promise<void> => {
		const box = await badge.boundingBox();
		if (!box) throw new Error("badge has no box");
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(page.locator(".ann-pop")).toBeVisible();
	};
	await openMenu();
	await page.locator(".ann-pop textarea").fill("edited note");
	await page.locator(".ann-pop .ann-save").click();
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await openMenu();
	await expect(page.locator(".ann-pop textarea")).toHaveValue("edited note");
});

/** Keyboard Enter on a focused badge opens the edit (click dedup uninvolved). */
test("keyboard enter opens the badge edit", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.locator(".ann-pop textarea").fill("typed");
	// Slow the mock answer: the badge Enter below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-pop")).toBeVisible();
	await expect(page.locator(".ann-pop textarea")).toHaveValue("typed");
});

/** Escape drops the badge edit without touching the saved comment
(no Cancel button: click-off and Esc close the card). */
test("badge cancel drops the edit", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.locator(".ann-pop textarea").fill("kept");
	// Slow the mock answer: the badge clicks below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.locator(".ann-pop textarea").fill("scratch");
	await expect(page.locator(".ann-pop .ann-cancel")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	const reopened = await badge.boundingBox();
	if (!reopened) throw new Error("badge has no box");
	await page.mouse.click(
		reopened.x + reopened.width / 2,
		reopened.y + reopened.height / 2
	);
	await expect(page.locator(".ann-pop textarea")).toHaveValue("kept");
});

/** The review popup shows quotes with hyphen labels (never "note:"),
no Selected text. The note itself reads italic in the quiet voice,
like the cancel and icon buttons. */
test("review popup uses hyphen labels", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	// File without sending: a send bakes annotations into the outgoing
	// message and clears the live list, leaving no pill to hover.
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	const review = page.locator(".prompt-tools .review");
	await expect(review.locator(".review-label").first()).toHaveText("-");
	await expect(review).not.toContainText("note:");
	await expect(review).not.toContainText("Selected text");
	await expect(review).not.toContainText("User comment");
	const comment = review.locator(".review-comment").first();
	await expect(comment).toHaveText("meaning?");
	await expect(comment).toHaveCSS("font-style", "italic");
	await expect(comment).toHaveCSS("color", "rgb(110, 110, 115)");
});

/** An annotations-only message renders unfolded (em-dash plus the count)
and folds to its quotes previewed on demand. */
test("annotations-only message renders folded", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content:
				'Annotated selections:\n1. "風に舞う" — What does this mean?\n2. "夕暮れの公園で" — What does this mean?'
		}
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".ann-refs-pill")).toBeVisible();
	// Folding previews the quotes; unfolding restores the em-dash body
	// with the pill above — the baked block never shows.
	await article
		.locator('.actions button[aria-label="Fold this message"]')
		.click();
	const preview = article.locator(".folded-preview");
	await expect(preview).toContainText("風に舞う");
	await article
		.locator('.actions button[aria-label="Unfold this message"]')
		.click();
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".rendered")).not.toContainText(
		"Annotated selections:"
	);
	await expect(article.locator(".ann-refs-pill")).toBeVisible();
});

/** No message row offers an audio download anymore. */
test("message rows have no download button", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi there" }
	]);
	await page.reload();
	for (const role of ["user", "assistant"] as const) {
		await page.locator(`article.${role} .rendered`).first().hover();
		await expect(
			page.locator(
				`article.${role} .actions [aria-label="Download audio for this message"]`
			)
		).toHaveCount(0);
	}
});

/** Sending files the pending annotations with the message: the composer
pill is gone while the reply is still on its way. */
test("sending clears pending annotations immediately", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
	await page.locator(".ta-input").click();
	await page.keyboard.type("go");
	// The Enter that filed the annotation must not double as a send.
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	// The pill leaves with the send, not with the reply.
	await expect(page.locator("article.user .rendered")).toContainText("go");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await expect(
		page.locator("article.assistant .rendered").last()
	).toContainText("Mock reply");
	// The sent message carries the block (folded with its count).
	await expect(page.locator("article.user .ann-refs-pill")).toHaveText("1");
});

/** The pencil edits an own message, then resends it: the message
rewrites and the stale reply is replaced by a fresh one. */
test("pencil edit saves without resending", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "helo world" },
		{ role: "assistant", content: "hi" }
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await article
		.locator('.actions button[aria-label="Edit this message"]')
		.click();
	// Nothing is deleted; the text opens in an in-place editor where the
	// message sat (the composer keeps its own empty draft).
	const inline = page.locator(".msg-edit .ta-input");
	await expect(inline).toHaveValue(/helo world/);
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator(".prompt .ta-input")).not.toHaveValue(/helo world/);
	// Fix the typo and save: the message rewrites in place, nothing
	// resends — the old reply stands untouched.
	await inline.click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText(
		"hello world"
	);
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator("article.assistant .rendered")).toContainText("hi");
	await expect(page.locator(".sending")).toHaveCount(0);
});

/** The in-place edit keeps the raw text: fenced code edits plain (the
composer is a textarea now — highlighting lives in history only). */
test("in-place edit keeps the raw fence text", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "```python\nprint('hi')\n```" }
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await article
		.locator('.actions button[aria-label="Edit this message"]')
		.click();
	const inline = page.locator(".msg-edit .ta-input");
	await expect(inline).toHaveValue("```python\nprint('hi')\n```");
	// Cancel keeps history untouched.
	await page.keyboard.press("Escape");
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator("article.user .rendered")).toContainText("print");
});

/** Hovering an own message and hitting E starts editing it. */
test("E key edits the hovered own message", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "helo world" }]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	// Click first: focus starts in the prompt, which owns keystrokes.
	await article.locator(".rendered").click();
	await article.hover();
	await page.keyboard.press("e");
	await expect(page.locator(".msg-edit .ta-input")).toHaveValue("helo world");
	// Esc cancels: history untouched, the inline editor unmounts, the
	// composer stays empty.
	await page.keyboard.press("Escape");
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input")).not.toHaveValue(/helo world/);
	await expect(page.locator("article.user .rendered")).toContainText(
		"helo world"
	);
});

/** Clear-all sits at the bottom-right of the review overlay. */
test("clear-all lives at the top right of the review", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	const review = page.locator(".prompt-tools .review");
	const tools = review.locator(".review-tools");
	await expect(tools).toContainText("Clear all");
	const reviewBox = await review.boundingBox();
	const toolsBox = await tools.boundingBox();
	if (!reviewBox || !toolsBox) throw new Error("review lost its box");
	// Top edge: the tools row starts where the overlay starts.
	expect(toolsBox.y - reviewBox.y).toBeLessThan(32);
	// Right edge: the tools row ends where the overlay ends.
	expect(
		reviewBox.x + reviewBox.width - (toolsBox.x + toolsBox.width)
	).toBeLessThan(40);
	await tools.locator("button").click();
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Multi-paragraph quotes wash without painting the paragraph gaps: no
whitespace-only marks, no layout growth while the wash is on, and a
live highlight survives hovering the badge on and off. */
test("multi-paragraph wash paints no gaps and keeps the highlight", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here."
		}
	]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	// Selectable text nodes: skip badge chrome and inter-block gaps.
	const selectAcross = (from: number, to: number) =>
		page.evaluate(
			([a, b]: number[]) => {
				const texts: Text[] = [];
				const walker = document.createTreeWalker(
					document.querySelector("article .rendered"),
					NodeFilter.SHOW_TEXT
				);
				while (walker.nextNode()) {
					const node = walker.currentNode;
					const parent = node.parentNode;
					if (parent instanceof Element && parent.closest("[data-ann-badge]"))
						continue;
					if (node instanceof Text && /\S/.test(node.textContent ?? ""))
						texts.push(node);
				}
				const first = texts[0];
				const last = texts[texts.length - 1];
				if (!first || !last || a === undefined || b === undefined)
					throw new Error("no text");
				window.getSelection()?.setBaseAndExtent(first, a, last, b);
				return window.getSelection()?.toString() ?? "";
			},
			[from, to] as [number, number]
		);
	expect(await selectAcross(6, 5)).toBe(
		"paragraph here.\n\nSecond paragraph here.\n\nThird"
	);
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toHaveCount(1);
	const snapshot = () =>
		page.evaluate(() => {
			const root = document.querySelector("article .rendered");
			// The preview wash paints Highlight ranges (no DOM marks) —
			// under any graded ramp name mid-fade, so union all three.
			const reg = (
				window as unknown as {
					CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
				}
			).CSS?.highlights;
			const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
			const ranges = names
				.flatMap((n) => [...(reg?.get(n) ?? [])])
				.map((r) => r.toString());
			const box = root
				?.querySelector("button.ccez-ann-badge")
				?.getBoundingClientRect();
			return {
				rangeCount: ranges.length,
				blankRanges: ranges.filter((text) => !/\S/.test(text ?? "")).length,
				badgeY: box ? Math.round(box.y) : -1,
				height: root?.getBoundingClientRect().height
			};
		});
	const washed = await snapshot();
	expect(washed.rangeCount).toBeGreaterThan(0);
	expect(washed.blankRanges).toBe(0);
	// A live highlight inside the washed region survives hover on/off
	// (re-anchor by content: the badge anchor splits text nodes, so
	// node order never survives stamping).
	const reselected = await page.evaluate(() => {
		const walker = document.createTreeWalker(
			document.querySelector("article .rendered"),
			NodeFilter.SHOW_TEXT
		);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			const text = node instanceof Text ? (node.textContent ?? "") : "";
			const at = text.indexOf("paragraph here.");
			if (at >= 0) {
				window.getSelection()?.setBaseAndExtent(node, at, node, at + 9);
				return window.getSelection()?.toString() ?? "";
			}
		}
		throw new Error("no target");
	});
	expect(reselected).toBe("paragraph");
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(300);
	const hovered = await snapshot();
	expect(hovered.rangeCount).toBeGreaterThan(0);
	expect(hovered.blankRanges).toBe(0);
	expect(hovered.height).toBe(washed.height);
	expect(hovered.badgeY).toBe(washed.badgeY);
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toBe("paragraph");
	await page.mouse.move(4, 4);
	await page.waitForTimeout(400);
	const left = await snapshot();
	expect(left.height).toBe(washed.height);
	expect(left.badgeY).toBe(washed.badgeY);
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toBe("paragraph");
});

/** RTL paragraphs lay out right-to-left (dir=auto), so a top-right to
bottom drag starts at the text's start instead of mid-text. */
test("rtl drag from the top-right selects the whole paragraph", async ({
	page
}) => {
	const para =
		"القط السمين يجلس على السجادة القديمة في غرفة المعيشة المشمسة. الكلب الصغير يركض بسرعة في الحديقة الخضراء الواسعة. الطائر الأزرق يغرد بصوت عال فوق الأشجار العالية.";
	await seedChat(page, [{ role: "assistant", content: para }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	await expect(body.locator("p").first()).toHaveAttribute("dir", "auto");
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.move(box.x + box.width - 4, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + 4, box.y + box.height - 4, { steps: 15 });
	await page.mouse.up();
	const sel = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	// Was 47 of 162 before per-block direction: the first sentence dropped.
	expect(sel.length).toBeGreaterThan(150);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Saving a bullet-spanning annotation with Enter leaves no native
highlight behind: the quote keeps its badge and wash, but the
selection itself is gone. */
test("annotating bullets and saving with Enter clears the highlight", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"Points:\n\n- 越えた (koeta) = crossed\n- 友情 (yujo) = friendship"
		}
	]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	const first = body.locator("li").nth(0);
	const second = body.locator("li").nth(1);
	const a = await first.boundingBox();
	const b = await second.boundingBox();
	if (!a || !b) throw new Error("bullets have no boxes");
	// Real press to normalize the click guard, then a real range over
	// both bullets before the matching mouseup summons the menu.
	await page.mouse.click(a.x + 5, a.y + 5);
	await page.mouse.move(b.x + b.width - 5, b.y + 5);
	await page.mouse.down();
	await page.evaluate(() => {
		const items = [...document.querySelectorAll("article .rendered li")];
		if (items.length < 2) throw new Error("no bullets");
		const range = document.createRange();
		range.setStart(items[0].firstChild, 0);
		const last = items[1].lastChild;
		range.setEnd(last, last.textContent?.length ?? 0);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toBe("");
	// The save itself worked: one badge stamped on the quote, and the
	// steady state carries no wash — badges alone mark saved quotes.
	expect(await page.locator("article .rendered [data-ann-badge]").count()).toBe(
		1
	);
	// Past the pill fade (160ms): steady state carries no wash —
	// badges alone mark saved quotes (the Highlight wash clears
	// instantly, no fade-out).
	await page.waitForTimeout(600);
	expect(
		await page.evaluate(
			() =>
				(
					window as unknown as {
						CSS?: { highlights?: { has(name: string): boolean } };
					}
				).CSS?.highlights?.has("ccez-ann") ?? false
		)
	).toBe(false);
});

/** A press outside message text that drags into the chat keeps the
live highlight: only a plain (unmoved) click clears it. */
test("dragging from the gutter into the chat keeps the highlight", async ({
	page
}) => {
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 20, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 120, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	const before = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	expect(before.length).toBeGreaterThan(0);
	// Press in the gutter (past the 24px edge-gesture zone, so no
	// sidebar claims the stroke), drag into the chat, release over text.
	await page.mouse.move(40, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 60, y, { steps: 8 });
	await page.mouse.up();
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toBe(before);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Annotations-only messages render an em-dash at text size with the
count above, unfolded — never the baked block. */
test("annotations-only message renders em-dash with count", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: 'Annotated selections:\n1. "bonjour" — ?' },
		{ role: "assistant", content: "ok" }
	]);
	await page.goto("/");
	const article = page.locator("article.user");
	await expect(article.locator(".ann-refs-pill")).toHaveText("1", {
		timeout: 60_000
	});
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".rendered")).not.toContainText(
		"Annotated selections"
	);
	await expect(article.locator(".folded-preview")).toHaveCount(0);
	const dash = await article
		.locator(".rendered")
		.evaluate((el) => getComputedStyle(el as HTMLElement).fontSize);
	const normal = await page
		.locator("article.assistant .rendered")
		.evaluate((el) => getComputedStyle(el as HTMLElement).fontSize);
	expect(dash).toBe(normal);
});

/** Message copy excludes the baked annotation block. */
test("message copy excludes baked annotations", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — ?'
		}
	]);
	await page.goto("/");
	const row = page.locator("article.user .actions");
	await row.hover();
	await page
		.locator('article.user .actions button[data-tip="Copy as plain text"]')
		.click();
	await expect(page.locator(".toast")).toHaveText("Copied", {
		timeout: 10_000
	});
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		"explain this"
	);
});

/** Each baked annotation copies from the sent-refs card's icon button. */
test("sent-refs card copies one annotation", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	// A leading assistant message pushes the user article down: the
	// count pill floats above its message and is unhittable at the
	// viewport's top edge.
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	// Click-toggled (hover never opens it).
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-copy").first().click();
	await expect(page.locator(".toast")).toHaveText("Copied", {
		timeout: 10_000
	});
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		'"bonjour" — greeting?'
	);
});

/** Sent-refs rows read like the draft card: quote + copy up top,
note + pencil below, Clear-all top-right of the card. */
test("sent-refs card lays out quote, copy, note, pencil in order", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	const pop = page.locator(".ann-refs-pop").first();
	await expect(pop).toBeVisible();
	const box = async (sel: string) => {
		const rect = await pop.locator(sel).first().boundingBox();
		if (!rect) throw new Error(`no box for ${sel}`);
		return rect;
	};
	const quote = await box(".ann-refs-quote");
	const copy = await box(".ann-refs-copy");
	const note = await box(".ann-refs-comment");
	const pencil = await box(".ann-refs-pencil");
	const clear = await box(".ann-refs-clear");
	// Copy rides the quote line; the pencil rides the note line.
	expect(Math.abs(copy.y - quote.y)).toBeLessThan(10);
	expect(copy.x).toBeGreaterThan(quote.x);
	expect(note.y).toBeGreaterThan(quote.y);
	expect(Math.abs(pencil.y - note.y)).toBeLessThan(10);
	expect(pencil.x).toBeGreaterThan(note.x);
	// Clear-all sits top-right, above the first row (inside the
	// card's own padding, like the draft tools row).
	const popBox = await pop.boundingBox();
	if (!popBox) throw new Error("no pop box");
	expect(clear.y + clear.height).toBeLessThanOrEqual(quote.y + 4);
	expect(clear.x + clear.width).toBeGreaterThanOrEqual(
		popBox.x + popBox.width - 16
	);
});

/** Sent-refs Clear-all strips the baked block, keeping the prompt. */
test("sent-refs Clear-all strips the baked block", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-clear").first().click();
	await expect(page.locator(".toast")).toHaveText("Sent annotations cleared", {
		timeout: 10_000
	});
	await expect(page.locator(".ann-refs-pill")).toHaveCount(0);
	const body = await page.locator("article.user .rendered").first().innerText();
	expect(body).toContain("explain this");
	expect(body).not.toContain("Annotated selections");
});

/** Sent-refs Clear-all on a refs-only message deletes the message. */
test("sent-refs Clear-all deletes a refs-only message", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{ role: "user", content: 'Annotated selections:\n1. "bonjour" — greeting?' }
	]);
	await page.goto("/");
	await expect(page.locator("article.user")).toHaveCount(1);
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-clear").first().click();
	await expect(page.locator(".toast")).toHaveText("Sent annotations cleared", {
		timeout: 10_000
	});
	await expect(page.locator("article.user")).toHaveCount(0);
});

/** Sent-refs quote jumps to the quoted message — not the sender — and
flashes the quote through the Highlight registry (zero DOM churn, so
the badge anchor never moves; the jump clears the hover wash first,
so no twin layers under the flash). */
test("sent-refs quote jumps to the quoted text with a flash", async ({
	page
}) => {
	const sentence =
		"The quick brown fox jumps over the lazy dog near the riverbank.";
	const filler = Array.from(
		{ length: 10 },
		(_, i) => `Filler ${i}. ${sentence} ${sentence}`
	).join("\n\n");
	await seedChat(page, [
		{
			role: "assistant",
			content: `Kyoto in spring is lovely and bright\n\n${filler}`
		},
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	// Park at the bottom (on the sender) so the jump travels back up.
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement;
		box.style.scrollBehavior = "auto";
		box.scrollTo({ top: 999999 });
	});
	const top = await page.evaluate(
		() => document.querySelector(".messages")?.scrollTop ?? 0
	);
	expect(top).toBeGreaterThan(100);
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-quote").first().click();
	// The flash paints on the jump: a draft-yellow registry highlight
	// on the quote (polled — the lit phase counts). No DOM mark ever
	// mounts, so the badge anchor cannot move mid-blink.
	const flashSize = (): Promise<number> =>
		page.evaluate(() => {
			const reg = (
				window.CSS as unknown as {
					highlights?: { get(n: string): { size: number } | undefined };
				}
			).highlights;
			return reg?.get("ccez-ann-flash")?.size ?? 0;
		});
	await expect.poll(flashSize, { timeout: 5_000 }).toBeGreaterThan(0);
	// No Highlight twin layers under the flash (one landing, one shape):
	// the jump clears the hover wash first.
	const washed = await page.evaluate(() => {
		const reg = (
			window.CSS as unknown as {
				highlights?: { get(n: string): { size: number } | undefined };
			}
		).highlights;
		return ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"].some(
			(name) => (reg?.get(name)?.size ?? 0) > 0
		);
	});
	expect(washed).toBe(false);
	await page.waitForTimeout(800);
	const after = await page.evaluate(
		() => document.querySelector(".messages")?.scrollTop ?? 0
	);
	expect(after).toBeLessThan(top - 50);
	// The flash releases itself: no highlight lingers in the registry
	// and no mark lingers in the message, and a failed re-locate
	// clears rather than stranding yellow.
	await expect.poll(flashSize, { timeout: 5_000 }).toBe(0);
	await expect(page.locator("mark.ccez-ann-flash")).toHaveCount(0, {
		timeout: 5_000
	});
});

/** The pressed sent row blinks like a draft row (same phases), so the
jump reads even where the highlight wash can't paint. */
test("sent-refs quote blinks its row", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Kyoto in spring is lovely and bright" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-quote").first().click();
	const row = page.locator(".ann-refs-item").first();
	await expect(row).toHaveClass(/blink/);
	await expect(row).not.toHaveClass(/blink/, { timeout: 5_000 });
});

/** Sent rows point only on the quote: number and note read default,
like the draft card. */
test("sent-refs rows point only on the quote", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Kyoto in spring is lovely and bright" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".ann-refs-pill").first().click();
	const cursors = await page.evaluate(() => {
		const style = (sel: string) =>
			getComputedStyle(document.querySelector(sel) as HTMLElement).cursor;
		return {
			item: style(".ann-refs-item"),
			quote: style(".ann-refs-quote"),
			num: style(".ann-refs-num"),
			note: style(".ann-refs-comment")
		};
	});
	expect(cursors).toEqual({
		item: "default",
		quote: "pointer",
		num: "default",
		note: "default"
	});
});

/** The sent card follows the theme: panel surface and quiet note on
light, dark card and pale note on dark. */
for (const theme of ["light", "dark"] as const) {
	test(`sent-refs card themes on ${theme}`, async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "Kyoto in spring is lovely and bright" },
			{
				role: "user",
				content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
			}
		]);
		await page.addInitScript((name: string) => {
			const raw = window.localStorage.getItem("ccez-llm-settings-v1") ?? "{}";
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ ...JSON.parse(raw), theme: name })
			);
		}, theme);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		await page.locator(".ann-refs-pill").first().click();
		const card = page.locator(".ann-refs-pop").first();
		await expect(card).toHaveCSS(
			"background-color",
			theme === "light" ? "rgb(250, 250, 252)" : "rgb(28, 28, 30)"
		);
		await expect(page.locator(".ann-refs-comment").first()).toHaveCSS(
			"color",
			theme === "light" ? "rgb(110, 110, 115)" : "rgb(199, 199, 204)"
		);
	});
}

/** A sent quote edited away everywhere falls back to the sending
message (cleared refs have no badge left to blink). Long messages
fold, so the landing reads off the scroll call itself, not movement. */
test("sent-refs missing quote falls back to the sender", async ({ page }) => {
	await page.addInitScript(() => {
		const seen: string[] = [];
		const orig = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (
			opts?: ScrollIntoViewOptions | boolean
		): void {
			seen.push(`${(this as Element).id}:${JSON.stringify(opts)}`);
			(window as unknown as { __siv?: string[] }).__siv = seen;
			orig.call(this, opts);
		};
	});
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-quote").first().click();
	await page.waitForTimeout(500);
	const seen = await page.evaluate(
		() => (window as unknown as { __siv?: string[] }).__siv ?? []
	);
	expect(seen).toContain('msg-1:{"block":"center","behavior":"smooth"}');
});

/** Only the sent quote navigates: note and number clicks jump nowhere
— no scroll, no flash, the card stays open. */
test("sent-refs note click does not jump", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Kyoto in spring is lovely and bright" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "spring" — ?'
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".ann-refs-pill").first().click();
	const top = await page.evaluate(
		() => document.querySelector(".messages")?.scrollTop ?? 0
	);
	await page.locator(".ann-refs-comment").first().click();
	await page.locator(".ann-refs-num").first().click();
	await page.waitForTimeout(500);
	expect(
		await page.evaluate(
			() => document.querySelector(".messages")?.scrollTop ?? 0
		)
	).toBe(top);
	const flashed = await page.evaluate(
		() =>
			(
				window as unknown as {
					CSS?: { highlights?: { has(name: string): boolean } };
				}
			).CSS?.highlights?.has("ccez-ann-jump") ?? false
	);
	expect(flashed).toBe(false);
	await expect(page.locator(".ann-refs-pop").first()).toHaveCSS("opacity", "1");
});

/** Picks rooted in the sent-refs card are never annotatable:
selecting saved text summons no menu and keeps the pick. */
test("selecting sent-refs text summons no menu", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	const comment = page.locator(".ann-refs-comment").first();
	const cbox = await comment.boundingBox();
	if (!cbox) throw new Error("comment has no box");
	await page.mouse.move(cbox.x + 2, cbox.y + cbox.height / 2);
	await page.mouse.down();
	await page.mouse.move(cbox.x + cbox.width - 2, cbox.y + cbox.height / 2, {
		steps: 6
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).not.toBe("");
});

/** Sent-refs rows stay one line like the composer card: quote cuts
with an ellipsis, note scrolls sideways, copy rides the row's end. */
test("sent-refs rows are one line with copy at the end", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	const style = await page.evaluate(() => {
		const q = document.querySelector(".ann-refs-quote") as HTMLElement | null;
		const c = document.querySelector(".ann-refs-comment") as HTMLElement | null;
		const qs = q ? getComputedStyle(q) : null;
		const cs = c ? getComputedStyle(c) : null;
		return {
			quote:
				qs?.whiteSpace === "nowrap" &&
				qs?.textOverflow === "ellipsis" &&
				qs?.overflow === "hidden",
			note:
				cs?.whiteSpace === "nowrap" &&
				cs?.overflowX === "auto" &&
				cs?.fontStyle === "italic"
		};
	});
	expect(style).toEqual({ quote: true, note: true });
	const order = await page.evaluate(() => {
		const item = document.querySelector(".ann-refs-item");
		const copy = item?.querySelector(".ann-refs-copy")?.getBoundingClientRect();
		const quote = item
			?.querySelector(".ann-refs-quote")
			?.getBoundingClientRect();
		return copy && quote ? copy.x > quote.x : false;
	});
	expect(order).toBe(true);
});

/** The sent-refs pencil edits the note in the row (desktop): Enter
rebakes the message in place — no resend, no composer detour — and
focus parks back on the pencil. */
test("sent-refs pencil edits the note in the row", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-pencil").first().click();
	const field = page.locator(".ann-refs-input");
	await expect(field).toHaveValue("greeting?");
	await field.click();
	await page.keyboard.press("End");
	await page.keyboard.type("!!");
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-refs-comment").first()).toHaveText(
		"greeting?!!"
	);
	// The pill count stands, focus is back on the pencil, nothing resent.
	await expect(page.locator(".ann-refs-pencil").first()).toBeFocused();
	await expect(page.locator(".ann-refs-pill").first()).toHaveText("1");
	await expect(page.locator("article.assistant")).toHaveCount(1);
});

/** Escape cancels the sent-refs row edit: the stored note stands and
the card stays open for a second Esc. */
test("sent-refs row edit cancels on Escape", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{
			role: "user",
			content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?'
		}
	]);
	await page.goto("/");
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-pencil").first().click();
	const field = page.locator(".ann-refs-input");
	await expect(field).toHaveValue("greeting?");
	await field.click();
	await page.keyboard.type("!!");
	await page.keyboard.press("Escape");
	await expect(field).toHaveCount(0);
	await expect(page.locator(".ann-refs-comment").first()).toHaveText(
		"greeting?"
	);
	await expect(page.locator(".ann-refs-pop").first()).toHaveCSS("opacity", "1");
});

/** Each draft annotation copies from the review panel's icon button. */
test("review panel copies one annotation", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	await page.locator(".prompt-tools .review-copy").first().click();
	await expect(page.locator(".toast")).toHaveText("Copied", {
		timeout: 10_000
	});
	const pasted = await page.evaluate(() => navigator.clipboard.readText());
	expect(pasted).toContain("テストを確認しました");
});

/**
 * Annotation UX bucket (e2e; NOT run in the agent loop — the shared
 * dev-server port belongs to the human's session).
 *
 * Covers, with real layout:
 * 1. create marker snaps to word edges (never splits a word in half);
 * 2. create textbox centers over narrow highlights, keeps cursor
 *    placement for wide ones; the Annotate button never moves;
 * 3. numbered badges scale with the message font size;
 * 4. empty annotations bake a "?" so the model sees the confusion;
 * 5. annotations-only messages render as an em-dash with the count UI above;
 * 6. review edit box: Enter saves, Save animates symmetrically, and the
 *    textarea stays readable in dark mode;
 * 7. off-chat drags never highlight above the cursor's current line.
 */

test("mid-word drags snap out to whole words", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "hello world from Kyoto" }
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	// Real press to normalize the click guard, then a range cut
	// mid-word on both ends ("ell|o worl|d") before mouseup.
	await page.mouse.click(box.x + 10, y);
	await page.mouse.move(box.x + box.width - 2, y);
	await page.mouse.down();
	await page.evaluate(() => {
		const text = document.querySelector(
			"article.assistant .rendered p"
		)?.firstChild;
		if (!(text instanceof Text)) throw new Error("no message text");
		window.getSelection()?.setBaseAndExtent(text, 1, text, 10);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	// The filed quote is the whole words, never the cut fragment.
	await page.locator(".prompt-tools .ann-wrap").hover();
	await expect(page.locator(".prompt-tools .review-quote").first()).toHaveText(
		/hello world/
	);
});

test("create box centers over narrow highlights, wide ones open at the cursor", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "assistant",
			content: "Kyoto is an old capital with many temples and quiet gardens"
		}
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	const box = await para.boundingBox();
	if (!box) throw new Error("message has no box");

	// Narrow: double-click picks one word; the box centers over it
	// while the Annotate button stays at the cursor end.
	const paraBox = await para.boundingBox();
	if (!paraBox) throw new Error("paragraph has no box");
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	const menuBox = await page.locator(".sel-menu").boundingBox();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	const pop = page.locator(".ann-pop");
	await expect(pop).toBeVisible();
	const popBox = await pop.boundingBox();
	const highlight = await page.evaluate(() => {
		// Annotate consumed the live highlight, so read the pending
		// wash range it painted instead (Highlight API: no DOM marks).
		const reg = (
			window as unknown as {
				CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
			}
		).CSS?.highlights;
		const ranges = [...(reg?.get("ccez-ann") ?? [])];
		const r = ranges[0]?.getBoundingClientRect();
		if (!r) return null;
		return { left: r.left, width: r.width };
	});
	if (!popBox) throw new Error("missing pop box");
	if (highlight && highlight.width < 300) {
		const popCX = popBox.x + popBox.width / 2;
		const hlCX = highlight.left + highlight.width / 2;
		expect(Math.abs(popCX - hlCX)).toBeLessThanOrEqual(8);
	}
	// The menu itself sits at the cursor end, not centered.
	if (!menuBox) throw new Error("missing menu box");
	expect(Math.abs(menuBox.x - (paraBox.x + 10 - 16))).toBeLessThanOrEqual(8);
	await page.keyboard.press("Escape");
	// Settle first: the pill fades out on a timer that unwraps its
	// wash mark, and closing returns focus to the composer (which
	// scrolls the list) — measuring or dragging mid-fade races both.
	await expect(page.locator(".ann-pop")).toHaveCount(0);

	// Wide: dragging the whole paragraph keeps the cursor placement —
	// the box opens at the selection end, not the paragraph center.
	const wide = await para.boundingBox();
	if (!wide) throw new Error("message lost its box");
	const wideY = wide.y + wide.height / 2;
	await page.mouse.move(wide.x + 10, wideY);
	await page.mouse.down();
	await page.mouse.move(wide.x + wide.width - 10, wideY, { steps: 8 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	const endX = wide.x + wide.width - 10;
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(pop).toBeVisible();
	const wideBox = await pop.boundingBox();
	if (!wideBox) throw new Error("missing wide box");
	expect(Math.abs(wideBox.x - (endX - 16))).toBeLessThanOrEqual(24);
	await page.keyboard.press("Escape");
});

test("numbered badges grow with the message font size", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.type("note");
	await page.keyboard.press("Enter");
	const badge = page.locator("article.assistant [data-ann-badge]").first();
	await expect(badge).toBeVisible();
	const small = await badge.evaluate((el) => getComputedStyle(el).fontSize);
	await page.evaluate(() => {
		document.querySelector(".app")?.setAttribute("style", "--font-scale: 2");
	});
	const big = await badge.evaluate((el) => getComputedStyle(el).fontSize);
	expect(parseFloat(big)).toBeGreaterThan(parseFloat(small));
});

test("empty annotations bake a question mark for the model", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	// Enter with no text files the empty annotation (click-away would cancel it).
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-wrap")).toBeVisible();
	// Send the empty prompt with the annotation attached (mock provider).
	await page.locator(".ta-input").click();
	await page.keyboard.press("Enter");
	const user = page.locator("article.user").first();
	await expect(user).toBeVisible();
	// Click-toggled (hover never opens it): prove the toggle
	// genuinely opened it via its opacity transition.
	await user.locator(".ann-refs-pill").click();
	await expect(user.locator(".ann-refs-pop")).toHaveCSS("opacity", "1");
	await expect(user.locator(".ann-refs-comment").first()).toHaveText("?");
});

test("annotations-only messages render as an em-dash with the count pill above", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "user", content: 'Annotated selections:\n1. "Kyoto" — ?' }
	]);
	await page.goto("/");
	const user = page.locator("article.user").first();
	await expect(user).toBeVisible({ timeout: 60_000 });
	// Body collapses to one em-dash at the normal message text size.
	const bodyText = await user.locator(".rendered").innerText();
	expect(bodyText.trim()).toBe("—");
	const sizes = await page.evaluate(() => {
		const em = document
			.querySelector("article.user .rendered")
			?.getBoundingClientRect();
		const pill = document
			.querySelector("article.user .ann-refs-pill")
			?.getBoundingClientRect();
		const base = getComputedStyle(
			document.querySelector("article.user .rendered")!
		);
		if (!em || !pill) return null;
		return {
			emTop: em.y,
			pillBottom: pill.y + pill.height,
			fontSize: base.fontSize
		};
	});
	if (!sizes) throw new Error("missing refs-only boxes");
	// The count UI rides above the dash, never inline with it.
	expect(sizes.pillBottom).toBeLessThanOrEqual(sizes.emTop + 2);
	// Normal text size: the message scale, not a shrunken preview.
	expect(parseFloat(sizes.fontSize)).toBeGreaterThanOrEqual(13);
});

test("review pencil edits at the mark in the floating card", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.type("first");
	await page.keyboard.press("Enter");
	// A chat draft is already underway: the card edit must not clobber it.
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.type("chat draft");
	// The pill toggles the review (hover never opens it); the pencil
	// jumps to the mark and opens the floating edit card there.
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	await page.locator(".review-pencil").first().click();
	const card = page.locator('.ann-pop[aria-label="Edit annotation"]');
	await expect(card).toBeVisible();
	await expect(card.locator("textarea")).toHaveValue("first");
	// Enter files the note back into the draft (the guard swallows the
	// keypress so it never doubles as a send).
	await card.locator("textarea").click();
	await page.keyboard.type("!");
	await page.keyboard.press("Enter");
	await expect(card).toHaveCount(0);
	await expect(page.locator(".review-comment").first()).toHaveText("first!");
	// The composer draft survived untouched.
	const draft = await page.evaluate(
		() =>
			(
				document.querySelector(
					".prompt .ta-input"
				) as HTMLTextAreaElement | null
			)?.value ?? ""
	);
	expect(draft).toBe("chat draft");
});

/** Hovering the review pencil moves nothing: the row's icons keep
their boxes (a hover style that grows the box jitters the whole
card under the cursor). */
test("review pencil hover moves no icons", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.type("first");
	await page.keyboard.press("Enter");
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	const boxes = () =>
		page.evaluate(() => {
			const box = (sel: string) => {
				const el = document.querySelector(sel);
				if (!(el instanceof HTMLElement)) throw new Error(`missing ${sel}`);
				const b = el.getBoundingClientRect();
				return {
					x: Math.round(b.x),
					y: Math.round(b.y),
					w: Math.round(b.width),
					h: Math.round(b.height)
				};
			};
			return {
				copy: box(".review-copy"),
				del: box('.review-head button[title="Delete annotation"]'),
				pencil: box(".review-pencil"),
				quote: box(".review-quote"),
				comment: box(".review-comment")
			};
		});
	const before = await boxes();
	// Copy and delete share one vertical middle at rest (the old text
	// × sat low on its font bearings).
	expect(
		Math.abs(
			before.copy.y + before.copy.h / 2 - (before.del.y + before.del.h / 2)
		)
	).toBeLessThanOrEqual(1);
	await page.locator(".review-pencil").first().hover();
	// Hover transitions run 0.15s; measure past them.
	await page.waitForTimeout(400);
	expect(await boxes()).toEqual(before);
	// And the hover paints no box-bleeding artifacts: icon buttons
	// never underline, the pencil signals with color alone (no
	// background, no glow).
	const paint = await page.evaluate(() => {
		const style = (sel: string) =>
			getComputedStyle(document.querySelector(sel) as HTMLElement);
		return {
			copyDeco: style(".review-copy").textDecorationLine,
			pencilDeco: style(".review-pencil").textDecorationLine,
			pencilColor: style(".review-pencil").color,
			pencilBg: style(".review-pencil").backgroundColor,
			pencilFilter: style(".review-pencil").filter,
			// The row itself navigates nowhere: default cursor on the
			// item, pointer only on the quote button.
			itemCursor: style(".review-item").cursor,
			quoteCursor: style(".review-quote").cursor
		};
	});
	expect(paint).toEqual({
		copyDeco: "none",
		pencilDeco: "none",
		pencilColor: "rgb(0, 122, 255)",
		pencilBg: "rgba(0, 0, 0, 0)",
		pencilFilter: "none",
		itemCursor: "auto",
		quoteCursor: "pointer"
	});
	// The delete icon goes Clear-all red, never underlined — and holds
	// its box like the rest.
	await page.locator(".review-del").first().hover();
	await page.waitForTimeout(400);
	expect(await boxes()).toEqual(before);
	const delPaint = await page.evaluate(() => {
		const style = getComputedStyle(
			document.querySelector(".review-del") as HTMLElement
		);
		return { color: style.color, deco: style.textDecorationLine };
	});
	expect(delPaint).toEqual({ color: "rgb(148, 37, 10)", deco: "none" });
	// The quote navigates, so it links: underline on hover.
	await page.locator(".review-quote").first().hover();
	await page.waitForTimeout(400);
	expect(await boxes()).toEqual(before);
	const quoteDeco = await page.evaluate(
		() =>
			getComputedStyle(document.querySelector(".review-quote") as HTMLElement)
				.textDecorationLine
	);
	expect(quoteDeco).toBe("underline");
});

/** A long review quote clips with an ellipsis inside the row: the card
never scrolls sideways (a flex-shrink regression once stretched the
whole overlay instead). */
test("long review quote truncates with an ellipsis", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-long",
						messageId: "e2e-m0",
						quote:
							"栄養バランスが良いとされています最近では健康志向の高まりから和食の見直しが進み若い世代にも伝統が受け継がれています",
						comment: "note"
					}
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	const sizes = await page.evaluate(() => {
		const quote = document.querySelector(".review-quote") as HTMLElement;
		const card = document.querySelector(".ann-wrap .review") as HTMLElement;
		const qr = quote.getBoundingClientRect();
		const cr = card.getBoundingClientRect();
		return {
			quoteClipped: quote.scrollWidth > quote.clientWidth + 1,
			quoteFits: qr.right <= cr.right + 1,
			cardScrolls: card.scrollWidth > card.clientWidth + 1
		};
	});
	expect(sizes).toEqual({
		quoteClipped: true,
		quoteFits: true,
		cardScrolls: false
	});
});

test("gutter drags never highlight above the cursor line", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "aaa one\n\nbbb two\n\nccc three" }
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const target = body.locator("p").nth(2);
	const tbox = await target.boundingBox();
	if (!tbox) throw new Error("third paragraph has no box");
	// Press in the left gutter beside the third paragraph (off-chat),
	// drag into its middle, then run to the top edge (off-screen path
	// shares the same selectionchange trim).
	await page.mouse.move(6, tbox.y + tbox.height / 2);
	await page.mouse.down();
	await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, {
		steps: 8
	});
	await page.mouse.move(tbox.x + tbox.width / 2, 4, { steps: 4 });
	await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, {
		steps: 4
	});
	await page.mouse.up();
	const selected = await page.evaluate(
		() => window.getSelection()?.toString() ?? ""
	);
	// Nothing above the cursor's line ("aaa", "bbb") may highlight.
	expect(selected).not.toContain("aaa");
	expect(selected).not.toContain("bbb");
});

/** Filed-annotations card dismisses: Escape closes it, and so does a
press anywhere outside the card (the pill alone toggles). The pill
also shows the pointer hand. */
test("sent refs card dismisses on Escape and outside press", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-wrap")).toBeVisible();
	await page.locator(".ta-input").click();
	await page.keyboard.press("Enter");
	const user = page.locator("article.user").first();
	await expect(user).toBeVisible();
	const pill = user.locator(".ann-refs-pill");
	const pop = user.locator(".ann-refs-pop");
	await expect(pill).toHaveCSS("cursor", "pointer");
	await pill.click();
	await expect(pop).toHaveCSS("opacity", "1");
	await page.keyboard.press("Escape");
	// The card opens under the cursor, and hover alone holds opacity
	// at 1: step off first — only a still-open card survives that.
	await page.mouse.move(10, 300);
	await expect(pop).toHaveCSS("opacity", "0");
	await pill.click();
	await expect(pop).toHaveCSS("opacity", "1");
	await page.mouse.click(10, 300);
	await expect(pop).toHaveCSS("opacity", "0");
});

/** Tabbing through the badge edit card keeps it open: blur-save only
fires when focus leaves the card, not between its own buttons. */
test("tab through the badge edit keeps the card open", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	// Slow the mock answer: the badge click below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	const pop = page.locator(".ann-pop");
	await expect(pop).toBeVisible();
	await expect(pop.locator("textarea")).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(pop).toBeVisible();
	await expect(
		pop.locator('button[aria-label="Delete annotation"]')
	).toBeFocused();
	// Every further Tab walks the card's own row (dictation joins it
	// when the mic is available) until Save; the card must never
	// close under keyboard traversal.
	const focusedName = (): Promise<string> =>
		page.evaluate(() => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement)) return "none";
			return (
				active.getAttribute("aria-label") ??
				active.textContent ??
				""
			).trim();
		});
	for (let n = 0; n < 6; n++) {
		if ((await focusedName()) === "Save") break;
		await page.keyboard.press("Tab");
		await expect(pop).toBeVisible();
	}
	await expect(pop.locator(".ann-save")).toBeFocused();
	await expect(pop).toBeVisible();
});

/** Badge-edit focus holds: the box keeps the caret a beat after open
and after clicking back in (a delayed steal must fail this, not the
instant assertion above). */
test("badge edit keeps focus after open and re-click", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	// Slow the mock answer: the badge clicks below must open the edit
	// card, not the ready-answer card.
	await page.evaluate(() =>
		localStorage.setItem("ccez-mock-chat-ms", "15000")
	);
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	const pop = page.locator(".ann-pop");
	await expect(pop).toBeVisible();
	const area = pop.locator("textarea");
	await expect(area).toBeFocused();
	await page.waitForTimeout(800);
	await expect(area).toBeFocused();
	await area.click();
	await page.waitForTimeout(800);
	await expect(area).toBeFocused();
});

/** Hovering badges across two messages washes every quote: the shared
Highlight registry is painted by every message body, so a body holding
no ranges for the hovered id must never clear a wash another body
painted (assistant-to-user slides left the user quote dark), and
hovering must never re-stamp badges (rebuilt nodes read as marker
flicker). */
test("badge hover washes every quote across both messages", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "user",
			content:
				"The quick brown fox jumps over the lazy dog near the river bank."
		},
		{
			role: "assistant",
			content:
				"Pack my box with five dozen liquor jugs before the long winter voyage ends."
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	const annotate = async (article: number, quote: string): Promise<void> => {
		await dragQuote(page, article, quote);
		await expect(page.locator(".sel-menu")).toBeVisible();
		await page.locator('.sel-menu button:has-text("Annotate")').click();
		await expect(page.locator(".ann-pop")).toBeVisible();
		await page.keyboard.press("Enter");
	};
	const badges = (role: "user" | "assistant") =>
		page.locator(`article.${role} button.ccez-ann-badge`);
	await annotate(0, "quick brown fox");
	await annotate(0, "lazy dog");
	await annotate(1, "five dozen liquor");
	await annotate(1, "winter voyage");
	await expect(badges("user")).toHaveCount(2);
	await expect(badges("assistant")).toHaveCount(2);
	// Tag the live badge nodes: any re-stamp (the flicker) swaps
	// nodes and drops the tags.
	await page.evaluate(() => {
		document.querySelectorAll("button.ccez-ann-badge").forEach((b, i) => {
			if (b instanceof HTMLElement) b.dataset.probe = `badge-${i}`;
		});
	});
	const washedText = () =>
		page.evaluate(() => {
			const reg = (
				window as unknown as {
					CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
				}
			).CSS?.highlights;
			// The badge anchors mid-quote, so its digit rides inside
			// the washed range text ("quick br1own fox"): strip digits
			// before matching the quote back.
			return [...(reg?.get("ccez-ann") ?? [])]
				.map((r) => r.toString().replace(/\d/g, ""))
				.join(" ");
		});
	const hoverBadge = async (
		role: "user" | "assistant",
		nth: number,
		word: string,
		visible: { article: number; quote: string } | null = null
	): Promise<void> => {
		if (visible) {
			// Registry ranges are not visible paint: clip the quote's
			// lines unhovered, then hovered — the wash must change
			// pixels (badges carry no :hover styling, so any change in
			// the static clip is the yellow).
			const clip = await quoteRect(page, visible.article, visible.quote);
			await page.mouse.move(4, 4);
			await page.waitForTimeout(400);
			const bare = await page.screenshot({ clip });
			const badge = badges(role).nth(nth);
			const box = await badge.boundingBox();
			if (!box) throw new Error("badge has no box");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.waitForTimeout(300);
			expect(await washedText()).toContain(word);
			const washed = await page.screenshot({ clip });
			expect(Buffer.compare(bare, washed) !== 0).toBe(true);
			return;
		}
		const badge = badges(role).nth(nth);
		const box = await badge.boundingBox();
		if (!box) throw new Error("badge has no box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(300);
		expect(await washedText()).toContain(word);
	};
	// User to assistant, then back: every slide must wash its quote.
	// The first slide on each side also proves visible paint, not
	// just registry ranges.
	await hoverBadge("user", 0, "quick brown fox", {
		article: 0,
		quote: "quick brown fox"
	});
	await hoverBadge("assistant", 0, "five dozen", {
		article: 1,
		quote: "five dozen liquor"
	});
	await hoverBadge("assistant", 1, "winter voyage");
	await hoverBadge("user", 1, "lazy dog");
	// Gapped slide across plain text: the stepped cursor crosses
	// non-badge ground between the messages, arming the shared
	// hysteresis mid-slide — the arrival must cancel it, so the
	// fresh wash survives past the clear window.
	const slideFrom = await badges("user").nth(1).boundingBox();
	const slideTo = await badges("assistant").nth(1).boundingBox();
	if (!slideFrom || !slideTo) throw new Error("slide badges have no box");
	await page.mouse.move(
		slideFrom.x + slideFrom.width / 2,
		slideFrom.y + slideFrom.height / 2
	);
	await page.mouse.move(
		slideTo.x + slideTo.width / 2,
		slideTo.y + slideTo.height / 2,
		{ steps: 12 }
	);
	await page.waitForTimeout(400);
	expect(await washedText()).toContain("winter voyage");
	// No badge node churned under the hovers.
	const probes = await page.evaluate(() =>
		[...document.querySelectorAll("button.ccez-ann-badge")].map((b) =>
			b instanceof HTMLElement ? (b.dataset.probe ?? "") : ""
		)
	);
	expect(probes).toEqual(["badge-0", "badge-1", "badge-2", "badge-3"]);
	// Hovering off clears the wash: park away past the hysteresis
	// window and the registry must hold nothing.
	await page.mouse.move(4, 4);
	await page.waitForTimeout(600);
	expect(await washedText()).toBe("");
});

/** RTL quotes wash through DOM marks, Latin through the registry: the
shell overlay paints a tight RTL registry range past its end, so the
wash must never reach the registry for those quotes. */
test("rtl quotes wash through dom marks, latin through the registry", async ({
	page
}) => {
	await seedChat(page, [
		{
			role: "assistant",
			content:
				"Tall filler so badges can scroll clear of the sticky header. ".repeat(
					60
				)
		},
		{ role: "assistant", content: "اللغة العربية من أجمل لغات العالم" },
		{ role: "assistant", content: "the quick brown fox jumps" }
	]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-annotations-v1",
			JSON.stringify({
				"e2e-chat": [
					{
						id: "ann-ar",
						messageId: "e2e-m1",
						quote: "اللغة العربية",
						comment: ""
					},
					{
						id: "ann-en",
						messageId: "e2e-m2",
						quote: "quick brown",
						comment: ""
					}
				]
			})
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	const badges = page.locator("button.ccez-ann-badge");
	await expect(badges).toHaveCount(2);
	const paint = () =>
		page.evaluate(() => {
			const reg = (
				window as unknown as {
					CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
				}
			).CSS?.highlights;
			const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
			return {
				ranges: names.flatMap((n) => [...(reg?.get(n) ?? [])]).length,
				marks: [...document.querySelectorAll("mark.ccez-ann")].map((m) =>
					(m.textContent ?? "").replace(/\d/g, "")
				)
			};
		});
	const hover = async (nth: number): Promise<void> => {
		// Center-scroll first: a top badge hides under the sticky
		// header, and the pointer would land on chrome instead. The
		// scroll glides (smooth behavior), so read the box only after
		// it settles or the pointer chases a stale position.
		await badges
			.nth(nth)
			.evaluate((b) => b.scrollIntoView({ block: "center" }));
		await page.waitForTimeout(600);
		await badges.nth(nth).hover({ timeout: 8_000 });
		await page.waitForTimeout(400);
	};
	// Arabic first in document order: its wash wraps the quote in
	// marks and never touches the registry.
	await hover(0);
	const arabic = await paint();
	expect(arabic.ranges).toBe(0);
	expect(arabic.marks.join("")).toBe("اللغة العربية");
	// Latin washes the registry way, and the Arabic marks unwrap.
	await hover(1);
	const latin = await paint();
	expect(latin.ranges).toBeGreaterThan(0);
	expect(latin.marks).toEqual([]);
});
