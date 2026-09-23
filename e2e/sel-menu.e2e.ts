import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

test.describe("desktop", () => {
	const SENTENCE = "テストを確認しました。何かお手伝いできることはありますか？";

	test.beforeEach(async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
	});

	async function selectWord(page: Page): Promise<void> {
		const body = page.locator("article .rendered").first();
		const box = await body.boundingBox();
		if (!box) throw new Error("message has no box");
		await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
		await expect(page.locator(".sel-menu")).toBeVisible();
	}

	/** The dev shell flashes a bridge-error toast on load that overlaps
	the menu: real users wait it out (8s), so the clicking tests do too. */
	async function waitForToastToFade(page: Page): Promise<void> {
		await page
			.locator(".toast")
			.waitFor({ state: "hidden", timeout: 15000 })
			.catch(() => {});
	}

	/** The menu is Annotate alone here (the Han aids stay off by
	default): the OS bubble owns Copy/Translate, and whole-message
	copy/speak live on the action rows. With the Inspect setting on,
	Only a single-Han-char highlight adds Inspect; everything else is Annotate alone. */
	test("selection menu offers Annotate alone", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu.locator("button")).toHaveCount(1);
		await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	});

	/** Annotate opens the comment pill for the quote and stands the
	menu down. */
	test("Annotate opens the pill for the quote", async ({ page }) => {
		await waitForToastToFade(page);
		await selectWord(page);
		await page.locator('.sel-menu button:has-text("Annotate")').click();
		await expect(page.locator(".ann-pop")).toBeVisible();
	});

	/** Right-click Annotate files and sends at once (the "a" key
	path): no create box, no menu flash — the badge files and the
	answer request fires. */
	test("right-click Annotate sends at once", async ({ page }) => {
		await waitForToastToFade(page);
		await selectWord(page);
		const button = page.locator('.sel-menu button:has-text("Annotate")');
		await button.click({ button: "right" });
		await expect(page.locator(".ann-pop")).toHaveCount(0);
		await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1, {
			timeout: 10_000
		});
		await expect(page.locator(".sel-menu")).toHaveCount(0);
	});

	/** Triple-click takes the sentence (never the native paragraph
	pick); quadruple-click takes the whole paragraph block. */
	test("triple-click selects the sentence", async ({ page }) => {
		await seedChat(page, [
			{
				role: "assistant",
				content: "First sentence here. Second sentence there.\n\nNext paragraph follows."
			}
		]);
		await page.goto("/");
		const para = page.locator("article .rendered p").first();
		await expect(para).toBeVisible();
		const box = await para.boundingBox();
		if (!box) throw new Error("paragraph has no box");
		await page.mouse.click(box.x + 30, box.y + 8, { clickCount: 3 });
		const picked = await page.evaluate(() =>
			window.getSelection()?.toString().trim()
		);
		expect(picked).toBe("First sentence here.");
	});

	test("quadruple-click selects the paragraph", async ({ page }) => {
		await seedChat(page, [
			{
				role: "assistant",
				content: "First sentence here. Second sentence there.\n\nNext paragraph follows."
			}
		]);
		await page.goto("/");
		const para = page.locator("article .rendered p").first();
		await expect(para).toBeVisible();
		const box = await para.boundingBox();
		if (!box) throw new Error("paragraph has no box");
		await page.mouse.click(box.x + 30, box.y + 8, { clickCount: 4 });
		const picked = await page.evaluate(() =>
			window.getSelection()?.toString().trim()
		);
		expect(picked).toBe("First sentence here. Second sentence there.");
	});

	/** A plain click on another message clears the in-flight highlight
	and drops the menu: click-away always dismisses (controls,
	composer, and message text alike — only menu presses, drags, and
	multi-click reselections keep their paths). */
	test("clicking another message clears the highlight and menu", async ({
		page
	}) => {
		await waitForToastToFade(page);
		await page.addInitScript(() => {
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: null,
						messages: [
							{
								id: "e2e-m0",
								role: "user",
								content: "alpha beta gamma delta",
								usage: null,
								error: null
							},
							{
								id: "e2e-m1",
								role: "assistant",
								content: "zeta eta theta iota",
								usage: null,
								error: null
							}
						]
					}
				])
			);
		});
		await page.reload();
		const first = page.locator("article .rendered p").first();
		const box = await first.boundingBox();
		if (!box) throw new Error("message has no box");
		await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		const quote = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(quote).not.toBe("");
		const second = page.locator("article .rendered p").nth(1);
		const box2 = await second.boundingBox();
		if (!box2) throw new Error("second message has no box");
		await page.mouse.click(box2.x + 20, box2.y + box2.height / 2);
		await expect
			.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
			.toBe("");
		await expect(menu).toBeHidden();
	});

	test("pressing Annotate stands the menu through mousedown", async ({
		page
	}) => {
		await waitForToastToFade(page);
		await selectWord(page);
		const button = page.locator('.sel-menu button:has-text("Annotate")');
		await button.hover();
		await page.mouse.down();
		// The press natively collapses the highlight; the menu must stand
		// on its stored quote past the selectionchange dismiss.
		await expect(page.locator(".sel-menu")).toBeVisible();
		await page.mouse.up();
		await expect(page.locator(".ann-pop")).toBeVisible();
	});

	/** Double-clicking CJK grabs the clicked character's word, never
	the neighbor: native double-click rounds boundaries
	engine-dependently (塔 lands や), so a point-anchored CJK pick
	replaces it — other scripts keep the native selection. */
	test("double-clicking CJK keeps the clicked character", async ({
		page
	}) => {
		await seedChat(page, [
			{
				role: "assistant",
				content: "エッフェル塔やルーブル美術館などの観光名所がたくさんあります。"
			}
		]);
		await page.goto("/");
		const body = page.locator("article .rendered").first();
		await expect(body).toBeVisible({ timeout: 60_000 });
		for (const char of ["塔", "館"]) {
			const pt = await page.evaluate((c: string) => {
				const root = document.querySelector("article .rendered");
				if (!root) return null;
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let node: Text | null = null;
				for (let n = walker.nextNode(); n; n = walker.nextNode()) {
					if (n instanceof Text && (n.textContent ?? "").includes(c)) {
						node = n;
						break;
					}
				}
				if (!node) return null;
				const i = (node.textContent ?? "").indexOf(c);
				const range = document.createRange();
				range.setStart(node, i);
				range.setEnd(node, i + 1);
				const r = range.getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			}, char);
			if (!pt) throw new Error(`no point for ${char}`);
			await page.mouse.dblclick(pt.x, pt.y);
			const picked = await page.evaluate(
				() => window.getSelection()?.toString() ?? ""
			);
			expect(
				picked,
				`double-click on ${char} picked ${JSON.stringify(picked)}`
			).toContain(char);
			await page.evaluate(() => window.getSelection()?.removeAllRanges());
		}
	});

	/** Long CJK drag selection (the reader's case): Annotate files the
	pill for a multi-line quote. */
	test("Annotate files a multi-line CJK quote", async ({ page }) => {
		const CJK =
			"读书是一种安静而深远的力量，它能带我们穿越时空，去体验不同的人生。当我们翻开一本历史书，仿佛能听到古代战场的鼓声与市井的喧哗；当我们阅读一本科幻小说，又好像置身于未来的星际之中。书中的人物常常像镜子一样，映照出我们内心的困惑与渴望。每一次深夜里的沉思，每一次在页边写下的批注，都是与作者跨越时空的对话。";
		await seedChat(page, [{ role: "assistant", content: CJK }]);
		await page.goto("/");
		const body = page.locator("article .rendered").first();
		await expect(body).toBeVisible({ timeout: 60_000 });
		const box = await body.boundingBox();
		if (!box) throw new Error("message has no box");
		await waitForToastToFade(page);
		await page.mouse.move(box.x + 40, box.y + 20);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width - 40, box.y + box.height - 20, {
			steps: 12
		});
		await page.mouse.up();
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible({ timeout: 5_000 });
		const quote = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(quote.trim().length).toBeGreaterThan(20);
		const button = page.locator('.sel-menu button:has-text("Annotate")');
		await button.hover();
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	});

	/** Hovering the menu holds it past the auto-dismiss: moving the mouse
	from the highlight to Annotate never cancels it. (The live
	highlight itself is engine-owned: WebKit empties it on menu hover,
	Chromium keeps it — the menu standing on its stored quote is the
	contract both engines keep.) */
	test("hovering the menu holds it past the timer", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		await menu.hover();
		// Past the 6s desktop idle window the hovered menu still stands.
		await page.waitForTimeout(7000);
		await expect(menu).toBeVisible();
	});

	/** Clicking away at empty space clears the highlight and drops
	the menu at once: a press-backed clear always dismisses, never
	rescues. */
	test("clicking away clears the highlight and menu", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		await page.mouse.click(10, 300);
		await expect
			.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
			.toBe("");
		await expect(menu).toBeHidden();
	});

	/** Pointer activity holds the menu without hovering it: an aimer
	steering toward Annotate never races the dismiss, and going still
	lets it expire. */
	test("pointer activity holds the menu without hovering", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		// Wiggle over the text (never the menu) past the dismiss
		// window: engagement holds it, highlight intact.
		const body = page.locator("article .rendered").first();
		const box = await body.boundingBox();
		if (!box) throw new Error("message has no box");
		for (let i = 0; i < 7; i++) {
			await page.mouse.move(box.x + 30 + (i % 2) * 60, box.y + box.height / 2);
			await page.waitForTimeout(1000);
		}
		await expect(menu).toBeVisible();
		const selected = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(selected).not.toBe("");
		// Hands off: the idle window expires and the menu stands down.
		await page.waitForTimeout(7000);
		await expect(menu).toHaveCount(0);
	});

	/** A body swap under the highlight (stream chunk, aid preview,
	late enhancement) detaches the selection anchor: the menu stands
	on its stored quote anyway, and Annotate still files the pill. */
	test("menu survives a body swap under the highlight", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		// Swap-collapse end state, deterministically: fresh nodes plus
		// a collapsed selection still anchored at a detached node.
		await page.evaluate(() => {
			const body = document.querySelector("article .rendered");
			const oldFirst = body?.firstChild ?? null;
			if (body) body.innerHTML += "";
			const sel = window.getSelection();
			if (sel && oldFirst && !document.contains(oldFirst)) {
				sel.setBaseAndExtent(oldFirst, 0, oldFirst, 0);
			}
		});
		expect(
			await page.evaluate(() => window.getSelection()?.toString() ?? "")
		).toBe("");
		await expect(menu).toBeVisible({ timeout: 5_000 });
		await page.locator('.sel-menu button:has-text("Annotate")').click();
		await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	});

	/** Sliding from the highlight to Annotate keeps the highlight and
	the menu: WebKit empties the live highlight when the pointer
	reaches the floating menu (engine behavior — no DOM change, no
	press; Chromium keeps it), so menu hover puts the stored live
	range back, and Annotate files the pill off the live selection. */
	test("sliding to Annotate keeps the highlight, menu, and pill", async ({
		page
	}) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		const button = page.locator('.sel-menu button:has-text("Annotate")');
		const btnBox = await button.boundingBox();
		if (!btnBox) throw new Error("annotate button has no box");
		// Stepped slide from the word to the button center, the way a
		// real aimer travels (fires every over/out/leave on the path).
		await page.mouse.move(
			btnBox.x + btnBox.width / 2,
			btnBox.y + btnBox.height / 2,
			{
				steps: 15
			}
		);
		const selected = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(selected).not.toBe("");
		await expect(menu).toBeVisible({ timeout: 5_000 });
		await waitForToastToFade(page);
		await page.mouse.down();
		await page.mouse.up();
		await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	});

	/** A real body swap under the highlight (Shiki late-enhance, aid
	rebuild, stream chunk) collapses the selection onto the ATTACHED
	container — empty, collapsed, contained. The menu must stand on
	its stored quote anyway, and Annotate still files the pill. */
	test("menu survives a real body swap under the highlight", async ({
		page
	}) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		// Same content, new nodes: what production swaps actually do.
		await page.evaluate(() => {
			const body = document.querySelector("article .rendered");
			// Same markup, fresh nodes (not a self-assign): what
			// production swaps actually do under a live highlight.
			if (body) {
				const html = body.innerHTML;
				body.innerHTML = html;
			}
		});
		const after = await page.evaluate(() => {
			const sel = window.getSelection();
			return {
				text: sel?.toString() ?? "",
				attached: !!sel?.anchorNode && document.contains(sel.anchorNode)
			};
		});
		// The production collapse shape (NOT the detached anchor the
		// older test fabricates).
		expect(after.text).toBe("");
		expect(after.attached).toBe(true);
		await expect(menu).toBeVisible({ timeout: 5_000 });
		await waitForToastToFade(page);
		await page.locator('.sel-menu button:has-text("Annotate")').click();
		await expect(page.locator(".ann-pop")).toBeVisible({ timeout: 5_000 });
	});

	/** The menu sits just above the cursor that finished the gesture
	(never below it), left-shifted and clamped to the viewport. */
	test("menu sits just above the cursor", async ({ page }) => {
		const body = page.locator("article .rendered").first();
		const box = await body.boundingBox();
		if (!box) throw new Error("message has no box");
		const cx = box.x + 20;
		const cy = box.y + box.height / 2;
		await page.mouse.dblclick(cx, cy);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		const menuBox = await menu.boundingBox();
		if (!menuBox) throw new Error("menu has no box");
		const viewport = await page.evaluate(() => window.innerWidth);
		// Left edge sits left of the cursor (was clamped exactly to it).
		expect(menuBox.x).toBeLessThan(cx);
		// Bottom edge hugs the cursor from above: a short trip up.
		expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(cy);
		expect(cy - (menuBox.y + menuBox.height)).toBeLessThan(70);
		// Viewport clamping holds on both edges.
		expect(menuBox.x).toBeGreaterThanOrEqual(0);
		expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport);
	});

	/** Near the right edge the menu keeps its right edge on screen
and stays a short trip from the cursor — the clamp follows the
menu's own width, never a phantom box that strands it left. A
short user bubble docks hard right, so its last word truly ends
near the viewport edge at a narrow width. */
	test("menu near the right edge stays under the cursor", async ({ page }) => {
		await page.setViewportSize({ width: 500, height: 800 });
		await seedChat(page, [{ role: "user", content: "alpha beta gamma delta" }]);
		await page.goto("/");
		const body = page.locator("article.user .rendered").first();
		await expect(body).toBeVisible();
		const box = await body.boundingBox();
		if (!box) throw new Error("message has no box");
		const cx = box.x + box.width - 10;
		const cy = box.y + box.height / 2;
		await page.mouse.dblclick(cx, cy);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		const menuBox = await menu.boundingBox();
		if (!menuBox) throw new Error("menu has no box");
		const viewport = await page.evaluate(() => window.innerWidth);
		expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport);
		// A short trip: the button sits just left of the cursor.
		expect(cx - menuBox.x).toBeLessThan(200);
	});

	/** Bare Escape drops the highlight with the menu (click-away
	parity): audio stops through the same ladder, and editor or
	field selections are another gesture's business. */
	test("escape clears the highlight and menu", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		await page.keyboard.press("Escape");
		await expect
			.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
			.toBe("");
		await expect(menu).toBeHidden();
	});

	/** A press-less selection clear never costs the menu: the engine
(emptying the highlight while the pointer cruises other messages)
puts nothing behind the clear, so the menu stands on its stored
range and the highlight comes back. Presses, keys, and
programmatic clears still dismiss (pinned by the tests around). */
	test("menu survives a press-less selection clear", async ({ page }) => {
		await selectWord(page);
		const menu = page.locator(".sel-menu");
		// Outlast the hover-change restore window: only the
		// press/key/programmatic stamps stand the menu down now.
		await page.waitForTimeout(600);
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		await expect
			.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
			.not.toBe("");
		await expect(menu).toBeVisible();
	});

	/** Right-clicking empty space never starts audio: nothing speaks and nothing selects. */
	test("right-click on empty space stays silent", async ({ page }) => {
		await page.mouse.click(10, 300, { button: "right" });
		await page.waitForTimeout(500);
		await expect(
			page.locator("article.speaking, article.speaking-sel")
		).toHaveCount(0);
		const selected = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(selected).toBe("");
	});

	/** Bullet markers never enter the highlight: ::marker is a
	pseudo-element outside the DOM, so native selection (which the
	annotation quote reads) skips it — no annotation-side carve-out. */
	test("list-item selection excludes the bullet marker", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "- alpha item\n- beta item" }
		]);
		await page.goto("/");
		const item = page.locator("article .rendered li").first();
		await expect(item).toBeVisible({ timeout: 60_000 });
		const box = await item.boundingBox();
		if (!box) throw new Error("list item has no box");
		// Start left of the text, over the marker gutter, drag mid-item.
		await page.mouse.move(box.x - 12, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, {
			steps: 5
		});
		await page.mouse.up();
		const selected = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(selected).toContain("alpha");
		expect(selected).not.toContain("•");
	});

	/** Dragging across messages keeps the anchor message's quote: the
	gesture never spans articles (WebKit re-anchors a drag into the
	next message with no selectionchange the trim can see), so the
	highlight freezes at the anchor's edge and the menu quotes it —
	never the message dragged into. Integer coords throughout
	(fractional ones birth dead drags in the harness); the start row
	retries past line boundaries, which also birth dead drags. */
	test("cross-message drag keeps the anchor message's quote", async ({
		page
	}) => {
		const M1 =
			"The quick brown fox jumps over the lazy dog near the riverbank.";
		const M2 = "The five boxing wizards jump quickly past the quiet village.";
		await seedChat(page, [
			{ role: "assistant", content: M1 },
			{ role: "assistant", content: M2 }
		]);
		await page.goto("/");
		const first = page.locator("article .rendered").first();
		await expect(first).toBeVisible({ timeout: 60_000 });
		// Living start: probe rows until one grows.
		let start: { x: number; y: number } | null = null;
		for (const frac of [0.3, 0.55, 0.75]) {
			const g = await first.boundingBox();
			if (!g) throw new Error("message has no box");
			const x = Math.round(g.x + 30);
			const y = Math.round(g.y + g.height * frac);
			await page.mouse.move(x, y);
			await page.mouse.down();
			await page.mouse.move(x, y + 14, { steps: 3 });
			const len = await page.evaluate(
				() => window.getSelection()?.toString().length ?? 0
			);
			if (len > 0) {
				start = { x, y };
				break;
			}
			await page.mouse.up();
			await page.evaluate(() => window.getSelection()?.removeAllRanges());
		}
		if (!start) throw new Error("no living drag start");
		const second = page.locator("article .rendered").nth(1);
		const box2 = await second.boundingBox();
		if (!box2) throw new Error("second message has no box");
		// Drag well into the second message, then release there.
		const releaseY = Math.round(box2.y + box2.height / 2);
		await page.mouse.move(start.x, releaseY, { steps: 12 });
		await page.mouse.up();
		const quote = await page.evaluate(
			() => window.getSelection()?.toString() ?? ""
		);
		expect(quote).not.toBe("");
		expect(quote).not.toContain("wizards");
		const flat = (s: string): string => s.replace(/\s+/g, " ").trim();
		expect(flat(M1)).toContain(flat(quote).slice(0, 30));
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		// The menu docks to the quoted highlight, not the release
		// point down in the second message: its bottom edge stays a
		// full message above the release (viewport-top clamping can
		// overlap it onto the highlight, never down at the cursor).
		const menuBox = await menu.boundingBox();
		if (!menuBox) throw new Error("menu has no box");
		expect(menuBox.y + menuBox.height).toBeLessThan(releaseY - 20);
	});
});

