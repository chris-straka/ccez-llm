import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/** Drop a canvas-painted PNG onto the composer (in-page: DataTransfer
is not serializable across the protocol, so dispatchEvent can't carry
it from the test runner). */
async function dropImage(page: Page, name = "blue.png"): Promise<void> {
	await page.evaluate((fileName) => {
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas 2D unavailable");
		ctx.fillStyle = "#336699";
		ctx.fillRect(0, 0, 8, 8);
		return new Promise<void>((resolve, reject) => {
			canvas.toBlob((blob) => {
				try {
					if (!blob) throw new Error("canvas produced no blob");
					const transfer = new DataTransfer();
					transfer.items.add(new File([blob], fileName, { type: "image/png" }));
					const target = document.querySelector(".prompt");
					if (!target) throw new Error("missing composer");
					target.dispatchEvent(
						new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
					);
					resolve();
				} catch (error) {
					reject(error);
				}
			}, "image/png");
		});
	}, name);
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	// Force the download-blob export path: a native save picker cannot
	// be driven headless, so the picker must read as unavailable here.
	await page.addInitScript(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: undefined,
			configurable: true
		});
	});
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({
		timeout: 60_000
	});
});

test("composer accepts dropped files into the attachments path", async ({ page }) => {
	// A .md drop lands as a text attachment pill under the composer.
	// The event is dispatched in-page: DataTransfer is not serializable
	// across the protocol, so dispatchEvent cannot carry it.
	await page.evaluate(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(["# hello"], "notes.md", { type: "text/markdown" }));
		const target = document.querySelector(".prompt");
		if (!target) throw new Error("missing composer");
		target.dispatchEvent(
			new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
		);
	});
	await expect(page.locator(".attachments .name")).toHaveText("notes.md", {
		timeout: 15_000
	});
});

test("sidebar row export button downloads the chat as markdown", async ({ page }) => {
	// Export lives per sidebar row now (icon-only, left of delete);
	// the header button is gone.
	await expect(page.locator('header button[aria-label="Export chat as Markdown"]')).toHaveCount(0);
	await page.keyboard.press("Meta+b");
	const row = page.locator("aside li").first();
	await expect(row).toBeVisible();
	await row.hover();
	const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
	await row.locator('button[aria-label="Export chat as Markdown"]').click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
	const path = await download.path();
	expect(path).toBeTruthy();
});

test("dropped images land as cards with a [Pasted image] tag", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	await expect(card.locator(".thumb img")).toBeVisible();
	await expect(card.locator(".tok")).toBeVisible();
	await expect(card.locator('button[aria-label="Copy attachment"] svg')).toHaveCount(1);
	await expect(
		card.locator('button[aria-label="Remove attachment"] svg')
	).toHaveCount(1);
	// The tag stays on the current line with one trailing space.
	await expect(page.locator(".ta-input")).toHaveValue(/\[Pasted image\]/);
});

test("pasted tag leaves the caret after its space, same line", async ({ page }) => {
	await dropImage(page);
	const content = page.locator(".ta-input");
	await expect(content).toHaveValue(/\[Pasted image\]/, { timeout: 15_000 });
	// End takes the caret to the tag line's end, then type: the word
	// must land beside the tag (old own-line placement parked the
	// caret below, so typing opened a second line).
	await content.click();
	await page.keyboard.press("End");
	await page.keyboard.type("hi");
	await expect(content).toHaveValue("[Pasted image] hi");
});

test("a second pasted image chains onto the same line", async ({ page }) => {
	await dropImage(page);
	const content = page.locator(".ta-input");
	await expect(content).toHaveValue(/\[Pasted image\]/, { timeout: 15_000 });
	// The second paste lands beside the first tag (the old prefix
	// newline parked the caret below, splitting repeat pastes).
	await dropImage(page);
	await expect(content).toHaveValue("[Pasted image] [Pasted image] ");
});

test("an image pasted after typed text stays on the same line", async ({ page }) => {
	const content = page.locator(".ta-input").first();
	await content.click();
	await page.keyboard.type("jj");
	// Spaceless mid-prose earns one separating space, never a fresh
	// line for the tag.
	await dropImage(page);
	await expect(content).toHaveValue("jj [Pasted image] ", { timeout: 15_000 });
});

test("removing the pill collapses the strip", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// No bridge in the preview: the fallback runs on the solid square
	// and reports the miss, never the red inline slot.
	await card.locator('button[aria-label="Recognize text in image"]').click();
	await expect(page.locator(".toast")).toContainText("No text found", { timeout: 120_000 });
	await expect(page.locator(".attach-error")).toHaveCount(0);
	// The X takes the pill, its tag, and the strip — nothing lingers
	// over the next draft.
	await card.locator('button[aria-label="Remove attachment"]').click();
	await expect(page.locator(".attachments")).toHaveCount(0);
});

