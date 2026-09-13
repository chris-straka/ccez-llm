import { expect, test, type Page } from "@playwright/test";
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

test("light theme paints light surfaces", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await seedTheme(page, "light");
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(page.locator(".app")).toHaveCSS("background-color", "rgb(255, 255, 255)");
	await expect(page.locator(".app")).toHaveCSS("color", "rgb(28, 28, 30)");
});

test("dark theme paints dark surfaces", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await seedTheme(page, "dark");
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(page.locator(".app")).toHaveCSS("background-color", "rgb(23, 23, 26)");
	await expect(page.locator(".app")).toHaveCSS("color", "rgb(242, 242, 247)");
	await expect(page.locator(".prompt")).toHaveCSS("background-color", "rgb(28, 28, 30)");
});

test("app fills the viewport height", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const { app, viewport } = await page.evaluate(() => ({
		app: document.querySelector(".app")?.getBoundingClientRect().height ?? 0,
		viewport: window.innerHeight
	}));
	expect(Math.abs(app - viewport)).toBeLessThanOrEqual(2);
});

test("page never scrolls sideways", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "a much longer message to stretch the column width a bit" },
		{ role: "assistant", content: "reply with enough text to wrap a few lines in the pane" }
	]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
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
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
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

test("empty-state hero stays centered", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	const hero = page.locator(".hero");
	await expect(hero).toBeVisible({ timeout: 60_000 });
	await expect(hero).toHaveCSS("text-align", "center");
});

const THEMES = [
	{
		name: "light" as const,
		bg: "rgb(255, 255, 255)",
		wash: "rgb(241, 241, 244)",
		softLine: "rgb(229, 229, 234)"
	},
	{
		name: "dark" as const,
		bg: "rgb(23, 23, 26)",
		wash: "rgb(44, 44, 46)",
		softLine: "rgb(56, 56, 58)"
	}
];

