import { test, type Page } from "@playwright/test";

/** Test-only window/element fields (replaces `as unknown` casts). */
declare global {
	interface Window {
		voiceToastSeen: number;
		voiceToastWatching: boolean;
	}
	interface Element {
		__mark?: number;
	}
}

export interface SeedMessage {
	role: "user" | "assistant";
	content: string;
}

/**
 * Seed one chat (plus hover-reveal settings and the mock provider) before
 * the app boots, so e2e specs open on a deterministic conversation with
 * no API key and no typing. Idle-hide defaults to never here: most specs
 * click the composer on short threads, and always-hide would park it —
 * idle specs reseed with their own timeout explicitly.
 */
export async function seedChat(
	page: Page,
	messages: SeedMessage[],
	replyLang: string | null = null,
	extraSettings: Record<string, unknown> = {}
): Promise<void> {
	await page.addInitScript(
		(seed: {
			messages: SeedMessage[];
			replyLang: string | null;
			extraSettings: Record<string, unknown>;
		}) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			window.localStorage.setItem(
				"ccez-llm-settings-v1",
				JSON.stringify({
					hoverAssistantActions: true,
					hoverUserActions: true,
					promptIdleSec: 0,
					...seed.extraSettings
				})
			);
			window.localStorage.setItem(
				"ccez-llm-chats-v1",
				JSON.stringify([
					{
						id: "e2e-chat",
						createdAt: 1,
						replyLang: seed.replyLang,
						messages: seed.messages.map((m, i) => ({
							id: `e2e-m${i}`,
							role: m.role,
							content: m.content,
							usage: null,
							error: null
						}))
					}
				])
			);
			// A never-opened chat lands at its bottom; specs here start
			// reading at the top, as a chat left there would.
			window.localStorage.setItem(
				"ccez-llm-chat-scroll-v1",
				JSON.stringify({ "e2e-chat": { bottom: false, top: 0, anchor: null } })
			);
		},
		{ messages, replyLang, extraSettings }
	);
}

/**
 * Toggle the chat-list sidebar the runtime-safe way. Plain Cmd/Ctrl+B
 * is shell-only (the browser passes it to the bookmarks bar), while
 * Shift+Cmd+[ toggles on web but resizes the prompt in the shell —
 * so specs pick the chord per runtime.
 */
/**
 * Report macOS to the page (`navigator.platform` and Client Hints), so
 * Mac-only settings rows render on any CI or dev host. Call before
 * `page.goto`.
 */
export async function pinMacPlatform(page: Page): Promise<void> {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, "platform", {
			get: () => "MacIntel"
		});
		Object.defineProperty(navigator, "userAgentData", {
			get: () => ({ platform: "macOS", mobile: false, brands: [] })
		});
	});
}

export async function toggleSidebar(page: Page): Promise<void> {
	const inShell = await page.evaluate(() => "__TAURI_INTERNALS__" in window);
	await page.keyboard.press(inShell ? "Meta+b" : "Meta+Shift+BracketLeft");
}

/**
 * Skip the rest of the calling test unless it runs inside the Tauri
 * shell. Shell-only chords (palette Ctrl+P, find Ctrl+F) pass through
 * to browser chrome on web runtimes, so their specs can only open a
 * dialog there — call after the seed/goto, before the chord press.
 */
export async function requireShell(page: Page): Promise<void> {
	const inShell = await page.evaluate(() => "__TAURI_INTERNALS__" in window);
	test.skip(!inShell, "shell-only chord passes through on web runtimes");
}

/**
 * Wait for the message column to rest: smooth programmatic glides keep
 * firing scroll events after they look done, and any scroll dismisses
 * the selection menu on desktop — so selects that summon the menu must
 * only run on a settled thread.
 */
export async function settleScroller(page: Page): Promise<void> {
	await page.waitForFunction(() => {
		const el = document.querySelector("main .messages") as HTMLElement | null;
		if (!el) return false;
		const rest = el.scrollTop;
		return new Promise<boolean>((resolve) => {
			setTimeout(() => resolve(el.scrollTop === rest), 350);
		});
	});
}

/** Bounding boxes for every button in an assistant message's action row. */
export async function rowBoxes(
	page: Page,
	article: string
): Promise<
	Array<{ x: number; y: number; width: number; height: number } | null>
> {
	const buttons = page.locator(`${article} .actions button`);
	const count = await buttons.count();
	const boxes = [];
	for (let i = 0; i < count; i++)
		boxes.push(await buttons.nth(i).boundingBox());
	return boxes;
}

/** Rect of a quote's visible text inside one article's rendered body
(badge chrome excluded so node offsets map onto visible text).
`root` scopes the same walk at news headlines. */
export async function quoteRect(
	page: Page,
	article: number,
	quote: string,
	rootSelector = "article .rendered"
): Promise<Box> {
	return (await quoteBoxes(page, article, quote, rootSelector)).box;
}

type Box = { x: number; y: number; width: number; height: number };

