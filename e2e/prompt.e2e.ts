import { devices, expect, test } from "@playwright/test";
import { seedChat, toggleSidebar } from "./helpers";

/** Staging (Alt+Enter, no reply stream) pins the scroller to the true
bottom: measuring in the send tick reads the pre-append height and the
scroll stops short by the new message (the short-landing send bug —
a tall viewport can still show the message, so assert the scroller,
not visibility). */
test("staging pins the scroller to the true bottom", async ({ page }) => {
	const history = Array.from({ length: 12 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `history filler paragraph ${i} with enough words to wrap several lines on any phone or desktop column`
	}));
	await seedChat(page, [...history, { role: "assistant", content: "ready" }]);
	await page.goto("/");
	// seedChat presets never-idle, so the composer is clickable even
	// with thirteen messages overflowing the viewport.
	await page.locator(".ta-input").click();
	await page.keyboard.type("staged hello");
	// Start genuinely stuck (a real scroll, so the flag and geometry
	// agree): the pin below asserts the landing, not the yank — a
	// mid-thread stage stays put (pinned in stick-scroll.e2e.ts).
	await page.evaluate(() => {
		document
			.querySelector("main .messages")
			?.scrollTo({ top: 1e9, behavior: "instant" as ScrollBehavior });
	});
	await page.waitForFunction(() => {
		const el = document.querySelector("main .messages");
		return el ? el.scrollHeight - el.scrollTop - el.clientHeight < 64 : false;
	});
	await page.keyboard.press("Alt+Enter");
	await expect(page.locator("article.user").last()).toContainText(
		"staged hello"
	);
	// The smooth scroll lands after the render: poll past the motion.
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const el = document.querySelector("main .messages");
				return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 999;
			})
		)
		.toBeLessThanOrEqual(2);
});

/** Summoning the parked composer neither hides the tail nor moves the
thread: the tail reserve never collapses while parked, so the last
line already clears the opaque card and the scroll position survives
the summon untouched (the floating-card regression covered the tail,
and re-sticking yanked it upward — both read as hiding text). */
test("summoning the parked composer keeps the tail visible", async ({
	page
}) => {
	// Thirty one-line messages (not one tall paragraph): the last line
	// is fully viewable, so the parking click below never triggers the
	// driver's scroll-into-view and the test reads the app, not the rig.
	const bodies = Array.from(
		{ length: 30 },
		(_, i) =>
			`tail line ${i} with enough words to wrap and overflow the viewport`
	);
	await page.addInitScript((contents: string[]) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: contents.map((content, n) => ({
						id: `m${n}`,
						role: "assistant",
						content,
						usage: null,
						error: null
					}))
				}
			])
		);
	}, bodies);
	await page.goto("/");
	const last = page.locator("article .rendered").last();
	await expect(last).toBeVisible({ timeout: 60_000 });
	// Settle webfonts first: a mid-test font swap changes line heights
	// and re-clamps scrollTop, which reads as the summon moving text.
	await page.evaluate(() => document.fonts.ready);
	// Read at the bottom like a real tail reader: pin the scroller to
	// the true bottom, instantly (the box is smooth-scrolled, so a
	// gliding pin would still be moving under later reads; scrolling
	// the whole-message div is a no-op — it is always partially
	// visible — so drive the box directly).
	await page.evaluate(() => {
		const box = document.querySelector("main .messages") as HTMLElement;
		box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
	});
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const box = document.querySelector("main .messages") as HTMLElement;
				return box.scrollHeight - box.scrollTop - box.clientHeight;
			})
		)
		.toBeLessThanOrEqual(2);
	// Park it: clicking the already-visible last line drops composer
	// focus without moving the scroll, and always-hide takes the card
	// away, uncovering the tail.
	await page.locator("article .rendered p").last().click();
	const composer = page.locator("main .prompt");
	await expect(composer).toHaveClass(/prompt-idle/, { timeout: 10_000 });
	// Summon it back: the tail must already clear the card (the reserve
	// never collapsed), and the scroll position must survive untouched.
	const scroller = "main .messages";
	const parkedTop = await page.evaluate(
		(sel: string) => document.querySelector(sel)?.scrollTop ?? -1,
		scroller
	);
	await page.keyboard.press("i");
	await expect(composer).not.toHaveClass(/prompt-idle/, { timeout: 10_000 });
	await expect
		.poll(async () =>
			page.evaluate(() => {
				const paras = [...document.querySelectorAll("article .rendered p")];
				const tail = paras[paras.length - 1]?.getBoundingClientRect();
				const card = document
					.querySelector("main .prompt")
					?.getBoundingClientRect();
				if (!tail || !card) return 9999;
				return tail.bottom - card.top;
			})
		)
		.toBeLessThanOrEqual(0);
	expect(
		await page.evaluate(
			(sel: string) => document.querySelector(sel)?.scrollTop ?? -1,
			scroller
		)
	).toBe(parkedTop);
});

