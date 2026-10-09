/**
 * Selection-menu and readings-panel geometry: word-edge snapping,
 * menu/panel placement, and touch-drag decisions. Pure numbers in,
 * coordinates out. Split out of annotations.ts (section C).
 */
import { touchPastSlop } from "./platform";

const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;
const COMBINING_RE = /\p{M}/u;
const SURROGATE_RE = /[\uD800-\uDFFF]/u;
const PUNCT_RE = /\p{P}/u;
const SPACE_RE = /\s/;
/**
 * Spaceless scripts have no words to pick: every character is a
 * letter (Lo), so snapping would glue whole sentences together.
 * The native pick already stands for these (see the Japanese
 * double-click specs) and stays untouched.
 */
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function isWordChar(ch: string): boolean {
	return WORD_CHAR_RE.test(ch) && !SPACELESS_RE.test(ch);
}

/**
 * Split-safe offset into `nodeText`: a node split must never leave a
 * combining mark or a low surrogate first on the right side, so
 * advance past them. The slice a gap was picked on can end before its
 * node does (wash marks expand to the cluster end), and splitting
 * there would strand the mark. Anchors land on the true cluster edge,
 * still quote-adjacent. Pure and unit-tested via stamping.
 */
export function splitSafeOffset(nodeText: string, offset: number): number {
	let o = Math.min(Math.max(0, offset), nodeText.length);
	while (o < nodeText.length) {
		const ch = nodeText[o] ?? "";
		if (!COMBINING_RE.test(ch) && !/[\uDC00-\uDFFF]/u.test(ch)) break;
		o += 1;
	}
	return o;
}

/**
 * Offset (0..text.length) of the word gap nearest the middle of `text`:
 * a position touching a word character where words split (an edge or a
 * word/non-word transition), never beside a combining mark or a
 * surrogate half. Ties prefer the later gap, so a lone word parks
 * after itself with its tail pointing back at it. Null when no gap
 * qualifies (spaceless scripts, empty input). Pure and unit-tested.
 */
