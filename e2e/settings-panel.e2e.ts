import { expect, test } from "./fixtures";
import { seedChat, setSettingValue, settingValue } from "./helpers";

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

test("own-bubble toggle reads as Background on my messages, under Enable", async ({
	page
}) => {
	await expect(
		page.locator(".settings-panel").getByText("Background on my messages")
	).toBeVisible();
});

/** Text size reaches 2000% on desktop (phones share the stored range). */
test("desktop text size steps up to 2000 percent", async ({ page }) => {
	const size = page.getByRole("spinbutton", {
		name: "Text size percent",
		exact: true
	});
	await expect(size).toHaveAttribute("aria-valuemax", "2000");
	await expect(size).toHaveAttribute("aria-valuemin", "80");
	await setSettingValue(page, "Text size percent", 2000);
	await expect(
		page.getByRole("button", { name: "Increase text size" })
	).toBeDisabled();
});

/** Annotation popups scale 10–200% of message text, reset to 100%. */
test("annotation popup size spans 10 to 200 percent", async ({ page }) => {
	const size = page.getByRole("spinbutton", {
		name: "Annotation popup size percent"
	});
	await expect(size).toHaveAttribute("aria-valuemax", "200");
	await expect(size).toHaveAttribute("aria-valuemin", "10");
	await setSettingValue(page, "Annotation popup size percent", 50);
	await expect(size).toHaveValue("50%");
	await page
		.locator('.settings-panel button[title="Reset to the default popup size"]')
		.click();
	await expect(size).toHaveAttribute("aria-valuenow", "100");
});

/** Each press moves one rung; the value shows once, inside the
control; Reset appears only off the default and restores it. */
test("text size stepper moves one rung per press and resets", async ({
	page
}) => {
	const size = page.getByRole("spinbutton", {
		name: "Text size percent",
		exact: true
	});
	const reset = page.locator(
		'.settings-panel button[title="Reset to the default size"]'
	);
	await expect(reset).toHaveCount(0);
	await page.getByRole("button", { name: "Increase text size" }).click();
	await expect(size).toHaveValue("110%");
	await page.getByRole("button", { name: "Increase text size" }).click();
	await expect(size).toHaveValue("120%");
	await page.getByRole("button", { name: "Decrease text size" }).click();
	await expect(size).toHaveValue("110%");
	const row = page.locator(".settings-panel .stepper-setting", {
		has: size
	});
	// The value shows once: in the field, never again as text.
	expect((await row.innerText()).match(/110%/g)).toBeNull();
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.querySelector(".app")!)
					.getPropertyValue("--font-scale")
					.trim()
			)
		)
		.toBe("1.1");
	await reset.click();
	await expect(size).toHaveValue("100%");
	await expect(reset).toHaveCount(0);
});

/** Text size also takes a typed percentage: Enter sets it, clamped to
the ladder's ends; Escape leaves it as it was. */
test("text size takes a typed percentage", async ({ page }) => {
	const size = page.getByRole("spinbutton", {
		name: "Text size percent",
		exact: true
	});
	await size.click();
	await page.keyboard.type("137");
	await page.keyboard.press("Enter");
	await expect(size).toHaveValue("137%");
	await expect
		.poll(() =>
			page.evaluate(() =>
				getComputedStyle(document.querySelector(".app")!)
					.getPropertyValue("--font-scale")
					.trim()
			)
		)
		.toBe("1.37");
	await size.click();
	await page.keyboard.type("99999");
	await page.keyboard.press("Enter");
	await expect(size).toHaveValue("2000%");
	await size.click();
	await page.keyboard.type("50");
	await page.keyboard.press("Escape");
	await expect(size).toHaveValue("2000%");
});

/** Sliders only move from their thumb: a click elsewhere on the
track and a wheel passing over it leave the value alone. */
test("sliders ignore track clicks and the wheel, move by thumb drag", async ({
	page
}) => {
	const name = "Voice volume percent";
	await page.getByRole("slider", { name }).scrollIntoViewIfNeeded();
	const track = page.locator(".settings-panel .slider-setting", {
		has: page.getByRole("slider", { name })
	});
	const hit = track.locator(".slider-hit");
	const box = (await hit.boundingBox())!;
	// Voice volume sits at 100% (thumb at the right end): click the left
	// third of the track.
	await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
	expect(await settingValue(page, name)).toBe(1);
	// The wheel over the track scrolls the panel, never the value.
	const panel = page.locator(".settings-panel");
	const before = await panel.evaluate((el) => el.scrollTop);
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
	await page.mouse.wheel(0, 200);
	await expect
		.poll(() => panel.evaluate((el) => el.scrollTop))
		.not.toBe(before);
	expect(await settingValue(page, name)).toBe(1);
	// Grab the thumb and drag it left: the value follows.
	const thumb = (await page.getByRole("slider", { name }).boundingBox())!;
	await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		thumb.x + thumb.width / 2 - box.width * 0.5,
		thumb.y + thumb.height / 2,
		{ steps: 5 }
	);
	await page.mouse.up();
	const dragged = await settingValue(page, name);
	expect(dragged).toBeGreaterThan(0.3);
	expect(dragged).toBeLessThan(0.7);
	await expect(track.locator(".slider-value")).toHaveText(
		`${Math.round(dragged * 100)}%`
	);
});

