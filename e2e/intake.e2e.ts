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
	// A .md drop lands as a [Pasted Attachment] link in the draft (no
	// pill tray on desktop); its popup names the file.
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
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toContainText("[Pasted Attachment]", { timeout: 15_000 });
	await marker.hover();
	await expect(page.locator(".cm-attach-preview .cm-attach-meta").first()).toContainText(
		"notes.md"
	);
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

test("dropped images land as links with a hover preview", async ({ page }) => {
	await dropImage(page);
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toBeVisible({ timeout: 15_000 });
	await expect(marker).toContainText("[Pasted image]");
	// Hover reveals the preview: thumbnail, file meta, and Copy/OCR.
	await marker.hover();
	const preview = page.locator(".cm-attach-preview").first();
	await expect(preview).toBeVisible();
	await expect(preview.locator(".cm-attach-img")).toBeVisible();
	await expect(preview.locator(".cm-attach-meta")).toContainText("blue.png");
	await expect(preview.locator('button[aria-label="Copy attachment"]')).toBeVisible();
	await expect(preview.locator('button[aria-label="Recognize text in image"]')).toBeVisible();
	// Clicking the link itself is a no-op: the tag stays, the draft
	// keeps its text, and nothing navigates.
	const url = page.url();
	await marker.click();
	await expect(page.locator(".cm-attach-marker")).toHaveCount(1);
	await expect(page.locator(".cm-content")).toContainText("[Pasted image]");
	expect(page.url()).toBe(url);
});

test("pasted tag leaves the caret after its space, same line", async ({ page }) => {
	await dropImage(page);
	const content = page.locator(".cm-content");
	await expect(content).toContainText("[Pasted image]", { timeout: 15_000 });
	// End takes the caret to the tag line's end, then type: the word
	// must land beside the tag (old own-line placement parked the
	// caret below, so typing opened a second line). The marker's
	// popup contributes its own text nodes, so same-line reads off
	// the rendered line, not the whole editor text.
	await content.click();
	await page.keyboard.press("End");
	await page.keyboard.type("hi");
	await expect
		.poll(() =>
			content.evaluate((el) => {
				const line = el.querySelector(".cm-attach-marker")?.closest(".cm-line");
				return !!line && (line.textContent ?? "").endsWith("hi");
			})
		)
		.toBe(true);
});

test("failed OCR surfaces inline, tag deletion clears it", async ({ page }) => {
	await dropImage(page);
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toBeVisible({ timeout: 15_000 });
	// No bridge in the preview: OCR fails into the inline slot under
	// the composer.
	await marker.hover();
	await page
		.locator('.cm-attach-preview button[aria-label="Recognize text in image"]')
		.first()
		.click();
	await expect(page.locator(".attach-error")).toBeVisible({ timeout: 15_000 });
	// Deleting the tag drops the marker and the stale error with it —
	// nothing lingers over the next draft.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.type("hello");
	await expect(page.locator(".cm-attach-marker")).toHaveCount(0);
	await expect(page.locator(".attach-error")).toHaveCount(0);
	await expect(page.locator(".cm-content")).toContainText("hello");
});

test("composer shows image cards above the prompt", async ({ page }) => {
	await dropImage(page);
	// The persistent preview: thumbnail only, no pill chrome — one
	// card per image, stacked above the prompt, never overlapping it.
	const shots = page.locator(".composer-shots");
	await expect(shots).toBeVisible({ timeout: 15_000 });
	const shot = shots.locator("img.composer-shot").first();
	await expect(shot).toBeVisible();
	expect(await shot.getAttribute("src")).toMatch(/^data:image\//);
	const shotsBox = await shots.boundingBox();
	const promptBox = await page.locator(".prompt").boundingBox();
	if (!shotsBox || !promptBox) throw new Error("missing boxes");
	expect(shotsBox.y + shotsBox.height).toBeLessThanOrEqual(promptBox.y + 1);
});

test("attachment links never cover message text", async ({ page }) => {
	await dropImage(page);
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toBeVisible({ timeout: 15_000 });
	// No tray on desktop: the link lives in-flow inside the composer,
	// so it cannot occlude the thread — it sits within the prompt box.
	await expect(page.locator(".attachments")).toHaveCount(0);
	const markerBox = await marker.boundingBox();
	const promptBox = await page.locator(".prompt").boundingBox();
	if (!markerBox || !promptBox) throw new Error("missing boxes");
	expect(markerBox.y).toBeGreaterThanOrEqual(promptBox.y);
	expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(
		promptBox.y + promptBox.height + 1
	);
});

test("deleting the tag drops the attachment", async ({ page }) => {
	await dropImage(page);
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toBeVisible({ timeout: 15_000 });
	// Replacing the whole draft (markers included) drops the image
	// attachment, like hand-deleting the tag. Meta+A: the macOS
	// select-all — Control+A only jumps to the line start in the
	// editor, so typing would prepend instead of replacing.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Meta+a");
	await page.keyboard.type("hello");
	await expect(page.locator(".cm-attach-marker")).toHaveCount(0);
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
