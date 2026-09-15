import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

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
	else if (count === 2) await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	else await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: count });
}

/** Spaceless scripts have no words to pick: double-click keeps the
native fragment (and still summons the menu). */
test("double-click in Japanese keeps the word pick", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テスト");
});

/** Triple-click keeps native behavior: the whole paragraph is picked. */
test("triple-click in Japanese selects the paragraph", async ({ page }) => {
	await clickText(page, 3);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
});

/** The paragraph pick holds wherever in it the triple-click lands. */
test("triple-click on the second sentence selects the paragraph", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, { clickCount: 3 });
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
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
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
	const btn = menu.locator('button:has-text("Annotate")');
	const btnBox = await btn.boundingBox();
	if (!btnBox) throw new Error("annotate button has no box");
	await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2, { steps: 6 });
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
test("clicking blank space deselects instead of reopening the menu", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	// Past the 6s idle window with no pointer activity: expired.
	await page.waitForTimeout(7000);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(10, 300);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
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
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
});

/** Clicking inside a live highlight clears the highlight AND the menu —
neither strands the other. */
test("clicking inside the highlight clears it with the menu", async ({ page }) => {
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
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Clicking a stale highlight (menu already faded) clears it without
re-summoning the menu. */
test("clicking a stale highlight never brings the menu back", async ({ page }) => {
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
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Four clicks: the paragraph pick comes off again and the menu goes
with it instead of stranding. */
test("fourth click clears the paragraph pick and the menu", async ({ page }) => {
	await clickText(page, 4);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Repeats anchor where selected: annotating the second "a" in
"a a" stamps the badge on the second "a", not the first. A
single-character word keeps the range on word edges, so the
create marker's word-snap (which intentionally expands mid-word
cuts like the last "c" of "ccc" to the whole word) leaves it
alone and the repeat disambiguation is what gets exercised. */
test("annotating a repeated character anchors the selected repeat", async ({ page }) => {
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
	expect(offset).toBe(2);
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
		const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
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
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	const pill = page.locator("article.user .ann-refs-pill");
	await expect(pill).toHaveText("1");
	await pill.click();
	const card = page.locator("article.user .ann-refs-pop");
	await expect(card).toHaveCSS("opacity", "1");
	const inside = await page.evaluate(() => {
		const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
		const c = rect("article.user .ann-refs-pop");
		const p = rect("article.user .ann-refs-pill");
		if (!c || !p) return null;
		const cx = p.x + p.width / 2;
		const cy = p.y + p.height / 2;
		return cx >= c.x && cx <= c.x + c.width && cy >= c.y && cy <= c.y + c.height;
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
	await page.locator(`article .rendered:has-text("${quote}")`).first().selectText();
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
});

/** Escape closes the badge edit box without writing. */
test("escape closes the badge edit without saving", async ({ page }) => {
	await openAnnotate(page, "確認しました");
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
	const sizes = await box.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
	expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
});

/** A grown create-box rounds its corners less: the fresh pill starts
as a 999px capsule, which reads over-rounded once it grows tall. */
test("grown comment box rounds its corners less", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	const pop = page.locator(".ann-pop");
	await expect(pop).not.toHaveClass(/tall/);
	await expect(pop).toHaveCSS("border-radius", "999px");
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
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
});

/** Re-pressing the open badge closes its edit menu like cancel. */
test("badge re-press closes the edit menu", async ({ page }) => {
	await openAnnotate(page, "確認しました");
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
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});

/** Saving the badge edit writes the new comment back to the annotation. */
test("badge save files the edited comment", async ({ page }) => {
	await openAnnotate(page, "確認しました");
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
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	await badge.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator(".ann-pop")).toBeVisible();
	await expect(page.locator(".ann-pop textarea")).toHaveValue("typed");
});

/** Cancel drops the badge edit without touching the saved comment. */
test("badge cancel drops the edit", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.locator(".ann-pop textarea").fill("kept");
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.locator(".ann-pop textarea").fill("scratch");
	await page.locator(".ann-pop .ann-cancel").click();
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	const reopened = await badge.boundingBox();
	if (!reopened) throw new Error("badge has no box");
	await page.mouse.click(reopened.x + reopened.width / 2, reopened.y + reopened.height / 2);
	await expect(page.locator(".ann-pop textarea")).toHaveValue("kept");
});

/** The review popup shows quotes with note: labels, no Selected text. */
test("review popup uses note labels", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	// File without sending: a send bakes annotations into the outgoing
	// message and clears the live list, leaving no pill to hover.
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	const review = page.locator(".prompt-tools .review");
	await expect(review).toContainText("note:");
	await expect(review).not.toContainText("Selected text");
	await expect(review).not.toContainText("User comment");
});

/** An annotations-only message renders unfolded (em-dash plus the count)
and folds to its quotes previewed on demand. */
test("annotations-only message renders folded", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content: 'Annotated selections:\n1. "風に舞う" — What does this mean?\n2. "夕暮れの公園で" — What does this mean?'
		}
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".ann-refs-pill")).toBeVisible();
	// Folding previews the quotes; unfolding restores the em-dash body
	// with the pill above — the baked block never shows.
	await article.locator('.actions button[aria-label="Fold this message"]').click();
	const preview = article.locator(".folded-preview");
	await expect(preview).toContainText("風に舞う");
	await article.locator('.actions button[aria-label="Unfold this message"]').click();
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".rendered")).not.toContainText("Annotated selections:");
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
			page.locator(`article.${role} .actions [aria-label="Download audio for this message"]`)
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
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	// The Enter that filed the annotation must not double as a send.
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	// The pill leaves with the send, not with the reply.
	await expect(page.locator("article.user .rendered")).toContainText("go");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await expect(page.locator("article.assistant .rendered").last()).toContainText("Mock reply");
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
	await article.locator('.actions button[aria-label="Edit this message"]').click();
	// Nothing is deleted; the text opens in an in-place editor where the
	// message sat (the composer keeps its own empty draft).
	const inline = page.locator(".msg-edit .cm-content");
	await expect(inline).toContainText("helo world");
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator(".prompt .cm-content")).not.toContainText("helo world");
	// Fix the typo and save: the message rewrites in place, nothing
	// resends — the old reply stands untouched.
	await inline.click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello world");
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator("article.assistant .rendered")).toContainText("hi");
	await expect(page.locator(".sending")).toHaveCount(0);
});

