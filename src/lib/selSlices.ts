import { shouldShowInspect } from "$lib/inspect";

/**
 * Selection-slice helpers (selection-menu slice, REFACTOR §6).
 *
 * The page walks the highlight into per-text-node `SelSlice`s (chrome
 * nodes skipped) and resolves absolute highlight offsets back into
 * (node, offset) points for tinting and panel anchoring. The walk
 * itself is DOM-bound and stays paged; the offset resolution and the
 * menu width estimate are pure and live here. Unit-tested in
 * `selSlices.test.ts`.
 */

/** One text node clamped to the highlight, with its highlight offset base. */
export interface SelSlice {
	node: Text;
	start: number;
	end: number;
	base: number;
}

/**
 * Overlap of one tint span with one text slice, in slice-relative
 * offsets for the splitText surgery — or null when they don't meet.
 * Backwards-order wrapping keeps earlier offsets resolving; this is
 * the per-pair math behind that order.
 */
export function spanSliceOverlap(
	span: { start: number; end: number },
	slice: { base: number; start: number; end: number }
): { relLo: number; relHi: number } | null {
	const lo = Math.max(span.start, slice.base);
	const hi = Math.min(span.end, slice.base + (slice.end - slice.start));
	if (hi <= lo) return null;
	return {
		relLo: slice.start + (lo - slice.base),
		relHi: slice.start + (hi - slice.base)
	};
}

/** (node, offset) for an absolute highlight offset, or null. */
export function slicePoint(
	slices: SelSlice[],
	at: number
): { node: Text; offset: number } | null {
	for (const s of slices) {
		if (at >= s.base && at <= s.base + (s.end - s.start)) {
			return { node: s.node, offset: s.start + (at - s.base) };
		}
	}
	const last = slices[slices.length - 1];
	if (last && at === last.base + (last.end - last.start)) {
		return { node: last.node, offset: last.end };
	}
	return null;
}

/**
 * Width estimate (px) for the selection menu's right-edge clamp: one
 * padded button, two when Inspect joins Annotate, three for the phone
 * menu (Copy, Annotate, Speak). The measured effect on the menu div
 * corrects font/zoom variance.
 */
export function selMenuWidthEstimate(
	quote: string,
	android: boolean,
	inspectEnabled: boolean
): number {
	if (android) return 300;
	return shouldShowInspect(quote, inspectEnabled) ? 220 : 120;
}
