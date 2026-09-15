/**
 * Shared-in text (Android OS selection menu) joining the composer
 * draft: blank-line separated, never glued onto a partial line, and
 * trailing whitespace on the old draft never leaves a gap.
 */
export function joinExternalDraft(draft: string, text: string): string {
	const clean = draft.replace(/\s+$/, "");
	if (!clean) return text;
	return `${clean}\n\n${text}`;
}

/** Native menu entry that arrived with the share (null behaves as annotate). */
export type ExternalTextAction = "annotate" | "speak" | "inspect";

/** Normalize the tapped entry: unknown values fall back to annotate. */
export function cleanExternalAction(action: unknown): ExternalTextAction {
	return action === "speak" || action === "inspect" ? action : "annotate";
}

/**
 * Route a native-menu arrival: text that matches nothing live is a
 * foreign share (composer prefill); matching or absent text runs the
 * tapped action on the live web selection.
 */
export function routeExternalText(
	action: unknown,
	text: string | null,
	liveSelection: string
): "prefill" | ExternalTextAction {
	const act = cleanExternalAction(action);
	if (text && text !== liveSelection.trim()) return "prefill";
	return act;
}
