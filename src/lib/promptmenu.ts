import { invoke } from "@tauri-apps/api/core";

import { tauriBackendAvailable } from "./secrets";

/**
 * Prompt-and-fields native OS text menu.
 *
 * The Activity swaps every floating selection menu for an empty dummy
 * except while a live selection sits inside the main prompt or an
 * editable field (key inputs and friends): then the real OS menu
 * (Copy / Cut / Paste / Select All) shows. Static panel copy matches
 * neither and keeps the dummy. The page owns the anchor fact
 * (CodeMirror renders the prompt, so only the DOM can see it) and
 * reports transitions to Rust, which the Activity reads synchronously
 * at menu time.
 */

export type ContainsNode = Pick<Node, "contains">;

const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true']";

type MaybeElement = {
	closest?: (selector: string) => unknown;
	parentElement?: MaybeElement | null;
};

/**
 * True when the anchor sits inside an editable field (text selections
 * anchor text nodes, so climb one level). Static panel copy never
 * matches — only fields get the native menu.
 */
function inEditableField(node: Node): boolean {
	const probe = node as unknown as MaybeElement;
	try {
		if (typeof probe.closest === "function") {
			return probe.closest(EDITABLE_SELECTOR) !== null;
		}
		const parent = probe.parentElement;
		if (parent && typeof parent.closest === "function") {
			return parent.closest(EDITABLE_SELECTOR) !== null;
		}
	} catch {
		return false;
	}
	return false;
}

/**
 * Pure read: is there a live range anchored inside any allowed root
 * or editable field? Roots cover rendered editors (the prompt's
 * CodeMirror); the field check covers native inputs like the key
 * field. Static text matches neither.
 */
export function osMenuSelectionActive(
	roots: Array<ContainsNode | null | undefined>,
	anchor: Node | null,
	collapsed: boolean
): boolean {
	if (anchor == null || collapsed) return false;
	if (inEditableField(anchor)) return true;
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
