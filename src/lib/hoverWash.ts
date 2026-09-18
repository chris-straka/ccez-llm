/**
 * Shared badge-hover wash ownership across message bodies. The wash id
 * feeds every body but lives once in the parent, so the hysteresis
 * must also live once: a per-body null timer lets a gapped slide
 * (badge, plain text, badge across two messages) clobber the fresh
 * wash — the first body's delayed null fires after the second body
 * painted. One pending null for all bodies: any badge-over cancels
 * it, and genuine leaves still clear faster than perception.
 */

export const HOVER_WASH_CLEAR_MS = 120;

let reported: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function disarm(): void {
	if (timer !== null) clearTimeout(timer);
	timer = null;
}

/**
 * Route one hover event. Non-null ids report at once (badge-to-badge
 * slides never lag); nulls wait out the tremor unless a clear is
 * already pending or nothing is showing. `toBadge` marks a
 * mouseout landing on another badge — the new over owns the wash.
 */
export function badgeHover(
	report: (id: string | null) => void,
	id: string | null,
	opts: { toBadge?: boolean } = {}
): void {
	if (id !== null) {
		disarm();
		if (reported !== id) {
			reported = id;
			report(id);
		}
		return;
	}
	if (opts.toBadge) return;
	if (timer !== null) return;
	if (reported === null) return;
	timer = setTimeout(() => {
		timer = null;
		reported = null;
		report(null);
	}, HOVER_WASH_CLEAR_MS);
}

/** Drop a pending clear (component teardown keeps no stale null). */
export function disarmHoverClear(): void {
	disarm();
}

/** Reset shared hover state. Tests only — production flows always
enter through badgeHover, which owns the transitions. */
export function resetHoverWashForTest(): void {
	reported = null;
	disarm();
}