/** A quote's bounding box and its first and last line boxes: a quote
can wrap, even inside one word (hyphenation at big type on Linux). */
async function quoteBoxes(
	page: Page,
	article: number,
	quote: string,
	rootSelector: string
): Promise<{ box: Box; first: Box; last: Box }> {
	return page.evaluate(
		([n, text, sel]: [number, string, string]) => {
			const root = document.querySelectorAll(sel)[n];
			if (!root) throw new Error("no article");
			const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
			const texts: Text[] = [];
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const parent = node.parentNode;
				if (parent instanceof Element && parent.closest("[data-ann-badge]"))
					continue;
				if (node instanceof Text) texts.push(node);
			}
			const hay = texts.map((t) => t.textContent ?? "").join("");
			const at = hay.indexOf(text);
			if (at < 0) throw new Error(`quote missing: ${text}`);
			const nodeAt = (flat: number): [Text, number] => {
				let rest = flat;
				for (const t of texts) {
					const len = (t.textContent ?? "").length;
					if (rest <= len) return [t, rest];
					rest -= len;
				}
				const last = texts[texts.length - 1];
				if (!last) throw new Error("no text");
				return [last, (last.textContent ?? "").length];
			};
			const [startNode, startOff] = nodeAt(at);
			const [endNode, endOff] = nodeAt(at + text.length);
			const range = document.createRange();
			range.setStart(startNode, startOff);
			range.setEnd(endNode, endOff);
			const box = (r: DOMRect) => ({
				x: r.x,
				y: r.y,
				width: r.width,
				height: r.height
			});
			const lines = [...range.getClientRects()].filter((r) => r.width > 0);
			const whole = range.getBoundingClientRect();
			return {
				box: box(whole),
				first: box(lines[0] ?? whole),
				last: box(lines[lines.length - 1] ?? whole)
			};
		},
		[article, quote, rootSelector] as [number, string, string]
	);
}

/** True drag-select of a quote inside one article: the release point
stays inside the message, never on a control that would clear it. */
export async function dragQuote(
	page: Page,
	article: number,
	quote: string,
	rootSelector = "article .rendered"
): Promise<void> {
	let quoted = await quoteBoxes(page, article, quote, rootSelector);
	const rect = quoted.box;
	// Off screen (taller font metrics on Linux): center it first. Only
	// then — an unneeded scroll moves quotes other specs measured.
	const vh = page.viewportSize()?.height ?? 720;
	if (rect.y < 0 || rect.y + rect.height > vh - 120) {
		await page.evaluate(
			([sel, n]: [string, number]) =>
				document
					.querySelectorAll(sel)
					[n]?.scrollIntoView({ block: "center", behavior: "instant" }),
			[rootSelector, article] as [string, number]
		);
		await page.waitForTimeout(300);
		quoted = await quoteBoxes(page, article, quote, rootSelector);
	}
	// From the start of its first line to the end of its last, so a
	// wrapped quote selects only itself.
	const { first, last } = quoted;
	await page.mouse.move(first.x + 1, first.y + first.height / 2);
	await page.mouse.down();
	await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, {
		steps: 8
	});
	await page.mouse.up();
}

/** Assert two box snapshots match within a pixel (no hover nudges). */
export function expectBoxesStable(
	before: Array<{ x: number; y: number; width: number; height: number } | null>,
	after: Array<{ x: number; y: number; width: number; height: number } | null>
): void {
	if (before.length !== after.length) {
		throw new Error(
			`button count changed: ${before.length} -> ${after.length}`
		);
	}
	for (let i = 0; i < before.length; i++) {
		const a = before[i];
		const b = after[i];
		if (!a || !b) throw new Error(`button ${i} lost its box`);
		for (const key of ["x", "y", "width", "height"] as const) {
			if (Math.abs(a[key] - b[key]) > 1) {
				throw new Error(`button ${i} moved: ${key} ${a[key]} -> ${b[key]}`);
			}
		}
	}
}

/**
 * Drive a settings stepper (spinbutton) or slider to `value` the way
 * a keyboard user would: focus it, then arrow toward the target one
 * step at a time. Steppers only land on their ladder rungs, so pick a
 * rung. `rank` orders non-numeric ladders (the idle stepper).
 */
export async function setSettingValue(
	page: Page,
	name: string,
	value: number,
	rank: (v: number) => number = (v) => v
): Promise<void> {
	const control = page.locator(`.settings-panel [aria-label="${name}"]`);
	for (let i = 0; i < 300; i++) {
		const now = Number(await control.getAttribute("aria-valuenow"));
		if (Math.abs(now - value) < 1e-6) return;
		// Refocus per press: an interface-size step re-lays out an
		// open chat list, which takes focus back to its active row.
		await control.focus();
		await page.keyboard.press(
			rank(now) < rank(value) ? "ArrowUp" : "ArrowDown"
		);
	}
	throw new Error(`${name} never reached ${value}`);
}

/** A settings control's current value (aria-valuenow). */
export async function settingValue(page: Page, name: string): Promise<number> {
	return Number(
		await page
			.locator(`.settings-panel [aria-label="${name}"]`)
			.getAttribute("aria-valuenow")
	);
}