/** The composer is solid and opaque: no translucency, no backdrop
blur anywhere (legacy opacity keys in older saves purge unread).
The thread still runs full-height behind the floating card — the
tail reserve keeps it clear — but nothing ghosts through. */
test("composer card is solid with no backdrop blur", async ({ page }) => {
	const lines = Array.from(
		{ length: 30 },
		(_, i) =>
			`tail line ${i} with enough words to wrap and overflow the viewport`
	).join("\n");
	await page.addInitScript((content: string) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0, composerOpacity: 0.5, bgOpacity: 0.5 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{ id: "m", role: "assistant", content, usage: null, error: null }
					]
				}
			])
		);
	}, lines);
	await page.goto("/");
	const composer = page.locator("main .prompt");
	await expect(composer).toBeVisible({ timeout: 60_000 });
	const glass = await page.evaluate(() => {
		const el = document.querySelector("main .prompt") as HTMLElement | null;
		if (!el) throw new Error("no composer");
		const style = getComputedStyle(el);
		// Computed colors serialize per engine (rgba() commas,
		// space-separated rgb(), or color()): only a four-part comma
		// form or a slash-alpha carries transparency.
		let alpha = 1;
		const inner = style.backgroundColor.match(/^(?:rgba?|color)\(([^)]+)\)$/);
		if (inner) {
			const body = inner[1]!;
			if (body.includes(",")) {
				const parts = body.split(",").map((part) => part.trim());
				alpha = parts.length === 4 ? parseFloat(parts[3]!) : 1;
			} else {
				alpha = parseFloat(body.match(/\/\s*([\d.]+)\s*$/)?.[1] ?? "1");
			}
		}
		return {
			alpha,
			blur: `${style.backdropFilter} ${style.getPropertyValue("-webkit-backdrop-filter")}`
		};
	});
	expect(glass.alpha).toBe(1);
	// Absent filters serialize as "none" (either prefix), never blur().
	expect(glass.blur).not.toMatch(/blur\(/);
});

/** The composer is solid by default: fully opaque, no backdrop blur
(the frost experiments are gone; the card floats over the thread on
the tail reserve, never ghosts through it). */
test("composer card is solid by default", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "m",
							role: "assistant",
							content: "hi",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	});
	await page.goto("/");
	const composer = page.locator("main .prompt");
	await expect(composer).toBeVisible({ timeout: 60_000 });
	await expect(composer).not.toHaveClass(/glass/);
	const glass = await page.evaluate(() => {
		const el = document.querySelector("main .prompt") as HTMLElement | null;
		if (!el) throw new Error("no composer");
		const style = getComputedStyle(el);
		let alpha = 1;
		const inner = style.backgroundColor.match(/^(?:rgba?|color)\(([^)]+)\)$/);
		if (inner) {
			const body = inner[1]!;
			if (body.includes(",")) {
				const parts = body.split(",").map((part) => part.trim());
				alpha = parts.length === 4 ? parseFloat(parts[3]!) : 1;
			} else {
				alpha = parseFloat(body.match(/\/\s*([\d.]+)\s*$/)?.[1] ?? "1");
			}
		}
		return {
			alpha,
			blur: `${style.backdropFilter} ${style.getPropertyValue("-webkit-backdrop-filter")}`
		};
	});
	expect(glass.alpha).toBe(1);
	// Absent filters serialize as "none" (either prefix), never blur().
	expect(glass.blur).not.toMatch(/blur\(/);
});