test("attachment strip never covers message text", async ({ page }) => {
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.goto("/");
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await dropImage(page);
	const strip = page.locator(".attachments");
	await expect(strip).toBeVisible({ timeout: 15_000 });
	// Worst case: scrolled to the very bottom with the strip open —
	// the last article still ends above it. The thumbnail is inert
	// (the big preview is gone): clicking it opens nothing.
	await page.locator(".attachments .thumb").click();
	await expect(page.locator("img.preview")).toHaveCount(0);
	await expect(strip).toBeVisible();
	// Instant (not the eased smooth scroll): measure only once the
	// scroller has settled at the bottom.
	await page.evaluate(() => {
		document.querySelector(".messages")?.scrollTo({ top: 1e9, behavior: "instant" });
	});
	await expect
		.poll(() =>
			page.evaluate(() => {
				const box = document.querySelector(".messages");
				return box ? box.scrollHeight - box.scrollTop - box.clientHeight : 99;
			})
		)
		.toBeLessThanOrEqual(1);
	const stripBox = await strip.boundingBox();
	const lastBox = await page.locator("article").last().boundingBox();
	if (!stripBox || !lastBox) throw new Error("missing boxes");
	expect(stripBox.y).toBeGreaterThanOrEqual(lastBox.y + lastBox.height - 1);
});

test("image pill and tag remove each other", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Pill → tag: the pill's X takes the marker line with it.
	await page.locator('.attachments button[aria-label="Remove attachment"]').click();
	await expect(card).toHaveCount(0);
	await expect(page.locator(".ta-input")).not.toHaveValue(/\[Pasted image\]/);
});

test("deleting the tag drops the pill", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Tag → pill: replacing the whole draft (markers included) drops
	// the image attachment, like hand-deleting the tag. Meta+A: the
	// macOS select-all — Control+A only jumps to the line start in
	// the editor, so typing would prepend instead of replacing.
	await page.locator(".ta-input").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.type("hello");
	await expect(card).toHaveCount(0);
	await expect(page.locator(".ta-input")).toHaveValue("hello");
});
test("long paste becomes a pill with a positional tag", async ({ page }) => {
	// A >100-char paste becomes a text pill above the composer plus a
	// positional [Pasted N chars] tag where the caret was — never raw
	// text in the box.
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	// PASTE-kind pill with excerpt preview plus char count…
	const pill = page.locator(".attachments .paste-body");
	await expect(pill).toBeVisible();
	await expect(page.locator(".attachments .file-kind")).toHaveText("PASTE");
	await expect(page.locator(".attachments .tok")).toHaveText("540 chars");
	// …and the tag rides the caret line with one trailing space.
	const box = page.locator(".ta-input").first();
	await expect(box).toHaveValue("[Pasted 540 chars] ");
	// Tap toggles the full scrollable text…
	const excerpt = `${pasted.slice(0, 240).trimEnd()}…`;
	await expect(pill).toHaveText(excerpt);
	await pill.click();
	await expect(pill).toHaveAttribute("aria-expanded", "true");
	await expect(pill).toHaveText(pasted);
	await pill.click();
	await expect(pill).toHaveAttribute("aria-expanded", "false");
	await expect(pill).toHaveText(excerpt);
	// …while Ctrl+O leaves the tag alone (no in-box collapse to toggle).
	await box.click();
	await page.keyboard.press("Control+o");
	await expect(box).toHaveValue("[Pasted 540 chars] ");
});

test("pasted text renders as an image-sized card", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	// The pill is a card now, like images — same row shape.
	const pill = page.locator(".attachments li.card .paste-body");
	await expect(pill).toBeVisible();
	await dropImage(page);
	const cards = page.locator(".attachments li.card");
	await expect(cards).toHaveCount(2);
	const pasteBox = await cards.nth(0).boundingBox();
	const imgBox = await cards.nth(1).boundingBox();
	if (!pasteBox || !imgBox) throw new Error("cards have no boxes");
	// Never wider than the image card beside it.
	expect(pasteBox.width).toBeLessThanOrEqual(imgBox.width + 1);
	// The text fills the thumbnail's seat: same height as the image.
	const previewBox = await pill.boundingBox();
	const thumbBox = await page.locator(".attachments .thumb img").boundingBox();
	if (!previewBox || !thumbBox) throw new Error("preview or thumb has no box");
	expect(Math.abs(previewBox.height - thumbBox.height)).toBeLessThanOrEqual(2);
	// Expanding scrolls in place: the card keeps its footprint.
	await pill.click();
	await expect(pill).toHaveAttribute("aria-expanded", "true");
	const openBox = await pill.boundingBox();
	if (!openBox) throw new Error("open preview has no box");
	expect(Math.abs(openBox.height - previewBox.height)).toBeLessThanOrEqual(2);
});

