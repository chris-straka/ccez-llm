import { expect, test, type Page } from "./fixtures";
import { seedChat, toggleSidebar } from "./helpers";

/**
 * Interface size (Settings > Interface size, 100–250%): the settings
 * drawer, chat list, dialogs, and toasts zoom while messages and the
 * composer keep their own sizes. Every surface stays inside the
 * viewport at 250% on desktop and phone alike, with text at 2.5x.
 * Screenshots land in .screenshots/ for eyeballing.
 */
const THREAD = [
	{ role: "user" as const, content: "show me the levels" },
	{
		role: "assistant" as const,
		content: `The energy levels:

$$E_n = -\\frac{13.6\\text{ eV}}{n^2}$$

where \\(n = 1, 2, \\dots\\) counts the level.

\`\`\`tex
$$E = mc^2$$
\`\`\``
	}
];

async function textHeight(page: Page, selector: string): Promise<number> {
	return page.evaluate((s) => {
		const el = document.querySelector(s);
		if (!(el instanceof HTMLElement)) throw new Error(`missing ${s}`);
		return el.getBoundingClientRect().height;
	}, selector);
}

async function settledOpen(page: Page, selector: string): Promise<void> {
	// Drawers slide on transform: the open class flips instantly but
	// the 0.22s slide runs on — measuring mid-flight catches the box
	// off-screen. Poll until the transform lands at none.
	await expect
		.poll(
			() =>
				page.evaluate((s) => {
					const el = document.querySelector(s);
					if (!(el instanceof HTMLElement)) throw new Error(`missing ${s}`);
					return getComputedStyle(el).transform;
				}, selector),
			{ timeout: 5_000 }
		)
		.toBe("none");
}

async function settledClosed(page: Page, selector: string): Promise<void> {
	// Mirror of settledOpen for the closing slide: the 0.22s slide
	// runs past the class flip, and mid-flight matrices read back
	// too — so poll until the transform stops changing instead.
	const transformOf = (s: string) =>
		page.evaluate((sel) => {
			const el = document.querySelector(sel);
			if (!(el instanceof HTMLElement)) throw new Error(`missing ${sel}`);
			return getComputedStyle(el).transform;
		}, s);
	await expect
		.poll(
			async () => {
				const first = await transformOf(selector);
				await page.waitForTimeout(60);
				return first === (await transformOf(selector)) ? "settled" : "moving";
			},
			{ timeout: 5_000 }
		)
		.toBe("settled");
}

async function boxInViewport(
	page: Page,
	selector: string,
	vw: number,
	vh: number
): Promise<{ width: number; height: number; x: number; y: number }> {
	const box = await page.locator(selector).boundingBox();
	expect(box).toBeTruthy();
	expect(box!.x).toBeGreaterThanOrEqual(-1);
	expect(box!.y).toBeGreaterThanOrEqual(-1);
	expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
	expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
	return box!;
}

async function openToast(page: Page): Promise<void> {
	await page.locator(".ccez-math-copy").first().click();
	await expect(page.locator(".toast")).toBeVisible({ timeout: 10_000 });
	// Toasts hold while hovered: pin it before measuring.
	await page.locator(".toast").hover();
}

