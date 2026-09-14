import type { Page } from "@playwright/test";

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
	replyLang: string | null = null
): Promise<void> {
	await page.addInitScript((seed: { messages: SeedMessage[]; replyLang: string | null }) => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem(
			"ccez-llm-settings-v1",
			JSON.stringify({ hoverAssistantActions: true, hoverUserActions: true, promptIdleSec: 0 })
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
	}, { messages, replyLang });
}

/** Bounding boxes for every button in an assistant message's action row. */
export async function rowBoxes(page: Page, article: string): Promise<Array<{ x: number; y: number; width: number; height: number } | null>> {
	const buttons = page.locator(`${article} .actions button`);
	const count = await buttons.count();
	const boxes = [];
	for (let i = 0; i < count; i++) boxes.push(await buttons.nth(i).boundingBox());
	return boxes;
}

/** Assert two box snapshots match within a pixel (no hover nudges). */
export function expectBoxesStable(
	before: Array<{ x: number; y: number; width: number; height: number } | null>,
	after: Array<{ x: number; y: number; width: number; height: number } | null>
): void {
	if (before.length !== after.length) {
		throw new Error(`button count changed: ${before.length} -> ${after.length}`);
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
