import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";

/**
 * Visual baseline for the modern-CSS overhaul (tokens, dvh, field-sizing,
 * :has, scrollbar-gutter, text-wrap). These pin today's rendered behavior
 * so the rewrite can prove it changed nothing.
 */

/** Pin the settings theme before boot (seedChat writes settings with no theme). */
async function seedTheme(page: Page, theme: "light" | "dark"): Promise<void> {
	await page.addInitScript((t: string) => {
		const raw = window.localStorage.getItem("ccez-llm-settings-v1");
		const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ ...prev, theme: t })
		);
	}, theme);
}

test("app fills the viewport height", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const { app, viewport } = await page.evaluate(() => ({
		app: document.querySelector(".app")?.getBoundingClientRect().height ?? 0,
		viewport: window.innerHeight
	}));
	expect(Math.abs(app - viewport)).toBeLessThanOrEqual(2);
});

test("page never scrolls sideways", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content: "a much longer message to stretch the column width a bit"
		},
		{
			role: "assistant",
			content: "reply with enough text to wrap a few lines in the pane"
		}
	]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const overflow = await page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
});

test("message list scrolls inside its pane", async ({ page }) => {
	const msgs = Array.from({ length: 30 }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `filler message number ${i} with enough words to wrap onto a second line`
	}));
	await seedChat(page, msgs);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const sizes = await page.evaluate(() => {
		const list = document.querySelector(".messages");
		const root = document.scrollingElement;
		if (!(list instanceof HTMLElement) || !root) return null;
		return {
			listClient: list.clientHeight,
			listScroll: list.scrollHeight,
			pageScrollable: root.scrollHeight - root.clientHeight
		};
	});
	if (!sizes) throw new Error("messages pane missing");
	expect(sizes.listScroll).toBeGreaterThan(sizes.listClient);
	expect(sizes.pageScrollable).toBeLessThanOrEqual(1);
});

/** The Appearance swatch repaints own messages live (boots light). */
test("my message color swatch repaints own messages", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "ink me" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	await page
		.locator('.settings-panel [aria-label="My msg color"]')
		.getByRole("radio", { name: "Blue" })
		.click();
	await expect(page.locator("article.user .bubble").first()).toHaveCSS(
		"color",
		"rgb(29, 78, 216)"
	);
});

const THEMES = [
	{
		name: "light" as const,
		bg: "rgb(255, 255, 255)",
		chrome: "rgb(255, 255, 255)",
		wash: "rgb(241, 241, 244)",
		softLine: "rgb(229, 229, 234)",
		ink: "rgb(28, 28, 30)",
		ownInk: "rgb(190, 24, 93)"
	},
	{
		name: "dark" as const,
		bg: "rgb(18, 18, 20)",
		// Drawers sit one step off the thread on dark.
		chrome: "rgb(25, 25, 28)",
		wash: "rgb(38, 38, 42)",
		softLine: "rgb(42, 42, 46)",
		ink: "rgb(242, 242, 247)",
		ownInk: "rgb(249, 168, 212)"
	}
];

