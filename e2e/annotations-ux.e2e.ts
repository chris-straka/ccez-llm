import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

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
 * 6. dock Unpin animates symmetrically, and pinned chips ride
 *    token surfaces (filed notes never edit in an overlay);
 * 7. off-chat drags never highlight above the cursor's current line.
 */

test("review dock respects its width cap at 200% type", async ({
	page
}) => {
	const sentence =
		"Kyoto is an old capital with many temples near the riverbank.";
	await seedChat(page, [
		{ role: "assistant", content: sentence },
		{ role: "assistant", content: sentence },
		{ role: "assistant", content: sentence }
	]);
	await page.addInitScript(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...prev, fontScale: 2 })
		);
	});
	await page.goto("/");
	// The middle message: badges at either chrome edge take no hits.
	const body = page.locator("article.assistant .rendered").nth(1);
	await expect(body).toBeVisible({ timeout: 60_000 });
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.click(box.x + 10, y);
	await page.mouse.move(box.x + box.width - 2, y);
	await page.mouse.down();
	await page.evaluate(() => {
		const text = document.querySelectorAll("article.assistant .rendered p")[1]
			?.firstChild;
		if (!(text instanceof Text)) throw new Error("no message text");
		window.getSelection()?.setBaseAndExtent(text, 0, text, 5);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	const pop = page.locator(".ann-pop");
	await expect(pop).toBeVisible();
	// The create box is the fixed 19rem fresh pill; file a note and
	// open the dock to measure it (filed notes never open edit
	// cards anymore — the dock is the overlay that must cap).
	await pop.locator("textarea").fill("riverbank note");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await expect(pop).toHaveCount(0, { timeout: 5_000 });
	// The dock lists pinned rows only: wait for the answer,
	// pin the badge (double-click), then open the dock.
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toHaveCount(1, { timeout: 30_000 });
	await page.locator("button.ccez-ann-badge").nth(0).dblclick();
	await page.keyboard.press("Escape");
	await page.locator(".prompt-tools .ann-pill").click();
	const card = page.locator(".ann-wrap .review");
	await expect(card).toHaveCSS("opacity", "1");
	// Content-sized up to its cap: 30rem (480px) plus borders.
	const width = await card.evaluate((el) => el.getBoundingClientRect().width);
	expect(width).toBeLessThanOrEqual(482);
	expect(width).toBeGreaterThan(200);
});

test("desktop right-click never opens the native menu", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "hello world from Kyoto" }
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const suppressed = await body.evaluate((el) => {
		const event = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true
		});
		el.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(suppressed).toBe(true);
	// Editable fields keep theirs (spellcheck, copy/paste).
	const kept = await page.locator(".prompt .ta-input").evaluate((el) => {
		const event = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true
		});
		el.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(kept).toBe(false);
});

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
	// The filed quote is the whole words, never the cut fragment
	// (the dock lists pinned rows only, so wait for the answer
	// and pin first — keyboard, never pointer: the badge sits
	// under the sticky header).
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toHaveCount(1, { timeout: 30_000 });
	const midBadge = page.locator("button.ccez-ann-badge").nth(0);
	await midBadge.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await page.locator(".prompt-tools .ann-wrap").hover();
	await expect(page.locator(".prompt-tools .review-quote").first()).toHaveText(
		/hello world/
	);
});

