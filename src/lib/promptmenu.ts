import { invoke } from "@tauri-apps/api/core";

import { tauriBackendAvailable } from "./secrets";

/**
 * Settings/composer native OS text menu.
 *
 * The Activity swaps every floating selection menu for an empty dummy
 * except while a live selection sits inside the main prompt or the
 * settings panel: then the real OS menu (Copy / Cut / Paste /
 * Select All) shows, so key fields and other settings inputs paste
 * like anywhere else on the device. The page owns the
 * "inside an allowed root" fact (CodeMirror renders the prompt, so
 * only the DOM can see the anchor) and reports transitions to Rust,
 * which the Activity reads synchronously at menu time.
 */

export type ContainsNode = Pick<Node, "contains">;

/** Pure read: is there a live range anchored inside any allowed root? */
export function osMenuSelectionActive(
	roots: Array<ContainsNode | null | undefined>,
	anchor: Node | null,
	collapsed: boolean
): boolean {
	if (anchor == null || collapsed) return false;
	return roots.some((root) => {
		if (root == null) return false;
		try {
			return root.contains(anchor);
		} catch {
			return false;
		}
	});
}

let lastReported = false;

async function defaultSink(allowed: boolean): Promise<void> {
	if (!tauriBackendAvailable()) return;
	try {
		await invoke("set_prompt_menu_allowed", { allowed });
	} catch {
		// Backend gone mid-transition (dev reload, teardown): the flag
		// keeps its last value, which degrades to today's dummy menu.
	}
}

/**
 * Report the current selection state; invokes only on transitions so
 * handle drags don't chatter the bridge. The sink is injectable for
 * tests; production passes none.
 */
export function reportOsMenu(
	roots: Array<ContainsNode | null | undefined>,
	anchor: Node | null,
	collapsed: boolean,
	sink: (allowed: boolean) => unknown = defaultSink
): void {
	const active = osMenuSelectionActive(roots, anchor, collapsed);
	if (active === lastReported) return;
	lastReported = active;
	void sink(active);
}

/** Test seam: reset the transition latch between cases. */
export function resetOsMenuLatch(): void {
	lastReported = false;
}
