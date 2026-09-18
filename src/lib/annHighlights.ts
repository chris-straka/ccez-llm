/**
 * Custom Highlight API (CSS.highlights) for annotation badges.
 *
 * Today badges stamp via mark-DOM wrapping (see applyMarks in
 * annotations.ts), which splits text nodes and forces selection save /
 * restore on every render. Where the browser supports CSS Custom
 * Highlight API, annotation washes can paint as highlight ranges over
 * the untouched DOM instead — no wrapping, no fragmentation.
 *
 * Badge buttons themselves stay DOM (they are interactive); only the
 * yellow wash moves to highlights. Fallback is always the current
 * mark-DOM rendering.
 *
 * NOTE: Highlight/CSS.highlights have no TS lib types, so both are
 * declared in web-apis.d.ts and read here as ordinary globals.
 */

/** Highlight name under which annotation washes are registered. */
export const ANN_HIGHLIGHT_NAME = "ccez-ann";
/**
 * Highlight name for the jump-landing flash (draft-menu and sent-ref
 * jumps). A registry paint moves zero DOM nodes, so the mid-quote
 * badge anchor never shifts and text never reflows — the DOM-mark
 * fallback below exists only where the Highlight API is missing.
 * Separate name from the wash grades: the flash must clear without
 * touching a live hover wash, and vice versa.
 */
export const ANN_FLASH_NAME = "ccez-ann-flash";
/**
 * Graded dimmer names for the wash fade ramp: the Highlight pseudo
 * can't transition (probed: transitions and keyframes on
 * ::highlight() are ignored in Chromium and WebKit), so the fade
 * walks down shared grades ~35ms apart instead. Same ranges, zero
 * DOM churn — at four steps the eye reads it as a fade, not a blink.
 */
export const ANN_HIGHLIGHT_D1 = "ccez-ann-d1";
export const ANN_HIGHLIGHT_D2 = "ccez-ann-d2";
export const ANN_HIGHLIGHT_D3 = "ccez-ann-d3";
/** One ramp step: a graded name to paint, or null to clear. */
export type WashRampStep = string | null;
/**
 * Pure fade schedule both directions. In runs D3 → D1 → live
 * (~100ms: fast enough to feel responsive); out runs D1 → D2 → D3
 * → clear (~140ms on top of the hover hysteresis). The walker lives
 * in annotations.ts next to the registry ownership.
 */
export function washRampSchedule(ramp: "in" | "out"): WashRampStep[] {
	return ramp === "in"
		? [ANN_HIGHLIGHT_D3, ANN_HIGHLIGHT_D1, ANN_HIGHLIGHT_NAME]
		: [ANN_HIGHLIGHT_D1, ANN_HIGHLIGHT_D2, ANN_HIGHLIGHT_D3, null];
}

export interface HighlightRegistry {
	set(name: string, highlight: object): void;
	delete(name: string): void;
	get(name: string): Highlight | undefined;
}

/** True when CSS.highlights with Highlight construction exists. */
export function highlightsSupported(): boolean {
	try {
		if (typeof CSS === "undefined" || !("highlights" in CSS)) return false;
		return typeof Highlight === "function";
	} catch {
		return false;
	}
}

function registry(): HighlightRegistry | null {
	try {
		if (!highlightsSupported()) return null;
		return CSS.highlights ?? null;
	} catch {
		return null;
	}
}

/**
 * Paint wash ranges via CSS.highlights under one graded name
 * (default live). No-op (returns false) where unsupported — the
 * caller keeps the mark-DOM path. Never throws.
 */
export function paintAnnotationWash(ranges: Range[], name: string = ANN_HIGHLIGHT_NAME): boolean {
	try {
		const reg = registry();
		if (!reg || ranges.length === 0) return false;
		const Ctor = Highlight;
		if (typeof Ctor !== "function") return false;
		reg.set(name, new Ctor(...ranges));
		return true;
	} catch {
		return false;
	}
}

/** Clear one graded wash name (default live). Never throws. */
export function clearAnnotationWash(name: string = ANN_HIGHLIGHT_NAME): void {
	try {
		registry()?.delete(name);
	} catch {
		// Clearing is cosmetic: never break the stamp.
	}
}

/** Clear every graded wash name (a fresh paint supersedes a mid-ramp fade). Never throws. */
export function clearAnnotationWashes(): void {
	clearAnnotationWash(ANN_HIGHLIGHT_NAME);
	clearAnnotationWash(ANN_HIGHLIGHT_D1);
	clearAnnotationWash(ANN_HIGHLIGHT_D2);
	clearAnnotationWash(ANN_HIGHLIGHT_D3);
}

/** Ranges currently registered under the live name (empty where unsupported). Never throws. */
export function liveWashRanges(): AbstractRange[] {
	try {
		const reg = registry();
		if (!reg) return [];
		return [...(reg.get(ANN_HIGHLIGHT_NAME) ?? [])];
	} catch {
		return [];
	}
}

/**
 * True when two single-range paints cover the same endpoints: a
 * re-stamp over replaced DOM (streaming tokens) relocates the quote,
 * while a same-content re-stamp does not. Pure — unit-tested.
 */
export function sameWashRanges(a: AbstractRange[], b: AbstractRange[]): boolean {
	if (a.length !== 1 || b.length !== 1) return a.length === b.length;
	const x = a[0]!;
	const y = b[0]!;
	return (
		x.startContainer === y.startContainer &&
		x.startOffset === y.startOffset &&
		x.endContainer === y.endContainer &&
		x.endOffset === y.endOffset
	);
}

/**
 * Collect DOM ranges for the current live selection clipped to a root,
 * for painting as a highlight instead of mark-wrapping. Empty array
 * when there is no non-collapsed selection fully inside the root.
 * Never throws.
 */
export function selectionRanges(root: Node): Range[] {
	try {
		const sel = document.getSelection();
		if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
		const anchor = sel.anchorNode;
		const focus = sel.focusNode;
		if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return [];
		const out: Range[] = [];
		for (let i = 0; i < sel.rangeCount; i++) {
			const range = sel.getRangeAt(i);
			if (!root.contains(range.commonAncestorContainer)) continue;
			out.push(range);
		}
		return out;
	} catch {
		return [];
	}
}