export function gapOffsetForAnchor(text: string): number | null {
	const len = text.length;
	if (len === 0) return null;
	const mid = len / 2;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let k = 0; k <= len; k++) {
		const left = k > 0 ? (text[k - 1] ?? "") : "";
		const right = k < len ? (text[k] ?? "") : "";
		const touchesWord =
			(k > 0 && isWordChar(left)) || (k < len && isWordChar(right));
		const splitsWords =
			k === 0 || k === len || !isWordChar(left) || !isWordChar(right);
		if (!touchesWord || !splitsWords) continue;
		if (COMBINING_RE.test(left) || COMBINING_RE.test(right)) continue;
		if (SURROGATE_RE.test(left) || SURROGATE_RE.test(right)) continue;
		const dist = Math.abs(k - mid);
		if (dist < bestDist || (dist === bestDist && (best === null || k > best))) {
			best = k;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Fallback gap for spaceless scripts (CJK): word gaps don't exist,
 * but a letter-wrap paints one fragment short (the seam), so the
 * anchor still holds no text. Punctuation-adjacent boundaries nearest
 * the middle win (a fence beside 。、never splits a pick); otherwise
 * the quote's own end edge, so lone quotes park after themselves like
 * spaced words do. Combining marks and surrogate halves never border
 * the gap. Null when nothing qualifies. Pure and unit-tested.
 */
export function edgeOffsetForAnchor(text: string): number | null {
	const len = text.length;
	if (len === 0) return null;
	const mid = len / 2;
	let best: number | null = null;
	let bestDist = Infinity;
	for (let k = 0; k <= len; k++) {
		const left = k > 0 ? (text[k - 1] ?? "") : "";
		const right = k < len ? (text[k] ?? "") : "";
		const touchesContent =
			(k > 0 && !SPACE_RE.test(left)) || (k < len && !SPACE_RE.test(right));
		if (!touchesContent) continue;
		const punct = PUNCT_RE.test(left) || PUNCT_RE.test(right);
		if (k !== 0 && k !== len && !punct) continue;
		if (COMBINING_RE.test(left) || COMBINING_RE.test(right)) continue;
		if (SURROGATE_RE.test(left) || SURROGATE_RE.test(right)) continue;
		const dist = Math.abs(k - mid);
		if (dist < bestDist || (dist === bestDist && (best === null || k > best))) {
			best = k;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Snap a [start, end) range to word edges so the create-annotation
 * marker never splits a word in half: a boundary cut inside a word
 * expands outward to that word's edge, while a boundary already on
 * an edge (or beside non-word text) stays put. Spaceless scripts
 * (CJK) have no word characters, so they never snap. Out-of-range
 * inputs clamp; reversed inputs normalize.
 */
export function snapOffsetsToWordEdges(
	text: string,
	start: number,
	end: number
): { start: number; end: number } {
	const len = text.length;
	let s = Math.max(0, Math.min(start, len));
	let e = Math.max(0, Math.min(end, len));
	if (s > e) [s, e] = [e, s];
	if (s < e) {
		while (s > 0 && isWordChar(text[s - 1] ?? "") && isWordChar(text[s] ?? ""))
			s -= 1;
		while (
			e < len &&
			isWordChar(text[e - 1] ?? "") &&
			isWordChar(text[e] ?? "")
		)
			e += 1;
	}
	return { start: s, end: e };
}

/**
 * True when a press grew the live selection out of its press-time
 * snapshot: a right-press micro-drag extends the old highlight
 * instead of replacing it, so the click point sits inside a range
 * the user never picked. Steady presses (same text) and fresh
 * engine picks (a replacement, never containing the old text) both
 * read false — only growth repoints. Pure.
 */
export function pressExpandedSelection(prior: string, live: string): boolean {
	return prior !== "" && live !== prior && live.includes(prior);
}

/**
 * Horizontal placement for the create-annotation textbox: centered
 * over the highlight when the highlight is narrower than the box,
 * otherwise the current end-of-selection (cursor) placement. Either
 * way clamped on screen. The Annotate button itself is unaffected —
 * it stays at the cursor end.
 */
export function placeAnnPopX(opts: {
	cursorX: number;
	highlightLeft: number;
	highlightWidth: number;
	popWidth: number;
	viewportWidth: number;
}): number {
	const { cursorX, highlightLeft, highlightWidth, popWidth, viewportWidth } =
		opts;
	const lo = 8;
	const hi = Math.max(lo, viewportWidth - popWidth - 8);
	if (highlightWidth < popWidth) {
		return Math.min(
			Math.max(lo, highlightLeft + (highlightWidth - popWidth) / 2),
			hi
		);
	}
	return Math.min(Math.max(lo, cursorX), hi);
}

/**
 * Selection-menu popup placement (pure): the menu docks near the
 * cursor that finished the gesture, not the selection's start — a
 * full-sentence pick shouldn't strand it lines above the pointer —
 * clamped to the viewport. The right clamp uses the caller's menu
 * width estimate (one button vs Annotate+Inspect), never a
 * one-size box: a wide phantom shoves the menu far left of picks
 * near the right edge. Phones take the above slot too (the native
 * callout is suppressed; readings dock below instead) — iOS keeps
 * it because its bubble owns below. placeSelMenu uses it at summon
 * time; the scroll tracker re-runs it cursorless so the menu
 * follows its highlight instead of dying on scroll.
 */
export function selMenuPlacement(opts: {
	cursorX: number | undefined;
	cursorY: number | undefined;
	rectLeft: number;
	rectTop: number;
	rectBottom: number;
	/** Selection width (px): phones center the menu over the text. */
	rectWidth: number;
	viewportWidth: number;
	viewportHeight: number;
	androidUI: boolean;
	iosUI: boolean;
	/** Estimated menu width (px) for the centering/clamp. */
	menuWidth: number;
	/** Message text scale: the menu tracks it, so clearance scales too. */
	fontScale: number;
}): { x: number; y: number } {
	const {
		cursorX,
		cursorY,
		rectLeft,
		rectTop,
		rectBottom,
		rectWidth,
		viewportWidth,
		viewportHeight,
		androidUI,
		iosUI,
		menuWidth,
		fontScale
	} = opts;
	// Phones center the menu over the selected text (a 2-button row
	// left-anchored like desktop reads off-center); desktop keeps the
	// cursor-anchored left edge. Either way clamped to the viewport.
	const at = cursorX ?? rectLeft;
	const phoneX = rectLeft + rectWidth / 2 - menuWidth / 2;
	const x = Math.min(
		Math.max(8, androidUI && !iosUI ? phoneX : at - 16),
		Math.max(8, viewportWidth - menuWidth - 8)
	);
	// Android: the OS text toolbar is suppressed (the app menu
	// replaces it), so ours takes the above slot like desktop —
	// clear of the highlight — except near the screen top, where
	// below wins. iOS docks its bubble below the selection, so
	// ours takes the above slot like desktop — one popup on each
	// side, never stacked.
	let y: number;
	if (androidUI && !iosUI) {
		// Above the highlight; only a cramped top edge drops it
		// below, still clear of the handles, and clamped on screen.
		y = rectTop - 47;
		if (y < 8) y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, viewportHeight - 52);
	} else if (iosUI) {
		// Above slot (Apple's bubble owns below); only a cramped
		// top edge drops it below, still clear of the handles and
		// the native bubble, and clamped on screen.
		y = rectTop - 47;
		if (y < 8) y = rectBottom + 30;
		if (y + 44 > viewportHeight) y = Math.max(8, viewportHeight - 52);
	} else {
		// Desktop: always above the cursor that finished the
		// gesture (never below it), riding clear of it by its own
		// scaled height plus a breath — a fixed 48px strands the
		// menu over the cursor once the button tracks huge type,
		// eating double/triple clicks. Clamped to the viewport top.
		const menuH = Math.round(24 + 16 * Math.max(1, fontScale));
		const cy = cursorY ?? rectTop;
		y = Math.max(8, cy - 8 - menuH);
	}
	return { x, y };
}

/** Minimal rect shape for reading-panel anchoring (DOMRect compatible). */
export interface AnchorRect {
	left: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

/**
 * Anchor for one highlight span's readings panel: the span's first
 * line fragment, never the whole union box. A group wrapping across
 * lines reports a union rect whose center sits mid-column — every
 * wrapped group would anchor the same middle and stack. The first
 * fragment starts at the group's own kanji on every layout.
 */
export function firstContentRect<T extends AnchorRect>(
	rects: readonly T[]
): T | null {
	for (const rect of rects) {
		if (rect.width > 0 && rect.height > 0) return rect;
	}
	return null;
}

/**
 * Readings-panel placement (pure): the panel centers on its
 * highlight span via CSS translateX, so the style left IS the
 * span's center — never the span's left edge, which would park
 * the panel half its width too far left. The center clamps only
 * to the viewport edges (never a fixed-pixel reserve): on a
 * narrow phone a wide reserve collapses every group's center to
 * one x and the panels stack exactly. A later width pass nudges
 * wide panels back inside; placement keeps them spread on their
 * own groups first.
 *
 * Above with headroom, else below (a tall highlight under the
 * keyboard can leave no room under it): the readings hang over
 * the highlight's top edge, and on phones the selection menu
 * rises above them instead of owning the above slot.
 */
export function readingPanelPlacement(opts: {
	rect: AnchorRect;
	viewportWidth: number;
	viewportHeight: number;
}): { x: number; y: number; above: boolean } {
	const { rect, viewportWidth, viewportHeight } = opts;
	const cx = rect.left + rect.width / 2;
	const x = Math.min(Math.max(8, cx), Math.max(8, viewportWidth - 8));
	const headroom = rect.top >= 128;
	const footroom = rect.bottom + 44 <= viewportHeight;
	const above = headroom || !footroom;
	if (above) return { x, y: Math.max(8, rect.top), above: true };
	return { x, y: Math.min(rect.bottom, viewportHeight - 40), above: false };
}

/**
 * Menu top that clears a readings panel above the highlight: the
 * panel's visual top minus the menu height and a hair, never past
 * the screen edge. Pure — callers measure both rects.
 */
export function menuYAbovePanel(
	panelTop: number,
	menuHeight: number,
	gap = 4,
	minY = 8
): number {
	// A 4px hairline: the menu sits as close under the panel as it
	// can without ever touching it (menu bottom lands exactly
	// gap above the panel top).
	return Math.max(minY, Math.round(panelTop - menuHeight - gap));
}

/**
 * Width-pass center clamp for readings panels: the panel centers on
 * its highlight (CSS translateX), so the center keeps an 8px margin
 * on both sides. The upper bound never drops below the lower one —
 * on a very narrow phone a wide panel parks at the lower bound
 * instead of inverting to a negative x. Pure — callers measure the
 * true width a frame after placement.
 */
export function clampPanelCenterX(
	x: number,
	panelWidth: number,
	viewportWidth: number,
	margin = 8
): number {
	const lo = panelWidth / 2 + margin;
	return Math.min(
		Math.max(lo, x),
		Math.max(lo, viewportWidth - panelWidth - margin)
	);
}

/**
 * Settle check for the width pass: a sub-pixel-corrected center
 * within a pixel of the placed one needs no state write (and no
 * re-render). Pure.
 */
export function panelCenterMoved(
	x: number,
	placedX: number,
	tolerance = 1
): boolean {
	return Math.abs(x - placedX) > tolerance;
}

/**
 * Steadiness check before the width pass: the live highlight must
 * still sit where placement measured it (scrolls and selection
 * edits move it), else the corrected center belongs to a stale
 * rect. Pure.
 */
export function highlightSteady(
	now: { left: number; top: number },
	placed: { left: number; top: number },
	tolerance = 2
): boolean {
	return (
		Math.abs(now.left - placed.left) <= tolerance &&
		Math.abs(now.top - placed.top) <= tolerance
	);
}

/**
 * Start offset of the visual line holding `offset`: the index just
 * past the nearest preceding newline (0 when none). Lines come from
 * text alone so the rule unit-tests without layout.
 */
export function lineStartOffset(text: string, offset: number): number {
	const at = Math.max(0, Math.min(offset, text.length));
	return text.lastIndexOf("\n", at - 1) + 1;
}

/**
 * Clamp an off-chat drag's anchor end to the focus (cursor) line:
 * a selection whose anchor sits above the cursor's current line
 * pins back to that line's start, so drags starting off-chat (or
 * running off-screen) never highlight above it. Anchors at or below
 * the line pass through untouched.
 */
export function clampDragAnchorToFocusLine(
	text: string,
	anchorOffset: number,
	focusOffset: number
): number {
	const lineStart = lineStartOffset(text, focusOffset);
	return anchorOffset < lineStart ? lineStart : anchorOffset;
}

/**
 * Clamp a dragged menu spot on screen: the finger's
 * own stroke stays 1:1, pinned inside the viewport by a margin.
 */
export function clampMenuDrag(
	x: number,
	y: number,
	viewportWidth: number,
	viewportHeight: number,
	margin = 8
): { x: number; y: number } {
	return {
		x: Math.min(Math.max(margin, x), viewportWidth - margin),
		y: Math.min(Math.max(margin, y), viewportHeight - margin)
	};
}

/** A touch point in client pixels. */
export interface MenuTouchPoint {
	x: number;
	y: number;
}

/** `menuBtnTouch` outcome: eat the tap, or run the button action. */
export type MenuBtnTouchAction = "suppress-drag" | "ignore" | "run";

/**
 * What a selection-menu touchend does. Order is the contract: a drag
 * that just ended eats the synthesized tap (750ms drift guard), then
 * a missing endpoint or a finger that drifted past the 14px tap slop
 * (handle nudge, not a tap) drops silently — only a settled tap runs.
 */
export function menuBtnTouchAction(facts: {
	now: number;
	suppressAt: number;
	start: MenuTouchPoint | null;
	end: MenuTouchPoint | null;
}): MenuBtnTouchAction {
	if (facts.now - facts.suppressAt < 750) return "suppress-drag";
	if (!facts.start || !facts.end) return "ignore";
	if (touchPastSlop(facts.start.x, facts.start.y, facts.end.x, facts.end.y, 14))
		return "ignore";
	return "run";
}

/**
 * Where a selection-menu drag moves the menu, or null while the
 * finger stays inside the 12px tap slop (no move yet). The caller
 * owns the suppress stamp and the assignment; this only resolves
 * the clamped target from the drag anchor plus the finger delta.
 */
export function selMenuDragTarget(
	drag: { mx: number; my: number; x0: number; y0: number },
	at: MenuTouchPoint,
	viewportWidth: number,
	viewportHeight: number
): { x: number; y: number } | null {
	if (!touchPastSlop(drag.mx, drag.my, at.x, at.y, 12)) return null;
	return clampMenuDrag(
		drag.x0 + (at.x - drag.mx),
		drag.y0 + (at.y - drag.my),
		viewportWidth,
		viewportHeight
	);
}
