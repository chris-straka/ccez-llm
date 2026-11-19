import type { Page } from "@playwright/test";

/**
 * A stand-in shell for the menu bar Ask window (`/menubar`): events the
 * page listens for can be pushed (`pushMenubar`), and what the page sends
 * (`emit_to`, window resizes, hide) is kept on `window.__menubar` for the
 * spec to read. Nothing opens on screen: the page runs in a headless
 * browser as the Mac app's Ask window would.
 */
export async function seedMenubarShell(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const listeners: Record<string, number[]> = {};
		const callbacks: ((payload: unknown) => void)[] = [];
		const kept = {
			emitted: [] as { target: unknown; event: string; payload: unknown }[],
			sizes: [] as { width: number; height: number }[],
			hidden: 0,
			opened: [] as string[]
		};
		const w = window as unknown as Record<string, unknown>;
		w.__menubar = kept;
		w.__TAURI_INTERNALS__ = {
			metadata: {
				currentWindow: { label: "menubar" },
				currentWebview: { windowLabel: "menubar", label: "menubar" }
			},
			invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
				if (cmd === "plugin:event|listen") {
					const name = String(args["event"] ?? "");
					(listeners[name] ??= []).push(Number(args["handler"]));
					return listeners[name].length;
				}
				if (cmd === "plugin:event|unlisten") return null;
				if (cmd === "plugin:event|emit_to") {
					kept.emitted.push({
						target: args["target"],
						event: String(args["event"]),
						payload: args["payload"]
					});
					return null;
				}
				if (cmd === "menubar_fit") {
					kept.sizes.push({ width: 420, height: Number(args["height"]) });
					return null;
				}
				if (cmd === "menubar_hide") {
					kept.hidden++;
					return null;
				}
				if (cmd === "plugin:opener|open_url") {
					kept.opened.push(String(args["url"]));
					return null;
				}
				// A release build: no drive hooks.
				if (cmd === "drive_ready") throw new Error("not a debug build");
				return null;
			},
			transformCallback: (fn?: (payload: unknown) => void): number => {
				callbacks.push(fn ?? (() => undefined));
				return callbacks.length - 1;
			},
			unregisterCallback: (): void => {}
		};
		w.__pushMenubar = (event: string, payload: unknown): void => {
			for (const id of listeners[event] ?? [])
				callbacks[id]?.({ event, id, payload });
		};
	});
}

/** An event to the page, as the main window would send it. */
export async function pushMenubar(
	page: Page,
	event: string,
	payload: unknown
): Promise<void> {
	await page.evaluate(
		([e, p]) =>
			(
				window as unknown as {
					__pushMenubar: (event: string, payload: unknown) => void;
				}
			).__pushMenubar(e as string, p),
		[event, payload] as const
	);
}

/** What the page sent and asked for so far. */
export async function menubarKept(page: Page): Promise<{
	emitted: { target: unknown; event: string; payload: unknown }[];
	sizes: { width: number; height: number }[];
	hidden: number;
	opened: string[];
}> {
	return page.evaluate(
		() =>
			(window as unknown as { __menubar: never }).__menubar as {
				emitted: { target: unknown; event: string; payload: unknown }[];
				sizes: { width: number; height: number }[];
				hidden: number;
				opened: string[];
			}
	);
}
