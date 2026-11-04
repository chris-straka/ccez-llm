import { expect, test } from "./fixtures";

test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 360, height: 780 },
	colorScheme: "dark"
});

/** The phone settings sheet: rows on the page with room between them
(no cards), choices on one line, the last rows plain (owner, 2026-11-04). */
test("phone settings read by whitespace", async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem("ccez-mock-provider", "1");
		localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ fontScale: 1.7, uiScale: 1.3, theme: "dark" })
		);
		localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible({ timeout: 60_000 });
	await page.evaluate(() => {
		const touch = (x: number, y: number) =>
			new Touch({
				identifier: 7,
				target: document.body,
				clientX: x,
				clientY: y
			});
		window.dispatchEvent(
			new TouchEvent("touchstart", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(4, 600)]
			})
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(140, 604)]
			})
		);
	});
	await page.locator("aside button.side-settings").click();
	const panel = page.locator(".settings-panel");
	await expect(panel).toBeVisible();
	await page.waitForTimeout(500);
	await page.screenshot({ path: ".screenshots/settings-1.png" });
	// Chat: thinking levels on one line.
	await page.locator(".settings-nav button", { hasText: "Chat" }).click();
	await page.waitForTimeout(1500);
	await expect(
		page
			.locator("#settings-chat, [id^='settings-'] h2", { hasText: /^Chat$/i })
			.first()
	).toBeInViewport();
	await page.screenshot({ path: ".screenshots/settings-2.png" });
	await page.locator(".settings-nav button", { hasText: "Model" }).click();
	await page.waitForTimeout(700);
	await panel.evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await page.waitForTimeout(400);
	await page.screenshot({ path: ".screenshots/settings-3.png" });
	const levels = page
		.locator(".settings-panel .segmented")
		.filter({ has: page.getByRole("radio", { name: "Minimal" }) })
		.locator("button");
	const tops = await levels.evaluateAll((els) =>
		els.map((e) => Math.round(e.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
	// All five in sight, none scrolled off.
	const strip = page
		.locator(".settings-panel .segmented")
		.filter({ has: page.getByRole("radio", { name: "Minimal" }) });
	expect(
		await strip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
	).toBe(true);
	// Every stepper under its name, on the names' left edge.
	const steppers = await page
		.locator(".settings-panel .stepper-setting")
		.evaluateAll((rows) =>
			rows.map((r) => {
				const l = r.querySelector(".setting-label")!.getBoundingClientRect();
				const c = r.querySelector(".setting-control")!.getBoundingClientRect();
				const step = r.querySelector(".stepper")!.getBoundingClientRect();
				return {
					under: c.top >= l.bottom - 1,
					left: Math.round(step.left),
					labelLeft: Math.round(l.left)
				};
			})
		);
	expect(steppers.every((s) => s.under)).toBe(true);
	// One left edge: the names' and the steppers'.
	expect(steppers.every((s) => s.left === s.labelLeft)).toBe(true);
});