test("create box centers over narrow highlights, wide ones clamp to the viewport", async ({
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
		// wash range it painted instead (Highlight API: no DOM marks) —
		// under any graded ramp name mid-fade, so union all three.
		const reg = (
			window as unknown as {
				CSS?: { highlights?: { get(name: string): Set<Range> | undefined } };
			}
		).CSS?.highlights;
		const names = ["ccez-ann", "ccez-ann-d1", "ccez-ann-d2", "ccez-ann-d3"];
		const ranges = names.flatMap((n) => [...(reg?.get(n) ?? [])]);
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

	// Wide: dragging the whole paragraph opens the 90%-column
	// pill below the highlight, clamped inside the viewport —
	// never hugging the selection end, never covering the word.
	const wide = await para.boundingBox();
	if (!wide) throw new Error("message lost its box");
	const wideY = wide.y + wide.height / 2;
	await page.mouse.move(wide.x + 10, wideY);
	await page.mouse.down();
	await page.mouse.move(wide.x + wide.width - 10, wideY, { steps: 8 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	// The highlight's own bottom (element boxes carry a stray
	// leading pixel the text never paints).
	const hlBottom = await page.evaluate(
		() =>
			window.getSelection()?.rangeCount
				? window.getSelection()!.getRangeAt(0).getBoundingClientRect().bottom
				: null
	);
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(pop).toBeVisible();
	const wideBox = await pop.boundingBox();
	if (!wideBox) throw new Error("missing wide box");
	const vw = page.viewportSize()?.width ?? 1280;
	expect(wideBox.x).toBeGreaterThanOrEqual(8);
	expect(wideBox.x + wideBox.width).toBeLessThanOrEqual(vw - 8);
	if (hlBottom !== null) expect(wideBox.y).toBeGreaterThanOrEqual(hlBottom);
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

/** The creation pill and its Annotate button track the text size: a
fixed 19rem pill next to huge type is unreadable. */
test("creation pill and Annotate button scale with font size", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	const menuBtn = page.locator('.sel-menu button:has-text("Annotate")');
	await expect(menuBtn).toBeVisible();
	const btnSmall = await menuBtn.evaluate((el) => getComputedStyle(el).fontSize);
	await page.evaluate(() => {
		document.querySelector(".app")?.setAttribute("style", "--font-scale: 2");
	});
	const btnBig = await menuBtn.evaluate((el) => getComputedStyle(el).fontSize);
	expect(parseFloat(btnBig)).toBeGreaterThan(parseFloat(btnSmall));
	await menuBtn.click();
	const pop = page.locator(".ann-pop.fresh");
	await expect(pop).toBeVisible({ timeout: 10_000 });
	const area = pop.locator("textarea");
	const areaSize = await area.evaluate((el) => getComputedStyle(el).fontSize);
	expect(parseFloat(areaSize)).toBeGreaterThan(parseFloat(btnSmall));
	const pillBox = await pop.boundingBox();
	if (!pillBox) throw new Error("fresh pill has no box");
	// 90% of the chat column (the rem-cap era is over): read the
	// live --chat-width var with the CSS fallback (36), never a
	// fixed pixel number.
	const expected = await page.evaluate(() => {
		const raw = getComputedStyle(
			document.querySelector(".app")!
		).getPropertyValue("--chat-width");
		const rem = parseFloat(raw);
		return (Number.isFinite(rem) && rem > 0 ? rem : 36) * 16 * 0.9;
	});
	expect(Math.abs(pillBox.width - expected)).toBeLessThanOrEqual(4);
});

/** The sent card spans the message (not a 24rem strip) at twice
the old height cap. */
test("sent card spans the message at twice the height cap", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "First filler message." },
		{ role: "assistant", content: "Second filler message." },
		{
			role: "assistant",
			content:
				'Alpha beta gamma delta.\n\nAnnotated selections:\n1. "beta" — note'
		}
	]);
	await page.goto("/");
	// The count floats above its message: take the last article so
	// scrolling can clear it of the sticky app header (a lone first
	// message sits under the header with nowhere to scroll).
	const article = page.locator("article.assistant").last();
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.locator(".ann-refs-pill").click();
	const pop = article.locator(".ann-refs-pop");
	await expect(pop).toHaveCSS("opacity", "1");
	const sizes = await page.evaluate(() => {
		const articles = document.querySelectorAll("article.assistant");
		const a = articles[articles.length - 1];
		const p = a?.querySelector(".ann-refs-pop");
		if (!a || !p) return null;
		return {
			article: a.getBoundingClientRect().width,
			pop: p.getBoundingClientRect().width
		};
	});
	if (!sizes) throw new Error("missing boxes");
	expect(sizes.pop).toBeGreaterThan(sizes.article - 40);
	const maxH = await pop.evaluate((el) => getComputedStyle(el).maxHeight);
	expect(parseFloat(maxH)).toBeGreaterThan(384);
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
	// Unpinned annotations never reach the send: wait for the
	// answer and pin (keyboard — the badge sits under the sticky
	// header), so the empty prompt carries it.
	await expect(
		page.locator("button.ccez-ann-badge.ans-ready")
	).toHaveCount(1, { timeout: 30_000 });
	const emptyBadge = page.locator("button.ccez-ann-badge").nth(0);
	await emptyBadge.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	await page.keyboard.press("Escape");
	await expect(page.locator(".prompt-tools .ann-wrap")).toBeVisible();
	// Send the empty prompt with the annotation attached (mock provider).
	await page.locator(".ta-input").click();
	await page.keyboard.press("Enter");
	const user = page.locator("article.user").first();
	await expect(user).toBeVisible();
	// The card is click-toggled (hover never opens it): prove the
	// toggle genuinely opened it via its opacity transition.
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

test("badge tap opens the dock on its row, never an edit", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "alpha beta gamma delta" }
	]);
	// Slow the mock answer: the tap must land while the badge is
	// still waiting (blue), so it opens the dock row — never an
	// answer card.
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-chat-ms", "15000");
	});
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.type("first");
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toBeVisible({ timeout: 15_000 });
	// The thread sits top-scrolled under the sticky header, which
	// intercepts pointer events over the badge: keyboard-activate
	// instead (buttons act on Enter without hit-testing).
	await badge.focus();
	await page.keyboard.press("Enter");
	// The dock opens on this row — no floating edit card, no
	// composer transplant, the saved comment stands.
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	await expect(page.locator(".review-item.highlight")).toBeVisible();
	await expect(page.locator(".review-comment").first()).toHaveText("first");
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input")).not.toHaveAttribute(
		"placeholder",
		"Edit annotation"
	);
	// Re-tap keeps the dock on the row (idempotent, never a toggle).
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	await expect(page.locator(".review-item.highlight")).toBeVisible();
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