for (const t of THEMES) {
	test(`sidebar buttons paint ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const L = t.name === "light";
		// The list always boots closed; ⌘B opens it for real.
		await page.keyboard.press("Meta+b");
		const sidebar = page.locator("aside:has(button.side-chat)");
		await expect(sidebar).toBeVisible();
		const row = sidebar.locator("li").first();
		const chat = row.locator("button.side-chat");
		await expect(chat).toHaveCSS("color", L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)");
		await chat.hover();
		await expect(chat).toHaveCSS(
			"background-color",
			L ? "rgb(236, 236, 241)" : "rgb(44, 44, 46)"
		);
		const fresh = sidebar.locator(".new");
		await expect(fresh).toHaveCSS(
			"border-color",
			L ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)"
		);
		await fresh.hover();
		await expect(fresh).toHaveCSS(
			"border-color",
			L ? "rgb(58, 58, 60)" : "rgb(174, 174, 178)"
		);
		await row.hover();
		const del = row.locator(".del");
		await expect(del).toHaveCSS("color", L ? "rgb(110, 110, 115)" : "rgb(174, 174, 178)");
		await del.hover();
		await expect(del).toHaveCSS("color", L ? "rgb(192, 54, 44)" : "rgb(232, 154, 144)");
	});

	test(`sidebar paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const sidebar = page.locator("aside:has(button.side-chat)");
		await expect(sidebar).toHaveCSS("background-color", t.bg);
		await expect(sidebar).toHaveCSS("border-right-color", t.softLine);
	});

	test(`own bubble off paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "bubble me" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		await page.keyboard.press("Meta+,");
		await page.locator(".settings-panel").getByText("Enable background on my messages").click();
		const bubble = page.locator("article.user .bubble").first();
		await expect(bubble).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	});

	test(`own bubble paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "bubble me" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator("article.user .bubble").first()).toBeVisible({ timeout: 60_000 });
		await expect(page.locator("article.user .bubble").first()).toHaveCSS(
			"background-color",
			t.wash
		);
	});

	test(`settings panel paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		await page.keyboard.press("Meta+,");
		await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
		await expect(page.locator(".settings-panel")).toHaveCSS("background-color", t.bg);
		await expect(page.locator(".settings-panel")).toHaveCSS("border-left-color", t.softLine);
	});

	test(`composer paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const prompt = page.locator(".prompt");
		await expect(prompt).toHaveCSS(
			"background-color",
			t.name === "light" ? t.bg : "rgb(28, 28, 30)"
		);
		// The editor autofocuses on boot, so the rim starts focused.
		await page.locator(".cm-content").first().click();
		await expect(prompt).toHaveCSS(
			"border-color",
			t.name === "light" ? "rgb(58, 58, 60)" : "rgb(174, 174, 178)"
		);
		const editor = page.locator(".prompt .cm-content");
		await expect(editor).toHaveCSS(
			"caret-color",
			t.name === "light" ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)"
		);
		const hint = await page.evaluate(
			() => getComputedStyle(document.querySelector(".prompt .cm-placeholder")!).color
		);
		expect(hint).toBe(
			t.name === "light" ? "rgb(142, 142, 147)" : "rgb(99, 99, 102)"
		);
		// No .cm-cursor assert: CodeMirror only mounts the cursor node
		// while focused, so its dark shade stays a pinned rule.
		// Resting/hover rims share the same tokens; the app holds editor
		// focus while typing, so e2e can't isolate those two states
		// without fighting focus management — bg + focus rim pin the theme.
	});

	test(`lang menus paint ${t.name}`, async ({ page }) => {
		await seedChat(page, []);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
		const ink = t.name === "light" ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)";
		const line = t.name === "light" ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)";
		const raised = t.name === "light" ? t.bg : "rgb(28, 28, 30)";
		const menu = page.locator(".lang-menu > button").first();
		await menu.click();
		const list = page.locator(".lang-list");
		await expect(list).toBeVisible();
		await expect(list).toHaveCSS("background-color", raised);
		await expect(list).toHaveCSS("border-color", line);
		const option = list.locator("button").first();
		await expect(option).toHaveCSS("color", ink);
		// The list opens upward past the viewport edge: hover the
		// bottom option, which sits nearest the menu button, in view.
		const nearest = list.locator("button").last();
		await nearest.hover();
		await expect(nearest).toHaveCSS("background-color", t.wash);
		await expect(list.locator(".badge").first()).toHaveCSS(
			"color",
			t.name === "light" ? "rgb(58, 58, 60)" : "rgb(174, 174, 178)"
		);
		// Picking a language stamps the send button with its flag.
		const badge = (await list.locator(".badge").last().innerText()).trim();
		await nearest.click();
		await expect(page.locator(".send-btn")).toContainText(badge);
		await menu.click();
		await expect(list.locator("button.selected")).toHaveCSS("background-color", t.wash);
	});

	test(`annotation surfaces paint ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "paintable annotation target" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const L = t.name === "light";
		const v = {
			ink: L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)",
			muted: L ? "rgb(110, 110, 115)" : "rgb(152, 152, 159)",
			line: L ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)",
			softLine: L ? "rgb(229, 229, 234)" : "rgb(56, 56, 58)",
			raised: L ? t.bg : "rgb(28, 28, 30)",
			panel: L ? "rgb(250, 250, 252)" : "rgb(28, 28, 30)",
			field: L ? "rgb(255, 255, 255)" : "rgb(16, 16, 19)",
			invert: L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)",
			invertInk: L ? "rgb(255, 255, 255)" : "rgb(28, 28, 30)",
			danger: L ? "rgb(148, 37, 10)" : "rgb(232, 154, 144)",
			strong: L ? "rgb(28, 28, 30)" : "rgb(174, 174, 178)"
		};
		// Selection menu.
		await page.locator('article .rendered:has-text("paintable annotation target")').first().selectText();
		await page.mouse.up();
		const menu = page.locator(".sel-menu");
		await expect(menu).toBeVisible();
		// Frosted pill by design (backdrop blur over the page): the
		// shadow draws the edge, so the menu carries no border.
		await expect(menu).toHaveCSS(
			"background-color",
			L ? "rgba(255, 255, 255, 0.88)" : "rgba(30, 30, 32, 0.88)"
		);
		const annBtn = menu.locator('button:has-text("Annotate")');
		await expect(annBtn).toHaveCSS("color", v.ink);
		await annBtn.hover();
		await expect(annBtn).toHaveCSS("background-color", t.wash);
		// Annotation popover: dark in both themes.
		await annBtn.click();
		const pop = page.locator(".ann-pop");
		await expect(pop).toBeVisible();
		await expect(pop).toHaveCSS("background-color", "rgb(28, 28, 30)");
		await expect(pop).toHaveCSS("border-color", "rgb(56, 56, 58)");
		await page.keyboard.press("Enter");
		const pill = page.locator(".prompt-tools .ann-pill");
		await expect(pill).toBeVisible();
		// Fresh saves highlight their review row.
		await expect(page.locator(".review-item.highlight")).toHaveCSS(
			"background-color",
			L ? "rgb(238, 244, 255)" : "rgb(18, 35, 61)"
		);
		// The card fades in on pill hover: open it before touching inside.
		const card = page.locator(".ann-wrap .review");
		const box = await pill.boundingBox();
		if (!box) throw new Error("pill has no box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await expect
			.poll(() => card.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2000 })
			.toBe("1");
		await expect(card).toHaveCSS("background-color", v.panel);
		await expect(card).toHaveCSS("border-color", v.softLine);
		await expect(page.locator(".review-label").first()).toHaveCSS("color", v.muted);
		const del = page.locator(".review-head button:not(.review-pencil)").first();
		await expect(del).toHaveCSS("color", v.muted);
		await del.hover();
		await expect(del).toHaveCSS("color", v.ink);
		await expect(page.locator(".ann-wrap")).toHaveCSS("border-color", v.line);
		await expect(pill).toHaveCSS("color", v.muted);
		const clear = page.locator(".review-tools button");
		await expect(clear).toHaveCSS("color", v.muted);
		await clear.hover();
		await expect(clear).toHaveCSS("color", v.danger);
		// Edit mode via the pencil: textarea plus Save/Cancel.
		await page.locator('button[aria-label="Edit comment for annotation 1"]').click();
		const area = page.locator(".review textarea");
		await expect(area).toBeVisible();
		await expect(area).toHaveCSS("background-color", v.field);
		// The pencil parks focus in the box, so the rim starts focused.
		await expect(area).toHaveCSS("border-color", v.strong);
		const save = page.locator(".review-edit-actions button").first();
		await expect(save).toHaveCSS("background-color", v.invert);
		await expect(save).toHaveCSS("color", v.invertInk);
		const cancel = page.locator(".review-edit-actions button").last();
		await expect(cancel).toHaveCSS("color", v.muted);
		await cancel.hover();
		await expect(cancel).toHaveCSS("color", v.ink);
		// Send pill shares the inversion.
		const send = page.locator(".send-btn");
		await expect(send).toHaveCSS("background-color", v.invert);
		await expect(send).toHaveCSS("color", v.invertInk);
	});

	test(`action buttons paint ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "button paint check" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const L = t.name === "light";
		const muted = L ? "rgb(110, 110, 115)" : "rgb(152, 152, 159)";
		const ink = L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)";
		const row = page.locator("article.assistant").first();
		await row.hover();
		const btn = row.locator(".actions button").first();
		await expect(btn).toHaveCSS("color", muted);
		await btn.hover();
		await expect(btn).toHaveCSS("color", ink);
		const attach = page.locator(".attach-btn");
		await attach.hover();
		await expect(attach).toHaveCSS("color", ink);
	});

	test(`attachments paint ${t.name}`, async ({ page }) => {
		await seedChat(page, []);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const L = t.name === "light";
		const muted = L ? "rgb(110, 110, 115)" : "rgb(152, 152, 159)";
		const hl = L ? "rgb(238, 244, 255)" : "rgb(18, 35, 61)";
		await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/attach.bmp");
		const item = page.locator(".attachments li").first();
		await expect(item).toBeVisible({ timeout: 10_000 });
		await expect(item).toHaveCSS("background-color", hl);
		await expect(item.locator(".tok")).toHaveCSS("color", muted);
		await item.locator(".thumb").click();
		await expect(page.locator(".preview")).toHaveCSS(
			"border-color",
			L ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)"
		);
		await page.locator(".cm-content").click();
		await page.keyboard.type("file attached");
		await page.keyboard.press("Enter");
		const sent = page.locator(".sent-files").first();
		await expect(sent).toBeVisible({ timeout: 30_000 });
		await expect(sent).toHaveCSS("color", muted);
	});

	// No failed-send test: without the mock the dev backend still
	// answers, so the error banner isn't forceable here. Its dark
	// pair matches no token, so the lone rule stays.
	test(`selected message paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [
			{ role: "user", content: "one" },
			{ role: "assistant", content: "two" }
		]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		await page.locator(".cm-content").click();
		await page.keyboard.press("Control+g");
		const current = page.locator("article.selected");
		await expect(current).toHaveCount(1);
		await expect(current).toHaveCSS(
			"outline-color",
			t.name === "light" ? "rgb(58, 58, 60)" : "rgb(174, 174, 178)"
		);
	});

	test(`shortcuts modal paints ${t.name}`, async ({ page }) => {
		await seedChat(page, [{ role: "user", content: "hi" }]);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		await page.keyboard.press("Shift+Meta+/");
		await expect(page.locator(".modal")).toBeVisible();
		await expect(page.locator(".modal")).toHaveCSS("background-color", t.bg);
		await expect(page.locator(".modal")).toHaveCSS("border-top-color", t.softLine);
		const L = t.name === "light";
		const line = L ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)";
		const focus = L ? "rgb(58, 58, 60)" : "rgb(174, 174, 178)";
		const ink = L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)";
		const strong = L ? "rgb(28, 28, 30)" : "rgb(174, 174, 178)";
		const close = page.locator(".modal-head button");
		await expect(close).toHaveCSS("border-color", line);
		await expect(close).toHaveCSS("color", focus);
		await close.hover();
		await expect(close).toHaveCSS("border-color", strong);
		if (!L) await expect(close).toHaveCSS("color", "rgb(242, 242, 247)");
		// Rows 1-2 carry no top border by design; the third row does.
		const key = page.locator(".keys div").nth(2);
		await expect(key).toHaveCSS(
			"border-top-color",
			L ? "rgb(229, 229, 234)" : "rgb(56, 56, 58)"
		);
		await expect(page.locator(".keys dt").first()).toHaveCSS("color", focus);
		await expect(page.locator(".keys dd").first()).toHaveCSS("color", ink);
	});

	test(`chrome paints ${t.name}`, async ({ page }) => {
		const msgs = Array.from({ length: 30 }, (_, i) => ({
			role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
			content: `chrome filler message ${i} with enough words to wrap a line`
		}));
		await seedChat(page, msgs);
		await seedTheme(page, t.name);
		await page.goto("/");
		await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
		const L = t.name === "light";
		const muted = L ? "rgb(110, 110, 115)" : "rgb(152, 152, 159)";
		const ink = L ? "rgb(28, 28, 30)" : "rgb(242, 242, 247)";
		const voice = page.locator(".voice-float");
		await expect(voice).toHaveCSS("color", muted);
		await voice.hover();
		await expect(voice).toHaveCSS("color", ink);
		await voice.click();
		await expect(voice).toHaveCSS(
			"color",
			L ? "rgb(31, 122, 77)" : "rgb(124, 195, 163)"
		);
		await voice.click();
		await page.locator("article .rendered").first().selectText();
		const tint = await page.evaluate(
			() => getComputedStyle(document.querySelector("article .rendered")!, "::selection").backgroundColor
		);
		expect(tint).toBe(L ? "rgba(99, 102, 241, 0.28)" : "rgba(129, 140, 248, 0.4)");
		// The floating nav carries border: 0, so neither the old dark
		// border rule nor its token line ever paints — nothing to pin.
		await expect(page.locator('nav[aria-label="Waypoints"]')).toHaveCount(1);
		// The wrap is the hover target (it also opens the menu by CSS).
		await page.locator(".wp-wrap").hover();
		const wp = page.locator(".wp-menu");
		await expect(wp).toBeVisible();
		await expect(wp).toHaveCSS(
			"background-color",
			L ? "rgb(255, 255, 255)" : "rgb(28, 28, 30)"
		);
		await expect(wp).toHaveCSS(
			"border-color",
			L ? "rgb(199, 199, 204)" : "rgb(72, 72, 74)"
		);
		const target = wp.locator('button[role="menuitem"]').first();
		await expect(target).toHaveCSS("color", ink);
		await target.hover();
		await expect(target).toHaveCSS(
			"background-color",
			L ? "rgb(241, 241, 244)" : "rgb(44, 44, 46)"
		);
		await expect(wp.locator('button[aria-current="true"]')).toHaveCSS(
			"background-color",
			L ? "rgb(241, 241, 244)" : "rgb(44, 44, 46)"
		);
	});
}

test("composer holds its first line clear of the tools", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const pad = await page.evaluate(() => {
		const el = document.querySelector(".prompt .cm-content");
		return el ? parseFloat(getComputedStyle(el).paddingRight) : 0;
	});
	// 4.6rem ≈ 74px at the default root size; tools must never overlap text.
	expect(pad).toBeGreaterThan(60);
});
