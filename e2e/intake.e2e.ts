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
	await expect(page.locator(".cm-content")).toContainText("[Pasted image]");
});

test("pasted tag leaves the caret after its space, same line", async ({ page }) => {
	await dropImage(page);
	const content = page.locator(".cm-content");
	await expect(content).toContainText("[Pasted image]", { timeout: 15_000 });
	// End takes the caret to the tag line's end, then type: the word
	// must land beside the tag (old own-line placement parked the
	// caret below, so typing opened a second line).
	await content.click();
	await page.keyboard.press("End");
	await page.keyboard.type("hi");
	await expect(content).toHaveText("[Pasted image] hi");
});

test("a second pasted image chains onto the same line", async ({ page }) => {
	await dropImage(page);
	const content = page.locator(".cm-content");
	await expect(content).toContainText("[Pasted image]", { timeout: 15_000 });
	// The second paste lands beside the first tag (the old prefix
	// newline parked the caret below, splitting repeat pastes).
	await dropImage(page);
	await expect(content).toHaveText("[Pasted image] [Pasted image] ");
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
	// Worst case: scrolled to the very bottom with the strip open (and
	// the tall preview too) — the last article still ends above it.
	await page.locator(".attachments .thumb").click();
	await expect(page.locator("img.preview")).toBeVisible();
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
	await expect(page.locator(".cm-content")).not.toContainText("[Pasted image]");
});

test("deleting the tag drops the pill", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Tag → pill: replacing the whole draft (markers included) drops
	// the image attachment, like hand-deleting the tag. Meta+A: the
	// macOS select-all — Control+A only jumps to the line start in
	// the editor, so typing would prepend instead of replacing.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.type("hello");
	await expect(card).toHaveCount(0);
	await expect(page.locator(".cm-content")).toContainText("hello");
});
test("long paste collapses to a tag; Ctrl+O expands and re-collapses", async ({
	page
}) => {
	// A >100-char paste renders as one grey tag, not the raw text.
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".cm-content").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".cm-content");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const marker = page.locator(".cm-paste-marker");
	await expect(marker).toBeVisible();
	await expect(marker).toContainText("Pasted content");
	// Grey shade, no own background: the tag is not a code block.
	const box = await marker.evaluate((el) => {
		const style = getComputedStyle(el);
		return { background: style.backgroundColor, borderWidth: style.borderWidth };
	});
	expect(box.background).toBe("rgba(0, 0, 0, 0)");
	expect(box.borderWidth).toBe("0px");
	// Ctrl+O expands every tag…
	await page.keyboard.press("Control+o");
	await expect(marker).toHaveCount(0);
	await expect(page.locator(".cm-content").first()).toContainText("lorem ipsum");
	// …and again re-collapses.
	await page.keyboard.press("Control+o");
	await expect(marker).toBeVisible();
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
	await page.locator(".cm-content").first().click();
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
	// pills float with the thread visible between them, and image
	// cards float bare with no wash block behind the thumbnails.
	await page.reload();
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
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
	expect(cardBg).toBe("rgba(0, 0, 0, 0)");
});

/** One-pixel attachment seed (leftover-strip turns carry no literal). */
const PIXEL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function seedStripTurn(page: Page, count: number): Promise<void> {
	await page.addInitScript((args: { url: string; count: number }) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 0 })
		);
		const attachments = Array.from({ length: args.count }, (_, i) => ({
			id: `e2e-img-${i}`,
			name: `shot-${i}.png`,
			mime: "image/png",
			kind: "image",
			dataUrl: args.url,
			text: null,
			width: 1,
			height: 1,
			tokens: 85
		}));
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
	}, { url: PIXEL, count });
	await page.reload();
}

