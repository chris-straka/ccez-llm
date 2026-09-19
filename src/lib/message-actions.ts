/**
 * Pure message-hotkey effects for the page-level keydown handler.
 *
 * Target lookups, pin storage, and every state mutation stay in
 * +page.svelte: only the toggle math and the ownership gates move
 * here, so each trigger rule is unit-tested without a component.
 * Bodies chain `if` on the results — never a switch — so a body
 * whose target is gone keeps falling through like the handler did.
 */
import type { LocalAid } from "./reading";

/**
 * Toggle-all math for the A hotkey: when every offered kind is already
 * pinned, lift them all; otherwise pin every kind that isn't. Empty
 * offers toggle nothing (the body owns the non-empty check that keeps
 * unoffered hovers falling through).
 */
export function toggleAidKinds(
	offered: LocalAid[],
	pinned: LocalAid[]
): { pin: LocalAid[]; unpin: LocalAid[] } {
	if (offered.length > 0 && offered.every((kind) => pinned.includes(kind))) {
		return { pin: [], unpin: [...offered] };
	}
	return { pin: offered.filter((kind) => !pinned.includes(kind)), unpin: [] };
}

/**
 * Single-aid toggle for the M/N hotkeys: null when the center message
 * doesn't offer the wanted kind (stays off, exactly like A on an
 * unoffered hover), otherwise the direction of the toggle.
 */
export function toggleSingleAid(
	offered: LocalAid[],
	pinned: LocalAid[],
	want: LocalAid
): "pin" | "unpin" | null {
	if (!offered.includes(want)) return null;
	return pinned.includes(want) ? "unpin" : "pin";
}

/**
 * The E hotkey pulls own messages into the composer — same ownership
 * rule as F fold, own messages only. Structural rows (only `role`
 * matters), so tests never build full messages.
 */
export function canEditMessage(
	messages: { role: string }[],
	hoveredIdx: number
): boolean {
	return messages[hoveredIdx]?.role === "user";
}