for (const t of THEMES) {
	test(`own ink white paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "ink me" }], null, {
			ownInk: "white"
		});
		await seedTheme(page, t.name);
		await page.goto("/");
		// White on dark; theme ink on light (white reads nowhere there).
		const bubble = page.locator("article.user .bubble").first();
		await expect(bubble).toBeVisible({ timeout: 60_000 });
		await expect(bubble).toHaveCSS(
			"color",
			t.name === "dark" ? "rgb(255, 255, 255)" : t.ink
		);
	});
}

/** Quoted passages read as body text (the bar carries the quote
signal): muting them washed out long passages on light theme. */
for (const t of THEMES) {
	test(`blockquote reads as body text on ${t.name}`, async ({ page }) => {
		await seedChat(page, [
			{
				role: "assistant",
				content: "As the saying goes:\n\n> The quick brown fox jumps."
			}
		]);
		await seedTheme(page, t.name);
		await page.goto("/");
		const quote = page.locator("article .rendered blockquote").first();
		await expect(quote).toBeVisible({ timeout: 60_000 });
		await expect(quote).toHaveCSS(
			"color",
			t.name === "light" ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)"
		);
		await expect(quote).toHaveCSS(
			"border-left-color",
			t.name === "light" ? "rgb(142, 142, 147)" : "rgb(85, 85, 91)"
		);
		await expect(quote).toHaveCSS("border-left-width", "4px");
	});
}

/** Message buttons read 85% of the message size, tracking the
text-size setting instead of holding a fixed size. */
test("action buttons read 85 percent of message size", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ fontScale: 2, promptIdleSec: 0 })
		);
	});
	await page.goto("/");
	const btn = page.locator("article.assistant .actions button").first();
	await expect(btn).toHaveCount(1, { timeout: 60_000 });
	const sizes = await page.evaluate(() => {
		const button = document.querySelector("article.assistant .actions button");
		const body = document.querySelector("article.assistant .rendered");
		if (!button || !body) throw new Error("missing action row");
		return {
			button: parseFloat(getComputedStyle(button).fontSize),
			body: parseFloat(getComputedStyle(body).fontSize)
		};
	});
	expect(sizes.button / sizes.body).toBeCloseTo(0.85, 2);
});

test("composer text sits above the tools row at full width", async ({
	page
}) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	const layout = await page.evaluate(() => {
		const el = document.querySelector(".prompt .ta-input");
		const tools = document.querySelector(".prompt-tools");
		if (!el || !tools) throw new Error("missing composer");
		return {
			pad: parseFloat(getComputedStyle(el).paddingRight),
			below:
				tools.getBoundingClientRect().top - el.getBoundingClientRect().bottom
		};
	});
	// No side reservation: tools never overlap text because they sit
	// in their own row below it.
	expect(layout.pad).toBe(0);
	expect(layout.below).toBeGreaterThanOrEqual(0);
});

/** The scheme picker: a Light | Dark | System toggle over four style
tiles per side. Pinned, one side's tiles show; following the system,
both rows show and each tile sets its side's style without leaving
System. Playwright emulates a light OS. */
test("scheme toggle and style tiles", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".ta-input").first()).toBeVisible({
		timeout: 60_000
	});
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const html = page.locator("html");
	const app = page.locator(".app");
	const sideBtn = (name: string) =>
		panel.getByRole("radio", { name, exact: true });
	const tile = (name: string) =>
		panel.locator(`.theme-tile[data-tile="${name}"]`);
	// Default: following a light OS, both rows show, Paper and Graphite.
	await expect(sideBtn("System")).toHaveAttribute("aria-checked", "true");
	await expect(tile("light-paper")).toHaveAttribute("aria-pressed", "true");
	await expect(tile("dark-graphite")).toHaveAttribute("aria-pressed", "true");
	// A dark tile sets the dark style without switching the theme.
	await tile("dark-ink").click();
	await expect(html).toHaveAttribute("data-dark-style", "ink");
	await expect(html).toHaveAttribute("data-theme", "light");
	await expect(sideBtn("System")).toHaveAttribute("aria-checked", "true");
	// Light styles apply live on the light side.
	await tile("light-sepia").click();
	await expect(html).toHaveAttribute("data-light-style", "sepia");
	await expect(app).toHaveCSS("background-color", "rgb(246, 238, 219)");
	await expect(app).toHaveCSS("color", "rgb(58, 46, 33)");
	// Pinned: the toggle switches the theme and shows only that side.
	await sideBtn("Dark").click();
	await expect(html).toHaveAttribute("data-theme", "dark");
	await expect(tile("light-paper")).toHaveCount(0);
	await expect(app).toHaveCSS("background-color", "rgb(0, 0, 0)");
	await expect(app).toHaveCSS("color", "rgb(230, 228, 223)");
	await tile("dark-contrast").click();
	await expect(app).toHaveCSS("color", "rgb(255, 255, 255)");
	await sideBtn("Light").click();
	await expect(html).toHaveAttribute("data-theme", "light");
	await tile("light-contrast").click();
	await expect(html).toHaveAttribute("data-theme", "light");
	await expect(app).toHaveCSS("color", "rgb(0, 0, 0)");
});