/** The thread runs full-height behind the floating card: mid-thread
text overlaps the composer's rect (the solid card covers it; the
tail reserve keeps the last line clear). A main-level reserve would
shrink the scroller and clip everything above the card instead.
Measured synchronously so the stick glide can't re-pin between the
scroll and the read. */
test("thread paints behind the floating composer", async ({ page }) => {
	const lines = Array.from(
		{ length: 30 },
		(_, i) =>
			`tail line ${i} with enough words to wrap and overflow the viewport`
	).join("\n");
	await page.addInitScript((content: string) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: 0 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{ id: "m", role: "assistant", content, usage: null, error: null }
					]
				}
			])
		);
	}, lines);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const overlap = await page.evaluate(() => {
		const box = document.querySelector("main .messages") as HTMLElement | null;
		const card = document.querySelector("main .prompt") as HTMLElement | null;
		if (!box || !card) throw new Error("missing scroller or composer");
		box.scrollTo({
			top: box.scrollHeight - box.clientHeight - 600,
			behavior: "instant"
		});
		const cardRect = card.getBoundingClientRect();
		const paras = [...document.querySelectorAll("article .rendered")];
		return Math.max(
			...paras.map((p) => {
				const rect = p.getBoundingClientRect();
				return (
					Math.min(rect.bottom, cardRect.bottom) -
					Math.max(rect.top, cardRect.top)
				);
			})
		);
	});
	expect(overlap).toBeGreaterThan(0);
});

/** Reduced motion settles the summon instantly: the card and its
strip run no transition, so the landed frame is the final one. */
test("reduced motion settles the composer instantly", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{
							id: "m",
							role: "assistant",
							content: "hi",
							usage: null,
							error: null
						}
					]
				}
			])
		);
	});
	await page.goto("/");
	const composer = page.locator("main .prompt");
	await expect(composer).toBeAttached({ timeout: 60_000 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.keyboard.press("i");
	await expect(composer).not.toHaveClass(/prompt-idle/, { timeout: 10_000 });
	const durations = await page.evaluate(() => {
		const el = document.querySelector("main .prompt") as HTMLElement | null;
		if (!el) throw new Error("no composer");
		return getComputedStyle(el)
			.transitionDuration.split(",")
			.map((part) => parseFloat(part));
	});
	expect(durations.length).toBeGreaterThan(0);
	for (const seconds of durations) expect(seconds).toBe(0);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	// The ramp comes back with the setting: the summon slides again
	// (the visibility flip legitimately stays instant, so the longest
	// ramp — not every entry — must be positive).
	const live = await page.evaluate(() => {
		const el = document.querySelector("main .prompt") as HTMLElement | null;
		if (!el) throw new Error("no composer");
		return getComputedStyle(el)
			.transitionDuration.split(",")
			.map((part) => parseFloat(part));
	});
	expect(Math.max(...live)).toBeGreaterThan(0);
});
/** A press inside the composer outlives a focusout to nowhere: WebKit
(the Tauri shell) never focuses the button being pressed, so the
editor blurs with a null target where Chromium reports the button
itself. Parking there would hide the composer and eat the press's
click behind pointer-events:none — tools buttons and the pill review
toggle silently die. The idle ticker still re-parks a genuinely
unfocused composer, so the guard only bridges the press in flight. */
test("in-prompt press outlives a focusout to nowhere", async ({ page }) => {
	await page.addInitScript((content: string) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-chat",
					createdAt: 1,
					replyLang: null,
					messages: [
						{ id: "m", role: "assistant", content, usage: null, error: null }
					]
				}
			])
		);
	}, "stuck composer probe with enough words to render");
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const composer = page.locator("main .prompt");
	await page.keyboard.press("i");
	await expect(composer).not.toHaveClass(/prompt-idle/, { timeout: 10_000 });
	const editor = page.locator(".prompt .ta-input");
	await editor.click();
	// WebKit button press: a real mousedown inside the composer (stamps
	// the press), then the editor blurs to nowhere (relatedTarget null)
	// because WebKit never focuses the button. Release off-button so no
	// file picker opens.
	const attachBox = await page
		.locator(".prompt-tools .attach-btn")
		.boundingBox();
	if (!attachBox) throw new Error("attach button has no box");
	await page.mouse.move(
		attachBox.x + attachBox.width / 2,
		attachBox.y + attachBox.height / 2
	);
	await page.mouse.down();
	// A real FocusEvent (Playwright's dispatchEvent builds a generic
	// Event for focusout, whose relatedTarget reads undefined): WebKit
	// delivers null when the press focuses no button.
	await editor.evaluate((el) => {
		el.dispatchEvent(
			new FocusEvent("focusout", { bubbles: true, relatedTarget: null })
		);
	});
	await page.mouse.move(8, 8);
	await page.mouse.up();
	await page.waitForTimeout(600);
	await expect(composer).not.toHaveClass(/prompt-idle/);
});
/** The composer box dwarfs a one-line draft: tapping its empty floor
focuses the editor instead of dying on the container. */
test("clicking the composer floor focuses and types", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	// Mounted only — never clicked, so only the floor tap can focus.
	await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
	const box = await page.locator(".prompt").boundingBox();
	if (!box) throw new Error("composer lost its box");
	await page.mouse.click(box.x + 30, box.y + box.height - 12);
	await page.keyboard.type("floor tap");
	await expect(page.locator(".ta-input")).toHaveValue("floor tap");
});

