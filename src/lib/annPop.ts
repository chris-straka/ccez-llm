/**
 * Annotation-pill save/cancel decisions for +page.svelte.
 *
 * The fade timer, pin storage, focus effects, and every state mutation
 * stay in the component: only the submit/cancel matrix moves here, so
 * the pending-vs-fresh-vs-existing branches are unit-tested instead of
 * re-verified by ear. Bodies keep their liveness guards
 * (`!annPop || annPopClosing`) and fall through unchanged.
 */
import { placeAnnPopX } from "$lib/annotations";

export type AnnPopSaveKind = "commit-pending" | "save-edit";

/**
 * Submit writes a pending annotation or edits the saved comment of an
 * existing one. The pop id decides: a pop still addressing its pending
 * annotation commits it.
 */
export function annPopSaveKind(
	popId: string,
	pendingId: string | null
): AnnPopSaveKind {
	return pendingId !== null && popId === pendingId
		? "commit-pending"
		: "save-edit";
}

export type AnnPopCancelKind =
	"drop-pending" | "delete-fresh" | "keep-existing";

/**
 * Cancel means "as it was", checked in handler order: a never-submitted
 * pending annotation never existed (drop it); a fresh one goes no matter
 * what was typed; an existing one keeps its saved comment (nothing is
 * written until Save).
 */
export function annPopCancelKind(
	popId: string,
	fresh: boolean,
	pendingId: string | null
): AnnPopCancelKind {
	if (pendingId !== null && popId === pendingId) return "drop-pending";
	if (fresh) return "delete-fresh";
	return "keep-existing";
}

/**
 * Clicking off the pill: an empty draft cancels (no ghost empty
 * annotations), a typed draft still saves — typed comments are never
 * silently dropped. Enter with no text is the way to file an empty one.
 */
export function annPopBlurAction(draft: string): "cancel" | "save" {
	return draft.trim() === "" ? "cancel" : "save";
}

/**
 * Wash ownership for the open pill: the wash releases the moment the
 * pill starts closing (save or cancel), not 160ms later when it
 * unmounts — the fade then starts at the click, so filing never holds
 * a full-bright wash through the pill fade before clearing it.
 */
export function pillWashId(
	pop: { id: string } | null,
	closing: boolean
): string | null {
	return pop && !closing ? pop.id : null;
}

/**
 * Popover width in px (16px root): the card scales with font size up
 * to 32rem (see .ann-pop); the fresh pill stays 19rem. The viewport
 * clamp keeps narrow phones inside the screen.
 */
export function annPopWidth(facts: {
	fresh: boolean;
	android: boolean;
	fontScale: number;
	viewportWidth: number;
}): number {
	const scale = facts.android ? Math.min(8, facts.fontScale) : facts.fontScale;
	// The creation pill scales with the text size like the card does
	// (19rem base, same 32rem cap): mirrors the fresh width in CSS.
	if (facts.fresh)
		return Math.min(Math.min(19 * scale, 32) * 16, facts.viewportWidth - 16);
	return Math.min(Math.min(24 * scale, 32) * 16, facts.viewportWidth - 16);
}

/**
 * Edit-card placement from a badge anchor: centered over the anchor,
 * clamped inside the viewport; drops above the anchor when the 240px
 * card would run past the bottom edge. Narrow viewports clamp first
 * or x goes negative and the popover runs off-screen.
 */
export function placeAnnCard(facts: {
	anchorX: number;
	anchorY: number;
	width: number;
	viewportWidth: number;
	viewportHeight: number;
}): { x: number; y: number } {
	const x = Math.min(
		Math.max(8, facts.anchorX - facts.width / 2),
		facts.viewportWidth - facts.width - 8
	);
	const height = 240;
	let y = facts.anchorY + 8;
	if (y + height > facts.viewportHeight - 8)
		y = Math.max(8, facts.anchorY - height - 8);
	return { x, y };
}

/**
 * Compose-box placement from the selection-menu anchor: phones pin
 * high and centered (the keyboard eats the lower screen, so the box
 * is never covered wherever the quote sits); desktop centers narrow
 * highlights over themselves and keeps the end-of-selection
 * placement for wide ones, a breath below the menu anchor and
 * clamped inside the viewport.
 */
export function placeAnnComposer(facts: {
	android: boolean;
	viewportWidth: number;
	viewportHeight: number;
	width: number;
	menuX: number;
	menuY: number;
	highlightLeft: number;
	highlightWidth: number;
}): { x: number; y: number } {
	if (facts.android) {
		return {
			x: Math.max(8, (facts.viewportWidth - facts.width) / 2),
			y: Math.max(8, facts.viewportHeight * 0.12)
		};
	}
	return {
		x: placeAnnPopX({
			cursorX: facts.menuX,
			highlightLeft: facts.highlightLeft,
			highlightWidth: facts.highlightWidth,
			popWidth: facts.width,
			viewportWidth: facts.viewportWidth
		}),
		y: Math.min(Math.max(8, facts.menuY + 2), facts.viewportHeight - 72)
	};
}