async function interfaceSizeFlow(
	page: Page,
	vw: number,
	vh: number,
	phone: boolean
): Promise<void> {
	const tag = phone ? "phone" : "desktop";
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, THREAD);
	await page.goto("/");
	await expect(page.locator(".ccez-math").first()).toBeVisible({
		timeout: 60_000
	});
	const drawer = page.locator(".settings-panel");
	const list = page.locator("aside:has(button.side-chat)");
	const modal = page.locator(".modal");
	const slider = page.locator(
		'.settings-panel input[aria-label="Interface size percent"]'
	);
	// Baseline geometry at 100%. The toast comes first with no
	// drawers open (the thread copy click matches the latex suite's
	// proven context); the drawer and list then stay open on opposite
	// sides, and only the modal veil must close before each copy click.
	const msgText100 = await textHeight(page, "article .rendered");
	const editorText100 = await textHeight(page, ".prompt .ta-input");
	await openToast(page);
	const toastBox100 = await boxInViewport(page, ".toast", vw, vh);
	await page.keyboard.press("Meta+,");
	await expect(drawer).not.toHaveClass(/closed/);
	await settledOpen(page, ".settings-panel");
	const drawerText100 = await textHeight(page, ".settings-panel .reset-width");
	const drawerBox100 = await boxInViewport(page, ".settings-panel", vw, vh);
	await toggleSidebar(page);
	await expect(list).not.toHaveClass(/collapsed/);
	await settledOpen(page, "aside:has(button.side-chat)");
	const rowText100 = await textHeight(page, "aside ul li .side-chat");
	const listBox100 = await boxInViewport(
		page,
		"aside:has(button.side-chat)",
		vw,
		vh
	);
	await page.keyboard.press("Control+Shift+Slash");
	await expect(modal.first()).toBeVisible({ timeout: 10_000 });
	const modalText100 = await textHeight(page, ".modal .keys dt");
	await boxInViewport(page, ".modal", vw, vh);
	await page.keyboard.press("Escape");
	// Phones draw one sidebar at a time, so the list folded settings
	// above: reopen for the slider + measurement.
	if (phone) {
		await page.keyboard.press("Meta+,");
		await expect(drawer).not.toHaveClass(/closed/);
		await settledOpen(page, ".settings-panel");
	}
	// Crank to 250% through the real slider (change commits on
	// release; fill alone only fires input).
	await slider.fill("250");
	await slider.dispatchEvent("change");
	await expect
		.poll(() => textHeight(page, ".settings-panel .reset-width"), {
			timeout: 5_000
		})
		.toBeGreaterThan(drawerText100 * 2);
	const out = page.locator(
		'.settings-panel .slider-row:has(input[aria-label="Interface size percent"]) output'
	);
	await expect(out).toHaveText("250%");
	// Drawer: text at 2.5x. Desktop boxes grow with the zoom; the
	// phone sheet keeps filling the screen exactly.
	const drawerText250 = await textHeight(page, ".settings-panel .reset-width");
	// ±4% bands: zoom is exact but small-box text metrics round to
	// whole pixels (the drawer button reads 2.5625x, not 2.5x).
	expect(drawerText250 / drawerText100).toBeGreaterThanOrEqual(2.4);
	expect(drawerText250 / drawerText100).toBeLessThanOrEqual(2.6);
	const drawerBox250 = await boxInViewport(page, ".settings-panel", vw, vh);
	await page.screenshot({ path: `.screenshots/ui-250-${tag}-drawer.png` });
	if (phone) {
		// The 2x2 gestures/updates footer stacks to one column on the
		// narrow sheet: the updates button was shoved off-screen (x=457)
		// before the container query. Scroll it into view and pin it.
		await page.evaluate(() => {
			const p = document.querySelector(".settings-panel");
			p?.scrollTo({ top: p.scrollHeight });
		});
		await page.waitForTimeout(200);
		await boxInViewport(
			page,
			'.settings-panel section[aria-labelledby="updates-heading"] > button',
			vw,
			vh
		);
		await page.evaluate(() => {
			document.querySelector(".settings-panel")?.scrollTo({ top: 0 });
		});
		expect(drawerBox250.x).toBeGreaterThanOrEqual(-1);
		expect(drawerBox250.x).toBeLessThanOrEqual(1);
		expect(drawerBox250.width).toBeGreaterThanOrEqual(vw - 1);
	} else {
		const grew = drawerBox250.width / drawerBox100.width;
		expect(grew).toBeGreaterThanOrEqual(2.4);
		expect(grew).toBeLessThanOrEqual(2.6);
	}
	// Chat list: row text grows 2.5x (lower bound — a capped phone
	// box may wrap a long title); the box never leaves the screen.
	// The phone drawer reopen folded the list: summon it back.
	if (phone) {
		await toggleSidebar(page);
		await expect(list).not.toHaveClass(/collapsed/);
		await settledOpen(page, "aside:has(button.side-chat)");
	}
	const rowText250 = await textHeight(page, "aside ul li .side-chat");
	expect(rowText250 / rowText100).toBeGreaterThanOrEqual(2.4);
	const listBox250 = await boxInViewport(
		page,
		"aside:has(button.side-chat)",
		vw,
		vh
	);
	await page.screenshot({ path: `.screenshots/ui-250-${tag}-list.png` });
	if (!phone) {
		const grew = listBox250.width / listBox100.width;
		expect(grew).toBeGreaterThanOrEqual(2.4);
		expect(grew).toBeLessThanOrEqual(2.6);
	}
	// Dialog: names grow (wrapping tolerates the capped box); the
	// reciprocal cap holds the rendered box inside the veil.
	await page.keyboard.press("Control+Shift+Slash");
	await expect(modal.first()).toBeVisible({ timeout: 10_000 });
	const modalText250 = await textHeight(page, ".modal .keys dt");
	expect(modalText250 / modalText100).toBeGreaterThanOrEqual(2.4);
	await boxInViewport(page, ".modal", vw, vh);
	if (phone) {
		// Key chords wrap instead of stretching their rows: an 836px
		// dt blew the modal to 14810px tall (blank card) before the
		// .keys wrap fix. Wrapped chords stay under ~130px.
		const tallestChord = await page.evaluate(() =>
			Math.max(
				...[...document.querySelectorAll(".modal .keys dt")].map(
					(el) => el.getBoundingClientRect().height
				)
			)
		);
		expect(tallestChord).toBeLessThanOrEqual(300);
	}
	await page.screenshot({ path: `.screenshots/ui-250-${tag}-modal.png` });
	await page.keyboard.press("Escape");
	// Toast: the pill grows with the text, stays centered and inside.
	// Fold the drawers first (the zoomed desktop pair covers the
	// thread; the phone holds only the list by now).
	if (phone) {
		await toggleSidebar(page);
		await expect(list).toHaveClass(/collapsed/);
		await settledClosed(page, "aside:has(button.side-chat)");
	} else {
		await page.keyboard.press("Meta+,");
		await toggleSidebar(page);
		await expect(drawer).toHaveClass(/closed/);
		await expect(list).toHaveClass(/collapsed/);
		await settledClosed(page, ".settings-panel");
		await settledClosed(page, "aside:has(button.side-chat)");
	}
	await openToast(page);
	const toastBox250 = await boxInViewport(page, ".toast", vw, vh);
	await page.screenshot({ path: `.screenshots/ui-250-${tag}-toast.png` });
	const toastGrew = toastBox250.height / toastBox100.height;
	expect(toastGrew).toBeGreaterThanOrEqual(2.4);
	expect(toastGrew).toBeLessThanOrEqual(2.6);
	const center = toastBox250.x + toastBox250.width / 2;
	expect(Math.abs(center - vw / 2)).toBeLessThanOrEqual(3);
	// Messages and the composer never follow the interface zoom.
	const msgText250 = await textHeight(page, "article .rendered");
	const editorText250 = await textHeight(page, ".prompt .ta-input");
	expect(msgText250 / msgText100).toBeGreaterThanOrEqual(0.99);
	expect(msgText250 / msgText100).toBeLessThanOrEqual(1.01);
	expect(editorText250 / editorText100).toBeGreaterThanOrEqual(0.99);
	expect(editorText250 / editorText100).toBeLessThanOrEqual(1.01);
}

test("desktop chrome zooms to 250% inside the viewport", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await interfaceSizeFlow(page, 1280, 800, false);
});

test.describe("phone", () => {
	test.use({
		hasTouch: true,
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("phone chrome zooms to 250% inside the viewport", async ({ page }) => {
		await interfaceSizeFlow(page, 412, 915, true);
	});
});