test("thoughts never render and Ctrl+O stays quiet without paste tags", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{ id: "e2e-m0", role: "user", content: "hi", usage: null, error: null },
						{
							id: "e2e-m1",
							role: "assistant",
							content: "<think>quiet plan</think>Final answer",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	});
	await page.reload();
	const body = page.locator("article.assistant .rendered").first();
	await expect(body).toContainText("Final answer", { timeout: 60_000 });
	await expect(body).not.toContainText("quiet plan");
	await expect(page.locator("article.assistant .ccez-thoughts")).toHaveCount(0);
	// Ctrl+O with no paste tags does nothing (and opens no file dialog).
	await page.locator(".ta-input").first().click();
	await page.keyboard.press("Control+o");
	await expect(page.locator("article.assistant .ccez-thoughts")).toHaveCount(0);
	await expect(body).toContainText("Final answer");
});

test("screenshot-to-chat is gone, paste still takes images", async ({ page }) => {
	// Shot was removed (paste + OCR remain the image paths): no Shot
	// control even where screen capture is supported.
	await expect(
		page.locator('.prompt-tools button[aria-label="Capture a screenshot into the chat"]')
	).toHaveCount(0);
	await expect(
		page.locator('.prompt-tools button[aria-label="Attach images or text files"]')
	).toBeVisible();
});

test("expanded pasted content contracts from either blue bracket", async ({ page }) => {
	// A stored closed fold expands in place framed by blue collapse
	// brackets; clicking either bracket contracts back to the tag.
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
							content: "aa BBBB cc",
							pasteFolds: [{ start: 3, end: 7, chars: 4 }],
							usage: null,
							error: null
						},
						{ id: "e2e-m1", role: "assistant", content: "got it", usage: null, error: null }
					]
				}
			])
		);
	});
	await page.reload();
	const body = page.locator("article.user .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	const marker = body.locator("button.paste-fold", { hasText: "[Pasted 4 chars]" });
	await expect(marker).toBeVisible();
	// Composer-tag voice (ink bold), not link blue: the tag reads as
	// message text that happens to click. Collapse brackets keep blue.
	await expect(marker).toHaveCSS("font-weight", "700");
	await expect(body).not.toContainText("BBBB");
	await marker.click();
	await expect(body).toContainText("BBBB");
	const open = body.locator("button.paste-fold", { hasText: "[" }).first();
	await expect(open).toBeVisible();
	await open.click();
	await expect(body).not.toContainText("BBBB");
	await expect(body.locator("button.paste-fold", { hasText: "[Pasted 4 chars]" })).toBeVisible();
});

test("tray stays background-free under a solid prompt", async ({ page }) => {
	// Surfaces are solid now (no frost anywhere): the prompt card is
	// opaque, while the pill tray above it paints no background —
	// pills float with the thread visible between them, and draft
	// image cards wear the blue wash again as basic pill-cards.
	await page.reload();
	await expect(page.locator(".ta-input").first()).toBeVisible({ timeout: 60_000 });
	await dropImage(page);
	const tray = page.locator("ul.attachments").first();
	await expect(tray).toBeVisible({ timeout: 15_000 });
	const style = await tray.evaluate((el) => {
		const css = getComputedStyle(el);
		return { bg: css.backgroundColor, blur: css.backdropFilter };
	});
	expect(style.bg).toBe("rgba(0, 0, 0, 0)");
	expect(style.blur).toBe("none");
	const prompt = await page.locator("main .prompt").evaluate((el) => {
		const css = getComputedStyle(el);
		return { bg: css.backgroundColor, blur: css.backdropFilter };
	});
	expect(prompt.blur).toBe("none");
	const cardBg = await page
		.locator("ul.attachments li.card")
		.first()
		.evaluate((el) => window.getComputedStyle(el).backgroundColor);
	expect(cardBg).toBe("rgb(238, 244, 255)");
});

/** Strip-turn seed: image attachments carry no literal (they ride the
inline flow since sends store literals), so strip tests seed file
attachments, which are the strip's only residents. */
const PIXEL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function seedStripTurn(page: Page, imageCount: number, textBodies: string[] = []): Promise<void> {
	await page.addInitScript((args: { url: string; imageCount: number; textBodies: string[] }) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 0 })
		);
		const attachments = [
			...Array.from({ length: args.imageCount }, (_, i) => ({
				id: `e2e-img-${i}`,
				name: `shot-${i}.png`,
				mime: "image/png",
				kind: "image",
				dataUrl: args.url,
				text: null,
				width: 1,
				height: 1,
				tokens: 85
			})),
			...args.textBodies.map((text, i) => ({
				id: `e2e-txt-${i}`,
				name: `notes-${i}.md`,
				mime: "text/markdown",
				kind: "text",
				dataUrl: null,
				text,
				width: null,
				height: null,
				tokens: 85
			}))
		];
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
							role: "assistant",
							content: "Welcome.",
							usage: null,
							error: null
						},
						{
							id: "e2e-m1",
							role: "user",
							content: "What do you see here?",
							usage: null,
							error: null,
							attachments
						}
					]
				}
			])
		);
	}, { url: PIXEL, imageCount, textBodies });
	await page.reload();
}

