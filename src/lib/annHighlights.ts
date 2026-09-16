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
 * Highlight name for sent-annotation jump flashes. Separate from the
 * badge wash so a jump never clobbers a hover wash (or the reverse) —
 * both paint at once on different ranges.
 */
export const JUMP_HIGHLIGHT_NAME = "ccez-ann-jump";

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
 * Paint wash ranges via CSS.highlights. No-op (returns false) where
 * unsupported — the caller keeps the mark-DOM path. Never throws.
 */
export function paintAnnotationWash(ranges: Range[]): boolean {
	try {
		const reg = registry();
		if (!reg || ranges.length === 0) return false;
		const Ctor = Highlight;
		if (typeof Ctor !== "function") return false;
		reg.set(ANN_HIGHLIGHT_NAME, new Ctor(...ranges));
		return true;
	} catch {
		return false;
	}
}

/** Clear a previously painted annotation wash. Never throws. */
export function clearAnnotationWash(): void {
	try {
		registry()?.delete(ANN_HIGHLIGHT_NAME);
	} catch {
		// Clearing is cosmetic: never break the stamp.
	}
}

/**
 * Paint a sent-jump flash range. No-op (returns false) where
 * unsupported — the caller still scrolls, just without the flash.
 * Never throws.
 */
export function paintJumpWash(range: Range): boolean {
	try {
		const reg = registry();
		if (!reg) return false;
		const Ctor = Highlight;
		if (typeof Ctor !== "function") return false;
		reg.set(JUMP_HIGHLIGHT_NAME, new Ctor(range));
		return true;
	} catch {
		return false;
	}
}

/** Clear a jump flash. Never throws. */
export function clearJumpWash(): void {
	try {
		registry()?.delete(JUMP_HIGHLIGHT_NAME);
	} catch {
		// Clearing is cosmetic: never break the jump.
	}
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
