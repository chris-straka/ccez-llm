import { expect, test, type Page } from "./fixtures";
import { seedChat, setSettingValue } from "./helpers";

/**
 * Settings rows, measured in a real engine (WebKit too: it pinned
 * fieldset legends to the card's top edge where Chromium didn't). A
 * row's name and control share a line unless the row stacks or the
 * sheet is too narrow; steppers line up; Reset never grows a row;
 * every name sits inside its own card row.
 */
type Box = { top: number; bottom: number; left: number; right: number };

async function rowParts(page: Page, name: string) {
	return page.evaluate((name) => {
		const rows = [
			...document.querySelectorAll<HTMLElement>(".settings-panel .setting")
		];
		const row = rows.find(
			(r) =>
				r.querySelector(":scope > .setting-label")?.textContent?.trim() === name
		);
		if (!row) return null;
		const box = (el: Element | null): Box | null => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
		};
		return {
			row: box(row)!,
			label: box(row.querySelector(":scope > .setting-label"))!,
			control: box(row.querySelector(":scope > .setting-control"))!
		};
	}, name);
}

const middle = (b: Box): number => (b.top + b.bottom) / 2;

async function openSettings(page: Page): Promise<void> {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.addInitScript(() => {
		const raw = localStorage.getItem("ccez-llm-settings-v1");
		const s = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...s, readerMode: "follow" })
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("ControlOrMeta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

test.describe("desktop window", () => {
	test.use({ viewport: { width: 1440, height: 900 } });
	test.beforeEach(async ({ page }) => openSettings(page));

	test("inline rows keep the control on the name's line", async ({ page }) => {
		for (const name of [
			"Text size",
			"Voice speed",
			"Voice volume",
			"Chat width",
			"Big-word reader",
			"Color scheme",
			"Thinking level",
			"Fold older messages automatically",
			"Show message buttons on hover"
		]) {
			const parts = await rowParts(page, name);
			expect(parts, name).not.toBeNull();
			expect(
				Math.abs(middle(parts!.label) - middle(parts!.control)),
				name
			).toBeLessThan(12);
			expect(parts!.control.left, name).toBeGreaterThan(parts!.label.right);
		}
	});

	test("stacked rows put the control under the name", async ({ page }) => {
		for (const name of ["My message color", "Enable"]) {
			const parts = await rowParts(page, name);
			expect(parts, name).not.toBeNull();
			expect(parts!.control.top, name).toBeGreaterThanOrEqual(
				parts!.label.bottom
			);
		}
	});

	test("steppers share one width and one right edge", async ({ page }) => {
		const boxes = await page
			.locator(".settings-panel .stepper")
			.evaluateAll((els) =>
				els.map((el) => {
					const r = el.getBoundingClientRect();
					return { width: Math.round(r.width), right: Math.round(r.right) };
				})
			);
		expect(boxes.length).toBeGreaterThan(4);
		expect(new Set(boxes.map((b) => b.width)).size).toBe(1);
		expect(new Set(boxes.map((b) => b.right)).size).toBe(1);
	});

	test("Reset appears beside the stepper without growing its row", async ({
		page
	}) => {
		const before = await rowParts(page, "Text size");
		await setSettingValue(page, "Text size percent", 110);
		const reset = page
			.locator(".settings-panel .stepper-setting", { hasText: "Text size" })
			.first()
			.getByRole("button", { name: "Reset" });
		await expect(reset).toBeVisible();
		const after = await rowParts(page, "Text size");
		// Within a pixel of rounding (Reset under the name added ~16px).
		const height = (b: Box): number => b.bottom - b.top;
		expect(
			Math.abs(height(after!.row) - height(before!.row))
		).toBeLessThanOrEqual(1);
	});

	test("every name sits inside its own row", async ({ page }) => {
		const outside = await page.evaluate(() =>
			[...document.querySelectorAll(".settings-panel .setting")]
				.map((row) => {
					const label = row.querySelector(":scope > .setting-label");
					if (!label) return null;
					const r = row.getBoundingClientRect();
					const l = label.getBoundingClientRect();
					return l.top < r.top || l.bottom > r.bottom
						? (label.textContent ?? "")
						: null;
				})
				.filter(Boolean)
		);
		expect(outside).toEqual([]);
	});
});

test.describe("phone sheet", () => {
	test.use({
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});
	test.beforeEach(async ({ page }) => openSettings(page));

	test("a slider takes the whole line under its name", async ({ page }) => {
		const parts = await rowParts(page, "Voice volume");
		expect(parts).not.toBeNull();
		expect(parts!.control.top).toBeGreaterThanOrEqual(parts!.label.bottom);
		const rowWidth = parts!.row.right - parts!.row.left;
		const controlWidth = parts!.control.right - parts!.control.left;
		expect(controlWidth).toBeGreaterThan(rowWidth * 0.8);
	});
});