test("leftover strip tag matches body size and hugs the own-message edge", async ({ page }) => {
	// The strip sits outside .rendered, whose 0.92rem the fold buttons
	// otherwise miss (they rendered at the 16px root size beside
	// 14.72px body text); own-message strips pack right like the text.
	await seedStripTurn(page, 0, ["What do you see here?"]);
	const article = page.locator("article.user").last();
	const tag = article.locator(".sent-tags .paste-fold").first();
	await expect(tag).toBeVisible({ timeout: 60_000 });
	const sizes = await article.evaluate((root) => {
		const px = (el: Element | null): number =>
			el ? Number.parseFloat(window.getComputedStyle(el).fontSize) : Number.NaN;
		return {
			body: px(root.querySelector(".rendered p")),
			tag: px(root.querySelector(".sent-tags .paste-fold"))
		};
	});
	expect(sizes.tag).toBe(sizes.body);
	const edges = await article.evaluate((root) => {
		const body = root.querySelector(".rendered p") as HTMLElement | null;
		const strip = root.querySelector(".sent-tags") as HTMLElement | null;
		if (!body || !strip) throw new Error("missing strip or body");
		return {
			bodyRight: body.getBoundingClientRect().right,
			stripRight: strip.getBoundingClientRect().right
		};
	});
	expect(Math.abs(edges.stripRight - edges.bodyRight)).toBeLessThanOrEqual(2);
});

test("strip popup opens above the tag, centered on it", async ({ page }) => {
	await seedStripTurn(page, 0, ["What do you see here?"]);
	const article = page.locator("article.user").last();
	const tag = article.locator(".sent-tags .paste-fold").first();
	await expect(tag).toBeVisible({ timeout: 60_000 });
	await tag.click();
	const card = article.locator(".sent-open").first();
	await expect(card).toBeVisible();
	const geometry = await article.evaluate((root) => {
		const t = root.querySelector(".sent-tags .paste-fold") as HTMLElement | null;
		const c = root.querySelector(".sent-open") as HTMLElement | null;
		if (!t || !c) throw new Error("missing tag or card");
		const tb = t.getBoundingClientRect();
		const cb = c.getBoundingClientRect();
		return {
			tagTop: tb.top,
			cardBottom: cb.bottom,
			tagCenterX: tb.left + tb.width / 2,
			cardCenterX: cb.left + cb.width / 2
		};
	});
	expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.tagTop + 1);
	// Straddles its anchor instead of spilling right.
	expect(Math.abs(geometry.cardCenterX - geometry.tagCenterX)).toBeLessThanOrEqual(6);
});

test("preview cards hug their content", async ({ page }) => {
	// Shrink-to-fit (capped), not one fixed width: a short excerpt
	// rides narrow while a long excerpt fills the cap.
	await seedStripTurn(page, 0, [
		"Tiny note.",
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ".repeat(6)
	]);
	const article = page.locator("article.user").last();
	const tags = article.locator(".sent-tags .paste-fold");
	await expect(tags.first()).toBeVisible({ timeout: 60_000 });
	await expect(tags).toHaveCount(2);
	const widths: number[] = [];
	for (let i = 0; i < 2; i++) {
		await tags.nth(i).click();
		const card = article.locator(".sent-card").first();
		await expect(card).toBeVisible();
		widths.push(await card.evaluate((el) => el.getBoundingClientRect().width));
		await page.keyboard.press("Escape");
		await expect(article.locator(".sent-open")).toBeHidden();
	}
	expect(widths[0]).toBeLessThan(256);
	expect(widths[1]).toBeGreaterThan(widths[0]!);
});

test("tray card thumbnail never covers its footer", async ({ page }) => {
	// The tall thumbnail must not overlap the name/token/buttons row
	// it carries: geometry plus a hit test at the filename's center.
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	const geometry = await card.evaluate((el) => {
		const img = el.querySelector(".thumb img") as HTMLElement | null;
		const name = el.querySelector(".name") as HTMLElement | null;
		if (!img || !name) throw new Error("missing thumb or name");
		const ir = img.getBoundingClientRect();
		const nr = name.getBoundingClientRect();
		const hit = document.elementFromPoint(nr.left + nr.width / 2, nr.top + nr.height / 2);
		return {
			imgBottom: ir.bottom,
			nameTop: nr.top,
			hitImg: hit instanceof Element && hit.closest("img") !== null
		};
	});
	expect(geometry.imgBottom).toBeLessThanOrEqual(geometry.nameTop + 1);
	expect(geometry.hitImg).toBe(false);
});

