import { expect, test } from "@playwright/test";
import { seedChat, toggleSidebar } from "./helpers";

/** The chat pill spans the full row width flush with the + button
(the row × overlays instead of reserving its slot). */
test("active chat pill sits flush with the new-chat button", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.waitForTimeout(600);
	const edges = await page.evaluate(() => {
		const rect = (s: string) =>
			document.querySelector(s)?.getBoundingClientRect();
		const pill = rect("aside ul button.side-chat");
		const plus = rect("aside button.new");
		if (!pill || !plus) throw new Error("no sidebar rows");
		return { pillRight: pill.x + pill.width, plusRight: plus.x + plus.width };
	});
	expect(Math.abs(edges.pillRight - edges.plusRight)).toBeLessThanOrEqual(1);
});

/** Double-clicking the empty gutters opens the nearby sidebar. */
test("gutter double-click opens the nearby sidebar", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.mouse.dblclick(8, 300);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await toggleSidebar(page);
	await expect(page.locator("aside").first()).toHaveClass(/collapsed/);
	const width = await page.evaluate(() => window.innerWidth);
	await page.mouse.dblclick(width - 8, 300);
	await expect(page.locator(".settings-panel")).toBeVisible();
});

/** The text-size setting scales the UI text live (the ⌘+ / ⌘− chords
are shell-only: the browser owns page zoom, so specs drive the setting
the chords would have stepped). */
test("text size setting scales text", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	const rendered = page.locator("article .rendered").first();
	await expect(rendered).toBeVisible();
	const px = () =>
		rendered.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	const before = await px();
	await page.keyboard.press("Meta+,");
	const size = page.locator(
		'.settings-panel input[aria-label="Text size percent"]'
	);
	await expect(size).toBeVisible({ timeout: 5_000 });
	await size.fill("110");
	await expect.poll(px).toBeGreaterThan(before);
	await size.fill("100");
	await expect.poll(px).toBeCloseTo(before, 1);
});

/** The chat-width setting widens and narrows the column (the ⇧⌘+
/ ⇧⌘− chords are shell-only, so specs drive the setting instead). */
test("chat width setting scales the column", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible();
	await page.keyboard.press("Meta+,");
	const width = page.locator(
		'.settings-panel input[aria-label="Chat width in rem"]'
	);
	await expect(width).toBeVisible({ timeout: 5_000 });
	const stored = () =>
		page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"));
	await width.fill("38");
	await expect.poll(stored).toContain('"chatWidth":38');
	await width.fill("36");
	await expect.poll(stored).toContain('"chatWidth":36');
});

/** Text size scales messages, never the composer input; annotation
badges track it at a dampened rate (30%: 600% reads ≈2.5× badges). */
test("text size scales messages and badges, not the composer", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	const px = (sel: string) =>
		page.evaluate((s) => {
			const el = document.querySelector(s);
			if (!el) throw new Error(`missing ${s}`);
			return parseFloat(getComputedStyle(el as HTMLElement).fontSize);
		}, sel);
	// A badge in the message rides the same scale var at the dampened rate.
	await page.evaluate(() => {
		const rendered = document.querySelector("article .rendered");
		const badge = document.createElement("button");
		badge.className = "ccez-ann-badge";
		badge.textContent = "1";
		rendered?.appendChild(badge);
	});
	const msgBefore = await px("article .rendered");
	const editorBefore = await px(".prompt .ta-input");
	const badgeBefore = await px("button.ccez-ann-badge");
	// Shell-only chord (browser owns page zoom): drive the setting.
	await page.keyboard.press("Meta+,");
	const size = page.locator(
		'.settings-panel input[aria-label="Text size percent"]'
	);
	await expect(size).toBeVisible({ timeout: 5_000 });
	await size.fill("110");
	await expect
		.poll(() => px("article .rendered"), { timeout: 5_000 })
		.toBeCloseTo(msgBefore * 1.1, 1);
	expect(await px(".prompt .ta-input")).toBeCloseTo(editorBefore, 1);
	expect(await px("button.ccez-ann-badge")).toBeCloseTo(badgeBefore * 1.03, 1);
});

/** The attachment strip sits on top of the prompt: past a 36rem chat
width the composer stops growing, and the paste-tag row (with its
remove ×) must stop with it instead of spilling left. */
test("attachment strip shares the prompt box at wide chat widths", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	// Widen past the prompt's 36rem cap (seedChat's settings write
	// runs first; this merges the width in before load).
	await page.addInitScript(() => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...prev, chatWidth: 60 })
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	const btn = page.locator(".prompt-tools .attach-btn");
	await expect(btn).toBeVisible();
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser", { timeout: 10_000 }),
		btn.click()
	]);
	await chooser.setFiles("e2e/fixtures/attach.bmp");
	await expect(page.locator(".attachments li")).toBeVisible({
		timeout: 15_000
	});
	const edges = await page.evaluate(() => {
		const rect = (s: string) => {
			const el = document.querySelector(s);
			if (!(el instanceof HTMLElement)) throw new Error(`missing ${s}`);
			return el.getBoundingClientRect();
		};
		const strip = rect(".attachments");
		const prompt = rect(".prompt");
		return {
			stripLeft: strip.left,
			promptLeft: prompt.left,
			stripRight: strip.right,
			promptRight: prompt.right
		};
	});
	expect(Math.abs(edges.stripLeft - edges.promptLeft)).toBeLessThanOrEqual(2);
	expect(Math.abs(edges.stripRight - edges.promptRight)).toBeLessThanOrEqual(2);
});
