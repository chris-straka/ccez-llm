import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Giant text (low-vision use, up to 2000%): a realistic thread must
 * never scroll sideways, and every message's text stays inside the
 * column. Screenshots land in .screenshots/ for eyeballing.
 */
const THREAD = [
	{
		role: "user" as const,
		content: "Was bedeutet Donaudampfschifffahrtsgesellschaftskapitän?"
	},
	{
		role: "assistant" as const,
		content:
			"Das ist ein Kapitän der Donaudampfschifffahrtsgesellschaft. Mehr unter https://de.wikipedia.org/wiki/Donaudampfschifffahrtsgesellschaft\n\n" +
			"| Wort | Bedeutung |\n| --- | --- |\n| Donau | Danube |\n| Kapitän | captain |\n\n" +
			"```python\nprint('Donaudampfschifffahrtsgesellschaft')\n```\n\n" +
			"日本語でも説明します。これは長い言葉です。"
	}
];

async function overflowReport(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		const vw = document.documentElement.clientWidth;
		if (document.documentElement.scrollWidth > vw + 1)
			out.push(
				`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`
			);
		const box = document.querySelector(".messages");
		if (box && box.scrollWidth > box.clientWidth + 1)
			out.push(
				`.messages scrolls sideways: ${box.scrollWidth} > ${box.clientWidth}`
			);
		for (const el of document.querySelectorAll(".messages .rendered *")) {
			const r = el.getBoundingClientRect();
			if (r.width === 0) continue;
			// Code blocks and tables may scroll inside themselves.
			if (el.closest("pre, table, .table-wrap")) continue;
			if (r.right > vw + 1 || r.left < -1)
				out.push(
					`${el.tagName.toLowerCase()} spills: ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`
				);
		}
		return [...new Set(out)].slice(0, 12);
	});
}

for (const scale of [8, 20]) {
	test(`desktop thread fits at ${scale * 100}% text`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await seedChat(page, THREAD, null, { fontScale: scale });
		await page.goto("/");
		await expect(page.locator("article.assistant")).toBeVisible();
		await page.screenshot({ path: `.screenshots/giant-desktop-${scale}.png` });
		expect.soft(await overflowReport(page)).toEqual([]);
	});
}

test.describe("phone", () => {
	test.use({
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});
	for (const scale of [8, 20]) {
		test(`phone thread fits at ${scale * 100}% text`, async ({ page }) => {
			// Known: at 2000% the phone thread scrolls sideways (574 > 412).
			// Remove once docs/plans/2026-10-01-handoff.md §A lands.
			test.fail(scale === 20, "phone overflows sideways at 2000%");
			await seedChat(page, THREAD, null, { fontScale: scale });
			await page.goto("/");
			await expect(page.locator("article.assistant")).toBeVisible();
			await page.screenshot({ path: `.screenshots/giant-phone-${scale}.png` });
			expect.soft(await overflowReport(page)).toEqual([]);
		});
	}
});
