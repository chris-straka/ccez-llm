import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Scrollkeys bucket (desktop, nothing selected): bare j/k
 * smooth-scroll the chat, bare d/u skip one smooth fixed step per
 * tap (216px — quick, never a half-page jump; holds ramp from j/k
 * speed to 3x), gg goes to top, G to the bottom, and z/Z land the
 * hovered message's top/bottom. Ctrl+U / Ctrl+D jump an instant
 * half-page.
 * Escape still dismisses overlays exactly as today and never exits
 * fullscreen (only the Esc+f chord does, which needs a real window
 * chrome that playwright cannot cover: see exitFullscreen in
 * +page.svelte).
 *
 * Editor selector note: every platform composes in the plain
 * textarea (`.ta-input`, textarea-editor.ts) — CodeMirror is gone —
 * so this spec waits for `.ta-input`.
 */
test.setTimeout(90_000);

const LONG = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(
	40
);

function turns(): Array<{ role: "user" | "assistant"; content: string }> {
	return [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${LONG}` },
		{ role: "assistant" as const, content: `answer ${n} ${LONG}` }
	]);
}

async function scrollTop(page): Promise<number> {
	return page.evaluate(
		() =>
			(document.querySelector(".messages") as HTMLElement | null)?.scrollTop ??
			-1
	);
}

async function deselectToBody(page): Promise<void> {
	// Single click on the right gutter: no message, no control, so
	// focus lands on the body with nothing selected (edit mode,
	// selectedIdx -1). Double-click would open sidebars; a single
	// click only drops focus.
	await page.mouse.click(1240, 400);
	await page.waitForFunction(() => document.activeElement === document.body, {
		timeout: 10_000
	});
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, turns());
	await page.goto("/");
	// The composer is a plain textarea on every platform now.
	await page.locator(".prompt .ta-input").waitFor({ timeout: 60_000 });
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollHeight > box.clientHeight + 500;
		},
		{ timeout: 15_000 }
	);
	await deselectToBody(page);
});

test("j/k smooth-scroll down and back up with nothing selected", async ({
	page
}) => {
	const before = await scrollTop(page);
	await page.keyboard.press("j");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop > prev;
		},
		before,
		{ timeout: 10_000 }
	);
	const down = await scrollTop(page);
	expect(down).toBeGreaterThan(before);
	await page.keyboard.press("k");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop < prev;
		},
		down,
		{ timeout: 10_000 }
	);
	expect(await scrollTop(page)).toBeLessThan(down);
});

test("bare d/u skip one smooth step; ctrl+d jumps and ctrl+u climbs back", async ({
	page
}) => {
	const before = await scrollTop(page);
	const half = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box ? Math.floor(box.clientHeight / 2) : 0;
	});
	expect(half).toBeGreaterThan(0);
	// A tap lands one smooth skip step (216px — a little, never a
	// half-page): poll past the ease, wait for it to settle, then
	// pin the landing window.
	await page.keyboard.press("d");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev >= min;
		},
		{ prev: before, min: 150 },
		{ timeout: 10_000 }
	);
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			if (!box) return false;
			const t = box.scrollTop;
			return new Promise<boolean>((resolve) => {
				setTimeout(() => {
					const again = (
						document.querySelector(".messages") as HTMLElement | null
					)?.scrollTop;
					resolve(again === t);
				}, 350);
			});
		},
		undefined,
		{ timeout: 10_000 }
	);
	const down = await scrollTop(page);
	expect(down - before).toBeGreaterThanOrEqual(150);
	expect(down - before).toBeLessThan(half);
	await page.keyboard.press("u");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop < prev - min;
		},
		{ prev: down, min: 100 },
		{ timeout: 10_000 }
	);
	const before2 = await scrollTop(page);
	await page.keyboard.press("Control+d");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev >= min;
		},
		{ prev: before2, min: half * 0.8 },
		{ timeout: 10_000 }
	);
	const jumped = await scrollTop(page);
	await page.keyboard.press("Control+u");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop < prev - 50;
		},
		jumped,
		{ timeout: 10_000 }
	);
});

test("j hold glides near SCROLLKEY_JK_VELOCITY_PX_S with no discrete jump", async ({
	page
}) => {
	const HOLD_MS = 500;
	const before = await scrollTop(page);
	expect(before).toBeLessThanOrEqual(8);
	await page.keyboard.down("j");
	await page.waitForTimeout(HOLD_MS);
	await page.keyboard.up("j");
	// The glide accrues per rAF from the first frame (no restart
	// stutter, no initial tiny jump); the release lands no discrete
	// step for a hold past SCROLL_HOLD_TAP_MS. 720px/s * 0.5s =
	// ~360px — bounds stay wide for headless rAF pacing.
	await page.waitForTimeout(400);
	const dist = (await scrollTop(page)) - before;
	expect(dist).toBeGreaterThan(120);
	expect(dist).toBeLessThan(720);
});

test("d hold ramps: second window outruns the first, then cruises fast", async ({
	page
}) => {
	// Park mid-chat first so both windows have room below.
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (box)
			box.scrollTo({
				top: Math.max(0, box.scrollHeight - box.clientHeight * 2),
				behavior: "instant"
			});
	});
	// Let the park land: a settling glide would inflate the first
	// window with non-hold travel.
	await page.waitForFunction(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (!box) return false;
		const rest = box.scrollTop;
		return new Promise<boolean>((resolve) => {
			setTimeout(() => resolve(box.scrollTop === rest), 200);
		});
	});
	await page.keyboard.down("d");
	// Wait for the hold to engage before opening window one: keydown
	// latency otherwise shifts the ramp between runs.
	const parked = await scrollTop(page);
	await page.waitForFunction(
		(prev: number) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop > prev;
		},
		parked,
		{ timeout: 10_000 }
	);
	const start = await scrollTop(page);
	await page.waitForTimeout(250);
	const m1 = await scrollTop(page);
	await page.waitForTimeout(250);
	const m2 = await scrollTop(page);
	await page.keyboard.up("d");
	// First window rides the ramp (starts at j/k speed), the second
	// cruises near peak: the hold accelerates instead of kicking.
	// Bounds stay wide for headless rAF pacing.
	const w1 = m1 - start;
	const w2 = m2 - m1;
	expect(w1).toBeGreaterThan(0);
	expect(w2).toBeGreaterThan(w1);
	expect(w2).toBeGreaterThan(300);
});

test("gg goes to top, G to the bottom", async ({ page }) => {
	await page.keyboard.press("G");
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return (
				box !== null && box.scrollHeight - box.scrollTop - box.clientHeight <= 8
			);
		},
		undefined,
		{ timeout: 10_000 }
	);
	await page.keyboard.press("g");
	await page.keyboard.press("g");
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop <= 8;
		},
		undefined,
		{ timeout: 10_000 }
	);
	expect(await scrollTop(page)).toBeLessThanOrEqual(8);
});

/** Ctrl+G with the prompt unfocused enters scroll mode at the message
in view (not the newest): j then walks from the view cursor. */
test("ctrl+g lands the cursor on the message in view", async ({ page }) => {
	// msg-6 flush to the top of the view: it is the topmost visible
	// (direct scrollTop: scrollIntoView would honor the strip's
	// scroll-padding and park it 44px down instead).
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		const el = document.getElementById("msg-6");
		if (box && el)
			box.scrollTop =
				el.getBoundingClientRect().top -
				box.getBoundingClientRect().top +
				box.scrollTop;
	});
	await page.waitForFunction(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		const el = document.getElementById("msg-6");
		if (!box || !el) return false;
		return (
			Math.abs(
				el.getBoundingClientRect().top - box.getBoundingClientRect().top
			) < 4
		);
	});
	// Body-focused (edit mode, prompt unfocused): the composer owns no keys.
	await expect
		.poll(() =>
			page.evaluate(() => !!document.activeElement?.closest?.(".prompt"))
		)
		.toBe(false);
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	await expect(page.locator("#msg-6.selected")).toBeVisible({ timeout: 5_000 });
	await page.keyboard.press("j");
	await expect(page.locator("#msg-7.selected")).toBeVisible({ timeout: 5_000 });
});

test("z/Z land the hovered message top/bottom", async ({ page }) => {
	// Hovering never moves focus, so the body focus from beforeEach
	// survives: each press re-hovers first (leaving the article
	// clears hoveredIdx, and the z scroll itself can slide another
	// message under the stationary cursor).
	await page.locator("article#msg-3").scrollIntoViewIfNeeded();
	await page.locator("article#msg-3").hover();
	const box = await page.evaluate(() => {
		const el = document.querySelector(".messages") as HTMLElement | null;
		return el
			? { top: el.getBoundingClientRect().top, viewH: el.clientHeight }
			: null;
	});
	expect(box).not.toBeNull();
	await page.keyboard.press("z");
	await page.waitForFunction(
		({ top }) => {
			const msg = document.querySelector("article#msg-3") as HTMLElement | null;
			if (!msg) return false;
			return Math.abs(msg.getBoundingClientRect().top - top - 16) <= 24;
		},
		{ top: box!.top },
		{ timeout: 10_000 }
	);
	await page.locator("article#msg-3").hover();
	await page.keyboard.press("Z");
	// The bottom (action row included — it lives in the article) rides
	// just above the floating prompt card, never underneath it: the
	// card height plus the 8px gap plus the 16px edge margin.
	await page.waitForFunction(
		() => {
			const msg = document.querySelector("article#msg-3") as HTMLElement | null;
			const card = document.querySelector("main .prompt") as HTMLElement | null;
			if (!msg || !card) return false;
			const r = msg.getBoundingClientRect();
			const c = card.getBoundingClientRect();
			return Math.abs(r.bottom - (c.top - 24)) <= 28;
		},
		null,
		{ timeout: 10_000 }
	);
});

test("tap Escape still dismisses the shortcuts overlay", async ({ page }) => {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(
		page.locator(".modal", { hasText: "Keyboard shortcuts" })
	).toBeVisible({ timeout: 10_000 });
	// A quick tap (well under the fullscreen-hold threshold) keeps
	// today's dismiss path and exits no fullscreen.
	await page.keyboard.press("Escape");
	await expect(
		page.locator(".modal", { hasText: "Keyboard shortcuts" })
	).toBeHidden({ timeout: 10_000 });
});

test("held Escape past ESCAPE_HOLD_MS still dismisses overlays", async ({
	page
}) => {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(
		page.locator(".modal", { hasText: "Keyboard shortcuts" })
	).toBeVisible({ timeout: 10_000 });
	// A hold (past the 500ms fullscreen threshold) must not break
	// the dismiss path: keyup still dismisses exactly like a tap.
	// Fullscreen exit itself needs real window chrome (device-only).
	await page.keyboard.down("Escape");
	await page.waitForTimeout(700);
	await page.keyboard.up("Escape");
	await expect(
		page.locator(".modal", { hasText: "Keyboard shortcuts" })
	).toBeHidden({ timeout: 10_000 });
});

/** j on the last message drops back into the prompt (scroll mode is
for visiting history, not parking past the newest) — decided in
scrollModeAction's atNewest rule, pinned here. */
test("j on the last message lands in the composer", async ({ page }) => {
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	await page.keyboard.press("G");
	await expect(page.locator("#msg-11.selected")).toBeVisible({
		timeout: 5_000
	});
	await page.keyboard.press("j");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(0, {
		timeout: 10_000
	});
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			const editor = document.querySelector(".prompt .ta-input");
			return (
				box !== null &&
				editor !== null &&
				editor.contains(document.activeElement)
			);
		},
		undefined,
		{ timeout: 10_000 }
	);
});

/** Bare u/d in scroll mode skip one smooth step and never move the
message cursor; Ctrl+U / Ctrl+D jump an instant half-page each. */
test("bare u/d skip in scroll mode; ctrl jumps, cursor stays", async ({
	page
}) => {
	// Park mid-chat first so both directions have room (instant: the
	// column eases programmatic jumps, and a smooth park would still
	// be animating under the assertions below).
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (box)
			box.scrollTo({
				top: Math.max(0, box.scrollHeight - box.clientHeight * 2),
				behavior: "instant"
			});
	});
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	const sel = await page.evaluate(
		() => document.querySelector("article.selected")?.id ?? null
	);
	expect(sel).not.toBeNull();
	const half = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box ? Math.floor(box.clientHeight / 2) : 0;
	});
	expect(half).toBeGreaterThan(0);
	const before = await scrollTop(page);
	await page.keyboard.press("d");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev >= min;
		},
		{ prev: before, min: 100 },
		{ timeout: 10_000 }
	);
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			if (!box) return false;
			const t = box.scrollTop;
			return new Promise<boolean>((resolve) => {
				setTimeout(() => {
					const again = (
						document.querySelector(".messages") as HTMLElement | null
					)?.scrollTop;
					resolve(again === t);
				}, 350);
			});
		},
		undefined,
		{ timeout: 10_000 }
	);
	const skipped = await scrollTop(page);
	expect(skipped - before).toBeGreaterThanOrEqual(100);
	expect(skipped - before).toBeLessThan(half);
	await page.keyboard.press("u");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop < prev - min;
		},
		{ prev: skipped, min: 50 },
		{ timeout: 10_000 }
	);
	expect(
		await page.evaluate(
			() => document.querySelector("article.selected")?.id ?? null
		)
	).toBe(sel);
	const parked = await scrollTop(page);
	await page.keyboard.press("Control+d");
	await page.waitForFunction(
		({ prev, min }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev >= min;
		},
		{ prev: parked, min: half * 0.8 },
		{ timeout: 10_000 }
	);
	expect(
		await page.evaluate(
			() => document.querySelector("article.selected")?.id ?? null
		)
	).toBe(sel);
	const down = await scrollTop(page);
	await page.keyboard.press("Control+u");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop < prev - 50;
		},
		down,
		{ timeout: 10_000 }
	);
	expect(
		await page.evaluate(
			() => document.querySelector("article.selected")?.id ?? null
		)
	).toBe(sel);
});

/** A held d in scroll mode glides with the same ramp as
unselected (repeats belong to the loop now, not discrete skips);
the cursor stays put — only Ctrl+U / Ctrl+D jump. */
test("d hold glides in scroll mode, cursor stays put", async ({ page }) => {
	// Park mid-chat first so both directions have room (instant: the
	// column eases programmatic jumps, and a smooth park would still
	// be animating under the assertions below).
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (box)
			box.scrollTo({
				top: Math.max(0, box.scrollHeight - box.clientHeight * 2),
				behavior: "instant"
			});
	});
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	const sel = await page.evaluate(
		() => document.querySelector("article.selected")?.id ?? null
	);
	expect(sel).not.toBeNull();
	const before = await scrollTop(page);
	await page.keyboard.down("d");
	await page.waitForTimeout(400);
	await page.keyboard.up("d");
	await page.waitForTimeout(400);
	// A 400ms hold ramps then cruises (~650px: past one 216 skip,
	// proving the loop owns the hold); the cursor never moves.
	const dist = (await scrollTop(page)) - before;
	expect(dist).toBeGreaterThanOrEqual(300);
	expect(dist).toBeLessThan(1000);
	expect(
		await page.evaluate(
			() => document.querySelector("article.selected")?.id ?? null
		)
	).toBe(sel);
});

/** A quick d tap in scroll mode still lands exactly one skip step —
the hold loop owns repeats, taps stay discrete. */
test("d tap lands one skip in scroll mode", async ({ page }) => {
	await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		if (box)
			box.scrollTo({
				top: Math.max(0, box.scrollHeight - box.clientHeight * 2),
				behavior: "instant"
			});
	});
	await page.keyboard.press("Control+g");
	await expect(page.locator(".app[data-focus-mode='scroll']")).toHaveCount(1, {
		timeout: 5_000
	});
	const sel = await page.evaluate(
		() => document.querySelector("article.selected")?.id ?? null
	);
	expect(sel).not.toBeNull();
	const before = await scrollTop(page);
	await page.keyboard.press("d");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev >= 150;
		},
		before,
		{ timeout: 10_000 }
	);
	await page.waitForTimeout(500);
	const dist = (await scrollTop(page)) - before;
	expect(dist).toBeGreaterThanOrEqual(150);
	expect(dist).toBeLessThan(300);
	expect(
		await page.evaluate(
			() => document.querySelector("article.selected")?.id ?? null
		)
	).toBe(sel);
});

/** The j-step rides the text size: at 200% type one step moves two
steps' worth of pixels, so lines-per-press stays put. Drives the
real setting (storage writes race the seed on reload). */
test("j-step scales with the text size", async ({ page }) => {
	await page.keyboard.press("Meta+,");
	const size = page.locator(
		'.settings-panel input[aria-label="Text size percent"]'
	);
	await expect(size).toBeVisible({ timeout: 5_000 });
	await size.fill("200");
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						parseFloat(
							getComputedStyle(
								document.querySelector(
									"article .rendered"
								) as HTMLElement
							).fontSize
						)
				),
			{ timeout: 5_000 }
		)
		.toBeGreaterThan(20);
	await page.keyboard.press("Escape");
	await deselectToBody(page);
	const before = await scrollTop(page);
	await page.keyboard.press("j");
	await page.waitForFunction(
		(prev) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop > prev;
		},
		before,
		{ timeout: 10_000 }
	);
	// Settle past the smooth ease, then pin the doubled landing.
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			if (!box) return false;
			const t = box.scrollTop;
			return new Promise<boolean>((resolve) => {
				setTimeout(() => {
					const again = (
						document.querySelector(".messages") as HTMLElement | null
					)?.scrollTop;
					resolve(again === t);
				}, 350);
			});
		},
		undefined,
		{ timeout: 10_000 }
	);
	const dist = (await scrollTop(page)) - before;
	// 72px a step at 100%, doubled at 200% (ease slop either way).
	expect(dist).toBeGreaterThanOrEqual(110);
	expect(dist).toBeLessThan(200);
});
