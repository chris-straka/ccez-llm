import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({
		timeout: 60_000
	});
});

/** Select a word and save it as an annotation; resolves with the badge. */
async function addAnnotation(page: Page) {
	// Click on the text itself: the container's center is empty space
	// for short left-aligned messages and selects nothing.
	await page.locator("article.assistant .rendered p").dblclick({ position: { x: 10, y: 10 } });
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	const badge = page.locator(".prompt-tools .ann-pill");
	await expect(badge).toHaveText("1");
	return badge;
}

test("voice toggle is an icon with no text", async ({ page }) => {
	const voice = page.locator(".prompt-tools .voice-float");
	await expect(voice).toBeVisible();
	expect((await voice.innerText()).trim()).toBe("");
	expect(await voice.locator("svg").count()).toBe(1);
});

test("annotation tracker is a count badge left of the paperclip", async ({
	page
}) => {
	const badge = await addAnnotation(page);
	const badgeBox = await badge.boundingBox();
	const attachBox = await page.locator(".prompt-tools .attach-btn").boundingBox();
	if (!badgeBox || !attachBox) throw new Error("missing tool boxes");
	expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(attachBox.x);
	// The word "annotations" appears nowhere visible in the tools.
	expect(await page.locator(".prompt-tools").innerText()).not.toContain("nnotation");
});

/** Long chat payload so the thread overflows the viewport (idle-hide pays at any length now; overflow keeps it unambiguous). */
function longThread() {
	return Array.from({ length: 25 }, (_, i) => ({
		id: `e2e-long-${i}`,
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `message ${i} ` + "lorem ipsum dolor sit amet ".repeat(20),
		usage: null,
		error: null
	}));
}

test("idle-hide takes the attachment link with the prompt", async ({ page }) => {
	// Reseed: a long thread (overflow) plus a 2s idle timeout, then reload.
	await page.addInitScript((msgs) => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 2 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: msgs }])
		);
	}, longThread());
	await page.reload();
	await expect(page.locator("article.assistant .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	// A dropped file lands as an attachment link in the draft (no
	// tray on desktop).
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
	// An image alongside: its card rides above the prompt.
	await dropImage(page);
	const shots = page.locator(".composer-shots");
	await expect(shots.locator("img.composer-shot")).toHaveCount(1, { timeout: 15_000 });
	const prompt = page.locator(".prompt");
	// No input for 2s (+ticker): the prompt slides away with the link
	// inside it and the card with it — no attachment lingers over
	// the chat.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await expect(prompt).toHaveCSS("opacity", "0");
	await expect(shots).toHaveCSS("opacity", "0");
	// A summon key restores everything together (pointer travel alone
	// only re-arms the timer, never restores).
	await page.mouse.move(400, 200);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect(marker).toBeVisible({ timeout: 5_000 });
	await expect(shots).toHaveCSS("opacity", "1", { timeout: 5_000 });
});

test("empty chat never idle-hides the composer", async ({ page }) => {
	// No messages, 2s timeout: there is no text to uncover, so the
	// prompt and its strip stay put past the timeout.
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 2 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.reload();
	await expect(page.locator(".prompt")).toBeVisible({ timeout: 60_000 });
	await page.waitForTimeout(4000);
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/);
});

test.describe("phone idle default", () => {
	test.use({
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true
	});

	test("prompt stays visible on phones unless a timeout was chosen", async ({ page }) => {
		// Long thread (would hide on desktop) but NO stored timeout.
		await page.addInitScript((msgs) => {
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true })
			);
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: msgs }])
			);
		}, longThread());
		await page.reload();
		await expect(page.locator("article.assistant .rendered").first()).toBeVisible({
			timeout: 60_000
		});
		// Past the 6s desktop default: the phone composer stays put.
		await page.waitForTimeout(8000);
		await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/);
	});
});

test("ESC in the composer drops focus", async ({ page }) => {
	const editor = page.locator(".cm-content").first();
	await editor.click();
	await expect(editor).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(editor).not.toBeFocused();
});

test("composer text clears the tools cluster", async ({ page }) => {
	// First-line reservation holds the icon cluster clear: padding
	// meets the row's live width (the old >100px constant dated to
	// the Shot text-button era; the icon cluster is narrower, so the
	// invariant — never the number — is what pins the regression).
	const pad = await page
		.locator(".cm-content")
		.first()
		.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
	const toolsBox = await page.locator(".prompt-tools").boundingBox();
	if (!toolsBox) throw new Error("missing tools box");
	expect(pad).toBeGreaterThanOrEqual(toolsBox.width);
});

/** Drop a canvas-painted PNG onto the composer (in-page DataTransfer). */
async function dropImage(page: Page): Promise<void> {
	await page.evaluate(() => {
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
					transfer.items.add(new File([blob], "blue.png", { type: "image/png" }));
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
	});
}

