import { expect, test, type Page } from "./fixtures";
import { seedChat } from "./helpers";
import { emitShellEvent, seedMockShell } from "./mock-shell";

/**
 * The browser pane's own HTML (docs/design/browser-pane.md): its pages
 * are native views the stand-in shell only records, so these check what
 * the app asks of them: where, when shown, what URL. The real pages are
 * checked on the Mac app (scripts/drive.ts).
 */

type Call = { cmd: string; args: Record<string, unknown> };

const calls = (page: Page) =>
	page.evaluate(
		() =>
			((window as unknown as { __browserCalls?: Call[] }).__browserCalls ??
				[]) as Call[]
	);

/** The last call of `cmd`, waited for. */
async function last(page: Page, cmd: string): Promise<Record<string, unknown>> {
	await expect
		.poll(async () => (await calls(page)).some((c) => c.cmd === cmd))
		.toBe(true);
	return (await calls(page)).filter((c) => c.cmd === cmd).pop()!.args;
}

async function open(page: Page): Promise<void> {
	await seedMockShell(page);
	await seedChat(page, [
		{ role: "user", content: "Where can I read French news?" },
		{
			role: "assistant",
			content:
				"Try [Le Monde](https://www.lemonde.fr/) or [France Info](https://www.francetvinfo.fr/)."
		}
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

test.use({ viewport: { width: 1400, height: 860 } });

test("⇧⌘B opens the pane on a new tab, the address bar ready; Enter goes there", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	const pane = page.locator("aside.browser");
	await expect(pane).toBeVisible();
	await expect(pane.getByRole("tab")).toHaveCount(1);
	const address = pane.getByLabel("Address");
	await expect(address).toBeFocused();
	// The page sits exactly in the box the pane leaves for it.
	const made = await last(page, "browser_open");
	const box = await pane.locator(".page").boundingBox();
	expect(Math.abs(Number(made.x) - box!.x)).toBeLessThan(1.5);
	expect(Math.abs(Number(made.y) - box!.y)).toBeLessThan(1.5);
	expect(Math.abs(Number(made.w) - box!.width)).toBeLessThan(1.5);
	expect(Math.abs(Number(made.h) - box!.height)).toBeLessThan(1.5);
	await address.fill("lemonde.fr");
	await address.press("Enter");
	expect((await last(page, "browser_navigate")).url).toBe(
		"https://lemonde.fr/"
	);
	// At rest the host shows, not the field.
	await expect(pane.locator(".shown .host")).toHaveText("lemonde.fr");
	await page.screenshot({ path: ".screenshots/browser-pane-open.png" });
});

test("the divider keeps both sides to their minimums; a double-click puts it at half", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	const pane = page.locator("aside.browser");
	const divider = pane.getByRole("separator", { name: "Resize the browser" });
	const room = await page.evaluate(() => {
		const p = document.querySelector("aside.browser")!.getBoundingClientRect();
		const m = document.querySelector("main")!.getBoundingClientRect();
		return p.width + m.width;
	});
	const d = (await divider.boundingBox())!;
	await page.mouse.move(d.x + d.width / 2, d.y + 300);
	await page.mouse.down();
	await page.mouse.move(40, d.y + 300, { steps: 6 });
	await page.mouse.up();
	// The chat keeps 320px.
	await expect
		.poll(async () => (await page.locator("main").boundingBox())!.width)
		.toBeGreaterThanOrEqual(319);
	await divider.dblclick();
	await expect
		.poll(async () => (await pane.boundingBox())!.width)
		.toBeCloseTo(room / 2, -1);
	// While it moved, the page stepped aside (its snapshot stood in).
	const moves = (await calls(page))
		.filter((c) => c.cmd === "browser_visible")
		.map((c) => c.args.visible);
	expect(moves).toContain(false);
	expect(moves.at(-1)).toBe(true);
});

test("Settings opening over the window: the page steps aside, and comes back after", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	await last(page, "browser_open");
	await page.keyboard.press("ControlOrMeta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	await expect
		.poll(async () => (await last(page, "browser_visible")).visible)
		.toBe(false);
	await page.keyboard.press("Escape");
	await expect
		.poll(async () => (await last(page, "browser_visible")).visible)
		.toBe(true);
});

test("tabs: + adds one, × and the middle button close; the last closes the pane", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	const pane = page.locator("aside.browser");
	await pane.getByRole("button", { name: "New tab" }).click();
	await pane.getByRole("button", { name: "New tab" }).click();
	await expect(pane.getByRole("tab")).toHaveCount(3);
	await expect(pane.getByRole("tab").nth(2)).toHaveAttribute(
		"aria-selected",
		"true"
	);
	await pane.getByRole("tab").nth(1).click({ button: "middle" });
	await expect(pane.getByRole("tab")).toHaveCount(2);
	await pane
		.getByRole("tab")
		.nth(1)
		.getByRole("button", { name: "Close tab" })
		.click();
	await expect(pane.getByRole("tab")).toHaveCount(1);
	await pane.getByRole("tab").first().hover();
	await pane
		.getByRole("tab")
		.first()
		.getByRole("button", { name: "Close tab" })
		.click();
	await expect(pane).toHaveCount(0);
	expect(
		(await calls(page)).filter((c) => c.cmd === "browser_close").length
	).toBeGreaterThan(0);
});