/** The jump bar scrolls a group under itself and marks it current. */
test("section bar jumps between groups", async ({ page }) => {
	const nav = page.locator(".settings-panel .settings-nav");
	// All six pills fit one row at the default window size.
	expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
		true
	);
	await nav.getByRole("button", { name: "Look" }).click();
	await expect(nav.getByRole("button", { name: "Look" })).toHaveAttribute(
		"aria-current",
		"true"
	);
	await expect
		.poll(async () => {
			const navBottom =
				(await nav.boundingBox())!.y + (await nav.boundingBox())!.height;
			const head = (await page.locator("#look-heading").boundingBox())!.y;
			return head - navBottom;
		})
		.toBeLessThan(40);
	await nav.getByRole("button", { name: "Reading" }).click();
	await expect(page.locator("#reading-heading")).toBeInViewport();
});

/** The Reading sample tracks text size and line spacing live. */
test("reading preview follows text size and spacing", async ({ page }) => {
	const preview = page.locator(".settings-panel .reading-preview");
	const font = () =>
		preview.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	const before = await font();
	await setSettingValue(page, "Text size percent", 200);
	await expect.poll(font).toBeCloseTo(before * 2, 0);
	await setSettingValue(page, "Line spacing", 2);
	await expect(preview).toHaveCSS("line-height", `${(await font()) * 2}px`);
});

/** Background on my messages is a look, not a feature: it sits in Look. */
test("own-bubble checkbox sits in the Look group", async ({ page }) => {
	await expect(
		page
			.locator("#settings-look label.check")
			.filter({ hasText: "Background on my messages" })
	).toHaveCount(1);
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
	const slider = page.getByRole("slider", { name: "Chat width in rem" });
	await expect(slider).toBeVisible();
	await expect(slider).toHaveAttribute("aria-valuemin", "28");
	await expect(slider).toHaveAttribute("aria-valuemax", "120");
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
	await setSettingValue(page, "Chat width in rem", 32);
	await expect(slider).toHaveAttribute("aria-valuetext", "32 rem");
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
	const size = page.getByRole("spinbutton", {
		name: "Prompt text size percent"
	});
	const width = page.getByRole("slider", { name: "Prompt width in rem" });
	await expect(size).toBeVisible();
	await expect(width).toBeVisible();
	// Prompt text to 200%: its own var moves, the message scale stays.
	await setSettingValue(page, "Prompt text size percent", 200);
	await expect(size).toHaveAttribute("aria-valuetext", "200%");
	expect(await appVar("--prompt-font")).toBe("2");
	expect(await appVar("--font-scale")).toBe("1");
	// Prompt width to 32rem under the 36rem column: the var follows.
	await setSettingValue(page, "Prompt width in rem", 32);
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
	// Open settings and wait until it stays open: on a loaded runner
	// the gutter double-click's trailing outside-press can shut the
	// panel a frame after the chord opens it, so re-press until it
	// holds (the press only fires while the panel is closed).
	const panel = page.locator(".settings-panel");
	const openSettings = () =>
		expect(async () => {
			if (await panel.evaluate((el) => el.classList.contains("closed")))
				await page.keyboard.press("Meta+,");
			await expect(panel).not.toHaveClass(/closed/, { timeout: 2_000 });
			await page.waitForTimeout(300);
			expect(
				await panel.evaluate((el) => el.classList.contains("closed"))
			).toBe(false);
		}).toPass({ timeout: 20_000 });
	await openSettings();
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
	await setSettingValue(page, "Chat width in rem", 80);
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
	await openSettings();
	await setSettingValue(page, "Chat width in rem", 28);
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
	await expect(modal.locator(".keys")).toContainText("Summon / hide window");
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
		.getByText("Background on my messages")
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
			hasText: "Notifications"
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
		window.localStorage.setItem("ccez-llm-settings-v1", JSON.stringify(parsed));
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string) => {
				if (cmd === "plugin:event|listen") return 1;
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
			},
			transformCallback: (): number => 0,
			unregisterCallback: (): void => {}
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
				if (cmd === "plugin:event|listen") return 1;
				if (cmd === "ondevice_status")
					return {
						state: "error",
						reason: "stale-aicore",
						log: ["default: 606 feature 636 not found"],
						aicore: "241912009"
					};
				throw new Error(`unmocked command: ${cmd}`);
			},
			transformCallback: (): number => 0,
			unregisterCallback: (): void => {}
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

/** Phones: the same steppers and thumb-only sliders, sized for a
thumb; a tap on a slider's track leaves it alone. */
test.describe("phone", () => {
	test.use({
		hasTouch: true,
		isMobile: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("steppers take taps, slider tracks ignore them", async ({ page }) => {
		const plus = page.getByRole("button", { name: "Increase text size" });
		const box = (await plus.boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		await plus.tap();
		await expect(
			page.getByRole("spinbutton", { name: "Text size percent", exact: true })
		).toHaveValue("110%");
		const name = "Voice volume percent";
		const hit = page
			.locator(".settings-panel .slider-setting", {
				has: page.getByRole("slider", { name })
			})
			.locator(".slider-hit");
		await hit.scrollIntoViewIfNeeded();
		const track = (await hit.boundingBox())!;
		await page.touchscreen.tap(
			track.x + track.width * 0.25,
			track.y + track.height / 2
		);
		expect(await settingValue(page, name)).toBe(1);
		// All six section pills fit the phone row.
		const nav = page.locator(".settings-panel .settings-nav");
		expect(
			await nav.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
		).toBe(true);
	});
});