test("phone floor tap focuses the textarea", async ({ browser }) => {
	const ctx = await browser.newContext({ ...devices["iPhone 15"] });
	const page = await ctx.newPage();
	try {
		await seedChat(page, []);
		await page.goto("/");
		await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
		const box = await page.locator(".prompt").boundingBox();
		if (!box) throw new Error("composer lost its box");
		// Right of the tools cluster: the prompt-tools container, not
		// a button (the paperclip owns the left edge) — the floor tap
		// focuses the editor instead of dying on the container.
		await page.touchscreen.tap(box.x + 250, box.y + box.height - 20);
		await expect(page.locator(".ta-input")).toBeFocused();
	} finally {
		await ctx.close();
	}
});

test("prompt types and sends without vim", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".ta-input").click();
	await page.keyboard.type("hello world");
	await expect(page.locator(".ta-input")).toHaveValue("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText(
		"hello world"
	);
	// Ctrl+G still hops out to scroll mode.
	await page.locator(".ta-input").click();
	await page.keyboard.press("Control+g");
	await expect(page.locator(".ta-input")).toHaveAttribute(
		"placeholder",
		" Ctrl+G to hop back in"
	);
});

/** j past the newest message drops back into the prompt. */
test("j on the newest message returns to the prompt", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "one" },
		{ role: "assistant", content: "two" }
	]);
	await page.goto("/");
	await page.locator(".ta-input").click();
	await page.keyboard.press("Control+g");
	await expect(page.locator('.app[data-focus-mode="scroll"]')).toHaveCount(1);
	// G lands on the newest message; j past it hops back to edit mode.
	await page.keyboard.press("G");
	await page.keyboard.press("j");
	await expect(page.locator('.app[data-focus-mode="edit"]')).toHaveCount(1);
});

