/**
 * Global key-dispatch decisions for the page-level keydown handler.
 *
 * Each predicate answers one question — "what does this keypress mean
 * here?" — from an explicit snapshot of UI facts, returning an action
 * token (or null). Acting on the token (state mutation, focus, toasts)
 * stays in +page.svelte: only the *decisions* move here, so every
 * trigger condition is unit-tested without a DOM or component.
 *
 * Priority lives inside each function and mirrors the handler's branch
 * order: where two bindings share a key (Esc+f vs F fold), the winner
 * is the one the handler used to reach first.
 */

export interface KeyModifiers {
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

/** Bare key: no modifier held. */
function bare(mods: KeyModifiers): boolean {
	return !mods.metaKey && !mods.ctrlKey && !mods.altKey && !mods.shiftKey;
}

/** Facts every hovered-message hotkey guard reads. The three target
 * predicates differ on purpose: most hotkeys yield to plain fields,
 * X also yields to rich editors (it types `x` there), and Shift+D has
 * its own wider selector (buttons and links keep their keys too). */
export interface MessageKeyFacts extends KeyModifiers {
	key: string;
	code: string;
	inEditor: boolean;
	inField: boolean;
	inEditable: boolean;
	inInteractive: boolean;
	inFieldOrFilter: boolean;
	hoveredIdx: number;
	escDownAt: number;
}

export type MessageKeyAction =
	| "toggle-aids"
	| "pin-pinyin"
	| "pin-furigana"
	| "exit-fullscreen"
	| "fold-hovered"
	| "edit-hovered"
	| "cut-hovered"
	| "delete-hovered";

/** Hovered-message hotkey for this keypress, in handler priority
 * order (Esc+f before F fold, single-key before shifted). */
export function messageKeyAction(facts: MessageKeyFacts): MessageKeyAction | null {
	const hovered = !facts.inEditor && facts.hoveredIdx >= 0;
	if (facts.key === "a" && hovered && bare(facts) && !facts.inField) return "toggle-aids";
	// M/N pin on the center message, not the hovered one, so they
	// need no hover — only hands off the editor and fields.
	if (
		(facts.key === "m" || facts.key === "n") &&
		!facts.inEditor &&
		bare(facts) &&
		!facts.inField
	)
		return facts.key === "m" ? "pin-pinyin" : "pin-furigana";
	// Esc+f works from anywhere (no editor/hover requirement): it is
	// the only way out of fullscreen, checked before F fold. The
	// filter carve-out is wider than the field one: typing in the
	// shortcuts filter must not exit fullscreen either.
	if (
		(facts.key === "f" || facts.key === "F") &&
		bare(facts) &&
		facts.escDownAt !== 0 &&
		!facts.inFieldOrFilter
	)
		return "exit-fullscreen";
	if (
		(facts.key === "f" || facts.key === "F") &&
		hovered &&
		bare(facts) &&
		!facts.inField
	)
		return "fold-hovered";
	if (
		(facts.key === "e" || facts.key === "E") &&
		hovered &&
		bare(facts) &&
		!facts.inField
	)
		return "edit-hovered";
	if (
		(facts.key === "x" || facts.key === "X") &&
		hovered &&
		bare(facts) &&
		!facts.inEditable
	)
		return "cut-hovered";
	// Physical code, so any layout's D works; Shift is required, so
	// bare Delete never deletes.
	if (
		facts.code === "KeyD" &&
		facts.shiftKey &&
		!facts.metaKey &&
		!facts.ctrlKey &&
		!facts.altKey &&
		hovered &&
		!facts.inInteractive
	)
		return "delete-hovered";
	return null;
}

/** Facts the Space guards read. Note the dismiss has no shiftKey
 * condition: Shift+Space on an empty composer still dismisses. */
export interface SpaceKeyFacts extends KeyModifiers {
	key: string;
	repeat: boolean;
	isComposing: boolean;
	editing: boolean;
	hasAttachments: boolean;
	composerEmpty: boolean;
	inPrompt: boolean;
}

export type SpaceKeyAction = "dismiss-composer" | "swallow-repeat";

/** Space on the composer: a first press on empty text dismisses (no
 * message starts with a space, so it is never content); repeats are
 * swallowed so a held Space can't bounce the prompt back open. */
export function spaceKeyAction(facts: SpaceKeyFacts): SpaceKeyAction | null {
	if (facts.key !== " ") return null;
	if (
		!facts.repeat &&
		!facts.isComposing &&
		!facts.metaKey &&
		!facts.ctrlKey &&
		!facts.altKey &&
		!facts.editing &&
		!facts.hasAttachments &&
		facts.composerEmpty &&
		facts.inPrompt
	)
		return "dismiss-composer";
	if (facts.repeat && facts.inPrompt) return "swallow-repeat";
	return null;
}

export interface DeleteKeyFacts extends KeyModifiers {
	key: string;
	inEditor: boolean;
	inEditable: boolean;
}

export type DeleteChatScope = "chat" | "all";

/** Cmd/Ctrl+Delete drops the current chat; with Shift it drops every
 * chat. Typing targets keep the chord for line-kill habits. */
export function deleteChatScope(facts: DeleteKeyFacts): DeleteChatScope | null {
	if (!(facts.metaKey || facts.ctrlKey) || facts.altKey) return null;
	if (facts.key !== "Backspace" && facts.key !== "Delete") return null;
	if (facts.inEditor || facts.inEditable) return null;
	return facts.shiftKey ? "all" : "chat";
}
