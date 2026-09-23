import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Settings panel: five thinking pills share one row, labels stay terse. */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

test("thinking pills fit on one line", async ({ page }) => {
	const pills = page.locator(
		'.settings-panel .segmented[aria-label="Thinking level"] button'
	);
	await expect(pills).toHaveCount(5);
	const tops = await pills.evaluateAll((els) =>
		els.map((el) => Math.round(el.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
});

test("own-bubble toggle reads as Enable background on my messages", async ({
	page
}) => {
	await expect(
		page
			.locator(".settings-panel")
			.getByText("Enable background on my messages")
	).toBeVisible();
});

/** Text size caps at 800% on desktop, 400% on phones. */
test("desktop text slider caps at 800 percent", async ({ page }) => {
	await expect(
		page.locator('.settings-panel input[aria-label="Text size percent"]')
	).toHaveAttribute("max", "800");
});

test("text size reset button restores 100 percent", async ({ page }) => {
	const slider = page.locator(
		'.settings-panel input[aria-label="Text size percent"]'
	);
	await slider.fill("200");
	await expect(slider).toHaveValue("200");
	await page
		.locator('.settings-panel button[title="Reset to the default size"]')
		.click();
	await expect(slider).toHaveValue("100");
});

/** Bubble toggle sits below the hover row on desktop. */
test("own-bubble checkbox follows the hover row", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	const tops = await panel.evaluate((el) => {
		const find = (text: string): number | null => {
			for (const node of el.querySelectorAll(
				"fieldset.hover-row legend, label.check"
			)) {
				if (node.textContent?.includes(text))
					return node.getBoundingClientRect().top;
			}
			return null;
		};
		return {
			hover: find("message buttons on hover"),
			bubble: find("Enable background on my messages")
		};
	});
	expect(tops.hover).not.toBeNull();
	expect(tops.bubble).not.toBeNull();
	expect(tops.bubble! - tops.hover!).toBeGreaterThan(0);
});

/** macOS always uses system voices: no engine picker bubble. */
test("no System/Web engine picker on desktop", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await expect(
		panel.getByRole("button", { name: "System voices" })
	).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Web voices" })).toHaveCount(
		0
	);
});

/** Chat-width slider resizes the column live and persists the value. */
test("chat width slider narrows the column and persists", async ({ page }) => {
	const slider = page.locator(
		'.settings-panel input[aria-label="Chat width in rem"]'
	);
	await expect(slider).toBeVisible();
	await expect(slider).toHaveAttribute("min", "28");
	await expect(slider).toHaveAttribute("max", "120");
	// The composer pins to min(chat-width, 36rem) while articles ride
	// the raw column var — assert the var, which is what the slider
	// drives (the 46rem default predates both the cap and 36rem).
	const chatVar = () =>
		page.evaluate(() =>
			getComputedStyle(document.querySelector(".app") as Element)
				.getPropertyValue("--chat-width")
				.trim()
		);
	expect(await chatVar()).toBe("36");
	await slider.fill("32");
	await expect(slider).toHaveValue("32");
	expect(await chatVar()).toBe("32");
	// Persisted to storage (the seeded init script rewrites settings on
	// every navigation, so reload-round-trip is covered by the unit
	// test's loadSettings clamp instead).
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"chatWidth":32');
});

/** Prompt sliders resize only the composer: text size drives the
 * --prompt-font var (message --font-scale untouched), width drives
 * --prompt-width capped by the column. Both persist. */