/** The prompt grows with the draft, then stops and scrolls inside. */
test("long drafts cap the prompt height and scroll", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".ta-input").click();
	for (let i = 0; i < 15; i++) {
		await page.keyboard.type(`draft line ${i + 1}`);
		await page.keyboard.press("Shift+Enter");
	}
	const sizes = await page.evaluate(() => {
		// The plain textarea scrolls itself: no inner scroller node.
		const box = document.querySelector(".prompt .ta-input");
		if (!(box instanceof HTMLElement)) return null;
		return {
			client: box.clientHeight,
			scroll: box.scrollHeight,
			cap: Math.round(window.innerHeight * 0.4)
		};
	});
	if (!sizes) throw new Error("prompt box missing");
	// max-height: 40vh caps the growth while the content overflows
	// into an internal scroll.
	expect(sizes.client).toBeLessThanOrEqual(sizes.cap + 2);
	expect(sizes.scroll).toBeGreaterThan(sizes.client);
});

/** The prompt review card toggles on pill click (opacity and
visibility transition, never a display snap): hover alone never
opens it, and mouse travel never closes it. */
test("prompt review card toggles on pill click", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "fading review card" }]);
	await page.goto("/");
	await page
		.locator('article .rendered:has-text("fading review card")')
		.first()
		.selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	// Pin the filing (nothing pins on file): Enter opens its answer
	// card, re-press pins it, Escape shuts the card.
	const ready = page.locator("button.ccez-ann-badge.ans-ready").first();
	await expect(ready).toBeVisible({ timeout: 30_000 });
	await ready.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toBeVisible();
	await page.keyboard.press("Escape");
	const card = page.locator(".ann-wrap .review");
	const opacity = () => card.evaluate((el) => getComputedStyle(el).opacity);
	// Closed: invisible but laid out (display fade needs the box).
	expect(await opacity()).toBe("0");
	// Hover alone opens nothing.
	const box = await pill.boundingBox();
	if (!box) throw new Error("pill has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(400);
	expect(await opacity()).toBe("0");
	// The click toggles open; wandering the mouse keeps it open.
	await pill.click();
	await expect.poll(opacity, { timeout: 2000 }).toBe("1");
	await page.mouse.move(4, 300);
	await page.waitForTimeout(400);
	expect(await opacity()).toBe("1");
	// And back shut.
	await pill.click();
	await expect.poll(opacity, { timeout: 2000 }).toBe("0");
});

/** The draft text uses the same typeface as the chat messages — the
composer is a message being written, not a code editor. */
test("prompt typeface matches the chat typeface", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "same typeface" }]);
	await page.goto("/");
	// Raw evaluate does not auto-wait like locators do: hold for
	// hydration before reading computed styles.
	await page.locator(".prompt .ta-input").waitFor();
	await page.locator('article[id^="msg-"] .rendered').waitFor();
	const fonts = await page.evaluate(() => {
		const cm = document.querySelector(".prompt .ta-input");
		const msg = document.querySelector('article[id^="msg-"] .rendered');
		if (!(cm instanceof HTMLElement) || !(msg instanceof HTMLElement))
			return null;
		return {
			prompt: getComputedStyle(cm).fontFamily,
			message: getComputedStyle(msg).fontFamily
		};
	});
	if (!fonts) throw new Error("prompt or message node missing");
	expect(fonts.prompt).toBe(fonts.message);
	expect(fonts.prompt).not.toMatch(/fira|mono/i);
});

/** The document never scrolls: every pane moves inside .app, so iOS
can't pan the page (and the header pill) up when the keyboard opens.
Real keyboard travel is device-only; this pins the rule. */
test("document scroll is locked", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".ta-input").first().waitFor({ timeout: 60_000 });
	const overflow = await page.evaluate(() => ({
		html: getComputedStyle(document.documentElement).overflow,
		body: getComputedStyle(document.body).overflow
	}));
	expect(overflow.html).toBe("hidden");
	expect(overflow.body).toBe("hidden");
});

