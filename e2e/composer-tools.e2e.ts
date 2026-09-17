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

test("paperclip opens the file picker and files a card", async ({ page }) => {
	// The button itself fires (drop coverage never touches it): the
	// native picker opens, and choosing the bmp fixture runs the full
	// attach path to a tray card with its composer tag.
	const btn = page.locator(".prompt-tools .attach-btn");
	await expect(btn).toBeVisible();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser", { timeout: 10_000 }),
		btn.click()
	]);
	await chooser.setFiles("e2e/fixtures/attach.bmp");
	const card = page.locator(".attachments li");
	await expect(card).toBeVisible({ timeout: 15_000 });
	await expect(page.locator(".ta-input")).toHaveValue(/\[Pasted image\]/);
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

test("idle-hide takes the attachment strip with the prompt", async ({ page }) => {
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
	// A dropped file lands as an attachment pill above the composer.
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
	const prompt = page.locator(".prompt");
	const strip = page.locator(".attachments");
	// No input for 2s (+ticker): the prompt slides away and the image
	// bubble goes with it — no pill lingers over the chat.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await expect(strip).toHaveClass(/composer-idle/);
	await expect(strip).toHaveCSS("opacity", "0");
	// Strip and card park as one unit: same settled translate and same
	// ramp (a taller tray on its own slide outran the prompt).
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const motion = (sel: string): string => {
						const el = document.querySelector(sel);
						if (!el) return "missing";
						const css = getComputedStyle(el);
						return `${css.transform} ## ${css.transitionDuration}`;
					};
					return `${motion("ul.attachments")} @@ ${motion("main .prompt")}`;
				}),
			{ timeout: 5_000 }
		)
		.toMatch(/^matrix\(1, 0, 0, 1, 0, 12\) ## 0\.25s, 0\.25s, 0s @@ matrix\(1, 0, 0, 1, 0, 12\)/);
	// A summon key restores both together (pointer travel alone only
	// re-arms the timer, never restores).
	await page.mouse.move(400, 200);
	await expect(prompt).toHaveClass(/prompt-idle/);
	await page.keyboard.press("i");
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
	await expect(strip).not.toHaveClass(/composer-idle/, { timeout: 5_000 });
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
	const editor = page.locator(".ta-input").first();
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
		.locator(".ta-input")
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

test("send clears pills and files an inline tag in the message", async ({ page }) => {
	await dropImage(page);
	const card = page.locator(".attachments li.card");
	await expect(card).toBeVisible({ timeout: 15_000 });
	// Down to the tag's fresh line below (the click can land mid-tag,
	// and typing on the tag line would absorb it and drop the pill),
	// then send through the mock provider.
	await page.locator(".ta-input").first().click();
	await page.keyboard.press("ArrowDown");
	await page.keyboard.type("hello");
	await page.keyboard.press("Enter");
	// Pills empty with the prompt at send time…
	await expect(page.locator(".attachments")).toHaveCount(0);
	// …and the sent turn carries the tag in its text flow (sends store
	// the literal): a body-size ink fold button like the composer tag.
	const tag = page.locator("article.user .rendered .sent-fold").last();
	await expect(tag).toContainText("[Pasted image]", { timeout: 30_000 });
	// Clicking floats the preview popup above the tag (image, name,
	// compact tokens, copy icon, OCR, X) without moving any message
	// content.
	const article = page.locator("article.user").last();
	const before = await article.boundingBox();
	await tag.click();
	const popup = page.locator("article.user .rendered .sent-open").last();
	await expect(popup).toBeVisible();
	await expect(popup.locator(".sent-img")).toBeVisible();
	await expect(popup).toContainText("blue.png");
	await expect(popup.locator(".sent-tok")).toHaveAttribute("title", /tokens/);
	await expect(popup.locator('button[aria-label="Copy attachment"] svg')).toBeVisible();
	await expect(popup.locator("button", { hasText: "OCR" })).toBeVisible();
	await expect(popup.locator('button[aria-label="Close preview"] svg')).toBeVisible();
	// Overlay by construction: opening moves nothing visible (1px
	// covers sub-pixel line-box noise, not content reflow).
	const after = await article.boundingBox();
	expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
	// Above the tag (inline tags carry text above them), above the
	// messages but under the floating composer in z.
	const boxes = await popup.evaluate((el) => {
		const tagEl = el.closest(".sent-wrap")?.querySelector(".sent-fold");
		const prompt = document.querySelector(".prompt");
		const r = el.getBoundingClientRect();
		const t = tagEl?.getBoundingClientRect();
		if (!t || !prompt) throw new Error("missing tag or prompt");
		return {
			popupBottom: r.y + r.height,
			tagTop: t.y,
			popupZ: getComputedStyle(el).zIndex,
			promptZ: getComputedStyle(prompt).zIndex
		};
	});
	expect(boxes.popupBottom).toBeLessThanOrEqual(boxes.tagTop + 1);
	expect(Number(boxes.popupZ)).toBeLessThan(Number(boxes.promptZ));
	// X closes; clicking away closes; the message actions never open.
	await popup.locator('button[aria-label="Close preview"]').click();
	await expect(popup).toBeHidden();
	await tag.click();
	await expect(popup).toBeVisible();
	await page.locator(".ta-input").first().click();
	await expect(popup).toBeHidden();
	await expect(page.locator('article.user [data-actions-open="true"]')).toHaveCount(0);
});

test("a stored literal renders inline at body size with no duplicate", async ({ page }) => {
	// Turns stored before send-time stripping keep the literal: it
	// rebuilds in place, paired against the attachment, and the strip
	// above stays empty — each file shows exactly once, at the same
	// size as the surrounding text.
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
	await expect(page.locator("article.user .sent-fold")).toHaveCount(1);
	await expect(page.locator("article.user .sent-tags")).toHaveCount(0);
	// Same size as the message text around it — not chip-small.
	const tag = page.locator("article.user .sent-fold").first();
	const sizes = await tag.evaluate((el) => {
		const p = el.closest("article")?.querySelector(".rendered p");
		if (!p) throw new Error("missing body paragraph");
		return {
			tag: getComputedStyle(el).fontSize,
			body: getComputedStyle(p).fontSize
		};
	});
	expect(sizes.tag).toBe(sizes.body);
	// Clicking floats the popup ABOVE the tag (inline tags carry
	// text above them) with the tag still visible right below it —
	// and message content never moves.
	const article = page.locator("article.user").first();
	const before = await article.boundingBox();
	await tag.click();
	const popup = page.locator("article.user .sent-open").first();
	await expect(popup).toBeVisible();
	await expect(popup.locator(".sent-img")).toBeVisible();
	await expect(popup).toContainText("shot.png");
	const after = await article.boundingBox();
	expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
	const boxes = await popup.evaluate((el) => {
		const tagEl = el.closest(".sent-wrap")?.querySelector(".sent-fold");
		const r = el.getBoundingClientRect();
		const t = tagEl?.getBoundingClientRect();
		if (!t) throw new Error("missing tag");
		return { popupBottom: r.y + r.height, tagTop: t.y };
	});
	expect(boxes.popupBottom).toBeLessThanOrEqual(boxes.tagTop + 1);
	// ESC closes the popup.
	await page.keyboard.press("Escape");
	await expect(popup).toBeHidden();
});

test("sent turns with many attachments scroll their tags", async ({ page }) => {
	// Fourteen files ride one stripped turn, far more than fit, so the
	// file-tag row scrolls sideways instead of stretching the message;
	// the image rides the inline flow (sends store its literal).
	const pixel =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	const attachments = [
		{
			id: "e2e-img-0",
			name: "shot-0.png",
			mime: "image/png",
			kind: "image",
			dataUrl: pixel,
			text: null,
			width: 1,
			height: 1,
			tokens: 85
		},
		...Array.from({ length: 14 }, (_, n) => ({
			id: `e2e-file-${n}`,
			name: `notes-${n}.md`,
			mime: "text/markdown",
			kind: "text",
			dataUrl: null,
			text: `# notes ${n}`,
			width: null,
			height: null,
			tokens: 8
		}))
	];
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
	// Fourteen file folds in the strip plus the image fold inline (tags
	// stay mounted beside their popups, so indices hold while open).
	await expect(page.locator("article.user .sent-fold")).toHaveCount(15);
	await page.locator("article.user .sent-inline .sent-fold").first().click();
	await expect(page.locator("article.user .sent-open .sent-img").first()).toBeVisible();
	// Close the image popup before reaching into the scrolled strip:
	// the overlay floats over the message and can cover the scrolled
	// row's folds.
	await page.keyboard.press("Escape");
	const folds = page.locator("article.user .sent-tags .sent-fold");
	// The strip scrolls sideways, and the runner's auto-scroll cannot
	// reach folds parked outside the viewport: click by dispatch
	// (the popup behavior below is the subject, not click mechanics).
	await folds.nth(1).evaluate((el) => (el as HTMLElement).click());
	const excerpt = page.locator("article.user .sent-open .sent-excerpt").first();
	await expect(excerpt).toBeVisible();
	await expect(excerpt).toContainText("# notes 1");
	// The strip scrolls: content wider than its box. Measure with
	// popups closed (an open popup flips the strip to visible
	// overflow, which reads zero by construction).
	await page.keyboard.press("Escape");
	const overflow = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeGreaterThan(0);
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
