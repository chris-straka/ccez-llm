import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Unihan-enriched Inspect overlay.
 *
 * The generated Unihan bundle (kDefinition + kMandarin + kJapaneseOn +
 * kJapaneseKun) wires through getInspectData, so the overlay shows the
 * curated gloss plus Mandarin pinyin and Japanese on/kun readings for
 * a table-covered character. Separate from inspect.e2e.ts (gating +
 * overlay contract): this spec pins the enrichment alone.
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

async function openInspectForSingleChar(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Inspect")').click();
}

test("Inspect overlay shows Unihan definition and readings for a covered char", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await openInspectForSingleChar(page);
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	// Unihan definition (no curated overrides remain).
	await expect(modal).toContainText("language, words; saying, expression");
	// Unihan enrichment: Mandarin pinyin + Japanese on/kun readings.
	await expect(modal).toContainText("Mandarin");
	await expect(modal).toContainText("yǔ");
	await expect(modal).toContainText("Japanese on");
	await expect(modal).toContainText("GO GYO");
	await expect(modal).toContainText("Japanese kun");
	await expect(modal).toContainText("KATARU");
	// Unihan strokes + Kangxi radical (語: 14 strokes, 言 + 7).
	await expect(modal).toContainText("Strokes:");
	await expect(modal).toContainText("14");
	await expect(modal).toContainText("Radical:");
	await expect(modal).toContainText("言 + 7");
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});
