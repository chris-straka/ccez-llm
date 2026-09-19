import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Character Inspect.
 *
 * Gating: the Inspect button appears next to Annotate only when the
 * settings checkbox is on AND the highlight is a single Han
 * character. It opens a modal-veil/modal overlay (same pattern as the
 * shortcuts overlay) with radicals, stroke count, and definition.
 */

/** Seed a chat, then merge the Inspect toggle into stored settings. */
async function seedWithInspect(
	page: Page,
	enabled: boolean,
	content: string
): Promise<void> {
	await seedChat(page, [{ role: "assistant", content }]);
	await page.addInitScript((on: boolean) => {
		try {
			const raw = window.localStorage.getItem("ccez-llm-settings-v1");
			const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
			parsed["inspectEnabled"] = on;
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify(parsed)
			);
		} catch {
			// Seed-order failure surfaces as a missing toggle below.
		}
	}, enabled);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

async function selectWord(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
}

/**
 * Highlight exactly one character: double-clicking grabs the whole
 * CJK word (multi-char, no Inspect button), so the range is set
 * directly and a synthetic mouseup summons the menu off it.
 */
async function selectChar(page: Page, ch: string): Promise<void> {
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	await body.evaluate((el, c) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let node: Text | null = null;
		let idx = -1;
		let cur: Node | null = walker.nextNode();
		while (cur) {
			const i = (cur as Text).data.indexOf(c);
			if (i >= 0) {
				node = cur as Text;
				idx = i;
				break;
			}
			cur = walker.nextNode();
		}
		if (!node || idx < 0) throw new Error(`char ${c} not found in message`);
		const range = document.createRange();
		range.setStart(node, idx);
		range.setEnd(node, idx + 1);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		const rect = range.getBoundingClientRect();
		el.dispatchEvent(
			new MouseEvent("mouseup", {
				bubbles: true,
				button: 0,
				clientX: rect.left,
				clientY: rect.top
			})
		);
	}, ch);
	await expect(page.locator(".sel-menu")).toBeVisible();
}

test("no Inspect button anywhere when the setting is off", async ({ page }) => {
	await seedWithInspect(page, false, "語");
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
});

test("single Han character gains an Inspect button next to Annotate", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(2);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toBeVisible();
});

test("Inspect opens the overlay with radicals, strokes, and definition", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await expect(modal).toContainText("語");
	await expect(modal).toContainText("言");
	await expect(modal).toContainText("14");
	await expect(modal).toContainText("language");
	await expect(page.locator(".modal-veil")).toBeVisible();
	// Esc closes the overlay (same contract as the shortcuts modal).
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

test("multi-character highlight shows Annotate alone", async ({ page }) => {
	await seedWithInspect(page, true, "漢字のテストを確認しました");
	// Triple-click selects the whole paragraph (multi-char by construction).
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: 3 });
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	// Annotate is alone: Inspect is single-Han-char only, and the
	// multi-char Parts companion is gone by decision.
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
	await expect(menu.locator('button:has-text("Parts")')).toHaveCount(0);
});

test("single kana highlight shows Annotate alone", async ({ page }) => {
	await seedWithInspect(page, true, "あ");
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
});

test("Inspect resolves splits beyond the hand table via the data fallback", async ({
	page
}) => {
	// 館 is not hand-curated: the vendored cjk-decomp subset supplies 食 + 官.
	await seedWithInspect(page, true, "館");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await expect(modal).toContainText("館");
	await expect(modal).toContainText("食");
});

test("single-char Inspect guesses Japanese from surrounding kana", async ({
	page
}) => {
	await seedWithInspect(page, true, "漢字のテスト");
	await selectChar(page, "字");
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await expect(
		modal.getByRole("button", { name: "Show Japanese reading" })
	).toHaveAttribute("aria-pressed", "true");
	// JP face: Japanese readings only, no Mandarin row.
	await expect(modal).toContainText("On/Kun:");
	await expect(modal).not.toContainText("Mandarin:");
	// Flipping to 中文 swaps faces: Mandarin appears, Japanese rows go.
	await modal.getByRole("button", { name: "Show Chinese reading" }).click();
	await expect(modal).toContainText("Mandarin:");
	await expect(modal).not.toContainText("On/Kun:");
});

test("single-char Inspect defaults to Chinese without kana", async ({
	page
}) => {
	await seedWithInspect(page, true, "汉字测试");
	await selectChar(page, "字");
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await expect(
		modal.getByRole("button", { name: "Show Chinese reading" })
	).toHaveAttribute("aria-pressed", "true");
	// CN face: Mandarin only, no Japanese rows.
	await expect(modal).toContainText("Mandarin:");
	await expect(modal).not.toContainText("On/Kun:");
});

test("settings panel gates the feature behind a checkbox", async ({ page }) => {
	await seedWithInspect(page, false, "語");
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const box = page
		.locator(".settings-panel")
		.getByText("Show Inspect for single kanji/hanzi highlights");
	await expect(box).toBeVisible();
});

test("decomposition replaces the stroke bar", async ({ page }) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	const decomp = modal.locator(".inspect-decomp");
	await expect(decomp).toBeVisible();
	await expect(decomp).toContainText("語");
	await expect(decomp).toContainText("→");
	await expect(page.locator(".inspect-bar")).toHaveCount(0);
});

test("stepper arrows and h/l step manually, never autoplay", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	const count = modal.locator(".inspect-count");
	// The stepper never shows without its drawing: arrows wait for vectors.
	await expect(modal.locator(".inspect-svg")).toBeVisible({ timeout: 60_000 });
	await expect(count).toHaveText("1 / 14");
	// No autoplay: still on step 1 after the old interval elapsed twice.
	await page.waitForTimeout(1500);
	await expect(count).toHaveText("1 / 14");
	await modal.locator('button[aria-label="Next stroke (l)"]').click();
	await expect(count).toHaveText("2 / 14");
	await page.keyboard.press("l");
	await expect(count).toHaveText("3 / 14");
	await page.keyboard.press("h");
	await expect(count).toHaveText("2 / 14");
	await modal.locator('button[aria-label="Previous stroke (h)"]').click();
	await expect(count).toHaveText("1 / 14");
});

test("holding an arrow repeats strokes, taps still single-step", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	const count = modal.locator(".inspect-count");
	await expect(modal.locator(".inspect-svg")).toBeVisible({ timeout: 60_000 });
	await expect(count).toHaveText("1 / 14");
	const next = modal.locator('button[aria-label="Next stroke (l)"]');
	await next.hover();
	await page.mouse.down();
	// Beat 280ms plus ~85ms ticks: well past several strokes.
	await page.waitForTimeout(700);
	await page.mouse.up();
	const stepped = await count.textContent();
	const at = Number(stepped?.split("/")[0]?.trim() ?? "1");
	expect(at).toBeGreaterThanOrEqual(3);
	expect(at).toBeLessThanOrEqual(14);
});

test("readings render as one comma-joined on/kun line", async ({ page }) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await modal.locator('button:has-text("日本語")').click();
	const line = modal.locator(".inspect-onkun");
	await expect(line).toBeVisible();
	await expect(line).toContainText("On/Kun:");
	await expect(line).not.toContainText("On:");
	// "Kun:" alone can't be asserted — it sits inside "On/Kun:".
	// The single-line shape below proves there is no second row.
	await expect(line).toHaveText(/^On\/Kun: .+ \| .+$/);
});
