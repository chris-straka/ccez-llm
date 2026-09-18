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

/** Shared per-keydown base: the key, physical code, and modifiers. */
export interface KeyEventFacts extends KeyModifiers {
	key: string;
	code: string;
}

/**
 * Read the shared base once per snapshot: every facts object spreads
 * this instead of repeating the literal, so the six fields can never
 * drift between slices. Extra spread fields are fine — each slice
 * interface picks what it declares. The parameter names only the six
 * fields read, so tests pass plain literals and the handler passes the
 * real event.
 */
export function keyFacts(
	event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">
): KeyEventFacts {
	return {
		key: event.key,
		code: event.code,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey
	};
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
	/** A text selection is live: hovered copy yields to it. */
	hasSelection: boolean;
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
	| "copy-hovered"
	| "cut-hovered"
	| "delete-hovered"
	| "branch-hovered"
	| "speak-hovered";

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
	// Bare C copies the hovered message — but only with nothing
	// selected (a live selection keeps its keys: the copy would
	// otherwise eat the selection menu's own C). Rich editors own
	// their keystrokes the same way X yields to them.
	if (
		(facts.key === "c" || facts.key === "C") &&
		hovered &&
		bare(facts) &&
		!facts.inField &&
		!facts.inEditable &&
		!facts.hasSelection
	)
		return "copy-hovered";
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
	// Shift+C branches from the hovered message, Shift+R reads it
	// aloud. Physical codes like Shift+D, so any layout's keys work
	// (Shift+CapsLock spellings included); fields and rich editors
	// keep their keystrokes.
	if (
		facts.code === "KeyC" &&
		facts.shiftKey &&
		!facts.metaKey &&
		!facts.ctrlKey &&
		!facts.altKey &&
		hovered &&
		!facts.inField &&
		!facts.inEditable
	)
		return "branch-hovered";
	if (
		facts.code === "KeyR" &&
		facts.shiftKey &&
		!facts.metaKey &&
		!facts.ctrlKey &&
		!facts.altKey &&
		hovered &&
		!facts.inField &&
		!facts.inEditable
	)
		return "speak-hovered";
	return null;
}

/** Facts the Space/backslash guards read. Backslash is Space-equivalent
 * here (summon + stow); note the dismiss has no shiftKey condition:
 * Shift+Space on an empty composer still dismisses. */
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

export type EnterKeyAction = "dismiss-composer";

/** Bare Enter on an empty composer dismisses, exactly like Space —
 * except Shift+Enter, which stays a newline (Space has no such
 * second job, so its guard ignores shift and this one must not).
 * Text, modifiers, attachments, and message edits all fall through
 * to send/newline as before. */
export function enterKeyAction(facts: SpaceKeyFacts): EnterKeyAction | null {
	if (facts.key !== "Enter" || facts.shiftKey) return null;
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
	return null;
}

/** Space or backslash on the composer: a first press on empty text
 * dismisses (no message starts with a space, so it is never content;
 * backslash rides along as the requested Space-equivalent, so a
 * message opening with a backslash now stows instead of typing it);
 * repeats are swallowed so a held key can't bounce the prompt back
 * open. */