/** A cleared highlight drops the menu at once — a real tap elsewhere
(press-backed) dismisses through the click path, so without a
selectionchange dismiss the menu would strand on a dead highlight.
(Bare removeAllRanges with no press behind it is the engine
hover-clear shape, which the menu survives — see sel-menu.) */
test("a cleared highlight drops the menu at once", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "prompt halo" }]);
	await page.goto("/");
	await page
		.locator('article .rendered:has-text("prompt halo")')
		.first()
		.selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.mouse.click(10, 300);
	await expect(menu).toHaveCount(0, { timeout: 1500 });
	await expect
		.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ""))
		.toBe("");
});

/** Scrolling never dismisses a live selection menu on desktop: the
menu tracks its highlight (trackSelMenu) instead of dying in
noteScrolling. */
test("scrolling keeps a live selection menu", async ({ page }) => {
	const history = Array.from({ length: 12 }, (_, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: `history filler paragraph ${i} with enough words to wrap several lines on any phone or desktop column`
	}));
	await seedChat(page, [
		...history,
		{ role: "assistant", content: "halo keeper" }
	]);
	await page.goto("/");
	await page
		.locator('article .rendered:has-text("halo keeper")')
		.first()
		.selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.mouse.wheel(0, -400);
	await page.waitForTimeout(600);
	await expect(menu).toBeVisible();
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toContain("halo");
});

/** Sidebar hover preview yields to a live highlight: glancing at
another chat neither swaps the column nor drops the menu. */
test("sidebar hover keeps a live highlight and its menu", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const chat = (id: string, content: string) => ({
			id,
			createdAt: 1,
			replyLang: null,
			messages: [
				{ id: `${id}-m0`, role: "assistant", content, usage: null, error: null }
			]
		});
		// The first chat is active on load.
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				chat("e2e-active", "halo keeper"),
				chat("e2e-other", "other chat body")
			])
		);
	});
	await page.goto("/");
	await page
		.locator('article .rendered:has-text("halo keeper")')
		.first()
		.selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	// The other chat's row: without the yield this previews it (menu
	// gone, column swapped); with it, nothing moves.
	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await page.waitForTimeout(400);
	await expect(menu).toBeVisible();
	await expect(page.locator("main .messages")).toContainText("halo keeper");
	await expect(page.locator("main .messages")).not.toContainText(
		"other chat body"
	);
	expect(
		await page.evaluate(() => window.getSelection()?.toString() ?? "")
	).toContain("halo");
});

/** A sidebar preview reserves the same action rows as the open chat
without showing them: under hover-only rhythm the peek takes up the
row's space (opening the chat moves nothing) while the buttons —
and any error text riding with them — stay hidden until hovered in
the open chat. */
test("sidebar preview reserves action space without showing the row", async ({
	page
}) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const msg = (id: string, content: string, error: string | null) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-plain",
					createdAt: 1,
					replyLang: null,
					messages: [msg("e2e-plain-m", "plain thread", null)]
				},
				{
					id: "e2e-err",
					createdAt: 2,
					replyLang: null,
					messages: [msg("e2e-err-m", "failed thread", "Something broke")]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	const rows = page.locator("aside ul li button.side-chat");
	await rows.nth(1).hover();
	// The row is mounted (its space reserved) but invisible under
	// hover-only rhythm; the error rides with it, also mounted.
	const previewRow = page.locator("main .messages .actions");
	await expect(previewRow).toHaveCount(1);
	await expect(previewRow).toHaveCSS("opacity", "0");
	await expect(page.locator("main .messages .error")).toHaveCount(1);
	await rows.nth(1).click();
	await expect(page.locator("main .messages .actions")).toHaveCount(1);
	await expect(page.locator("main .messages .error")).toHaveCount(1);
});