/** Badge hover moves no DOM nodes: the wash paints through the
Highlight registry, so the hovered marker keeps its node (and its
:hover) while every other marker sits still. */
test("badge hover moves no DOM nodes", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "hello world from Kyoto" }
	]);
	await page.goto("/");
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	// Word-pick "world", file it, submit.
	await page.evaluate(() => {
		const text = document.querySelector(
			"article.assistant .rendered p"
		)?.firstChild;
		if (!(text instanceof Text)) throw new Error("no message text");
		window.getSelection()?.setBaseAndExtent(text, 6, text, 11);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toHaveCount(1, { timeout: 10_000 });
	await page.evaluate(() => {
		(window as unknown as { __badge?: Element | null }).__badge =
			document.querySelector("button.ccez-ann-badge");
	});
	// A synthetic mouseover (a real hover can't land: the scroller
	// parks the badge under the sticky header, which eats the
	// pointer). The wash path is identical — onBadgeOver reads the
	// bubbled target, not :hover state.
	await badge.evaluate((el) =>
		el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
	);
	await page.waitForTimeout(300);
	const state = await page.evaluate(() => ({
		same:
			document.querySelector("button.ccez-ann-badge") ===
			(window as unknown as { __badge?: Element | null }).__badge,
		marks: document.querySelectorAll("mark.ccez-ann").length,
		washed:
			(
				window as unknown as {
					CSS?: { highlights?: { has(n: string): boolean } };
				}
			).CSS?.highlights?.has("ccez-ann") ?? false
	}));
	// Same button node (no remove + re-append), no DOM wash marks, and
	// the registry wash actually painted.
	expect(state.same).toBe(true);
	expect(state.marks).toBe(0);
	expect(state.washed).toBe(true);
});