test("leftover strip tag matches body size and hugs the own-message edge", async ({ page }) => {
	// The strip sits outside .rendered, whose 0.92rem the fold buttons
	// otherwise miss (they rendered at the 16px root size beside
	// 14.72px body text); own-message strips pack right like the text.
	await seedStripTurn(page, 1);
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

test("strip popup opens above the tag", async ({ page }) => {
	await seedStripTurn(page, 1);
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
		return {
			tagTop: t.getBoundingClientRect().top,
			cardBottom: c.getBoundingClientRect().bottom
		};
	});
	expect(geometry.cardBottom).toBeLessThanOrEqual(geometry.tagTop + 1);
});

test("preview cards share one width whatever the excerpt", async ({ page }) => {
	await seedStripTurn(page, 2);
	const article = page.locator("article.user").last();
	const tags = article.locator(".sent-tags .paste-fold");
	await expect(tags.first()).toBeVisible({ timeout: 60_000 });
	await expect(tags).toHaveCount(2);
	const widths: number[] = [];
	for (let i = 0; i < 2; i++) {
		await tags.nth(i).click();
		const card = article.locator(".sent-open").first();
		await expect(card).toBeVisible();
		const width = await card.evaluate((el) => el.getBoundingClientRect().width);
		widths.push(width);
		await page.keyboard.press("Escape");
		await expect(card).toBeHidden();
	}
	expect(widths[0]).toBe(widths[1]);
});

test("removing the pill keeps pasted folds collapsed", async ({ page }) => {
	// Long paste folds, then the image pill goes: the fold must stay a
	// marker (the old full-rewrite excision dropped the decorations and
	// divulged the whole paste).
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".cm-content").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".cm-content");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const marker = page.locator(".cm-paste-marker");
	await expect(marker).toBeVisible();
	const label = await marker.textContent();
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	await page.locator('.attachments button[aria-label="Remove attachment"]').click();
	await expect(card).toHaveCount(0);
	await expect(page.locator(".cm-content").first()).not.toContainText("[Pasted image]");
	await expect(marker).toBeVisible();
	await expect(marker).toHaveText(label ?? "");
	// The full text is still in the draft: expanding shows it.
	await marker.click();
	await expect(page.locator(".cm-content").first()).toContainText("lorem ipsum");
});

test("expanded paste shows collapse brackets that re-collapse it", async ({ page }) => {
	const pasted = "lorem ipsum dolor sit amet ".repeat(20);
	await page.locator(".cm-content").first().click();
	await page.evaluate((text) => {
		const target = document.querySelector(".cm-content");
		if (!target) throw new Error("missing editor");
		const transfer = new DataTransfer();
		transfer.setData("text/plain", text);
		const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
		Object.defineProperty(event, "clipboardData", { value: transfer });
		target.dispatchEvent(event);
	}, pasted);
	const marker = page.locator(".cm-paste-marker");
	await expect(marker).toBeVisible();
	await marker.click();
	const brackets = page.locator(".cm-paste-bracket");
	await expect(brackets).toHaveCount(2);
	await expect(brackets.first()).toHaveText("[");
	await expect(brackets.last()).toHaveText("]");
	// Blue like history's brackets, not the marker's grey.
	const color = await brackets.first().evaluate((el) => window.getComputedStyle(el).color);
	expect(color).not.toBe("rgb(110, 110, 115)");
	await brackets.first().click();
	await expect(marker).toBeVisible();
	await expect(brackets).toHaveCount(0);
	await expect(page.locator(".cm-content").first()).not.toContainText("lorem ipsum");
});

test("tray parks just over the prompt", async ({ page }) => {
	// The reserve observer watches the box it writes to: unconditional
	// writes fed their own notifications (the "ResizeObserver loop"
	// console error), so the attach window must stay quiet.
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
	// The reserve sync lands a frame after the attach: poll past the
	// transient (a stuck negative would park the tray under the card).
	await expect.poll(gap, { timeout: 5_000 }).toBeGreaterThan(0);
	expect(await gap()).toBeLessThan(80);
	expect(roLoops).toEqual([]);
});