test("one preview per message, contents centered", async ({ page }) => {
	// Opening a second tag closes the first (stacked popups jar), and
	// the uniform card centers its contents: no stranded wash on one
	// side, footer riding the middle beneath the preview.
	await seedStripTurn(page, 0, ["alpha", "beta"]);
	const article = page.locator("article.user").last();
	const tags = article.locator(".sent-tags .paste-fold");
	await expect(tags.first()).toBeVisible({ timeout: 60_000 });
	await tags.nth(0).click();
	await expect(article.locator(".sent-open")).toHaveCount(1);
	await tags.nth(1).click();
	const cards = article.locator(".sent-open");
	await expect(cards).toHaveCount(1);
	const centered = await article.locator(".sent-card").first().evaluate((el) => {
		const foot = el.querySelector(".sent-foot") as HTMLElement | null;
		return {
			card: window.getComputedStyle(el).textAlign,
			foot: foot ? window.getComputedStyle(foot).justifyContent : "missing"
		};
	});
	expect(centered.card).toBe("center");
	expect(centered.foot).toBe("center");
	// Toggling the open tag still closes it.
	await tags.nth(1).click();
	await expect(cards).toHaveCount(0);
});

test("removing the image pill keeps the pasted-text pill", async ({ page }) => {
	// Long paste first: text pill plus positional tag…
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const pill = page.locator(".attachments .paste-body");
	await expect(pill).toBeVisible();
	const box = page.locator(".ta-input").first();
	await expect(box).toHaveValue("[Pasted 540 chars] ");
	// …then an image: its own card joins the strip (the text pill
	// is a card too now, so scope to the thumbnail card)…
	await dropImage(page);
	const card = page.locator(".attachments li.card", { has: page.locator(".thumb") });
	await expect(card).toBeVisible({ timeout: 15_000 });
	// …and removing the image pill keeps the pasted-text pill and tag.
	await card.locator('button[aria-label="Remove attachment"]').click();
	await expect(card).toHaveCount(0);
	await expect(box).not.toHaveValue(/\[Pasted image\]/);
	await expect(pill).toBeVisible();
	// The image tag (and its seat) is gone; the pasted-text tag stays.
	await expect(box).toHaveValue("[Pasted 540 chars]");
});

test("pasted-text pill expands to the full text and back", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const pill = page.locator(".attachments .paste-body");
	await expect(pill).toBeVisible();
	// Collapsed: the 240-char excerpt preview, not the whole paste.
	const excerpt = `${pasted.slice(0, 240).trimEnd()}…`;
	await expect(pill).toHaveText(excerpt);
	// Tap: the full scrollable text.
	await pill.click();
	await expect(pill).toHaveAttribute("aria-expanded", "true");
	await expect(pill).toHaveText(pasted);
	// Tap again: back to the excerpt.
	await pill.click();
	await expect(pill).toHaveAttribute("aria-expanded", "false");
	await expect(pill).toHaveText(excerpt);
});

test("tray docks a fixed margin above the prompt", async ({ page }) => {
	// The tray is bottom-anchored, not reserve-riding: a constant gap
	// whatever the thread length. The reserve observer watches the
	// box it writes to, so the attach window must also stay free of
	// "ResizeObserver loop" console errors.
	const roLoops: string[] = [];
	page.on("console", (msg) => {
		if (msg.type() === "error" && msg.text().includes("ResizeObserver loop")) {
			roLoops.push(msg.text());
		}
	});
	await dropImage(page);
	const tray = page.locator("ul.attachments").first();
	await expect(tray).toBeVisible({ timeout: 15_000 });
	const gap = async (): Promise<number> =>
		page.evaluate(() => {
			const strip = document.querySelector("ul.attachments");
			const prompt = document.querySelector("main .prompt");
			if (!strip || !prompt) throw new Error("missing tray or prompt");
			return prompt.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
		});
	// The dock lands a frame after the attach: poll past the transient
	// (a stuck negative would park the tray under the card).
	await expect.poll(gap, { timeout: 5_000 }).toBeGreaterThan(0);
	expect(await gap()).toBeLessThan(24);
	expect(roLoops).toEqual([]);
});

test("tray re-docks above the prompt after cut and paste", async ({ page }) => {
	// Cut empties the tray (unmount); pasting the tags back remounts
	// it with the composer at the same height — the dock write must
	// not be skipped as "unchanged", or the tray parks at the top.
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await dropImage(page);
	const tray = page.locator("ul.attachments").first();
	await expect(tray).toBeVisible({ timeout: 15_000 });
	const gap = async (): Promise<number> =>
		page.evaluate(() => {
			const strip = document.querySelector("ul.attachments");
			const prompt = document.querySelector("main .prompt");
			if (!strip || !prompt) throw new Error("missing tray or prompt");
			return prompt.getBoundingClientRect().top - strip.getBoundingClientRect().bottom;
		});
	await expect.poll(gap, { timeout: 5_000 }).toBeGreaterThan(0);
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+x");
	await expect(tray).toHaveCount(0);
	// The enriched clipboard write is async (blob fetch + HTML
	// encode): wait for the picture before pasting it back.
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					navigator.clipboard
						.read()
						.then(async (items) => {
							const html = items.find((item) => item.types.includes("text/html"));
							if (!html) return -1;
							const text = await (await html.getType("text/html")).text();
							return text.split("<img").length - 1;
						})
						.catch(() => -1)
				),
			{ timeout: 10_000 }
		)
		.toBe(1);
	await page.keyboard.press("Meta+v");
	await expect(tray).toBeVisible({ timeout: 15_000 });
	await expect.poll(gap, { timeout: 5_000 }).toBeGreaterThan(0);
	expect(await gap()).toBeLessThan(24);
});