/** The in-place edit keeps syntax colors: fenced code highlights. */
test("in-place edit keeps code highlighting", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "```python\nprint('hi')\n```" }]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await article.locator('.actions button[aria-label="Edit this message"]').click();
	const inline = page.locator(".msg-edit .cm-content");
	await expect(inline).toContainText("print");
	// Highlighting is active: markdown decorates fence markers and code
	// tokens with styled spans (plain text renders as bare text nodes).
	await expect(inline.locator(".cm-line span").first()).toBeVisible();
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
	await expect(page.locator(".msg-edit .cm-content")).toContainText("helo world");
	// Esc cancels: history untouched, the inline editor unmounts, the
	// composer stays empty.
	await page.keyboard.press("Escape");
	await expect(page.locator(".msg-edit")).toHaveCount(0);
	await expect(page.locator(".prompt .cm-content")).not.toContainText("helo world");
	await expect(page.locator("article.user .rendered")).toContainText("helo world");
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
	expect(reviewBox.x + reviewBox.width - (toolsBox.x + toolsBox.width)).toBeLessThan(40);
	await tools.locator("button").click();
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Multi-paragraph quotes wash without painting the paragraph gaps: no
whitespace-only marks, no layout growth while the wash is on, and a
live highlight survives hovering the badge on and off. */
test("multi-paragraph wash paints no gaps and keeps the highlight", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here." }
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
					if (parent instanceof Element && parent.closest("[data-ann-badge]")) continue;
					if (node instanceof Text && /\S/.test(node.textContent ?? "")) texts.push(node);
				}
				const first = texts[0];
				const last = texts[texts.length - 1];
				if (!first || !last || a === undefined || b === undefined) throw new Error("no text");
				window.getSelection()?.setBaseAndExtent(first, a, last, b);
				return window.getSelection()?.toString() ?? "";
			},
			[from, to] as [number, number]
		);
	expect(await selectAcross(6, 5)).toBe("paragraph here.\n\nSecond paragraph here.\n\nThird");
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
			const marks = [...(root?.querySelectorAll("mark.ccez-ann") ?? [])].map((m) => m.textContent);
			const box = root?.querySelector("button.ccez-ann-badge")?.getBoundingClientRect();
			return {
				blankMarks: marks.filter((text) => !/\S/.test(text ?? "")).length,
				badgeY: box ? Math.round(box.y) : -1,
				height: root?.getBoundingClientRect().height
			};
		});
	const washed = await snapshot();
	expect(washed.blankMarks).toBe(0);
	// A live highlight inside the washed region survives hover on/off.
	// (The preview wash split the paragraphs at the first selection's
	// edges, so re-anchor by content, not by node order.)
	const reselected = await page.evaluate(() => {
		const texts: Text[] = [];
		const walker = document.createTreeWalker(
			document.querySelector("article .rendered"),
			NodeFilter.SHOW_TEXT
		);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text && node.textContent === "paragraph here.") texts.push(node);
		}
		const target = texts[0];
		if (!target) throw new Error("no target");
		window.getSelection()?.setBaseAndExtent(target, 0, target, 9);
		return window.getSelection()?.toString() ?? "";
	});
	expect(reselected).toBe("paragraph");
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(300);
	const hovered = await snapshot();
	expect(hovered.blankMarks).toBe(0);
	expect(hovered.height).toBe(washed.height);
	expect(hovered.badgeY).toBe(washed.badgeY);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("paragraph");
	await page.mouse.move(4, 4);
	await page.waitForTimeout(400);
	const left = await snapshot();
	expect(left.height).toBe(washed.height);
	expect(left.badgeY).toBe(washed.badgeY);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("paragraph");
});

