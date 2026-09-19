/**
 * Unified notice queue (REFACTOR §7).
 *
 * Five one-off error states each owned a flag plus (sometimes) a
 * timer: `attachError`, `vocalizeError`, `voiceError` +
 * `voiceErrorTimer`, `toast` + `toastTimer` in the page, `modelError`
 * in `ProviderPanel` (bare `setTimeout`s, so two rapid failures let
 * the first timer clear the second message early). They group here
 * as one `NoticeState`: a slot per visual kind, each with a
 * generation. Showing bumps the generation, so a stale timer can
 * never clear a newer notice — the same supersede trick as
 * `ViewportState.holdSeq`, and it deletes the `clearTimeout`
 * bookkeeping entirely. Timer *firing* stays an effect
 * (`flashNotice` owns the `setTimeout`); the supersede decision is
 * pure. Unit-tested in `notices.test.ts`.
 */

/** Visual slot a notice renders in (each renders independently). */
export type NoticeKind = "inline" | "banner" | "voice" | "toast" | "errorToast";

/** Conventional self-clear delays (the page passed these as literals).
 * Plain toasts clear fast (confirmations, not reading material);
 * error toasts hold the long delay so failures can actually be read. */
export const TOAST_TIMEOUT_MS = 2500;
export const ERROR_TOAST_TIMEOUT_MS = 8000;
export const VOICE_TIMEOUT_MS = 8000;
export const MODEL_TIMEOUT_MS = 5000;

export interface NoticeSlot {
	/** Generation: bumped on every show, captured by the clear timer. */
	seq: number;
	message: string | null;
}

export interface NoticeState {
	/** Sticky composer error (`attachError`). */
	inline: NoticeSlot;
	/** Sticky bottom banner (`vocalizeError`, settings `modelError`). */
	banner: NoticeSlot;
	/** Self-clearing top voice notice (`voiceError`). */
	voice: NoticeSlot;
	/** Self-clearing top toast (`toast`). */
	toast: NoticeSlot;
	/** Self-clearing top error toast (red pairing, both themes). */
	errorToast: NoticeSlot;
}

function emptySlot(): NoticeSlot {
	return { seq: 0, message: null };
}

export function emptyNotices(): NoticeState {
	return {
		inline: emptySlot(),
		banner: emptySlot(),
		voice: emptySlot(),
		toast: emptySlot(),
		errorToast: emptySlot()
	};
}

/**
 * Show a notice, superseding whatever the slot held. Returns the
 * generation: a clear timer must pass it back to `expireNotice`, so
 * only the notice that armed the timer can be cleared by it.
 */
export function showNotice(
	state: NoticeState,
	kind: NoticeKind,
	message: string
): number {
	const slot = state[kind];
	slot.seq += 1;
	slot.message = message;
	return slot.seq;
}

/**
 * Clear the slot, but only when `seq` is still current — a stale
 * timer (an older show's) is a no-op. This is the whole timer race:
 * callers never store or clear timer handles.
 */
export function expireNotice(
	state: NoticeState,
	kind: NoticeKind,
	seq: number
): void {
	const slot = state[kind];
	if (slot.seq === seq) slot.message = null;
}

/** Immediate clear: tap-to-dismiss, next-attempt reset. */
export function clearNotice(state: NoticeState, kind: NoticeKind): void {
	state[kind].message = null;
}

/**
 * Show a notice that clears itself after `timeoutMs`. The timer
 * captures the show generation, so re-showing (which bumps it)
 * disarms the older timer without any `clearTimeout`.
 */
export function flashNotice(
	state: NoticeState,
	kind: NoticeKind,
	message: string,
	timeoutMs: number
): void {
	const seq = showNotice(state, kind, message);
	setTimeout(() => expireNotice(state, kind, seq), timeoutMs);
}