test("thread text flows beside the floating tray", async ({ page }) => {
	// Long thread, image attached, scrolled mid-thread: message text
	// stays visible beside the cards (the tray overlays the thread
	// instead of squeezing it out of the bottom third).
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 0 })
		);
		const msgs = [];
		for (let i = 0; i < 20; i++) {
			msgs.push({
				id: `e2e-fill-${i}`,
				role: i % 2 === 0 ? "assistant" : "user",
				content: `Filler message ${i} with enough words to wrap lines and fill the thread column.`,
				usage: null,
				error: null
			});
		}
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: msgs }])
		);
	});
	await page.reload();
	await expect(page.locator("article.assistant").first()).toBeVisible({ timeout: 60_000 });
	await dropImage(page);
	await expect(page.locator(".attachments li.card")).toBeVisible({ timeout: 15_000 });
	const hits = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (!box) throw new Error("missing scroller");
		box.scrollTo({ top: box.scrollHeight / 2, behavior: "instant" });
		const rect = (el: Element | null): { top: number; bottom: number; left: number; right: number } | null => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
		};
		const boxRect = rect(box);
		const tray = rect(document.querySelector("ul.attachments"));
		if (!boxRect || !tray) throw new Error("missing box or tray");
		let count = 0;
		document.querySelectorAll("article").forEach((art) => {
			const a = rect(art);
			if (!a) return;
			const visTop = Math.max(a.top, boxRect.top);
			const visBottom = Math.min(a.bottom, boxRect.bottom);
			if (visBottom - visTop <= 1) return;
			if (
				Math.min(visBottom, tray.bottom) - Math.max(visTop, tray.top) > 1 &&
				Math.min(a.right, tray.right) - Math.max(a.left, tray.left) > 1
			) {
				count++;
			}
		});
		return count;
	});
	expect(hits).toBeGreaterThan(0);
});

test("overflowing strip drag-pans under a grab cursor", async ({ page }) => {
	for (let i = 0; i < 8; i++) await dropImage(page, `shot-${i}.png`);
	const strip = page.locator("ul.attachments").first();
	await expect(strip).toBeVisible({ timeout: 15_000 });
	// The row really overflows: without that the pan has nothing to do.
	await expect.poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(50);
	// Cards show the hand, never the bar: scrollbars stay hidden.
	const cursor = await page
		.locator("ul.attachments li.card")
		.first()
		.evaluate((el) => window.getComputedStyle(el).cursor);
	expect(cursor).toBe("grab");
	// A press-drag across a card pans the row (no scrollbar needed).
	const box = await strip.boundingBox();
	if (!box) throw new Error("missing strip box");
	const startX = box.x + box.width / 2;
	const startY = box.y + box.height / 2;
	const before = await strip.evaluate((el) => el.scrollLeft);
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX - 160, startY, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).not.toBe(before);
});

test("cutting three tags pastes back three images, not one", async ({ page }) => {
	// Multi-tag cuts carry every picture (clipboard order); the paste
	// hook used to take only the first file and strand the rest.
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	for (const name of ["shot-0.png", "shot-1.png", "shot-2.png"]) await dropImage(page, name);
	await expect(page.locator(".attachments li.card")).toHaveCount(3, { timeout: 15_000 });
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+x");
	await expect(page.locator(".attachments li.card")).toHaveCount(0);
	// The enriched clipboard write is async (blob fetch + HTML
	// encode): wait for all three pictures before pasting back.
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					navigator.clipboard
						.read()
						.then(async (items) => {
							const html = items.find((item) => item.types.includes("text/html"));
							if (!html) return -1;
							const text = await (await html.getType("text/html")).text();
							return text.split("<img").length - 1;
						})
						.catch(() => -1)
				),
			{ timeout: 10_000 }
		)
		.toBe(3);
	await page.keyboard.press("Meta+v");
	await expect(page.locator(".attachments li.card")).toHaveCount(3, { timeout: 15_000 });
	const tags = await page.evaluate(
		() =>
			(
				(document.querySelector(".prompt .ta-input") as HTMLTextAreaElement | null)?.value.match(
					/\[Pasted image\]/g
				) ?? []
			).length
	);
	expect(tags).toBe(3);
});

test("breaking an image tag drops its pill", async ({ page }) => {
	// Tags are plain text now (no atomic unit): damaging the tag text
	// still drops the attachment, never a half-tag reading as prose.
	await dropImage(page);
	await expect(page.locator(".attachments li.card")).toBeVisible({ timeout: 15_000 });
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("End");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("ArrowLeft");
	await page.keyboard.press("Backspace");
	await expect(page.locator(".attachments li.card")).toHaveCount(0);
	await expect(page.locator(".prompt .ta-input").first()).not.toHaveValue(/\[Pasted image\]/);
});