/** RTL paragraphs lay out right-to-left (dir=auto), so a top-right to
bottom drag starts at the text's start instead of mid-text. */
test("rtl drag from the top-right selects the whole paragraph", async ({ page }) => {
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
	const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	// Was 47 of 162 before per-block direction: the first sentence dropped.
	expect(sel.length).toBeGreaterThan(150);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Saving a bullet-spanning annotation with Enter leaves no native
highlight behind: the quote keeps its badge and wash, but the
selection itself is gone. */
test("annotating bullets and saving with Enter clears the highlight", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Points:\n\n- 越えた (koeta) = crossed\n- 友情 (yujo) = friendship" }
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
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
	// The save itself worked: one badge stamped on the quote, and the
	// steady state carries no wash — badges alone mark saved quotes.
	expect(await page.locator("article .rendered [data-ann-badge]").count()).toBe(1);
	// Past both fade windows (pill 160ms, wash 180ms): steady state
	// carries no wash — badges alone mark saved quotes.
	await page.waitForTimeout(600);
	expect(
		await page.evaluate(() => document.querySelectorAll("article .rendered mark.ccez-ann").length)
	).toBe(0);
});

/** A press outside message text that drags into the chat keeps the
live highlight: only a plain (unmoved) click clears it. */
test("dragging from the gutter into the chat keeps the highlight", async ({ page }) => {
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
	const before = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(before.length).toBeGreaterThan(0);
	// Press in the gutter (past the 24px edge-gesture zone, so no
	// sidebar claims the stroke), drag into the chat, release over text.
	await page.mouse.move(40, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 60, y, { steps: 8 });
	await page.mouse.up();
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe(before);
	await expect(page.locator(".sel-menu")).toBeVisible();
});

/** Annotations-only messages render an em-dash at text size with the
count above, unfolded — never the baked block. */
test("annotations-only message renders em-dash with count", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: 'Annotated selections:\n1. "bonjour" — ?' },
		{ role: "assistant", content: "ok" }
	]);
	await page.goto("/");
	const article = page.locator("article.user");
	await expect(article.locator(".ann-refs-pill")).toHaveText("1", { timeout: 60_000 });
	await expect(article.locator(".rendered")).toContainText("—");
	await expect(article.locator(".rendered")).not.toContainText("Annotated selections");
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
		{ role: "user", content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — ?' }
	]);
	await page.goto("/");
	const row = page.locator("article.user .actions");
	await row.hover();
	await page.locator('article.user .actions button[data-tip="Copy as plain text"]').click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("explain this");
});

/** Each baked annotation copies from the sent-refs card's icon button. */
test("sent-refs card copies one annotation", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	// A leading assistant message pushes the user article down: the
	// count pill floats above its message and is unhittable at the
	// viewport's top edge.
	await seedChat(page, [
		{ role: "assistant", content: "noted" },
		{ role: "user", content: 'explain this\n\nAnnotated selections:\n1. "bonjour" — greeting?' }
	]);
	await page.goto("/");
	// Click-toggled (hover never opens it).
	await page.locator(".ann-refs-pill").first().click();
	await page.locator(".ann-refs-copy").first().click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('"bonjour" — greeting?');
});

