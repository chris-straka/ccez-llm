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
		},
		{ messages, replyLang, extraSettings }
	);
}

/**
 * Toggle the chat-list sidebar the browser-safe way. Plain Cmd/Ctrl+B is
 * shell-only (the browser runtime passes it through), so specs use
 * Shift+Cmd+[ — the chord that toggles on every runtime.
 */
export async function toggleSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Meta+Shift+BracketLeft");
}

/**
 * Skip the rest of the calling test unless it runs inside the Tauri
 * shell. Shell-only chords (palette Ctrl+P, find Ctrl+F) pass through
 * to browser chrome on web runtimes, so their specs can only open a
 * dialog there — call after the seed/goto, before the chord press.
 */
export async function requireShell(page: Page): Promise<void> {
	const inShell = await page.evaluate(
		() => "__TAURI_INTERNALS__" in window
	);
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
(badge chrome excluded so node offsets map onto visible text). */
export async function quoteRect(
	page: Page,
	article: number,
	quote: string
): Promise<{ x: number; y: number; width: number; height: number }> {
	return page.evaluate(
		([n, text]: [number, string]) => {
			const root = document.querySelectorAll("article .rendered")[n];
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
			return range.getBoundingClientRect().toJSON() as {
				x: number;
				y: number;
				width: number;
				height: number;
			};
		},
		[article, quote] as [number, string]
	);
}

/** True drag-select of a quote inside one article: the release point
stays inside the message, never on a control that would clear it. */
export async function dragQuote(
	page: Page,
	article: number,
	quote: string
): Promise<void> {
	const rect = await quoteRect(page, article, quote);
	await page.mouse.move(rect.x + 1, rect.y + rect.height / 2);
	await page.mouse.down();
	await page.mouse.move(rect.x + rect.width - 1, rect.y + rect.height / 2, {
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
