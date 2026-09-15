import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Settings panel: five thinking pills share one row, labels stay terse. */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

test("thinking pills fit on one line", async ({ page }) => {
	const pills = page
		.locator('.settings-panel .segmented[aria-label="Thinking level"] button');
	await expect(pills).toHaveCount(5);
	const tops = await pills.evaluateAll((els) =>
		els.map((el) => Math.round(el.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
});

test("own-bubble toggle reads as Enable background on my messages", async ({ page }) => {
	await expect(page.locator(".settings-panel").getByText("Enable background on my messages")).toBeVisible();
});

/** Text size caps at 800% on desktop, 400% on phones. */
test("desktop text slider caps at 800 percent", async ({ page }) => {
	await expect(page.locator('.settings-panel input[aria-label="Text size percent"]')).toHaveAttribute(
		"max",
		"800"
	);
});

test("text size reset button restores 100 percent", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Text size percent"]');
	await slider.fill("200");
	await expect(slider).toHaveValue("200");
	await page.locator('.settings-panel button[title="Reset to the default size"]').click();
	await expect(slider).toHaveValue("100");
});

/** Bubble toggle sits below the hover row on desktop. */
test("own-bubble checkbox follows the hover row", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	const tops = await panel.evaluate((el) => {
		const find = (text: string): number | null => {
			for (const node of el.querySelectorAll("fieldset.hover-row legend, label.check")) {
				if (node.textContent?.includes(text)) return node.getBoundingClientRect().top;
			}
			return null;
		};
		return { hover: find("message buttons only on hover"), bubble: find("Enable background on my messages") };
	});
	expect(tops.hover).not.toBeNull();
	expect(tops.bubble).not.toBeNull();
	expect(tops.bubble! - tops.hover!).toBeGreaterThan(0);
});

/** macOS always uses system voices: no engine picker bubble. */
test("no System/Web engine picker on desktop", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await expect(panel.getByRole("button", { name: "System voices" })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Web voices" })).toHaveCount(0);
});

/** Chat-width slider resizes the column live and persists the value. */
test("chat width slider narrows the column and persists", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
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

/** Gutter double-click reads the live column: wide ignores, narrow opens. */
test("gutter double-click recomputes from the live width", async ({ page }) => {
	// A full-width assistant reply marks the column edges (a lone short
	// user message docks right and leaves no left edge to compare).
	await seedChat(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "hello there, this is a reply" }
	]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
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
			.poll(() => page.evaluate(() => document.documentElement.style.pointerEvents))
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
	await page.locator('.settings-panel input[aria-label="Chat width in rem"]').fill("28");
	expect(await chatVar()).toBe("28");
	await page.locator(".settings-panel .panel-head").click();
	await waitHitTestable();
	await page.mouse.dblclick(100, 400);
	await expect(sidebar).not.toHaveClass(/collapsed/);
});

/** Tap-to-show is a touch idiom: desktops never see its checkbox. */
test("no hide-buttons checkbox on desktop", async ({ page }) => {
	await expect(page.locator(".settings-panel").getByText("Hide message buttons until tapped")).toHaveCount(0);
});

/** The shortcuts entry is a one-line "Shortcuts" button with no
inline kbd chip; the chord stays documented inside the modal. */
test("shortcuts entry is a one-line button, chord lives in the modal", async ({ page }) => {
	const btn = page.locator(".settings-panel button", { hasText: "Shortcuts" });
	await expect(btn).toHaveText("Shortcuts");
	await expect(page.locator(".settings-panel .key-hint")).toHaveCount(0);
	const single = await btn.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
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
test("own-bubble switch keeps left alignment, background follows", async ({ page }) => {
	const bubble = page.locator("article.user .bubble");
	await expect(bubble).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	await expect(bubble).toHaveCSS("text-align", "left");
	await page.locator(".settings-panel").getByText("Enable background on my messages").click();
	await expect(bubble).toHaveCSS("background-color", "rgb(241, 241, 244)");
	await expect(bubble).toHaveCSS("text-align", "left");
});

/** Transparency slider applies the alpha var and resets to opaque. */
test("transparency slider applies and resets", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Background transparency percent"]');
	await expect(slider).toHaveAttribute("max", "80");
	await slider.fill("50");
	await expect(page.locator(".app")).toHaveAttribute("style", /--bg-alpha: 0\.5/);
	await page.locator('.settings-panel button[title="Reset to fully opaque"]').click();
	await expect(page.locator(".app")).toHaveAttribute("style", /--bg-alpha: 1/);
});

/** Transparency slider thins the root without recoloring: the alpha
reaches <html> (the layer beneath .app), and the hue channels hold
steady against the opaque baseline. An opaque root used to cap the
slider — and on a mismatched OS/app theme it read as darkening. */
test("transparency slider thins the root without recoloring", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Background transparency percent"]');
	// Channels normalize to 0-255: engines serialize the same color
	// as rgba() commas, space-separated rgb(), or color(srgb …) unit
	// floats, so compare numerically, never as strings.
	const parse = (color: string): { channels: number[]; alpha: number } => {
		const inner = color.match(/^(?:rgba?|color)\(([^)]+)\)$/)?.[1] ?? "";
		if (inner.includes(",")) {
			const parts = inner.split(",").map((part) => parseFloat(part.trim()));
			return { channels: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3]! : 1 };
		}
		const [left = "", right = "1"] = inner.split("/");
		const unit = left.includes("srgb");
		const channels = left
			.replace(/^[a-z]+\s+/, "")
			.trim()
			.split(/\s+/)
			.filter((part) => part.length > 0)
			.map((part) => parseFloat(part) * (unit ? 255 : 1));
		return { channels, alpha: parseFloat(right) };
	};
	const sameHue = (a: number[], b: number[]): void => {
		expect(a.length).toBe(3);
		expect(b.length).toBe(3);
		for (const [i, v] of a.entries()) expect(v).toBeCloseTo(b[i]!, 0);
	};
	await expect(slider).toHaveAttribute("max", "80");
	await slider.fill("50");
	const thinned = await page.evaluate(() => {
		const bg = (el: Element | null): string =>
			el ? getComputedStyle(el).backgroundColor : "";
		return {
			app: bg(document.querySelector(".app")),
			root: bg(document.documentElement)
		};
	});
	expect(parse(thinned.app).alpha).toBeCloseTo(0.5, 1);
	expect(parse(thinned.root).alpha).toBeCloseTo(0.5, 1);
	await page.locator('.settings-panel button[title="Reset to fully opaque"]').click();
	const opaque = await page.evaluate(() => {
		const bg = (el: Element | null): string =>
			el ? getComputedStyle(el).backgroundColor : "";
		return {
			app: bg(document.querySelector(".app")),
			root: bg(document.documentElement)
		};
	});
	// Same hue top to bottom, then and now: only the alpha moved.
	sameHue(parse(thinned.app).channels, parse(opaque.app).channels);
	sameHue(parse(thinned.root).channels, parse(opaque.root).channels);
	expect(parse(opaque.app).alpha).toBeCloseTo(1, 1);
	expect(parse(opaque.root).alpha).toBeCloseTo(1, 1);
});

/** Composer transparency slider applies the prompt var and resets. */
test("composer transparency slider applies and resets", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Composer transparency percent"]');
	await expect(slider).toHaveAttribute("max", "80");
	await slider.fill("50");
	await expect(page.locator(".app")).toHaveAttribute("style", /--prompt-alpha: 0\.5/);
	await expect(page.locator("main .prompt")).toHaveClass(/glass/);
	await page.locator('.settings-panel button[title="Reset composer to fully opaque"]').click();
	await expect(page.locator(".app")).toHaveAttribute("style", /--prompt-alpha: 1/);
	await expect(page.locator("main .prompt")).not.toHaveClass(/glass/);
});