/** Returning to a chat restores where you left: every switch files
the leaving chat's scroll position, and the landing puts it back —
chats with nothing filed still start at the top. */
test("returning to a chat restores its scroll position", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const lines = (tag: string) =>
			Array.from({ length: 120 }, (_, i) => `${tag} line ${i}`).join("\n");
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "e2e-a",
					createdAt: 1,
					replyLang: null,
					messages: [msg("e2e-a-m", lines("Alpha"))]
				},
				{
					id: "e2e-b",
					createdAt: 2,
					replyLang: null,
					messages: [msg("e2e-b-m", lines("Beta"))]
				}
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const box = page.locator("main .messages");
	await box.evaluate((el) => el.scrollTo({ top: 300 }));
	await page.waitForTimeout(300);
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	const rows = page.locator("aside ul li button.side-chat");
	// The unvisited chat starts at the top like today.
	await rows.nth(1).click();
	await expect
		.poll(() => box.evaluate((el) => el.scrollTop), { timeout: 8000 })
		.toBe(0);
	// Back on the first chat: where it was left, not the top.
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await rows.nth(0).click();
	await expect
		.poll(() => box.evaluate((el) => el.scrollTop), { timeout: 8000 })
		.toBeGreaterThan(200);
});

/** An empty chat never hides the composer: arriving with the flag set
(parked on a previous thread under always-hide) clears it, or the one
place that must compose stays stranded hidden. */
test("empty chat restores an idle-hidden composer", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ promptIdleSec: -1 })
		);
		const chat = (id: string, messages: unknown[]) => ({
			id,
			createdAt: 1,
			replyLang: null,
			messages
		});
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				chat("chat-a", [msg("chat-a-m", "Alpha thread with a message.")]),
				chat("chat-b", [])
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	const composer = page.locator("main .prompt");
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	const rows = page.locator("aside ul li button.side-chat");
	// Park it on the full chat first (always-hide drops the composer
	// once focus leaves it).
	await rows.nth(0).click();
	await page.locator("article .rendered").first().click();
	await expect(composer).toBeHidden();
	// The empty chat's row restores the composer on switch (row
	// picks collapse the sidebar, so reopen it first).
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await rows.nth(1).click();
	await expect(composer).toBeVisible();
});

/** On an empty chat, bare Space, Enter, and i all land in the composer:
there is nothing to scroll, so each is a summon (never typed). */
test("empty chat Space Enter i focus the composer", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	const inPrompt = () =>
		page.evaluate(() => !!document.activeElement?.closest?.(".prompt"));
	for (const key of ["Space", "Enter", "i"]) {
		// The hero takes focus back to the body without summoning.
		await page.locator(".hero").click();
		expect(await inPrompt()).toBe(false);
		await page.keyboard.press(key);
		await expect.poll(inPrompt, { timeout: 5000 }).toBe(true);
	}
});

/** Hovering an empty chat previews its full empty state — hero, language
pills, and composer — inert, so every tap still belongs to the active chat. */
test("empty preview shows inert pills and composer", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		const chat = (id: string, messages: unknown[]) => ({
			id,
			createdAt: 1,
			replyLang: null,
			messages
		});
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				chat("chat-a", [msg("chat-a-m", "Alpha thread with a message.")]),
				chat("chat-b", [])
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	// The open sidebar parks the live composer...
	await expect(page.locator("main .prompt")).toBeHidden();
	// ...but hovering the empty row previews it back, with the pills.
	await page.locator("aside ul li button.side-chat").nth(1).hover();
	await expect(page.locator("main .hero")).toBeVisible();
	await expect(page.locator("main .lang-menus")).toBeVisible();
	const previewPrompt = page.locator("main .prompt.prompt-preview");
	await expect(previewPrompt).toBeVisible();
	await expect(previewPrompt).toHaveAttribute("inert", "");
	await expect(page.locator("main .lang-menus")).toHaveAttribute("inert", "");
	await expect(page.locator("main .messages")).not.toContainText(
		"Alpha thread"
	);
	// Clicking the previewed row lands directly: the preview clears
	// inside the switch, so the column never flashes back to Alpha.
	await page.locator("aside ul li button.side-chat").nth(1).click();
	await expect(page.locator("aside").first()).toHaveClass(/collapsed/);
	await expect(page.locator("main .hero")).toBeVisible();
	await expect(page.locator("main .messages")).not.toContainText(
		"Alpha thread"
	);
	await expect(page.locator("main .prompt")).toBeVisible();
});
