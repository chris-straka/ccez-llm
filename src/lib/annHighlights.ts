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
 * Graded dimmer names for the wash fade ramp: the Highlight pseudo
 * can't transition (probed: transitions and keyframes on
 * ::highlight() are ignored in Chromium and WebKit), so the fade
 * steps live → dim → faint → clear ~50ms apart instead. Same ranges,
 * zero DOM churn — the eye reads the steps as a fade.
 */
export const ANN_HIGHLIGHT_DIM = "ccez-ann-dim";
export const ANN_HIGHLIGHT_FAINT = "ccez-ann-faint";
/** One ramp step: a graded name to paint, or null to clear. */
export type WashRampStep = string | null;
/**
 * Pure fade schedule both directions. In runs faint → live (~100ms:
 * fast enough to feel responsive); out runs dim → faint → clear
 * (~150ms on top of the hover hysteresis). The walker lives in
 * annotations.ts next to the registry ownership.
 */
export function washRampSchedule(ramp: "in" | "out"): WashRampStep[] {
	return ramp === "in"
		? [ANN_HIGHLIGHT_FAINT, ANN_HIGHLIGHT_NAME]
		: [ANN_HIGHLIGHT_DIM, ANN_HIGHLIGHT_FAINT, null];
}

export interface HighlightRegistry {
	set(name: string, highlight: object): void;
	delete(name: string): void;
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
	clearAnnotationWash(ANN_HIGHLIGHT_DIM);
	clearAnnotationWash(ANN_HIGHLIGHT_FAINT);
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