test("backspacing a pasted-text tag drops its pill", async ({ page }) => {
	// Over-threshold paste: pill plus positional tag, not a fold.
	const pasted = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(4);
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const pill = page.locator(".attachments .paste-body");
	await expect(pill).toBeVisible();
	const box = page.locator(".prompt .ta-input");
	await expect(box).toHaveValue("[Pasted 220 chars] ");
	await box.click();
	await page.keyboard.press("End");
	// The first Backspace eats the separator space past the tag; the
	// tag still matches, so the pill stays…
	await page.keyboard.press("Backspace");
	await expect(box).toHaveValue("[Pasted 220 chars]");
	await expect(pill).toBeVisible();
	// …the second breaks the tag text, and the pill goes with it.
	await page.keyboard.press("Backspace");
	await expect(pill).toHaveCount(0);
	await expect(box).not.toHaveValue(/\[Pasted 220 chars\]/);
});

test("cutting an image tag keeps its bytes for another chat", async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Cut the tag in the composer: the tray empties with it...
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+x");
	await expect(card).toHaveCount(0);
	// ...but the clipboard kept the picture: a new chat pastes it back
	// as a live image, not a dead tag.
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/, { timeout: 10_000 });
	await page.locator('button[aria-label="New chat"]').click();
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+v");
	const fresh = page.locator(".attachments li.card");
	await expect(fresh).toBeVisible({ timeout: 15_000 });
	await expect(fresh.locator(".thumb img")).toBeVisible();
	await expect(page.locator(".prompt .ta-input").first()).toHaveValue(/\[Pasted image\]/);
});

test("deleting the first of two tags drops its own preview", async ({ page }) => {
	// Indexed pairing (Nth tag owns the Nth attachment): removing the
	// first tag used to drop the second image's preview instead.
	await dropImage(page, "first.png");
	await page.locator(".prompt .ta-input").click();
	// Tags are plain text (no atomic unit): park the caret past the
	// tag first, or the edit splits it mid-token.
	await page.keyboard.press("End");
	await page.keyboard.press("Shift+Enter");
	await dropImage(page, "second.png");
	const cards = page.locator(".attachments li.card");
	await expect(cards).toHaveCount(2, { timeout: 15_000 });
	// Caret sits after the second tag: up a line, select the first
	// line's tag, delete it. (Shift+End reaches text end in this
	// harness, so take the line with Shift+Down instead.)
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("Home");
	await page.keyboard.down("Shift");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.up("Shift");
	await page.keyboard.press("Backspace");
	await expect(cards).toHaveCount(1);
	await expect(cards.first().locator(".name")).toContainText("second.png");
	await expect(cards.first().locator(".thumb img")).toBeVisible();
});

test("removing the first pill keeps the second preview", async ({ page }) => {
	// Pill → tag by kind index, never the first of its kind.
	await dropImage(page, "first.png");
	await dropImage(page, "second.png");
	const cards = page.locator(".attachments li.card");
	await expect(cards).toHaveCount(2, { timeout: 15_000 });
	await cards.first().locator('button[aria-label="Remove attachment"]').click();
	await expect(cards).toHaveCount(1);
	await expect(cards.first().locator(".name")).toContainText("second.png");
	await expect(cards.first().locator(".thumb img")).toBeVisible();
	await expect(page.locator(".prompt .ta-input").first()).toHaveValue(/\[Pasted image\]/);
});

test("cut pastes back previews when rich clipboard writes fail", async ({ page }) => {
	// Shell behavior: the enriched clipboard write rejects, so the
	// paste lands as plain text — the in-app stash still rehydrates
	// the pictures with their preview cards, never dead tags.
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await dropImage(page, "first.png");
	await dropImage(page, "second.png");
	const cards = page.locator(".attachments li.card");
	await expect(cards).toHaveCount(2, { timeout: 15_000 });
	// The exact selected text, read back from a working copy first
	// (the enriched copy writes async — poll for it like the
	// three-tag roundtrip spec does, or the capture races empty).
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.press("Meta+c");
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 })
		.toContain("[Pasted image]");
	const cutText = await page.evaluate(() => navigator.clipboard.readText());
	// Now every clipboard write rejects (the shell's rich-write wall).
	await page.evaluate(() => {
		const denied = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
		Object.defineProperty(navigator.clipboard, "write", { value: denied, configurable: true });
		Object.defineProperty(navigator.clipboard, "writeText", {
			value: denied,
			configurable: true
		});
	});
	await page.keyboard.press("Meta+x");
	await expect(cards).toHaveCount(0);
	// Plain-text clipboard, as the shell leaves it: restore the text
	// write only, so the paste carries words without pictures.
	await page.evaluate((text) => {
		const clipboard = navigator.clipboard as unknown as Record<string, unknown>;
		delete clipboard["writeText"];
		return (navigator.clipboard.writeText as (s: string) => Promise<void>)(text);
	}, cutText);
	await page.keyboard.press("Meta+v");
	await expect(cards).toHaveCount(2, { timeout: 15_000 });
	await expect(cards.first().locator(".thumb img")).toBeVisible();
	await expect(cards.nth(1).locator(".thumb img")).toBeVisible();
});