/** Each draft annotation copies from the review panel's icon button. */
test("review panel copies one annotation", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await openPromptReview(page);
	await page.locator(".prompt-tools .review-copy").first().click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
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
	await seedChat(page, [{ role: "assistant", content: "hello world from Kyoto" }]);
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
		const text = document.querySelector("article.assistant .rendered p")?.firstChild;
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
	await expect(page.locator(".prompt-tools .review-quote").first()).toHaveText(/hello world/);
});

test("create box centers over narrow highlights, wide ones open at the cursor", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "Kyoto is an old capital with many temples and quiet gardens" }
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
		// wash mark it stamped instead.
		const mark = document.querySelector("article.assistant mark.ccez-ann");
		const r = mark?.getBoundingClientRect();
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
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
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

test("empty annotations bake a question mark for the model", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
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
	await page.locator(".cm-content").click();
	await page.keyboard.press("Enter");
	const user = page.locator("article.user").first();
	await expect(user).toBeVisible();
	// Click-toggled (hover never opens it): prove the toggle
	// genuinely opened it via its opacity transition.
	await user.locator(".ann-refs-pill").click();
	await expect(user.locator(".ann-refs-pop")).toHaveCSS("opacity", "1");
	await expect(user.locator(".ann-refs-comment").first()).toHaveText("?");
});

test("annotations-only messages render as an em-dash with the count pill above", async ({ page }) => {
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
		const em = document.querySelector("article.user .rendered")?.getBoundingClientRect();
		const pill = document.querySelector("article.user .ann-refs-pill")?.getBoundingClientRect();
		const base = getComputedStyle(document.querySelector("article.user .rendered")!);
		if (!em || !pill) return null;
		return { emTop: em.y, pillBottom: pill.y + pill.height, fontSize: base.fontSize };
	});
	if (!sizes) throw new Error("missing refs-only boxes");
	// The count UI rides above the dash, never inline with it.
	expect(sizes.pillBottom).toBeLessThanOrEqual(sizes.emTop + 2);
	// Normal text size: the message scale, not a shrunken preview.
	expect(parseFloat(sizes.fontSize)).toBeGreaterThanOrEqual(13);
});

test("review pencil files the edited comment on send", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.type("first");
	await page.keyboard.press("Enter");
	// The pill toggles the review (hover never opens it); the pencil
	// loads the comment into the composer instead of an inline box.
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".ann-wrap .review")).toHaveCSS("opacity", "1");
	await page.locator(".review-pencil").first().click();
	const draft = await page.evaluate(
		() => document.querySelector(".prompt .cm-content")?.textContent ?? ""
	);
	expect(draft).toBe("first");
	// Send files the note back (toast confirms the arrow didn't chat).
	await page.keyboard.type("!");
	await page.keyboard.press("Enter");
	await expect(page.locator(".toast")).toContainText("Note saved");
	await page.locator(".prompt-tools .ann-pill").click();
	await expect(page.locator(".review-comment").first()).toHaveText("first!");
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
	await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 8 });
	await page.mouse.move(tbox.x + tbox.width / 2, 4, { steps: 4 });
	await page.mouse.move(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2, { steps: 4 });
	await page.mouse.up();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	// Nothing above the cursor's line ("aaa", "bbb") may highlight.
	expect(selected).not.toContain("aaa");
	expect(selected).not.toContain("bbb");
});

/** Filed-annotations card dismisses: Escape closes it, and so does a
press anywhere outside the card (the pill alone toggles). The pill
also shows the pointer hand. */
test("sent refs card dismisses on Escape and outside press", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	const para = page.locator("article.assistant .rendered p").first();
	await expect(para).toBeVisible({ timeout: 60_000 });
	await para.dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-wrap")).toBeVisible();
	await page.locator(".cm-content").click();
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
	await expect(pop.locator('button[aria-label="Delete annotation"]')).toBeFocused();
	// Every further Tab walks the card's own row (dictation joins it
	// when the mic is available) until Save; the card must never
	// close under keyboard traversal.
	const focusedName = (): Promise<string> =>
		page.evaluate(() => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement)) return "none";
			return (active.getAttribute("aria-label") ?? active.textContent ?? "").trim();
		});
	for (let n = 0; n < 6; n++) {
		if ((await focusedName()) === "Save") break;
		await page.keyboard.press("Tab");
		await expect(pop).toBeVisible();
	}
	await expect(pop.locator(".ann-save")).toBeFocused();
	await expect(pop).toBeVisible();
});