export function spaceKeyAction(facts: SpaceKeyFacts): SpaceKeyAction | null {
	if (facts.key !== " " && facts.key !== "\\") return null;
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

/**
 * Facts the hidden-prompt idle guards read. `inPromptEditor` serves both
 * halves (the restore's stale-send check and the swallow's hidden-editor
 * check walk the same `.prompt` editor selector in the handler).
 */
export interface PromptIdleFacts extends KeyModifiers {
	key: string;
	repeat: boolean;
	isComposing: boolean;
	inPromptEditor: boolean;
	activeInPrompt: boolean;
	overlayOpen: boolean;
	inOwnedTarget: boolean;
}

export type PromptIdleAction = "restore" | "swallow";

/**
 * While the prompt idles hidden, bare i / Enter / Space / backslash
 * summon it back (never typed — the key is a summon); blind keystrokes
 * into the hidden composer die silently instead. Restore wins when both
 * match ("i", Space, and backslash are single chars too). The
 * stale-send guard stays: a keydown still targeted at the editor after
 * always-hide blurred it on send must not summon the prompt straight
 * back.
 */
export function promptIdleKeyAction(facts: PromptIdleFacts): PromptIdleAction | null {
	const unmodified = !facts.metaKey && !facts.ctrlKey && !facts.altKey;
	if (
		!facts.isComposing &&
		!facts.repeat &&
		unmodified &&
		(facts.key === "i" ||
			facts.key === "I" ||
			facts.key === "Enter" ||
			facts.key === " " ||
			facts.key === "\\")
	) {
		if (facts.inPromptEditor) {
			if (facts.activeInPrompt) return "restore";
		} else if (!facts.overlayOpen && !facts.inOwnedTarget) {
			return "restore";
		}
	}
	if (
		facts.inPromptEditor &&
		unmodified &&
		!facts.isComposing &&
		(facts.key === "Backspace" || facts.key === "Delete" || facts.key.length === 1)
	) {
		return "swallow";
	}
	return null;
}

/** Facts the Inspect stroke-preview stepping reads. */
export interface InspectStepFacts extends KeyModifiers {
	key: string;
	inspectOpen: boolean;
	inField: boolean;
}

/**
 * H/L step the Inspect stroke preview while it is open (never leaves
 * the menu): bare keys only, never from a field. Shift rides the key
 * value itself ("H" never equals "h"), so no shift condition — mirrors
 * the handler.
 */
export function inspectStepAction(facts: InspectStepFacts): -1 | 1 | null {
	if (!facts.inspectOpen) return null;
	if (facts.key !== "h" && facts.key !== "l") return null;
	if (facts.metaKey || facts.ctrlKey || facts.altKey) return null;
	if (facts.inField) return null;
	return facts.key === "l" ? 1 : -1;
}

/** Facts the shortcuts-filter carve-out reads. */
export interface ShortcutsFilterFacts extends KeyModifiers {
	key: string;
	code: string;
	inFilter: boolean;
}

/**
 * The shortcuts filter types freely: bare keys never reach the global
 * bindings — only Esc (close) and Cmd+F (focus) keep theirs. Modified
 * chords pass through like any other input.
 */
export function shortcutsFilterBlocksKey(facts: ShortcutsFilterFacts): boolean {
	if (!facts.inFilter) return false;
	if (facts.key === "Escape" || facts.code === "KeyF") return false;
	return !facts.metaKey && !facts.ctrlKey && !facts.altKey;
}

/** Facts the modifier-chord table reads. */
export interface CommandChordFacts extends KeyModifiers {
	key: string;
	code: string;
}

export type CommandChord =
	| "toggle-palette"
	| "toggle-fullscreen"
	| "find-toggle"
	| "toggle-pastes"
	| "send"
	| "provider-next"
	| "provider-prev"
	| "thinking-next"
	| "thinking-prev"
	| "new-chat"
	| "toggle-voice";

/**
 * Modifier-chord table in handler dispatch order: each condition is the
 * handler's verbatim guard (no narrowed re-spelling — Ctrl+O deliberately
 * ignores meta, the T chord deliberately ignores alt/shift). Bodies keep
 * their carve-outs (the send field check, the find modal split, the
 * pastes toggle result); only the chord match moves here. Callers chain
 * `if (chord === ...)` — never a switch — so a body whose target is
 * gone keeps falling through exactly like the handler did.
 */
export function commandChord(facts: CommandChordFacts): CommandChord | null {
	const cmd = facts.metaKey || facts.ctrlKey;
	if (cmd && !facts.altKey && !facts.shiftKey && facts.code === "KeyP") return "toggle-palette";
	if (
		!facts.altKey &&
		!facts.shiftKey &&
		((facts.metaKey && !facts.ctrlKey && facts.code === "KeyE") ||
			(facts.metaKey && facts.ctrlKey && facts.code === "KeyF"))
	)
		return "toggle-fullscreen";
	if (cmd && !facts.altKey && !facts.shiftKey && facts.code === "KeyF") return "find-toggle";
	if (facts.ctrlKey && (facts.key === "o" || facts.key === "O")) return "toggle-pastes";
	if (cmd && !facts.altKey && !facts.shiftKey && facts.key === "Enter") return "send";
	if (facts.ctrlKey && facts.altKey && facts.key.startsWith("Arrow")) {
		// Only these four exist (UI Events spec); anything else claiming
		// the prefix falls through instead of cycling.
		if (facts.key === "ArrowRight") return "provider-next";
		if (facts.key === "ArrowLeft") return "provider-prev";
		if (facts.key === "ArrowUp") return "thinking-next";
		if (facts.key === "ArrowDown") return "thinking-prev";
		return null;
	}
	if (facts.ctrlKey && facts.altKey && facts.code === "KeyN") return "new-chat";
	if (cmd && !facts.altKey && facts.code === "KeyN") return "new-chat";
	if (facts.ctrlKey && facts.altKey && facts.code === "KeyS") return "toggle-voice";
	return null;
}

/** Facts the sidebar/settings/zoom chord cluster reads. */
export interface ChromeChordFacts extends KeyModifiers {
	key: string;
	code: string;
	inEditor: boolean;
	hovered: boolean;
	inField: boolean;
}

export type ChromeChord =
	| "toggle-sidebar"
	| "toggle-settings"
	| "dismiss-or-sidebar"
	| "dismiss-or-settings"
	| "shortcuts-toggle"
	| "step-chat-newer"
	| "step-chat-older"
	| "zoom"
	| "quick-lang"
	| "delete-message";

/** Digit order for the Cmd+1..0 quick-language chords (see `quickLangIndexForKey`). */
const QUICK_LANG_KEYS = "1234567890";

/** Index into the priority-language list for a digit key, or -1. */
export function quickLangIndexForKey(key: string): number {
	return QUICK_LANG_KEYS.indexOf(key);
}

/**
 * Sidebar/settings/zoom chords in handler dispatch order (shift group,
 * zoom, shift-comma, then the plain panel block). Same token across
 * spellings: BracketLeft and Cmd+B both read "toggle-sidebar", all
 * three settings spellings read "toggle-settings". Bodies keep their
 * splits (the KeyH/KeyL close-and-land variants, the zoom
 * narrow/widen derivation, the quick-lang code lookup, the Cmd+D
 * target-exists check); only the chord match moves here. Callers
 * chain `if (chrome === ...)` — never a switch.
 */
export function chromeChord(facts: ChromeChordFacts): ChromeChord | null {
	const cmd = facts.metaKey || facts.ctrlKey;
	if (cmd && facts.shiftKey && !facts.altKey) {
		if (facts.code === "BracketLeft") return "toggle-sidebar";
		if (facts.code === "BracketRight") return "toggle-settings";
		if (facts.code === "KeyH") return "dismiss-or-sidebar";
		if (facts.code === "KeyL") return "dismiss-or-settings";
		if (facts.code === "Slash") return "shortcuts-toggle";
		if (facts.code === "KeyJ") return "step-chat-newer";
		if (facts.code === "KeyK") return "step-chat-older";
	}
	if (
		cmd &&
		!facts.altKey &&
		(facts.key === "=" || facts.key === "+" || facts.key === "-" || facts.key === "_")
	)
		return "zoom";
	if (cmd && !facts.altKey && facts.shiftKey && (facts.key === "<" || facts.key === ",")) {
		return "toggle-settings";
	}
	if (cmd && !facts.altKey && !facts.shiftKey) {
		// Physical key codes: shifted brackets report layout-dependent
		// `key` values ("{" / "}" on US), so the shift group above
		// matches the code instead.
		if (facts.key.toLowerCase() === "b") return "toggle-sidebar";
		if (facts.key === ".") return "toggle-settings";
		if (facts.key === ",") return "toggle-settings";
		if (quickLangIndexForKey(facts.key) !== -1) return "quick-lang";
		if (
			facts.metaKey &&
			!facts.ctrlKey &&
			(facts.key === "d" || facts.key === "D") &&
			!facts.inEditor &&
			facts.hovered &&
			!facts.inField
		) {
			// Cmd+D deletes the hovered message. Ctrl+D is deliberately
			// excluded: the prompt keeps it for editing and scroll
			// mode fast-scrolls on it instead.
			return "delete-message";
		}
	}
	return null;
}

/** Facts the open chat-list sidebar reads. */
export interface SidebarListFacts extends KeyModifiers {
	key: string;
	listOpen: boolean;
	inSidebar: boolean;
	/** Fields keep their keys (the list's own search box types, never walks). */
	inField: boolean;
}

export type SidebarListAction = "walk-up" | "walk-down" | "enter" | "delete-chat";

/**
 * The open chat list owns its keys: j/k walks chats (preview-as-you-go),
 * space/l enters the cursor chat, Delete drops the focused chat. Each
 * guard is the handler's verbatim spelling — the walk and enter blocks
 * deliberately carry no shift condition (shift rides the key value for
 * letters, and shifted arrows still walk), while Delete keeps its own.
 */
export function sidebarListAction(facts: SidebarListFacts): SidebarListAction | null {
	if (!facts.listOpen || !facts.inSidebar || facts.inField) return null;
	if (facts.metaKey || facts.ctrlKey || facts.altKey) return null;
	if (facts.key === "j" || facts.key === "ArrowDown") return "walk-down";
	if (facts.key === "k" || facts.key === "ArrowUp") return "walk-up";
	if (facts.key === " " || facts.key === "l" || facts.key === "L") return "enter";
	if (!facts.shiftKey && (facts.key === "Delete" || facts.key === "Backspace"))
		return "delete-chat";
	return null;
}

/** Facts the Ctrl+G scroll-mode entry reads. */
export interface ScrollEnterFacts extends KeyModifiers {
	key: string;
	inScrollMode: boolean;
	inEditor: boolean;
	androidUI: boolean;
	shortcutsOpen: boolean;
	searchOpen: boolean;
	inspectOpen: boolean;
	inOwnedTarget: boolean;
}

/**
 * Ctrl+G outside the composer enters scroll mode at the current message
 * in view. Bare Space never changes modes: it belongs to typing and
 * buttons, scrolls natively everywhere else, and summons the hidden
 * prompt through the idle path above — scroll mode is entered with
 * Ctrl+G only.
 */
export function scrollEnterAction(facts: ScrollEnterFacts): boolean {
	if (!facts.ctrlKey || facts.metaKey || facts.altKey) return false;
	if (facts.key !== "g" && facts.key !== "G") return false;
	if (facts.inScrollMode || facts.inEditor || facts.androidUI) return false;
	if (facts.shortcutsOpen || facts.searchOpen || facts.inspectOpen) return false;
	return !facts.inOwnedTarget;
}

/** Facts the shortcuts-modal scroll box reads. */
export interface ModalScrollFacts extends KeyModifiers {
	key: string;
	shortcutsOpen: boolean;
	searchOpen: boolean;
	inspectOpen: boolean;
	inEditor: boolean;
	androidUI: boolean;
	inEditable: boolean;
}

export type ModalScrollAction = "line-up" | "line-down";

/**
 * The shortcuts modal scrolls under j/k like the main chat,
 * contained: the palette and Inspect keep their own keys, fields keep
 * typing, and the main column never moves. The body keeps the modal-box
 * lookup (a missing box falls through). Bare d/u scroll nothing
 * anywhere — only Ctrl+U / Ctrl+D jump, in scroll mode.
 */
export function modalScrollAction(facts: ModalScrollFacts): ModalScrollAction | null {
	if (!facts.shortcutsOpen || facts.searchOpen || facts.inspectOpen) return null;
	if (facts.inEditor || facts.androidUI) return null;
	if (facts.metaKey || facts.ctrlKey || facts.altKey || facts.shiftKey) return null;
	if (facts.inEditable) return null;
	if (facts.key === "j") return "line-down";
	if (facts.key === "k") return "line-up";
	return null;
}

/**
 * Facts the scroll-mode tail reads. Modifier guards are the handler's
 * verbatim spellings — j/k/i/Enter carry none (scroll mode owns the
 * stage), while g/G keep theirs and bare u/d skip (only Ctrl+U / Ctrl+D
 * jump). `gArmed` is the
 * handler's `ggArmed(lastGAt, now)` beat; `atNewest` drops j back into
 * the prompt instead of stepping past the last message (scroll mode is
 * for visiting history, not parking).
 */
export interface ScrollModeFacts {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	inScrollMode: boolean;
	inEditor: boolean;
	inFind: boolean;
	/** Native fields keep their keys: scroll mode owns the stage, not typing. */
	inField: boolean;
	gArmed: boolean;
	atNewest: boolean;
	scrollFromPrompt: boolean;
	/** Phones keep bare d/u dead (touch owns scrolling there). */
	phoneUI: boolean;
}

export type ScrollModeAction =
	| "step-down"
	| "step-up"
	| "go-top"
	| "arm-g"
	| "go-bottom"
	| "half-jump-up"
	| "half-jump-down"
	| "skip-down"
	| "skip-up"
	| "enter-edit"
	| "scroll-toggle";

/**
 * Scroll-mode key decisions. `lastGAt` bookkeeping and every scroll
 * effect stay in the body — including the lone-g arm, which sets the
 * beat without consuming the key. Callers chain `if` — never a switch.
 */
export function scrollModeAction(facts: ScrollModeFacts): ScrollModeAction | null {
	if (!facts.inScrollMode || facts.inEditor || facts.inFind || facts.inField) return null;
	if (facts.key === "j" || facts.key === "ArrowDown") {
		// Past the newest message drops back into the prompt.
		return facts.atNewest ? "enter-edit" : "step-down";
	}
	if (facts.key === "k" || facts.key === "ArrowUp") return "step-up";
	if (facts.key === "g" && !facts.metaKey && !facts.ctrlKey && !facts.altKey) {
		// gg hops to the top of history (a lone g starts the beat).
		return facts.gArmed ? "go-top" : "arm-g";
	}
	if (facts.key === "G" && !facts.metaKey && !facts.ctrlKey && !facts.altKey) return "go-bottom";
	if (!facts.metaKey && !facts.altKey) {
		const lower = facts.key.toLowerCase();
		if (lower === "u" || lower === "d") {
			// Ctrl+U / Ctrl+D jump one instant half-page per press,
			// vim-style, everywhere. Bare taps skip a smooth fixed
			// step on desktop (a little, never a half-page); phones
			// keep them dead. Shift+D keeps its delete job in the
			// message-keys slice above (ScrollModeFacts carries no
			// shiftKey on purpose): the uppercase key string itself
			// is the shift signal.
			if (!facts.ctrlKey && (facts.phoneUI || facts.key !== lower)) return null;
			if (!facts.ctrlKey) return lower === "u" ? "skip-up" : "skip-down";
			return lower === "u" ? "half-jump-up" : "half-jump-down";
		}
	}
	if (facts.key === "i" || facts.key === "Enter") return "enter-edit";
	if (facts.ctrlKey && (facts.key === "g" || facts.key === "G")) return "scroll-toggle";
	return null;
}

/**
 * Facts the unselected-scroll block reads. `modalOpen` and `typing` keep
 * the handler's truthiness exactly (`Boolean(...)` over the same
 * expression); `emptyPromptSpace` is the already-extracted
 * `keyFocusesEmptyPrompt` verdict. The intent dispatch below these two
 * branches keeps its own inline guard and the extracted
 * `unselectedScrollIntent` call.
 */
export interface UnselectedScrollFacts extends KeyModifiers {
	key: string;
	scrollable: boolean;
	modalOpen: boolean;
	typing: boolean;
	findOpen: boolean;
	emptyPromptSpace: boolean;
	hasScrollBox: boolean;
}

export type UnselectedScrollAction = "half-jump-up" | "half-jump-down" | "empty-enter";

/**
 * Ctrl+U / Ctrl+D jump an instant half-page, vim-style (repeats jump
 * again); bare Space / Enter / i in an empty chat lands in the composer
 * instead of scrolling nowhere. A ctrl chord that is neither U nor D, or a jump
 * with no scroll box, matches nothing — the bare branch below still
 * requires no ctrl, so those keys fall through exactly like before.
 */
export function unselectedScrollAction(facts: UnselectedScrollFacts): UnselectedScrollAction | null {
	if (!facts.scrollable || facts.modalOpen || facts.typing) return null;
	if (!facts.metaKey && facts.ctrlKey && !facts.altKey && !facts.shiftKey) {
		const lower = facts.key.toLowerCase();
		if (lower === "u" || lower === "d") {
			if (!facts.hasScrollBox) return null;
			return lower === "u" ? "half-jump-up" : "half-jump-down";
		}
		return null;
	}
	if (!facts.metaKey && !facts.ctrlKey && !facts.altKey) {
		// Empty chat: bare Space / Enter / i has no scroll target, so it
		// lands in the composer instead of scrolling nowhere (fields and buttons
		// keep their native key — decided in `keyFocusesEmptyPrompt`).
		if (!facts.findOpen && facts.emptyPromptSpace) return "empty-enter";
	}
	return null;
}

export interface DeleteKeyFacts extends KeyModifiers {
	key: string;
	inEditor: boolean;
	inEditable: boolean;
}

export type DeleteChatScope = "chat" | "all";

/** Cmd/Ctrl+Delete drops the current chat; with Shift it drops every
 * chat — including from typing targets, where the plain chord stays
 * reserved for line-kill habits (Shift has no line-kill meaning). */
export function deleteChatScope(facts: DeleteKeyFacts): DeleteChatScope | null {
	if (!(facts.metaKey || facts.ctrlKey) || facts.altKey) return null;
	if (facts.key !== "Backspace" && facts.key !== "Delete") return null;
	if ((facts.inEditor || facts.inEditable) && !facts.shiftKey) return null;
	return facts.shiftKey ? "all" : "chat";
}