/** Sent images ride the text flow as collapsed tags: the user message
shows a [Pasted image] fold tag in its prose, never a strip tag above
it and never a separate block below it; clicking the tag floats the
preview card. */
/** Enter with the caret after a tag sends: pasting long text (pill +
tag) then an image (tag) leaves the caret pasted against the tag,
and Enter must send the turn — never drop a newline into the draft. */
test("enter after a paste tag sends the message", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	await expect(page.locator(".attachments .paste-body")).toBeVisible();
	await dropImage(page, "after-paste.png");
	const box = page.locator(".prompt .ta-input");
	await expect(box).toHaveValue(/\[Pasted 540 chars\] \[Pasted image\] /, { timeout: 15_000 });
	await page.keyboard.press("Enter");
	// First, not last: the mock assistant echo streams in after and
	// would swallow the locator. The sent tag reads 539: the stored
	// text trims the paste tail the composer pill still counts.
	const user = page.locator("article.user").first();
	const tag = user.locator("button.paste-fold", { hasText: "[Pasted 539 chars]" });
	await expect(tag).toBeVisible({ timeout: 15_000 });
	await tag.click();
	await expect(user.locator(".rendered")).toContainText("lorem ipsum", { timeout: 15_000 });
});

/** Sent pastes keep the tag: a pill-backed long paste sends as
collapsed prose — the user message shows the [Pasted N chars] fold
button, never unfolded prose — and opens in place on click. */
test("sent pasted text keeps its collapsed tag", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".ta-input").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	await expect(page.locator(".attachments .paste-body")).toBeVisible();
	await expect(page.locator(".ta-input").first()).toHaveValue("[Pasted 540 chars] ");
	await page.keyboard.press("Enter");
	const user = page.locator("article.user").first();
	const tag = user.locator("button.paste-fold", { hasText: "[Pasted 539 chars]" });
	await expect(tag).toBeVisible({ timeout: 15_000 });
	await expect(user.locator(".rendered")).not.toContainText("lorem ipsum");
	await tag.click();
	await expect(user.locator(".rendered")).toContainText("lorem ipsum");
});

/** Pasted-text tags land one space past the tag: pasting long text
leaves the caret separated from the tag, so continued typing starts
after a space rather than jammed against it. */
test("pasted-text tag leaves one space after it", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	const box = page.locator(".ta-input").first();
	await box.click();
	await page.evaluate((text) => {
		const target = document.querySelector(".ta-input");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	await expect(box).toHaveValue("[Pasted 540 chars] ");
	await page.keyboard.type("x");
	await expect(box).toHaveValue("[Pasted 540 chars] x");
});

/** A second image tag after typed prose stays on the line: drop, type
"test ", drop again — both tags read on one composer line, the second
never stranded below the first. */
test("second image tag rides the typed line", async ({ page }) => {
	await dropImage(page, "first.png");
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await page.keyboard.press("End");
	await page.keyboard.type("test ");
	await dropImage(page, "second.png");
	// One composer line: both tags plus the prose, no newline anywhere.
	await expect(box).toHaveValue("[Pasted image] test [Pasted image] ");
});

test("sent images ride inline with the text", async ({ page }) => {
	await dropImage(page, "first.png");
	await page.locator(".prompt .ta-input").click();
	await page.keyboard.type("look at this");
	await page.keyboard.press("Enter");
	const user = page.locator("article.user");
	await expect(user.locator(".rendered")).toContainText("look at this", { timeout: 15_000 });
	const tag = user.locator(".rendered .sent-fold");
	await expect(tag).toContainText("[Pasted image]", { timeout: 15_000 });
	await expect(user.locator(".rendered img.sent-img")).toHaveCount(0);
	await tag.click();
	await expect(user.locator(".rendered img.sent-img")).toBeVisible({ timeout: 15_000 });
	await expect(user.locator(".rendered .sent-name")).toContainText("first.png");
	// No strip for images: the above-message tags are files only.
	await expect(user.locator(".sent-tags")).toHaveCount(0);
});

/** Composer tags are plain textarea text: no decoration machinery
paints them (the CodeMirror highlight spans are gone with it). */
test("composer attachment tags are plain text", async ({ page }) => {
	await dropImage(page, "first.png");
	const box = page.locator(".prompt .ta-input");
	await expect(box).toHaveValue(/\[Pasted image\]/, { timeout: 15_000 });
	// No inner spans anywhere inside the composer input: the tag is
	// characters in the textarea value, not styled nodes.
	expect(await box.evaluate((el) => el.querySelectorAll("span").length)).toBe(0);
});