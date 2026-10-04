import { expect, test, type Page } from "./fixtures";
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
		// Phones clip the thread sideways (overflow-x: clip): a wide
		// tooltip there can't scroll it, so only a scrollable box counts.
		const scrolls =
			box && !["clip", "hidden"].includes(getComputedStyle(box).overflowX);
		if (box && scrolls && box.scrollWidth > box.clientWidth + 1)
			out.push(
				`.messages scrolls sideways: ${box.scrollWidth} > ${box.clientWidth}`
			);
		for (const el of document.querySelectorAll(".messages *")) {
			const r = el.getBoundingClientRect();
			if (r.width === 0) continue;
			// Content inside code blocks, tables, and the action row
			// scrolls within its own box; the boxes themselves must fit.
			if (el.parentElement?.closest("pre, table, .actions")) continue;
			if (r.right > vw + 1 || r.left < -1)
				out.push(
					`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} spills: ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`
				);
		}
		return [...new Set(out)].slice(0, 20);
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

/** Settings stay usable at 2000%: the panel fits the window and its
sliders (text size included) stay reachable. */
test("desktop settings fit at 2000% text", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await seedChat(page, THREAD, null, { fontScale: 20 });
	await page.goto("/");
	// The send button marks a fully mounted app (keys are live).
	await expect(page.locator(".send-btn")).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	// The panel slides in: poll until it settles inside the window.
	await expect
		.poll(async () => {
			const box = await panel.boundingBox();
			return box ? box.x + box.width : Infinity;
		})
		.toBeLessThanOrEqual(1281);
	await page.screenshot({ path: ".screenshots/giant-desktop-settings-20.png" });
	expect.soft(await overflowReport(page)).toEqual([]);
});

/** Every box that scrolls, or is styled to, yet paints a scrollbar. Phones
scroll by thumb, so at any text size this must stay empty there. */
async function paintedScrollbars(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		for (const el of [
			document.documentElement,
			...document.querySelectorAll("body *")
		]) {
			const cs = getComputedStyle(el);
			const canScroll = (axis: string, over: boolean) =>
				over &&
				(["auto", "scroll"].includes(axis) || el === document.documentElement);
			const scrolls =
				canScroll(cs.overflowY, el.scrollHeight > el.clientHeight + 1) ||
				canScroll(cs.overflowX, el.scrollWidth > el.clientWidth + 1);
			const latent =
				["auto", "scroll"].includes(cs.overflowY) ||
				["auto", "scroll"].includes(cs.overflowX);
			if (!(scrolls || latent) || cs.scrollbarWidth === "none") continue;
			out.push(
				`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} (scrollbar-width: ${cs.scrollbarWidth})`
			);
		}
		return [...new Set(out)].slice(0, 20);
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
			await seedChat(page, THREAD, null, { fontScale: scale });
			await page.goto("/");
			await expect(page.locator("article.assistant")).toBeVisible();
			await page.screenshot({ path: `.screenshots/giant-phone-${scale}.png` });
			expect.soft(await overflowReport(page)).toEqual([]);
		});
	}

	/** Nothing paints a scrollbar at giant sizes: the thread, the chats
	list, and settings all scroll by thumb with no chrome. */
	test("phone shows no scrollbars at 2000% text", async ({ page }) => {
		await seedChat(page, THREAD, null, { fontScale: 20 });
		await page.goto("/");
		await expect(page.locator("article.assistant")).toBeVisible();
		expect.soft(await paintedScrollbars(page), "thread").toEqual([]);
		// Synthetic edge swipe opens the chats list (as in android.e2e).
		await page.evaluate(() => {
			const touch = (x: number, y: number) =>
				new Touch({
					identifier: 7,
					target: document.body,
					clientX: x,
					clientY: y
				});
			const fire = (type: string, init: TouchEventInit) =>
				window.dispatchEvent(
					new TouchEvent(type, {
						bubbles: true,
						cancelable: true,
						composed: true,
						...init
					})
				);
			fire("touchstart", { touches: [touch(4, 600)] });
			fire("touchend", { touches: [], changedTouches: [touch(140, 604)] });
		});
		await expect(page.locator("aside button.side-settings")).toBeVisible();
		expect.soft(await paintedScrollbars(page), "chats list").toEqual([]);
		await page.locator("aside button.side-settings").click();
		await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
		await page.screenshot({ path: ".screenshots/giant-phone-settings-20.png" });
		expect.soft(await paintedScrollbars(page), "settings").toEqual([]);
	});
});
