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

test("removing the pill collapses the strip and clears its error", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// No bridge in the preview: OCR fails into the inline slot.
	await card.locator('button[aria-label="Recognize text in image"]').click();
	await expect(page.locator(".attach-error")).toBeVisible({ timeout: 15_000 });
	// The X takes the pill, its tag, the strip, and the stale error —
	// nothing lingers over the next draft.
	await card.locator('button[aria-label="Remove attachment"]').click();
	await expect(page.locator(".attachments")).toHaveCount(0);
	await expect(page.locator(".attach-error")).toHaveCount(0);
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
