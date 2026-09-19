/**
 * Submit/send decision functions (send-controller slice, REFACTOR §6).
 *
 * `onSubmit` / `doSend` / `editMessage` / `commitMessageEdit` mix
 * guards (pill ownership, send gates, edit state) with effects
 * (staging, streaming, editor resets). The guards live here as pure
 * facts-snapshot → action-token functions, exactly like the
 * `keybindings.ts` slices: verbatim guard order, `if` chains never a
 * switch, effects stay in the component body. Unit-tested in
 * `submit.test.ts` — the guard order is the contract.
 */
import type { SubmitKind } from "./editor";

/** Facts for `onSubmit`: verbatim mirrors of the handler's guards. */
export interface SubmitFacts {
	/** Annotation pill open and not fading: it owns Enter. */
	annPopOpen: boolean;
	/** Composer send gate (the same boolean the send button uses). */
	canSubmit: boolean;
	/** Now is inside the double-Enter window (time half of the guard). */
	sendGuardTripped: boolean;
	kind: SubmitKind;
}

/** `onSubmit` outcome: drop it, stage a message, or send a reply. */
export type SubmitAction = "ignore" | "stage" | "send";

/**
 * Which submit path a key/button press takes. Guard order is the
 * contract: the pill owns Enter while open (a pill already fading
 * out owns nothing, but the time guard below still eats the bare
 * double-Enter that saved it), then the send gate holds the draft
 * while a reply streams, then the double-Enter window — which only
 * ever blocks a bare send, never a stage.
 */
export function submitAction(facts: SubmitFacts): SubmitAction {
	if (facts.annPopOpen) return "ignore";
	if (!facts.canSubmit) return "ignore";
	if (facts.kind === "send" && facts.sendGuardTripped) return "ignore";
	if (facts.kind === "stage") return "stage";
	return "send";
}

/** Facts for `doSend`: the two gates before the preamble. */
export interface SendFacts {
	/** Composer send gate (same boolean the send button uses). */
	canSubmit: boolean;
	/** An in-place message edit is open. */
	editing: boolean;
}

/** `doSend` outcome: drop it, save-and-resend the edit, or send fresh. */
export type SendAction = "ignore" | "commit-edit" | "resolve-provider";

/**
 * How a send starts. The commit branch may still fall through to a
 * fresh send (the edited message can vanish mid-edit) — the body
 * owns that fall-through, this only picks the first step. Provider
 * resolution stays inline (one null check, no logic to pin).
 */
export function sendAction(facts: SendFacts): SendAction {
	if (!facts.canSubmit) return "ignore";
	if (facts.editing) return "commit-edit";
	return "resolve-provider";
}

/** Minimal message shape for the edit-target decisions. */
export interface EditTargetMessage {
	role: string;
	id: unknown;
}

/** `editMessage` outcome for one pencil press. */
export type EditMessageAction =
	"ignore-sending" | "ignore-not-user" | "toggle-off" | "open";

/**
 * What opening an in-place edit does. Guard order is the contract: a
 * streaming reply wins over everything (no-op mid-send), then the
 * target must be a user's message, then pressing the already-open
 * message toggles it shut instead of reopening.
 */
export function editMessageAction(
	messages: ReadonlyArray<EditTargetMessage>,
	index: number,
	facts: { sending: boolean; editingId: unknown }
): EditMessageAction {
	if (facts.sending) return "ignore-sending";
	const msg = messages[index];
	if (!msg || msg.role !== "user") return "ignore-not-user";
	if (
		facts.editingId !== null &&
		facts.editingId !== undefined &&
		msg.id === facts.editingId
	)
		return "toggle-off";
	return "open";
}

/**
 * Index of the message an in-place edit commits to, or null when the
 * edited message vanished (or was never a user's message): the caller
 * resets and falls through to a fresh send. Null editing id counts as
 * vanished — the body only calls this mid-edit, so a real id is
 * always present on the true path.
 */
export function commitEditTarget(
	messages: ReadonlyArray<EditTargetMessage>,
	editingId: unknown
): number | null {
	if (editingId === null || editingId === undefined) return null;
	const index = messages.findIndex((m) => m.id === editingId);
	if (index === -1) return null;
	const target = messages[index];
	if (!target || target.role !== "user") return null;
	return index;
}
