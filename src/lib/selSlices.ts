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

/**
 * Post-paint x correction for the selection menu, or null when the
 * estimate already holds. Phones ride the highlight's middle by
 * measured width; desktop pulls the estimate back on screen. The
 * one-shot page effect applies a non-null result once — a settled
 * value never re-triggers it.
 */
export function correctSelMenuX(
	menu: { x: number; left: number; w: number },
	measuredW: number,
	viewportW: number,
	phone: boolean
): number | null {
	if (phone) {
		const center = menu.left + menu.w / 2;
		const x = Math.min(
			Math.max(8, center - measuredW / 2),
			Math.max(8, viewportW - measuredW - 8)
		);
		return x !== menu.x ? x : null;
	}
	const over = menu.x + measuredW + 8 - viewportW;
	return over > 0 ? Math.max(8, menu.x - over) : null;
}

/**
 * What the selection menu's idle timer does on fire: re-arm while
 * engaged hands hold it (a live phone highlight, or recent desktop
 * input outside a hover), else dismiss. Pure decision behind the
 * page's arming effect.
 */
export function selMenuIdleDecision(facts: {
	android: boolean;
	selectionLive: boolean;
	hover: boolean;
	lastInputAt: number;
	now: number;
	idleMs: number;
}): "rearm" | "dismiss" {
	if (facts.android && facts.selectionLive) return "rearm";
	if (
		!facts.android &&
		!facts.hover &&
		facts.now - facts.lastInputAt < facts.idleMs
	)
		return "rearm";
	return "dismiss";
}
