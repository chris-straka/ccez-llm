/**
 * Annotation-pill save/cancel decisions for +page.svelte.
 *
 * The fade timer, pin storage, focus effects, and every state mutation
 * stay in the component: only the submit/cancel matrix moves here, so
 * the pending-vs-fresh-vs-existing branches are unit-tested instead of
 * re-verified by ear. Bodies keep their liveness guards
 * (`!annPop || annPopClosing`) and fall through unchanged.
 */
import { placeAnnPopX } from "$lib/sel-geometry";

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

/** Viewport rect of an annotated quote (a DOMRect's edges). */
export interface AnchorRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface AnswerPlacement {
	x: number;
	y: number;
	side: "below" | "above";
	/** Card height cap (px): the body scrolls past it. */
	maxHeight: number;
	/** Tail center, px from the card's left edge. */
	tailX: number;
}

/**
 * Answer-popover placement from the quote rect and the card's measured
 * size: below the word when the whole card fits there, above when it
 * fits there instead, otherwise on the roomier side with its height
 * capped to that side (the body scrolls). Never covers the word or its
 * badge (`clearTop` is the badge's top) and never needs the page to
 * scroll. Centered on the word (on the pointer inside wide quotes),
 * clamped inside the viewport; the tail points back at that x.
 */
export function placeAnswerPopover(facts: {
	anchor: AnchorRect;
	/** Top edge to keep clear above the quote (its badge). */
	clearTop: number;
	pointX: number;
	cardWidth: number;
	cardHeight: number;
	viewportWidth: number;
	viewportHeight: number;
	/** Word-to-tail-tip breath (px). */
	gap: number;
	/** Tail depth past the card edge (px). */
	tail: number;
	margin?: number;
}): AnswerPlacement {
	const m = facts.margin ?? 8;
	const { anchor, cardWidth: w } = facts;
	const wordWidth = anchor.right - anchor.left;
	const target =
		wordWidth < w
			? anchor.left + wordWidth / 2
			: Math.min(Math.max(facts.pointX, anchor.left), anchor.right);
	const x = Math.max(m, Math.min(target - w / 2, facts.viewportWidth - w - m));
	const tailInset = Math.min(18, w / 2);
	const tailX = Math.min(Math.max(target - x, tailInset), w - tailInset);
	const reach = facts.gap + facts.tail;
	const below = facts.viewportHeight - m - (anchor.bottom + reach);
	const above = Math.min(anchor.top, facts.clearTop) - reach - m;
	const h = Math.max(1, Math.ceil(facts.cardHeight));
	const side: "below" | "above" =
		h <= below || (h > above && below >= above) ? "below" : "above";
	const maxHeight = Math.max(48, Math.floor(side === "below" ? below : above));
	const shown = Math.min(h, maxHeight);
	const y =
		side === "below"
			? Math.floor(anchor.bottom + reach)
			: Math.ceil(Math.min(anchor.top, facts.clearTop) - reach - shown);
	return { x: Math.round(x), y, side, maxHeight, tailX: Math.round(tailX) };
}

/**
 * Popover anchor from a quote's line-box rects (Range.getClientRects):
 * the last line's fragment, where the badge sits and the tail points,
 * with the whole quote (and its badge) kept clear above it, so an
 * above-flip never covers an earlier line of a wrapped quote. Null
 * when the quote renders no boxes.
 */
export function quoteAnchor(
	rects: readonly AnchorRect[],
	badgeTop: number | null
): { anchor: AnchorRect; clearTop: number } | null {
	const boxes = rects.filter(
		(r) => r.right - r.left > 0 && r.bottom - r.top > 0
	);
	const last = boxes.at(-1);
	if (!last) return null;
	const line = boxes.filter(
		(r) => Math.abs(r.bottom - last.bottom) < (last.bottom - last.top) / 2
	);
	const anchor = {
		left: Math.min(...line.map((r) => r.left)),
		top: Math.min(...line.map((r) => r.top)),
		right: Math.max(...line.map((r) => r.right)),
		bottom: Math.max(...line.map((r) => r.bottom))
	};
	const top = Math.min(...boxes.map((r) => r.top));
	return {
		anchor,
		clearTop: badgeTop === null ? top : Math.min(top, badgeTop)
	};
}