test.describe("ios", () => {
	// iPhone 15 shape without defaultBrowserType (describe-level
	// test.use cannot switch engines): Chromium with the iPhone UA,
	// viewport, and touch. The dock/tap assertions are UA- and
	// touch-driven, not engine-driven.
	test.use({
		userAgent:
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1",
		viewport: { width: 393, height: 659 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true
	});

	/** iOS selection dock: the Annotate control lives in the composer
	tools while a highlight is up — no floating menu over the text (the
	native callout owns that space), so nothing fights it or the thumb. */
	test("ios docks Annotate in the composer, nothing floating", async ({
		page
	}) => {
		const filler =
			"秋が近づくと空が高くなり紅葉が美しく色づきます温かいお茶を飲みながらゆっくりと読書をしたり散歩を楽しんだりするのにぴったりの季節です";
		await seedChat(page, [
			{ role: "user", content: "first" },
			{ role: "assistant", content: filler },
			{ role: "assistant", content: "漢字を読む" },
			{ role: "assistant", content: filler },
			{ role: "assistant", content: filler }
		]);
		await page.goto("/");
		await expect(page.locator("article .rendered").nth(2)).toBeVisible({
			timeout: 60_000
		});
		await expect
			.poll(
				async () =>
					page.evaluate(() => {
						const app = document.querySelector(".app");
						if (!app?.hasAttribute("data-ios")) return "no-flag";
						// Message text itself must keep the callout (Apple's
						// bubble owns the slot): read the computed value
						// off a rendered message, so the pinyin ruby rule
						// (annotations only) can't trip the check.
						const rendered = document.querySelector("article .rendered");
						if (!rendered) return "no-render";
						const value = getComputedStyle(rendered)
							.getPropertyValue("-webkit-touch-callout")
							.trim();
						return value === "none" ? "suppressed" : "ok";
					}),
				{ timeout: 30_000 }
			)
			.toBe("ok");
		// A word pick summons the Annotate-only menu above the highlight.
		// Touch emulation performs no native word pick, so the highlight
		// is set programmatically and the same window dblclick summons it.
		const picked = await page.evaluate(() => {
			const roots = document.querySelectorAll("article .rendered");
			const root = roots[2];
			if (!root) return null;
			if (!root) return null;
			// Mid-viewport, so the menu takes its usual above slot (the
			// list scrolls smooth, so jump instantly before measuring).
			root.scrollIntoView({ block: "center", behavior: "instant" });
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			let target: Text | null = null;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (
					node instanceof Text &&
					(node.textContent ?? "").trim().length >= 4
				) {
					target = node;
					break;
				}
			}
			if (!target) return null;
			const text = target.textContent ?? "";
			const start = text.search(/\S/);
			const range = document.createRange();
			range.setStart(target, start < 0 ? 0 : start);
			range.setEnd(target, (start < 0 ? 0 : start) + 2);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
			const r = range.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		if (!picked) throw new Error("no word to highlight");
		// Dispatch on the prose element itself: the selection's midpoint
		// can sit under an overlay button, which the click guards (rightly)
		// reject. Coordinates still ride along for menu docking.
		await page.evaluate(({ x, y }) => {
			const el = document.querySelectorAll("article .rendered")[2];
			el?.dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y })
			);
		}, picked);
		// No floating menu on iOS: the docked composer button stands in.
		await expect(page.locator(".sel-menu")).toHaveCount(0);
		const dock = page.locator(".prompt-tools .ann-dock");
		await expect(dock).toBeVisible();
		await expect(dock).toHaveText("Annotate");
		// The dock files the annotation through the composer, never a
		// floating box (its textbox can't summon the phone keyboard):
		// the composer takes the note in an empty box with no staged
		// placeholder (the highlighted quote above it is the prompt).
		await dock.click();
		const composer = page.locator(".prompt textarea");
		await expect(composer).toHaveValue("");
		await expect(composer).not.toHaveAttribute("placeholder", "Add an annotation");
		await composer.click();
		await page.keyboard.type("nice point", { delay: 10 });
		await page.locator(".send-btn").click();
		await expect(page.locator(".toast")).toHaveText("Annotation saved");
		await expect(page.locator("button.ccez-ann-badge").first()).toBeVisible();
	});

	/** The dock holds past its timer while the highlight lives: on iOS it
	tracks the native bubble, not the clock (collapsing the selection
	still clears it at once). */
	test("ios dock holds while the highlight lives", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "漢字を読むテストです" }
		]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
		await page.locator("article .rendered").first().selectText();
		await page.mouse.up();
		const dock = page.locator(".prompt-tools .ann-dock");
		await expect(dock).toBeVisible();
		// Past the 4.5s touch timer with the highlight still live.
		await page.waitForTimeout(6000);
		await expect(dock).toBeVisible();
	});

	/** Tapping an annotation's marker opens the dock on its row: the
	tap's compatibility mousedown opens it, and the trailing
	compatibility click must not toggle it straight back shut
	(desktop Chrome eats that click via mousedown's preventDefault;
	iOS Safari fires it). Filed notes never edit — phones and
	desktop alike open the row; questions ask through the staged
	pill, never a floating card or composer transplant. */
	test("tapping a badge opens its dock row", async ({ page }) => {
		await seedChat(page, [
			{ role: "assistant", content: "漢字を読むテストです" }
		]);
		// Slow the mock answer: the tap must land while the badge
		// is still waiting (blue), so it opens the review — never
		// the answer card.
		await page.addInitScript(() => {
			window.localStorage.setItem("ccez-mock-chat-ms", "15000");
		});
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible({
			timeout: 60_000
		});
		// File an annotation through the composer's docked button
		// (empty box, no staged placeholder — the highlight above
		// is the prompt).
		await page.locator("article .rendered").first().selectText();
		await page.mouse.up();
		await page.locator(".prompt-tools .ann-dock").click();
		const composer = page.locator(".prompt textarea");
		await expect(composer).toHaveValue("");
		await expect(composer).not.toHaveAttribute("placeholder", "Add an annotation");
		await composer.click();
		await page.keyboard.type("go", { delay: 10 });
		await page.locator(".send-btn").click();
		await expect(page.locator(".toast")).toHaveText("Annotation saved");
		const badge = page.locator("button.ccez-ann-badge").first();
		await expect(badge).toHaveCount(1);
		// The iOS Safari tap sequence, dispatched verbatim: touch events
		// plus the compatibility mouse events Safari sends after them.
		// Unlike desktop Chrome, Safari fires the click even though the
		// badge's mousedown preventDefaults — touchscreen.tap can't show
		// that (Chromium suppresses it either way), so the sequence below
		// is the regression, not the tap helper.
		await badge.evaluate((el) => {
			const r = el.getBoundingClientRect();
			const x = r.x + r.width / 2;
			const y = r.y + r.height / 2;
			const at = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: x,
				clientY: y
			};
			// No Touch objects: the Touch constructor is unavailable under
			// iPhone emulation, and explicit empty touch lists throw there
			// too — so the lists are omitted (defaulting empty). That
			// no-ops the app's swipe tracking (no stroke, no fold) exactly
			// like a real tap with no movement does; the regression lives
			// in the mouse events below.
			el.dispatchEvent(new TouchEvent("touchstart", { ...at }));
			el.dispatchEvent(new TouchEvent("touchend", { ...at }));
			el.dispatchEvent(new MouseEvent("mousedown", { ...at, button: 0 }));
			el.dispatchEvent(new MouseEvent("mouseup", { ...at, button: 0 }));
			el.dispatchEvent(new MouseEvent("click", { ...at, button: 0 }));
		});
		// The trailing click must not toggle the dock straight back
		// shut: the review stays open on the tapped row afterwards,
		// and the composer never transplants the filed note.
		await expect(page.locator(".ann-wrap .review")).toHaveCSS(
			"opacity",
			"1"
		);
		await expect(page.locator(".review-item.highlight")).toBeVisible();
		await expect(composer).not.toHaveAttribute(
			"placeholder",
			"Edit annotation"
		);
		await page.waitForTimeout(400);
		await expect(page.locator(".ann-wrap .review")).toHaveCSS(
			"opacity",
			"1"
		);
	});
});
