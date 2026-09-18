/**
 * Annotation-pill save/cancel decisions for +page.svelte.
 *
 * The fade timer, pin storage, focus effects, and every state mutation
 * stay in the component: only the submit/cancel matrix moves here, so
 * the pending-vs-fresh-vs-existing branches are unit-tested instead of
 * re-verified by ear. Bodies keep their liveness guards
 * (`!annPop || annPopClosing`) and fall through unchanged.
 */

export type AnnPopSaveKind = "commit-pending" | "save-edit";

/**
 * Submit writes a pending annotation or edits the saved comment of an
 * existing one. The pop id decides: a pop still addressing its pending
 * annotation commits it.
 */
export function annPopSaveKind(popId: string, pendingId: string | null): AnnPopSaveKind {
	return pendingId !== null && popId === pendingId ? "commit-pending" : "save-edit";
}

export type AnnPopCancelKind = "drop-pending" | "delete-fresh" | "keep-existing";

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
export function pillWashId(pop: { id: string } | null, closing: boolean): string | null {
	return pop && !closing ? pop.id : null;
}
