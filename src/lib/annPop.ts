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
 * Popover width in px (16px root): every orange popup — card and
 * creation pill alike — runs 90% of the chat column (see .ann-pop),
 * so wide columns earn wide popups instead of a fixed 32rem cap.
 * The column already widens with huge type, so no separate font
 * term: the viewport clamp keeps narrow phones inside the screen.
 */
export function annPopWidth(facts: {
	chatWidthRem: number;
	viewportWidth: number;
}): number {
	return Math.min(facts.chatWidthRem * 0.9 * 16, facts.viewportWidth - 16);
}

/**
 * Edit-card placement from a badge anchor: centered over the anchor,
 * clamped inside the viewport; drops above the anchor when the card
 * would run past the bottom edge. The height is measured post-mount,
 * never estimated: a fixed estimate overshoots short cards (daylight
 * above bottom badges) and collapses to the top whenever the keyboard
 * shortens the viewport. Narrow viewports clamp first or x goes
 * negative and the popover runs off-screen.
 */
export function placeAnnCard(facts: {
	anchorX: number;
	anchorY: number;
	width: number;
	viewportWidth: number;
	viewportHeight: number;
	cardHeight: number;
}): { x: number; y: number } {
	const x = Math.min(
		Math.max(8, facts.anchorX - facts.width / 2),
		facts.viewportWidth - facts.width - 8
	);
	const height = Math.max(1, Math.ceil(facts.cardHeight));
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
 * placement for wide ones, hanging below the highlight itself with
 * an em-scaled gap — never covering the word, at any font size —
 * and clamped inside the viewport (above fallback when the bottom
 * edge would clip).
 */
/**
 * Answer-card placement from the quote rect: always below the
 * highlight with the create pill's em-scaled gap and x math —
 * never flipped above, never covering the word. When the bottom
 * edge would clip, the page scrolls the thread to make room
 * instead (the card stays glued to its quote). Pure.
 */
export function placeAnnAnswer(facts: {
	viewportWidth: number;
	menuX: number;
	highlightLeft: number;
	highlightWidth: number;
	highlightBottom: number;
	width: number;
	fontScale: number;
}): { x: number; y: number } {
	const gap = Math.max(2, Math.round(2 + (facts.fontScale - 1) * 12));
	return {
		x: placeAnnPopX({
			cursorX: facts.menuX,
			highlightLeft: facts.highlightLeft,
			highlightWidth: facts.highlightWidth,
			popWidth: facts.width,
			viewportWidth: facts.viewportWidth
		}),
		// Floored: a fractional highlight bottom would leave the
		// card a subpixel past the viewport edge after scrolling.
		y: Math.floor(facts.highlightBottom + gap)
	};
}

export function placeAnnComposer(facts: {
	android: boolean;
	viewportWidth: number;
	viewportHeight: number;
	width: number;
	menuX: number;
	highlightLeft: number;
	highlightWidth: number;
	highlightTop: number;
	highlightBottom: number;
	fontScale: number;
}): { x: number; y: number } {
	if (facts.android) {
		return {
			x: Math.max(8, (facts.viewportWidth - facts.width) / 2),
			y: Math.max(8, facts.viewportHeight * 0.12)
		};
	}
	// A breath at 1x, half a line more per extra scale: the pill
	// clears descenders at any size without drifting away at 1x.
	const gap = Math.max(2, Math.round(2 + (facts.fontScale - 1) * 12));
	// Fresh-pill first line plus chrome: ~22px per scale step.
	const estH = Math.round(22 * Math.max(1, facts.fontScale) + 18);
	const below = facts.highlightBottom + gap;
	const y =
		below + estH <= facts.viewportHeight - 8
			? below
			: Math.max(8, facts.highlightTop - gap - estH);
	return {
		x: placeAnnPopX({
			cursorX: facts.menuX,
			highlightLeft: facts.highlightLeft,
			highlightWidth: facts.highlightWidth,
			popWidth: facts.width,
			viewportWidth: facts.viewportWidth
		}),
		y
	};
}