test("prompt sliders resize the composer only and persist", async ({
	page
}) => {
	const appVar = (name: string) =>
		page.evaluate(
			(n) =>
				getComputedStyle(document.querySelector(".app") as Element)
					.getPropertyValue(n)
					.trim(),
			name
		);
	const size = page.locator(
		'.settings-panel input[aria-label="Prompt text size percent"]'
	);
	const width = page.locator(
		'.settings-panel input[aria-label="Prompt width in rem"]'
	);
	await expect(size).toBeVisible();
	await expect(width).toBeVisible();
	// Prompt text to 200%: its own var moves, the message scale stays.
	await size.fill("200");
	expect(await appVar("--prompt-font")).toBe("2");
	expect(await appVar("--font-scale")).toBe("1");
	// Prompt width to 32rem under the 36rem column: the var follows.
	await width.fill("32");
	expect(await appVar("--prompt-width")).toBe("32");
	expect(await appVar("--chat-width")).toBe("36");
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"promptScale":2');
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"promptWidth":32');
});

/** Gutter double-click reads the live column: wide ignores, narrow opens. */
test("gutter double-click recomputes from the live width", async ({ page }) => {
	// A full-width assistant reply marks the column edges (a lone short
	// user message docks right and leaves no left edge to compare).
	await seedChat(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "hello there, this is a reply" }
	]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	const slider = page.locator(
		'.settings-panel input[aria-label="Chat width in rem"]'
	);
	const sidebar = page.locator("aside:not(.settings-panel)");
	const chatVar = () =>
		page.evaluate(() =>
			getComputedStyle(document.querySelector(".app") as Element)
				.getPropertyValue("--chat-width")
				.trim()
		);
	// Closing the panel pulses root pointer-events (cursor re-hit-test);
	// wait for the restore so the gutter clicks below genuinely land.
	const waitHitTestable = () =>
		expect
			.poll(() =>
				page.evaluate(() => document.documentElement.style.pointerEvents)
			)
			.toBe("");
	await expect(sidebar).toHaveClass(/collapsed/);
	// Wide column: a point just inside its live left edge is content,
	// not gutter (articles cap at 90%, so a fixed x can't prove this).
	await slider.fill("80");
	expect(await chatVar()).toBe("80");
	const leftEdge = await page
		.locator("article.assistant")
		.first()
		.evaluate((el) => el.getBoundingClientRect().left);
	await page.locator(".settings-panel .panel-head").click();
	await waitHitTestable();
	await page.mouse.dblclick(leftEdge + 20, 400);
	await expect(sidebar).toHaveClass(/collapsed/);
	// Narrow column: x=100 is gutter, so the chats list opens.
	await page.keyboard.press("Meta+,");
	await page
		.locator('.settings-panel input[aria-label="Chat width in rem"]')
		.fill("28");
	expect(await chatVar()).toBe("28");
	await page.locator(".settings-panel .panel-head").click();
	await waitHitTestable();
	await page.mouse.dblclick(100, 400);
	await expect(sidebar).not.toHaveClass(/collapsed/);
});

/** Tap-to-show is a touch idiom: desktops never see its checkbox. */
test("no hide-buttons checkbox on desktop", async ({ page }) => {
	await expect(
		page
			.locator(".settings-panel")
			.getByText("Show message buttons only when tapped")
	).toHaveCount(0);
});