test("a link in a reply opens a new tab while the pane is open; the app never leaves itself", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	await page.locator("article .rendered a", { hasText: "Le Monde" }).click();
	const pane = page.locator("aside.browser");
	await expect(pane.getByRole("tab")).toHaveCount(2);
	await expect
		.poll(async () => (await last(page, "browser_open")).url)
		.toBe("https://www.lemonde.fr/");
	await expect(page).toHaveURL(/127\.0\.0\.1|localhost/);
});

test("a double-click on the right side never opens Settings while the pane is open", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	const main = (await page.locator("main").boundingBox())!;
	const col = (await page.locator("article").first().boundingBox())!;
	// Between the column and the divider.
	await page.mouse.dblclick(
		(col.x + col.width + main.x + main.width) / 2,
		main.y + 400
	);
	await page.waitForTimeout(300);
	await expect(page.locator(".settings-panel")).toHaveClass(/closed/);
});

test("tabs, the active one and the split come back after a relaunch", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	const pane = page.locator("aside.browser");
	await pane.getByLabel("Address").fill("spiegel.de");
	await pane.getByLabel("Address").press("Enter");
	await pane.getByRole("button", { name: "New tab" }).click();
	await pane.getByLabel("Address").fill("lemonde.fr");
	await pane.getByLabel("Address").press("Enter");
	await pane.getByRole("tab").first().click();
	await page.reload();
	await expect(page.locator("aside.browser")).toBeVisible();
	await expect(page.locator("aside.browser").getByRole("tab")).toHaveCount(2);
	await expect(
		page.locator("aside.browser").getByRole("tab").first()
	).toHaveAttribute("aria-selected", "true");
	await expect
		.poll(async () => (await last(page, "browser_open")).url)
		.toBe("https://spiegel.de/");
});

test("a menu of the app's reaching over the page: the page steps aside while it's there", async ({
	page
}) => {
	await open(page);
	await emitShellEvent(page, "menu-action", "browser-toggle");
	await last(page, "browser_open");
	const box = (await page.locator("aside.browser .page").boundingBox())!;
	await page.evaluate((b) => {
		const menu = document.createElement("div");
		menu.id = "spec-menu";
		menu.setAttribute("role", "menu");
		menu.style.cssText = `position:fixed;left:${b.x - 60}px;top:${b.y + 40}px;width:160px;height:120px;background:#333`;
		document.body.append(menu);
	}, box);
	await expect
		.poll(async () => (await last(page, "browser_visible")).visible)
		.toBe(false);
	await page.evaluate(() => document.getElementById("spec-menu")?.remove());
	await expect
		.poll(async () => (await last(page, "browser_visible")).visible)
		.toBe(true);
});

test.describe("a window too narrow for both", () => {
	test.use({ viewport: { width: 620, height: 800 } });

	test("the pane takes it all; its button brings the chat back, the tabs kept", async ({
		page
	}) => {
		await open(page);
		await emitShellEvent(page, "menu-action", "browser-toggle");
		const pane = page.locator("aside.browser");
		await expect(pane).toHaveClass(/expanded/);
		await pane.getByLabel("Address").fill("lemonde.fr");
		await pane.getByLabel("Address").press("Enter");
		await pane.getByRole("button", { name: "Show the chat" }).click();
		await expect(pane).toHaveCount(0);
		await expect(page.locator("article").first()).toBeVisible();
		await emitShellEvent(page, "menu-action", "browser-toggle");
		await expect(page.locator("aside.browser").getByRole("tab")).toHaveCount(1);
	});
});
