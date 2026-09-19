import { test, expect, type Page } from "@playwright/test";

/** Same phone emulation as the Android suite: UA-gated branches on. */
test.use({
	hasTouch: true,
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedEmpty(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator(".prompt")).toBeVisible();
}

/**
 * Spoof a keyboard-open visual viewport (desktop Chromium has no soft
 * keyboard): the handler only reads window.innerHeight (real 915 here)
 * plus these two values, so shadowing them plus a resize event drives
 * the real frame + settle path and asserts the real DOM effects.
 */
async function mockViewport(
	page: Page,
	height: number,
	offsetTop: number
): Promise<void> {
	await page.evaluate(
		([h, o]: [number, number]) => {
			const vv = window.visualViewport;
			if (!vv) throw new Error("no visualViewport");
			Object.defineProperty(vv, "height", { value: h, configurable: true });
			Object.defineProperty(vv, "offsetTop", { value: o, configurable: true });
			vv.dispatchEvent(new Event("resize"));
		},
		[height, offsetTop] as [number, number]
	);
}

async function appPin(page: Page): Promise<{ h: string; kb: string }> {
	const pin = await page.evaluate(() => {
		const app = document.querySelector(".app");
		return app instanceof HTMLElement
			? { h: app.style.height, kb: app.style.getPropertyValue("--kb-height") }
			: null;
	});
	if (!pin) throw new Error("no .app element");
	return pin;
}

/** No-shrink keyboard open pins .app to the visual height; closing clears it. */
test("fallback pin engages on no-shrink open and releases on close", async ({
	page
}) => {
	await seedEmpty(page);
	// Layout full (real 915), visual 615: 300px of keyboard, no pan.
	await mockViewport(page, 615, 0);
	await mockViewport(page, 615, 0);
	await expect
		.poll(async () => (await appPin(page)).h, { timeout: 5000 })
		.toBe("615px");
	expect((await appPin(page)).kb).toBe("300px");
	// Keyboard gone: the pin and the reflow var clear.
	await mockViewport(page, 915, 0);
	await expect
		.poll(async () => (await appPin(page)).h, { timeout: 5000 })
		.toBe("");
	expect((await appPin(page)).kb).toBe("0px");
});

/** A focus pan must not blind the gate: shrunk AND shifted still reads open. */
test("panned-open keyboard still engages the pin", async ({ page }) => {
	await seedEmpty(page);
	// Same 300px keyboard, plus a 250px focus pan toward it. The old
	// gate subtracted the pan (915 - 615 - 250 = 50) and read closed.
	await mockViewport(page, 615, 250);
	await mockViewport(page, 615, 250);
	await expect
		.poll(async () => (await appPin(page)).h, { timeout: 5000 })
		.toBe("615px");
	expect((await appPin(page)).kb).toBe("300px");
});