/** The shortcuts entry is a one-line "Shortcuts" button with no
inline kbd chip; the chord stays documented inside the modal. */
test("shortcuts entry is a one-line button, chord lives in the modal", async ({
	page
}) => {
	const btn = page.locator(".settings-panel button", { hasText: "Shortcuts" });
	await expect(btn).toHaveText("Shortcuts");
	await expect(page.locator(".settings-panel .key-hint")).toHaveCount(0);
	const single = await btn.evaluate(
		(el) => el.scrollWidth <= el.clientWidth + 1
	);
	expect(single).toBe(true);
	await btn.click();
	const modal = page.locator(".modal-veil .modal");
	await expect(modal).toBeVisible();
	await expect(modal.locator("dl.keys")).toContainText("Shortcuts show/hide");
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

/** Bubble background is decor only: the switch never moves message
alignment (left, right-docked, both ways). Plain text is the default. */
test("own-bubble switch keeps left alignment, background follows", async ({
	page
}) => {
	const bubble = page.locator("article.user .bubble");
	await expect(bubble).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(bubble).toHaveCSS("text-align", "left");
	await page
		.locator(".settings-panel")
		.getByText("Enable background on my messages")
		.click();
	await expect(bubble).toHaveCSS("background-color", "rgb(241, 241, 244)");
	await expect(bubble).toHaveCSS("text-align", "left");
});

/** No transparency sliders: surfaces are solid, so neither control
exists and no alpha vars reach the app root. */
test("transparency sliders are gone and surfaces stay solid", async ({
	page
}) => {
	await expect(
		page.locator(
			'.settings-panel input[aria-label="Background transparency percent"]'
		)
	).toHaveCount(0);
	await expect(
		page.locator(
			'.settings-panel input[aria-label="Composer transparency percent"]'
		)
	).toHaveCount(0);
	const style = await page.locator(".app").getAttribute("style");
	expect(style ?? "").not.toMatch(/--bg-alpha|--prompt-alpha/);
	const solid = await page.evaluate(() => {
		const alpha = (el: Element | null): number => {
			const bg = el ? getComputedStyle(el).backgroundColor : "";
			const inner = bg.match(/^(?:rgba?|color)\(([^)]+)\)$/)?.[1] ?? "";
			if (inner.includes(",")) {
				const parts = inner.split(",").map((part) => part.trim());
				return parts.length === 4 ? parseFloat(parts[3]!) : 1;
			}
			return parseFloat(inner.match(/\/\s*([\d.]+)\s*$/)?.[1] ?? "1");
		};
		return {
			app: alpha(document.querySelector(".app")),
			prompt: alpha(document.querySelector("main .prompt"))
		};
	});
	expect(solid.app).toBe(1);
	expect(solid.prompt).toBe(1);
});

/** Background reply ping has an opt-out, on by default, persisted. */
test("reply notification toggle persists", async ({ page }) => {
	const box = page
		.locator(".settings-panel label", {
			hasText: "Enable notifications"
		})
		.locator("input");
	await expect(box).toBeChecked();
	await box.uncheck();
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"replyNotifications":false');
	await box.check();
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-llm-settings-v1"))
		)
		.toContain('"replyNotifications":true');
});

/** The on-device note carries the probe facts: AICore version plus
per-variant receipts, so a flat verdict never hides what AICore
answered per config. */
test("on-device note renders probe facts", async ({ page }) => {
	await page.addInitScript(() => {
		const stored = window.localStorage.getItem("ccez-llm-settings-v1");
		const parsed = stored
			? (JSON.parse(stored) as Record<string, unknown>)
			: {};
		parsed["activeProviderId"] = "local-mlkit";
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify(parsed)
		);
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string) => {
				if (cmd === "ondevice_status")
					return {
						state: "error",
						reason: "stale-aicore",
						log: [
							"default: 606 feature 636 not found",
							"full-stable: UNAVAILABLE"
						],
						aicore: "241912009"
					};
				throw new Error(`unmocked command: ${cmd}`);
			}
		};
	});
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await expect(panel.getByText("On-device chat isn't ready.")).toBeVisible();
	await expect(
		panel.getByText("AI Core 241912009 · default: 606 feature 636 not found", {
			exact: false
		})
	).toBeVisible();
});

/** All-606 hides the ML Kit pill: the feature isn't provisioned for
the device, so the entry would only ever fail (reopening re-probes,
so a future provisioning restores it). */
test("ml kit pill hides on all-606 when inactive", async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string) => {
				if (cmd === "ondevice_status")
					return {
						state: "error",
						reason: "stale-aicore",
						log: ["default: 606 feature 636 not found"],
						aicore: "241912009"
					};
				throw new Error(`unmocked command: ${cmd}`);
			}
		};
	});
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await expect(
		panel.getByRole("radio", { name: "ML Kit (on-device)" })
	).toHaveCount(0);
});