test("send clears tags and files tag links above the message", async ({ page }) => {
	await dropImage(page);
	const marker = page.locator(".cm-attach-marker").first();
	await expect(marker).toBeVisible({ timeout: 15_000 });
	// Down to the tag's fresh line below (the click can land mid-tag,
	// and typing on the tag line would absorb it and drop the marker),
	// then send through the mock provider.
	await page.locator(".cm-content").first().click();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.type("hello");
	await page.keyboard.press("Enter");
	// No pill tray on desktop with the prompt at send time…
	await expect(page.locator(".attachments")).toHaveCount(0);
	// …and the sent turn carries the marker text as a link above its
	// text, with the same hover preview as the composer.
	const tag = page.locator("article.user .sent-tag").last();
	await expect(tag).toContainText("[Pasted image]", { timeout: 30_000 });
	await tag.hover();
	const preview = page.locator("article.user .sent-preview").last();
	await expect(preview).toBeVisible();
	await expect(preview.locator(".sent-img")).toBeVisible();
	await expect(preview.locator(".sent-meta")).toContainText("blue.png");
	// Clicking the tag is a no-op: the message actions stay shut.
	await tag.click();
	await expect(page.locator("article.user").last()).toHaveAttribute("data-actions-open", "false");
});

test("sent turns with many attachments scroll their tags", async ({ page }) => {
	// History rebuilds tags from the attachments (send strips the
	// literals): fourteen files ride one turn, far more than fit, so
	// the strip scrolls sideways instead of stretching the message.
	const pixel =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	const attachments = Array.from({ length: 14 }, (_, n) =>
		n % 2 === 0
			? {
					id: `e2e-img-${n}`,
					name: `shot-${n}.png`,
					mime: "image/png",
					kind: "image",
					dataUrl: pixel,
					text: null,
					width: 1,
					height: 1,
					tokens: 85
				}
			: {
					id: `e2e-file-${n}`,
					name: `notes-${n}.md`,
					mime: "text/markdown",
					kind: "text",
					dataUrl: null,
					text: `# notes ${n}`,
					width: null,
					height: null,
					tokens: 8
				}
	);
	await page.addInitScript((atts) => {
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
							content: "many files",
							usage: null,
							error: null,
							attachments: atts
						},
						{ id: "e2e-m1", role: "assistant", content: "got them", usage: null, error: null }
					]
				}
			])
		);
	}, attachments);
	await page.reload();
	const strip = page.locator("article.user .sent-tags").first();
	await expect(strip).toBeVisible({ timeout: 60_000 });
	const tags = page.locator("article.user .sent-tag");
	await expect(tags).toHaveCount(14);
	await expect(tags.first()).toContainText("[Pasted image]");
	await expect(tags.nth(1)).toContainText("[Pasted Attachment]");
	// Image tags preview thumbnails, file tags preview excerpts.
	await tags.first().hover();
	await expect(page.locator("article.user .sent-preview .sent-img").first()).toBeVisible();
	await tags.nth(1).hover();
	await expect(page.locator("article.user .sent-preview .sent-excerpt").first()).toContainText(
		"# notes 1"
	);
	// The strip scrolls: content wider than its box.
	const overflow = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeGreaterThan(0);
});

test("a stored literal renders inline with no strip duplicate", async ({ page }) => {
	// Turns stored before send-time stripping keep the literal in
	// their text: it rebuilds as a link in place, paired against the
	// attachment, and the strip above stays empty — each file shows
	// exactly once.
	const pixel =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	await page.addInitScript((url) => {
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
							content: "[Pasted image] what do you see here?",
							usage: null,
							error: null,
							attachments: [
								{
									id: "e2e-img-0",
									name: "shot.png",
									mime: "image/png",
									kind: "image",
									dataUrl: url,
									text: null,
									width: 1,
									height: 1,
									tokens: 85
								}
							]
						},
						{ id: "e2e-m1", role: "assistant", content: "a picture", usage: null, error: null }
					]
				}
			])
		);
	}, pixel);
	await page.reload();
	const body = page.locator("article.user .rendered").first();
	await expect(body).toBeVisible({ timeout: 60_000 });
	// One tag, inline where typed — and no strip above it.
	await expect(page.locator("article.user .sent-tag")).toHaveCount(1);
	await expect(page.locator("article.user .sent-tags")).toHaveCount(0);
	await expect(body).toContainText("what do you see here?");
	// Hovering the inline tag previews the image with its meta.
	const tag = page.locator("article.user .sent-tag").first();
	await tag.hover();
	const preview = page.locator("article.user .sent-preview").first();
	await expect(preview).toBeVisible();
	await expect(preview.locator(".sent-img")).toBeVisible();
	await expect(preview.locator(".sent-meta")).toContainText("shot.png");
	// Clicking it is a no-op: the message actions stay shut.
	await tag.click();
	await expect(page.locator("article.user").last()).toHaveAttribute("data-actions-open", "false");
});

test("popup touches the badge and clear-all lives inside it", async ({ page }) => {
	const badge = await addAnnotation(page);

	// The pill toggles the popup (hover never opens it): it floats
	// just above the tools row with the pill left exposed, so the
	// toggle stays clickable while open.
	await page.locator(".prompt-tools .ann-pill").click();
	const review = page.locator(".prompt-tools .review");
	await expect(review).toHaveCSS("opacity", "1");
	const reviewBox = await review.boundingBox();
	const wrapBox = await page.locator(".prompt-tools .ann-wrap").boundingBox();
	if (!reviewBox || !wrapBox) throw new Error("missing popup boxes");
	const gap = wrapBox.y - (reviewBox.y + reviewBox.height);
	expect(gap).toBeGreaterThanOrEqual(0);
	expect(gap).toBeLessThanOrEqual(14);

	// Clear-all is inside the popup now, not beside the badge.
	await expect(page.locator(".prompt-tools .ann-clear")).toHaveCount(0);
	await page.locator(".review-tools button").click();
	await expect(badge).toHaveCount(0);
});
