import { describe, it, expect } from "vitest";
import {
	chromeChord,
	commandChord,
	deleteChatScope,
	enterKeyAction,
	inspectStepAction,
	keyFacts,
	messageKeyAction,
	modalScrollAction,
	pastesKeyAction,
	promptIdleKeyAction,
	quickLangIndexForKey,
	scrollEnterAction,
	scrollModeAction,
	sendKeyAction,
	summonHideAction,
	unselectedScrollAction,
	shortcutsFilterBlocksKey,
	sidebarListAction,
	spaceKeyAction,
	type ChromeChordFacts,
	type CommandChordFacts,
	type DeleteKeyFacts,
	type InspectStepFacts,
	type MessageKeyFacts,
	type ModalScrollFacts,
	type PastesKeyFacts,
	type PromptIdleFacts,
	type ScrollEnterFacts,
	type ScrollModeFacts,
	type SendKeyFacts,
	type SummonHideFacts,
	type UnselectedScrollFacts,
	type ShortcutsFilterFacts,
	type SidebarListFacts,
	type SpaceKeyFacts
} from "./keybindings";

const msgBase: MessageKeyFacts = {
	key: "a",
	code: "KeyA",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	inEditor: false,
	inField: false,
	inEditable: false,
	inInteractive: false,
	inFieldOrFilter: false,
	hasSelection: false,
	hoveredIdx: 2,
	escDownAt: 0
};

const spaceBase: SpaceKeyFacts = {
	key: " ",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	repeat: false,
	isComposing: false,
	editing: false,
	hasAttachments: false,
	composerEmpty: true,
	inPrompt: true
};

const delBase: DeleteKeyFacts = {
	metaKey: true,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	key: "Backspace",
	inEditor: false,
	inEditable: false
};

describe("messageKeyAction", () => {
	it("files a live selection on A, toggles aids on bare message A", () => {
		expect(messageKeyAction(msgBase)).toBe("toggle-aids");
		expect(messageKeyAction({ ...msgBase, hasSelection: true })).toBe(
			"annotate-selection"
		);
		expect(
			messageKeyAction({ ...msgBase, hasSelection: true, shiftKey: true })
		).toBe(null);
	});
	it("fires the hovered-message hotkeys bare and hovered", () => {
		expect(messageKeyAction(msgBase)).toBe("toggle-aids");
		expect(messageKeyAction({ ...msgBase, key: "m", code: "KeyM" })).toBe(
			"pin-pinyin"
		);
		expect(messageKeyAction({ ...msgBase, key: "n", code: "KeyN" })).toBe(
			"pin-furigana"
		);
		expect(messageKeyAction({ ...msgBase, key: "f", code: "KeyF" })).toBe(
			"fold-hovered"
		);
		expect(messageKeyAction({ ...msgBase, key: "e", code: "KeyE" })).toBe(
			"edit-hovered"
		);
		expect(messageKeyAction({ ...msgBase, key: "c", code: "KeyC" })).toBe(
			"copy-hovered"
		);
		expect(messageKeyAction({ ...msgBase, key: "x", code: "KeyX" })).toBe(
			"cut-hovered"
		);
	});

	it("copies only with nothing selected, and never shifted", () => {
		expect(messageKeyAction({ ...msgBase, key: "c", code: "KeyC" })).toBe(
			"copy-hovered"
		);
		// CapsLock spells it "C" with no shift: still a copy.
		expect(messageKeyAction({ ...msgBase, key: "C", code: "KeyC" })).toBe(
			"copy-hovered"
		);
		// A live selection keeps its keys (the selection menu's own C).
		expect(
			messageKeyAction({
				...msgBase,
				key: "c",
				code: "KeyC",
				hasSelection: true
			})
		).toBe(null);
		// Shift+C is the branch key, never a copy.
		expect(
			messageKeyAction({ ...msgBase, key: "C", code: "KeyC", shiftKey: true })
		).toBe("branch-hovered");
		expect(
			messageKeyAction({ ...msgBase, key: "c", code: "KeyC", inField: true })
		).toBe(null);
		expect(
			messageKeyAction({ ...msgBase, key: "c", code: "KeyC", inEditable: true })
		).toBe(null);
		expect(
			messageKeyAction({ ...msgBase, key: "c", code: "KeyC", hoveredIdx: -1 })
		).toBe(null);
	});

	it("branches on Shift+C and speaks on Shift+R from any layout", () => {
		const shifted = { ...msgBase, shiftKey: true };
		expect(messageKeyAction({ ...shifted, key: "C", code: "KeyC" })).toBe(
			"branch-hovered"
		);
		expect(messageKeyAction({ ...shifted, key: "R", code: "KeyR" })).toBe(
			"speak-hovered"
		);
		// CapsLock+Shift spells them lowercase: the codes still match.
		expect(messageKeyAction({ ...shifted, key: "c", code: "KeyC" })).toBe(
			"branch-hovered"
		);
		expect(messageKeyAction({ ...shifted, key: "r", code: "KeyR" })).toBe(
			"speak-hovered"
		);
		// Bare letters are never branch/speak.
		expect(messageKeyAction({ ...msgBase, key: "r", code: "KeyR" })).toBe(null);
		// Chords, fields, editors, and no hover all yield.
		expect(
			messageKeyAction({ ...shifted, key: "C", code: "KeyC", metaKey: true })
		).toBe(null);
		expect(
			messageKeyAction({ ...shifted, key: "C", code: "KeyC", inField: true })
		).toBe(null);
		expect(
			messageKeyAction({ ...shifted, key: "R", code: "KeyR", inEditable: true })
		).toBe(null);
		expect(
			messageKeyAction({ ...shifted, key: "R", code: "KeyR", hoveredIdx: -1 })
		).toBe(null);
	});

	it("reads word/sentence/paragraph on Shift+W/S/P over a message", () => {
		const shifted = { ...msgBase, shiftKey: true };
		expect(messageKeyAction({ ...shifted, key: "W", code: "KeyW" })).toBe(
			"speak-word"
		);
		expect(messageKeyAction({ ...shifted, key: "S", code: "KeyS" })).toBe(
			"speak-sentence"
		);
		expect(messageKeyAction({ ...shifted, key: "P", code: "KeyP" })).toBe(
			"speak-paragraph"
		);
		// Bare letters never speak; fields, editors, chords, and no
		// hover all yield like Shift+R.
		expect(messageKeyAction({ ...msgBase, key: "w", code: "KeyW" })).toBe(null);
		expect(
			messageKeyAction({ ...shifted, key: "W", code: "KeyW", inField: true })
		).toBe(null);
		expect(
			messageKeyAction({
				...shifted,
				key: "S",
				code: "KeyS",
				metaKey: true
			})
		).toBe(null);
		expect(
			messageKeyAction({ ...shifted, key: "P", code: "KeyP", hoveredIdx: -1 })
		).toBe(null);
	});

	it("rejects modifiers, the editor, fields, and no hover", () => {
		expect(messageKeyAction({ ...msgBase, metaKey: true })).toBe(null);
		expect(messageKeyAction({ ...msgBase, ctrlKey: true })).toBe(null);
		expect(messageKeyAction({ ...msgBase, inEditor: true })).toBe(null);
		expect(messageKeyAction({ ...msgBase, inField: true })).toBe(null);
		expect(messageKeyAction({ ...msgBase, hoveredIdx: -1 })).toBe(null);
		expect(messageKeyAction({ ...msgBase, key: "z", code: "KeyZ" })).toBe(null);
	});

	it("pins M/N on the center message with no hover", () => {
		const unhovered = { ...msgBase, hoveredIdx: -1 };
		expect(messageKeyAction({ ...unhovered, key: "m", code: "KeyM" })).toBe(
			"pin-pinyin"
		);
		expect(messageKeyAction({ ...unhovered, key: "n", code: "KeyN" })).toBe(
			"pin-furigana"
		);
		expect(messageKeyAction({ ...unhovered, key: "a", code: "KeyA" })).toBe(
			null
		);
	});

	it("prefers Esc+f exit over F fold while the hold is armed", () => {
		const armed = { ...msgBase, key: "f", code: "KeyF", escDownAt: 123 };
		expect(messageKeyAction(armed)).toBe("exit-fullscreen");
		expect(messageKeyAction({ ...armed, escDownAt: 0 })).toBe("fold-hovered");
	});

	it("lets Esc+f fire from inside the editor", () => {
		expect(
			messageKeyAction({
				...msgBase,
				key: "f",
				code: "KeyF",
				inEditor: true,
				escDownAt: 123
			})
		).toBe("exit-fullscreen");
	});

	it("holds Esc+f while typing in the shortcuts filter", () => {
		// The filter is an input, so inField holds too; both guards fail.
		const filter = {
			...msgBase,
			key: "f",
			code: "KeyF",
			escDownAt: 123,
			inField: true,
			inFieldOrFilter: true
		};
		expect(messageKeyAction(filter)).toBe(null);
		expect(messageKeyAction({ ...filter, inFieldOrFilter: false })).toBe(
			"exit-fullscreen"
		);
	});

	it("holds X to rich editors while A still fires there", () => {
		// contenteditable: not a plain field, but editable.
		const rich = { ...msgBase, inField: false, inEditable: true };
		expect(messageKeyAction({ ...rich, key: "x", code: "KeyX" })).toBe(null);
		expect(messageKeyAction({ ...rich, key: "a", code: "KeyA" })).toBe(
			"toggle-aids"
		);
	});

	it("takes Shift+D by physical code with its wider guard", () => {
		const shiftD = { ...msgBase, key: "D", code: "KeyD", shiftKey: true };
		expect(messageKeyAction(shiftD)).toBe("delete-hovered");
		expect(messageKeyAction({ ...shiftD, inInteractive: true })).toBe(null);
		expect(messageKeyAction({ ...shiftD, metaKey: true })).toBe(null);
		// Bare D (any layout) is not a binding.
		expect(messageKeyAction({ ...msgBase, key: "d", code: "KeyD" })).toBe(null);
	});
});

describe("spaceKeyAction", () => {
	it("dismisses a first Space on empty text, swallows repeats", () => {
		expect(spaceKeyAction(spaceBase)).toBe("dismiss-composer");
		expect(spaceKeyAction({ ...spaceBase, repeat: true })).toBe(
			"swallow-repeat"
		);
	});

	it("keeps Space as content while editing, attaching, or composing", () => {
		expect(spaceKeyAction({ ...spaceBase, editing: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, hasAttachments: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, composerEmpty: false })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, isComposing: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, inPrompt: false })).toBe(null);
		expect(
			spaceKeyAction({ ...spaceBase, repeat: true, inPrompt: false })
		).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, key: "Enter" })).toBe(null);
	});

	it("treats backslash as Space: stow on empty, swallow repeats", () => {
		const slash = { ...spaceBase, key: "\\" };
		expect(spaceKeyAction(slash)).toBe("dismiss-composer");
		expect(spaceKeyAction({ ...slash, repeat: true })).toBe("swallow-repeat");
		expect(spaceKeyAction({ ...slash, composerEmpty: false })).toBe(null);
		expect(spaceKeyAction({ ...slash, hasAttachments: true })).toBe(null);
	});
});

describe("enterKeyAction", () => {
	const enterBase = { ...spaceBase, key: "Enter" };
	it("dismisses a bare Enter on empty text, like Space", () => {
		expect(enterKeyAction(enterBase)).toBe("dismiss-composer");
	});

	it("keeps Shift+Enter a newline and guards the rest like Space", () => {
		expect(enterKeyAction({ ...enterBase, shiftKey: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, repeat: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, metaKey: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, ctrlKey: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, editing: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, hasAttachments: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, composerEmpty: false })).toBe(null);
		expect(enterKeyAction({ ...enterBase, isComposing: true })).toBe(null);
		expect(enterKeyAction({ ...enterBase, inPrompt: false })).toBe(null);
		expect(enterKeyAction({ ...spaceBase })).toBe(null);
	});
});

describe("deleteChatScope", () => {
	it("drops one chat, Shift included", () => {
		expect(deleteChatScope(delBase)).toBe("chat");
		expect(deleteChatScope({ ...delBase, shiftKey: true })).toBe("chat");
		expect(deleteChatScope({ ...delBase, key: "Delete" })).toBe("chat");
	});

	it("keeps the plain chord for typing and line-kill habits", () => {
		expect(deleteChatScope({ ...delBase, altKey: true })).toBe(null);
		expect(
			deleteChatScope({ ...delBase, metaKey: false, ctrlKey: false })
		).toBe(null);
		expect(deleteChatScope({ ...delBase, inEditor: true })).toBe(null);
		expect(deleteChatScope({ ...delBase, inEditable: true })).toBe(null);
		expect(deleteChatScope({ ...delBase, key: "d" })).toBe(null);
	});

	it("Shift drops the chat even from typing targets", () => {
		expect(
			deleteChatScope({ ...delBase, shiftKey: true, inEditor: true })
		).toBe("chat");
		expect(
			deleteChatScope({ ...delBase, shiftKey: true, inEditable: true })
		).toBe("chat");
	});
});

describe("summonHideAction", () => {
	const hideBase: SummonHideFacts = { summon: true, inEditor: false };

	it("hides on the summon chord outside the editor", () => {
		expect(summonHideAction(hideBase)).toBe("hide");
	});

	it("leaves the chord unbound inside the editor", () => {
		expect(summonHideAction({ ...hideBase, inEditor: true })).toBe(null);
	});

	it("ignores other keys", () => {
		expect(summonHideAction({ ...hideBase, summon: false })).toBe(null);
	});
});

describe("pastesKeyAction", () => {
	const pastesBase: PastesKeyFacts = { pastesChord: true, inEditor: true };

	it("toggles folds in the editor, swallows elsewhere", () => {
		expect(pastesKeyAction(pastesBase)).toBe("toggle");
		expect(pastesKeyAction({ ...pastesBase, inEditor: false })).toBe(
			"swallow"
		);
	});

	it("ignores other chords", () => {
		expect(pastesKeyAction({ ...pastesBase, pastesChord: false })).toBe(
			null
		);
	});
});

describe("sendKeyAction", () => {
	const sendBase: SendKeyFacts = { sendChord: true, inField: false };

	it("sends from anywhere but settings fields", () => {
		expect(sendKeyAction(sendBase)).toBe("send");
		expect(sendKeyAction({ ...sendBase, inField: true })).toBe(
			"field-keeps"
		);
	});

	it("ignores other chords", () => {
		expect(sendKeyAction({ ...sendBase, sendChord: false })).toBe(null);
	});
});

const idleBase: PromptIdleFacts = {
	key: "i",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	repeat: false,
	isComposing: false,
	inPromptEditor: false,
	activeInPrompt: false,
	overlayOpen: false,
	inOwnedTarget: false
};

describe("promptIdleKeyAction", () => {
	it("restores on bare i / I / Enter / Space / backslash in the open", () => {
		expect(promptIdleKeyAction(idleBase)).toBe("restore");
		expect(promptIdleKeyAction({ ...idleBase, key: "I", shiftKey: true })).toBe(
			"restore"
		);
		expect(promptIdleKeyAction({ ...idleBase, key: "Enter" })).toBe("restore");
		expect(promptIdleKeyAction({ ...idleBase, key: " " })).toBe("restore");
		expect(promptIdleKeyAction({ ...idleBase, key: "\\" })).toBe("restore");
		expect(promptIdleKeyAction({ ...idleBase, key: "x" })).toBe(null);
	});

	it("restores from the hidden editor only while focus is still there", () => {
		expect(
			promptIdleKeyAction({
				...idleBase,
				inPromptEditor: true,
				activeInPrompt: true
			})
		).toBe("restore");
		// Stale send key: targeted at the editor but focus already left
		// on send — must not summon back (bare "i" swallows instead).
		expect(promptIdleKeyAction({ ...idleBase, inPromptEditor: true })).toBe(
			"swallow"
		);
	});

	it("never summons from behind an overlay or an owned target", () => {
		expect(promptIdleKeyAction({ ...idleBase, overlayOpen: true })).toBe(null);
		expect(promptIdleKeyAction({ ...idleBase, inOwnedTarget: true })).toBe(
			null
		);
	});

	it("ignores repeats, IME, modifiers, and other keys", () => {
		expect(promptIdleKeyAction({ ...idleBase, repeat: true })).toBe(null);
		expect(promptIdleKeyAction({ ...idleBase, isComposing: true })).toBe(null);
		expect(promptIdleKeyAction({ ...idleBase, metaKey: true })).toBe(null);
		expect(promptIdleKeyAction({ ...idleBase, ctrlKey: true })).toBe(null);
		expect(promptIdleKeyAction({ ...idleBase, key: "Tab" })).toBe(null);
	});

	it("swallows blind keystrokes into the hidden composer", () => {
		expect(
			promptIdleKeyAction({ ...idleBase, key: "x", inPromptEditor: true })
		).toBe("swallow");
		expect(
			promptIdleKeyAction({
				...idleBase,
				key: "Backspace",
				inPromptEditor: true
			})
		).toBe("swallow");
		expect(
			promptIdleKeyAction({
				...idleBase,
				key: "?",
				shiftKey: true,
				inPromptEditor: true
			})
		).toBe("swallow");
		// Outside the hidden editor there is nothing to swallow; chords,
		// IME, and control keys keep their behavior everywhere.
		expect(promptIdleKeyAction({ ...idleBase, key: "x" })).toBe(null);
		expect(
			promptIdleKeyAction({
				...idleBase,
				key: "x",
				inPromptEditor: true,
				metaKey: true
			})
		).toBe(null);
		expect(
			promptIdleKeyAction({ ...idleBase, key: "Tab", inPromptEditor: true })
		).toBe(null);
	});

	it("prefers restore when both halves match", () => {
		expect(
			promptIdleKeyAction({
				...idleBase,
				key: " ",
				inPromptEditor: true,
				activeInPrompt: true
			})
		).toBe("restore");
	});
});

const inspectBase: InspectStepFacts = {
	key: "h",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	inspectOpen: true,
	inField: false
};

describe("inspectStepAction", () => {
	it("steps on bare h/l while Inspect is open", () => {
		expect(inspectStepAction(inspectBase)).toBe(-1);
		expect(inspectStepAction({ ...inspectBase, key: "l" })).toBe(1);
	});

	it("stays out of fields, modifiers, other keys, and closed Inspect", () => {
		expect(inspectStepAction({ ...inspectBase, inField: true })).toBe(null);
		expect(inspectStepAction({ ...inspectBase, metaKey: true })).toBe(null);
		expect(inspectStepAction({ ...inspectBase, ctrlKey: true })).toBe(null);
		expect(inspectStepAction({ ...inspectBase, inspectOpen: false })).toBe(
			null
		);
		expect(inspectStepAction({ ...inspectBase, key: "j" })).toBe(null);
		// Shift rides the key value ("H" never equals "h").
		expect(
			inspectStepAction({ ...inspectBase, key: "H", shiftKey: true })
		).toBe(null);
	});
});

const filterBase: ShortcutsFilterFacts = {
	key: "a",
	code: "KeyA",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	inFilter: true
};

const chordBase: CommandChordFacts = {
	key: "",
	code: "",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	inShell: true
};

describe("commandChord", () => {
	it("matches every chord-table entry", () => {
		expect(commandChord({ ...chordBase, metaKey: true, code: "KeyP" })).toBe(
			"toggle-palette"
		);
		expect(commandChord({ ...chordBase, metaKey: true, code: "KeyE" })).toBe(
			"toggle-fullscreen"
		);
		expect(commandChord({ ...chordBase, metaKey: true, code: "KeyF" })).toBe(
			"find-toggle"
		);
		expect(commandChord({ ...chordBase, ctrlKey: true, key: "o" })).toBe(
			"toggle-pastes"
		);
		expect(commandChord({ ...chordBase, metaKey: true, key: "Enter" })).toBe(
			"send"
		);
		expect(
			commandChord({
				...chordBase,
				ctrlKey: true,
				altKey: true,
				key: "ArrowRight"
			})
		).toBe("provider-next");
		expect(
			commandChord({
				...chordBase,
				ctrlKey: true,
				altKey: true,
				key: "ArrowLeft"
			})
		).toBe("provider-prev");
		expect(
			commandChord({
				...chordBase,
				ctrlKey: true,
				altKey: true,
				key: "ArrowUp"
			})
		).toBe("thinking-next");
		expect(
			commandChord({
				...chordBase,
				ctrlKey: true,
				altKey: true,
				key: "ArrowDown"
			})
		).toBe("thinking-prev");
		expect(
			commandChord({ ...chordBase, ctrlKey: true, altKey: true, code: "KeyN" })
		).toBe("new-chat");
		expect(commandChord({ ...chordBase, metaKey: true, code: "KeyN" })).toBe(
			"new-chat"
		);
		expect(
			commandChord({ ...chordBase, ctrlKey: true, altKey: true, code: "KeyS" })
		).toBe("toggle-voice");
	});

	it("opens a chat on ⌘/Ctrl+T in the shell, releases it on the web", () => {
		// No in-app browser and no tabs: the shell mints a chat
		// (0.5.3 field notes), the browser keeps new-tab.
		expect(commandChord({ ...chordBase, metaKey: true, code: "KeyT" })).toBe(
			"new-chat"
		);
		expect(commandChord({ ...chordBase, ctrlKey: true, code: "KeyT" })).toBe(
			"new-chat"
		);
		expect(
			commandChord({ ...chordBase, inShell: false, metaKey: true, code: "KeyT" })
		).toBeNull();
		expect(
			commandChord({ ...chordBase, metaKey: true, altKey: true, code: "KeyT" })
		).toBeNull();
	});

	it("passes browser-claimed chords through on the web only", () => {
		// Print, find, and the ⌘E fullscreen arm belong to the
		// browser outside the shell.
		expect(
			commandChord({ ...chordBase, inShell: false, metaKey: true, code: "KeyP" })
		).toBe(null);
		expect(
			commandChord({ ...chordBase, inShell: false, metaKey: true, code: "KeyF" })
		).toBe(null);
		expect(
			commandChord({ ...chordBase, inShell: false, metaKey: true, code: "KeyE" })
		).toBe(null);
		// The ⌘+Ctrl+F fullscreen arm has no browser claim: it works
		// everywhere, as do send and the deliberate Ctrl+O swallow.
		expect(
			commandChord({
				...chordBase,
				inShell: false,
				metaKey: true,
				ctrlKey: true,
				code: "KeyF"
			})
		).toBe("toggle-fullscreen");
		expect(
			commandChord({ ...chordBase, inShell: false, metaKey: true, key: "Enter" })
		).toBe("send");
		expect(
			commandChord({ ...chordBase, inShell: false, ctrlKey: true, key: "o" })
		).toBe("toggle-pastes");
	});

	it("keeps handler priority (dual-modifier chords win their race)", () => {
		// Ctrl+Cmd+F reads as fullscreen, never find.
		expect(
			commandChord({ ...chordBase, metaKey: true, ctrlKey: true, code: "KeyF" })
		).toBe("toggle-fullscreen");
		// Ctrl+Alt+N reads as new-chat on the Option spelling.
		expect(
			commandChord({ ...chordBase, ctrlKey: true, altKey: true, code: "KeyN" })
		).toBe("new-chat");
	});

	it("keeps the verbatim guard spellings (no narrowed re-spelling)", () => {
		// Ctrl+O ignores meta and shift, like the handler did.
		expect(
			commandChord({ ...chordBase, ctrlKey: true, metaKey: true, key: "o" })
		).toBe("toggle-pastes");
		expect(
			commandChord({ ...chordBase, ctrlKey: true, shiftKey: true, key: "O" })
		).toBe("toggle-pastes");
		// The T chord ignores alt/shift; plain Cmd+O is not pastes.
		expect(commandChord({ ...chordBase, metaKey: true, key: "o" })).toBe(null);
		// Shift rides the new-chat branch (single window, no new window).
		expect(
			commandChord({
				...chordBase,
				metaKey: true,
				shiftKey: true,
				code: "KeyN"
			})
		).toBe("new-chat");
		// Alt/shift break the palette/fullscreen/find/send chords.
		expect(
			commandChord({ ...chordBase, metaKey: true, altKey: true, code: "KeyP" })
		).toBe(null);
		expect(
			commandChord({
				...chordBase,
				metaKey: true,
				shiftKey: true,
				code: "KeyE"
			})
		).toBe(null);
		expect(
			commandChord({
				...chordBase,
				metaKey: true,
				shiftKey: true,
				code: "KeyF"
			})
		).toBe(null);
		expect(
			commandChord({
				...chordBase,
				metaKey: true,
				shiftKey: true,
				key: "Enter"
			})
		).toBe(null);
		// Bare keys and unknown arrows match nothing.
		expect(commandChord({ ...chordBase, key: "t" })).toBe(null);
		expect(
			commandChord({ ...chordBase, ctrlKey: true, altKey: true, key: "ArrowX" })
		).toBe(null);
	});
});

const chromeBase: ChromeChordFacts = {
	key: "",
	code: "",
	metaKey: true,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	inEditor: false,
	hovered: false,
	inField: false,
	inShell: true
};

describe("chromeChord", () => {
	it("reads the same token across spellings", () => {
		expect(
			chromeChord({ ...chromeBase, shiftKey: true, code: "BracketLeft" })
		).toBe("toggle-sidebar");
		expect(chromeChord({ ...chromeBase, key: "b", code: "KeyB" })).toBe(
			"toggle-sidebar"
		);
		expect(
			chromeChord({ ...chromeBase, shiftKey: true, code: "BracketRight" })
		).toBe("toggle-settings");
		expect(chromeChord({ ...chromeBase, key: ".", code: "Period" })).toBe(
			"toggle-settings"
		);
		expect(chromeChord({ ...chromeBase, key: ",", code: "Comma" })).toBe(
			"toggle-settings"
		);
		expect(
			chromeChord({ ...chromeBase, shiftKey: true, key: "<", code: "Comma" })
		).toBe("toggle-settings");
	});

	it("matches the shift group, zoom, quick-lang, and Cmd+D", () => {
		expect(chromeChord({ ...chromeBase, shiftKey: true, code: "KeyH" })).toBe(
			"dismiss-or-sidebar"
		);
		expect(chromeChord({ ...chromeBase, shiftKey: true, code: "KeyL" })).toBe(
			"dismiss-or-settings"
		);
		expect(chromeChord({ ...chromeBase, shiftKey: true, code: "Slash" })).toBe(
			"shortcuts-toggle"
		);
		expect(chromeChord({ ...chromeBase, shiftKey: true, code: "KeyJ" })).toBe(
			"step-chat-newer"
		);
		expect(chromeChord({ ...chromeBase, shiftKey: true, code: "KeyK" })).toBe(
			"step-chat-older"
		);
		expect(chromeChord({ ...chromeBase, key: "=", code: "Equal" })).toBe(
			"zoom"
		);
		expect(
			chromeChord({ ...chromeBase, shiftKey: true, key: "+", code: "Equal" })
		).toBe("zoom");
		expect(chromeChord({ ...chromeBase, key: "1", code: "Digit1" })).toBe(
			"quick-lang"
		);
		// Browser preview: digit chords pass through to tab switching.
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "1", code: "Digit1" })
		).toBeNull();
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "0", code: "Digit0" })
		).toBeNull();
		// Same for the other browser-claimed chords: zoom (page
		// zoom), ⌘B (bookmarks bar), hovered ⌘D (bookmark tab).
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "=", code: "Equal" })
		).toBeNull();
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "b", code: "KeyB" })
		).toBeNull();
		expect(
			chromeChord({
				...chromeBase,
				inShell: false,
				key: "d",
				code: "KeyD",
				hovered: true
			})
		).toBeNull();
		// Shell keeps them all.
		expect(chromeChord({ ...chromeBase, key: "=", code: "Equal" })).toBe(
			"zoom"
		);
		expect(chromeChord({ ...chromeBase, key: "b", code: "KeyB" })).toBe(
			"toggle-sidebar"
		);
		expect(
			chromeChord({ ...chromeBase, key: "d", code: "KeyD", hovered: true })
		).toBe("delete-message");
		expect(quickLangIndexForKey("1")).toBe(0);
		expect(quickLangIndexForKey("0")).toBe(9);
		expect(quickLangIndexForKey("x")).toBe(-1);
	});

	it("steps chats on plain ⌘[ / ⌘] / ⌘↑ / ⌘↓ (shell only, fields keep them)", () => {
		expect(chromeChord({ ...chromeBase, key: "[", code: "BracketLeft" })).toBe(
			"step-chat-older"
		);
		expect(chromeChord({ ...chromeBase, key: "]", code: "BracketRight" })).toBe(
			"step-chat-newer"
		);
		expect(
			chromeChord({ ...chromeBase, key: "ArrowDown", code: "ArrowDown" })
		).toBe("step-chat-newer");
		expect(chromeChord({ ...chromeBase, key: "ArrowUp", code: "ArrowUp" })).toBe(
			"step-chat-older"
		);
		// Bare arrows never step; shift keeps the shift spelling.
		expect(chromeChord({ ...chromeBase, metaKey: false, key: "ArrowDown" })).toBe(
			null
		);
		expect(
			chromeChord({ ...chromeBase, shiftKey: true, code: "BracketLeft" })
		).toBe("toggle-sidebar");
		// Browser preview: history and scroll edges stay native.
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "[", code: "BracketLeft" })
		).toBeNull();
		expect(
			chromeChord({ ...chromeBase, inShell: false, key: "ArrowUp", code: "ArrowUp" })
		).toBeNull();
		// Fields and the prompt keep them for caret travel.
		expect(
			chromeChord({ ...chromeBase, key: "[", code: "BracketLeft", inField: true })
		).toBeNull();
		expect(
			chromeChord({ ...chromeBase, key: "ArrowDown", code: "ArrowDown", inEditor: true })
		).toBeNull();
	});

	it("keeps the guard spellings (Cmd+D stays meta-only and hover-gated)", () => {
		// Ctrl+D belongs to the prompt and scroll-mode fast-scroll.
		expect(
			chromeChord({
				...chromeBase,
				metaKey: false,
				ctrlKey: true,
				key: "d",
				hovered: true
			})
		).toBe(null);
		expect(
			chromeChord({ ...chromeBase, key: "d", hovered: true, inEditor: true })
		).toBe(null);
		expect(
			chromeChord({ ...chromeBase, key: "d", hovered: true, inField: true })
		).toBe(null);
		expect(chromeChord({ ...chromeBase, key: "d", code: "KeyD" })).toBe(null);
		// Alt breaks every chord in the cluster.
		expect(chromeChord({ ...chromeBase, altKey: true, key: "b" })).toBe(null);
		expect(
			chromeChord({ ...chromeBase, altKey: true, shiftKey: true, code: "KeyJ" })
		).toBe(null);
		expect(chromeChord({ ...chromeBase, altKey: true, key: "=" })).toBe(null);
		// Shift picks the shift spelling (or nothing), never the plain one.
		expect(chromeChord({ ...chromeBase, shiftKey: true, key: "b" })).toBe(null);
		expect(chromeChord({ ...chromeBase, shiftKey: true, key: "1" })).toBe(null);
		expect(chromeChord({ ...chromeBase, key: "x" })).toBe(null);
	});
});

const sideBase: SidebarListFacts = {
	key: "j",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	listOpen: true,
	inSidebar: true,
	inField: false,
	inChatRow: true
};

describe("sidebarListAction", () => {
	it("walks, enters, and deletes in the open list", () => {
		expect(sidebarListAction(sideBase)).toBe("walk-down");
		expect(sidebarListAction({ ...sideBase, key: "ArrowDown" })).toBe(
			"walk-down"
		);
		expect(sidebarListAction({ ...sideBase, key: "k" })).toBe("walk-up");
		expect(sidebarListAction({ ...sideBase, key: "ArrowUp" })).toBe("walk-up");
		expect(sidebarListAction({ ...sideBase, key: " " })).toBe("enter");
		expect(sidebarListAction({ ...sideBase, key: "l" })).toBe("enter");
		expect(sidebarListAction({ ...sideBase, key: "Enter" })).toBe("enter");
		// Off-row Enter keeps its native behavior (New chat, settings).
		expect(
			sidebarListAction({ ...sideBase, key: "Enter", inChatRow: false })
		).toBe(null);
		expect(sidebarListAction({ ...sideBase, key: "Delete" })).toBe(
			"delete-chat"
		);
		expect(sidebarListAction({ ...sideBase, key: "Backspace" })).toBe(
			"delete-chat"
		);
	});

	it("keeps the verbatim guard spellings", () => {
		// Closed list or outside it: nothing owned.
		expect(sidebarListAction({ ...sideBase, listOpen: false })).toBe(null);
		expect(sidebarListAction({ ...sideBase, inSidebar: false })).toBe(null);
		// Fields keep their keys even inside the open list (settings
		// inputs, the list's own search box: j/k type, Backspace edits).
		expect(sidebarListAction({ ...sideBase, inField: true })).toBe(null);
		expect(sidebarListAction({ ...sideBase, inField: true, key: "k" })).toBe(
			null
		);
		expect(sidebarListAction({ ...sideBase, inField: true, key: " " })).toBe(
			null
		);
		expect(
			sidebarListAction({ ...sideBase, inField: true, key: "Backspace" })
		).toBe(null);
		// Modifiers release every key; shifted Delete keeps its own.
		expect(sidebarListAction({ ...sideBase, metaKey: true })).toBe(null);
		expect(
			sidebarListAction({ ...sideBase, key: "Delete", shiftKey: true })
		).toBe(null);
		// Shifted arrows still walk (no shift condition, like the handler).
		expect(
			sidebarListAction({ ...sideBase, key: "ArrowDown", shiftKey: true })
		).toBe("walk-down");
		expect(sidebarListAction({ ...sideBase, key: "x" })).toBe(null);
	});
});

const enterBase: ScrollEnterFacts = {
	key: "g",
	metaKey: false,
	ctrlKey: true,
	altKey: false,
	shiftKey: false,
	inScrollMode: false,
	inEditor: false,
	androidUI: false,
	shortcutsOpen: false,
	searchOpen: false,
	inspectOpen: false,
	inOwnedTarget: false
};

describe("scrollEnterAction", () => {
	it("enters scroll mode on Ctrl+G outside the composer", () => {
		expect(scrollEnterAction(enterBase)).toBe(true);
		expect(scrollEnterAction({ ...enterBase, key: "G", shiftKey: true })).toBe(
			true
		);
	});

	it("stays out of scroll mode, the editor, overlays, and owned targets", () => {
		expect(scrollEnterAction({ ...enterBase, inScrollMode: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, inEditor: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, androidUI: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, shortcutsOpen: true })).toBe(
			false
		);
		expect(scrollEnterAction({ ...enterBase, searchOpen: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, inspectOpen: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, inOwnedTarget: true })).toBe(
			false
		);
		expect(scrollEnterAction({ ...enterBase, ctrlKey: false })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, metaKey: true })).toBe(false);
		expect(scrollEnterAction({ ...enterBase, key: "j" })).toBe(false);
	});
});

const modalBase: ModalScrollFacts = {
	key: "j",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	shortcutsOpen: true,
	searchOpen: false,
	inspectOpen: false,
	inEditor: false,
	androidUI: false,
	inEditable: false
};

describe("modalScrollAction", () => {
	it("scrolls the modal on j/k only; bare d/u stay put", () => {
		expect(modalScrollAction(modalBase)).toBe("line-down");
		expect(modalScrollAction({ ...modalBase, key: "k" })).toBe("line-up");
		expect(modalScrollAction({ ...modalBase, key: "d" })).toBe(null);
		expect(modalScrollAction({ ...modalBase, key: "u" })).toBe(null);
		expect(modalScrollAction({ ...modalBase, key: "x" })).toBe(null);
	});

	it("yields to the palette, Inspect, fields, and modifiers", () => {
		expect(modalScrollAction({ ...modalBase, shortcutsOpen: false })).toBe(
			null
		);
		expect(modalScrollAction({ ...modalBase, searchOpen: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, inspectOpen: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, inEditor: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, androidUI: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, inEditable: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, shiftKey: true })).toBe(null);
		expect(modalScrollAction({ ...modalBase, ctrlKey: true })).toBe(null);
	});
});

const scrollBase: ScrollModeFacts = {
	key: "j",
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	inScrollMode: true,
	inEditor: false,
	inFind: false,
	inField: false,
	inInteractive: false,
	gArmed: false,
	atNewest: false,
	scrollFromPrompt: false,
	phoneUI: false
};

describe("scrollModeAction", () => {
	it("steps, exits past the newest, and jumps in scroll mode", () => {
		expect(scrollModeAction(scrollBase)).toBe("step-down");
		expect(scrollModeAction({ ...scrollBase, key: "ArrowDown" })).toBe(
			"step-down"
		);
		// Past the newest message drops back into the prompt (j-exits scroll).
		expect(scrollModeAction({ ...scrollBase, atNewest: true })).toBe(
			"enter-edit"
		);
		expect(
			scrollModeAction({ ...scrollBase, key: "ArrowDown", atNewest: true })
		).toBe("enter-edit");
		expect(scrollModeAction({ ...scrollBase, key: "k" })).toBe("step-up");
		expect(scrollModeAction({ ...scrollBase, key: "ArrowUp" })).toBe("step-up");
		expect(scrollModeAction({ ...scrollBase, key: "g", gArmed: true })).toBe(
			"go-top"
		);
		expect(scrollModeAction({ ...scrollBase, key: "g" })).toBe("arm-g");
		expect(scrollModeAction({ ...scrollBase, key: "G" })).toBe("go-bottom");
		expect(scrollModeAction({ ...scrollBase, key: "i" })).toBe("enter-edit");
		expect(scrollModeAction({ ...scrollBase, key: "Enter" })).toBe(
			"enter-edit"
		);
		// Enter on a button or link clicks it natively instead.
		expect(
			scrollModeAction({ ...scrollBase, key: "Enter", inInteractive: true })
		).toBe(null);
	});

	it("skips bare U/D on desktop, ignores them on phones, jumps Ctrl+U/D", () => {
		// Desktop bare taps skip one fixed step (never a half-page).
		expect(scrollModeAction({ ...scrollBase, key: "u" })).toBe("skip-up");
		expect(scrollModeAction({ ...scrollBase, key: "d" })).toBe("skip-down");
		// Phones keep bare taps dead; shifted bare keeps delete.
		expect(scrollModeAction({ ...scrollBase, key: "u", phoneUI: true })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, key: "d", phoneUI: true })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, key: "D" })).toBe(null);
		expect(scrollModeAction({ ...scrollBase, key: "u", ctrlKey: true })).toBe(
			"half-jump-up"
		);
		expect(scrollModeAction({ ...scrollBase, key: "d", ctrlKey: true })).toBe(
			"half-jump-down"
		);
		expect(scrollModeAction({ ...scrollBase, key: "g", ctrlKey: true })).toBe(
			"scroll-toggle"
		);
		expect(scrollModeAction({ ...scrollBase, key: "G", ctrlKey: true })).toBe(
			"scroll-toggle"
		);
	});

	it("stays out of scroll mode, the editor, and find — and keeps guard spellings", () => {
		expect(scrollModeAction({ ...scrollBase, inScrollMode: false })).toBe(null);
		expect(scrollModeAction({ ...scrollBase, inEditor: true })).toBe(null);
		expect(scrollModeAction({ ...scrollBase, inFind: true })).toBe(null);
		expect(scrollModeAction({ ...scrollBase, inField: true })).toBe(null);
		expect(scrollModeAction({ ...scrollBase, inField: true, key: "d" })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, inField: true, key: "i" })).toBe(
			null
		);
		expect(
			scrollModeAction({ ...scrollBase, inField: true, key: "Enter" })
		).toBe(null);
		expect(
			scrollModeAction({ ...scrollBase, inField: true, key: "g", gArmed: true })
		).toBe(null);
		// g/G keep their guards; j/k/i/Enter carry none (scroll owns them).
		expect(scrollModeAction({ ...scrollBase, key: "g", metaKey: true })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, key: "G", altKey: true })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, key: "u", metaKey: true })).toBe(
			null
		);
		expect(scrollModeAction({ ...scrollBase, key: "j", metaKey: true })).toBe(
			"step-down"
		);
		expect(scrollModeAction({ ...scrollBase, key: "x" })).toBe(null);
	});
});

const unselectedBase: UnselectedScrollFacts = {
	key: "u",
	metaKey: false,
	ctrlKey: true,
	altKey: false,
	shiftKey: false,
	scrollable: true,
	modalOpen: false,
	typing: false,
	findOpen: false,
	emptyPromptSpace: false,
	hasScrollBox: true
};

describe("unselectedScrollAction", () => {
	it("jumps Ctrl+U/D a half page with a scroll box", () => {
		expect(unselectedScrollAction(unselectedBase)).toBe("half-jump-up");
		expect(unselectedScrollAction({ ...unselectedBase, key: "D" })).toBe(
			"half-jump-down"
		);
		expect(unselectedScrollAction({ ...unselectedBase, key: "x" })).toBe(null);
		expect(
			unselectedScrollAction({ ...unselectedBase, hasScrollBox: false })
		).toBe(null);
	});

	it("enters the composer on bare Space in an empty chat", () => {
		const space = {
			...unselectedBase,
			key: " ",
			ctrlKey: false,
			emptyPromptSpace: true
		};
		expect(unselectedScrollAction(space)).toBe("empty-enter");
		expect(unselectedScrollAction({ ...space, findOpen: true })).toBe(null);
		expect(unselectedScrollAction({ ...space, emptyPromptSpace: false })).toBe(
			null
		);
	});

	it("yields while modal, typing, or unscrolled — and keeps guard spellings", () => {
		expect(
			unselectedScrollAction({ ...unselectedBase, scrollable: false })
		).toBe(null);
		expect(unselectedScrollAction({ ...unselectedBase, modalOpen: true })).toBe(
			null
		);
		expect(unselectedScrollAction({ ...unselectedBase, typing: true })).toBe(
			null
		);
		// The jump needs bare ctrl: meta, alt, and shift all release it.
		expect(unselectedScrollAction({ ...unselectedBase, metaKey: true })).toBe(
			null
		);
		expect(unselectedScrollAction({ ...unselectedBase, altKey: true })).toBe(
			null
		);
		expect(unselectedScrollAction({ ...unselectedBase, shiftKey: true })).toBe(
			null
		);
		expect(unselectedScrollAction({ ...unselectedBase, ctrlKey: false })).toBe(
			null
		);
	});
});

describe("keyFacts", () => {
	it("reads the shared key, code, and modifiers off the event", () => {
		expect(
			keyFacts({
				key: "t",
				code: "KeyT",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: true
			})
		).toEqual({
			key: "t",
			code: "KeyT",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true
		});
	});
});

describe("shortcutsFilterBlocksKey", () => {
	it("lets the filter type bare keys freely", () => {
		expect(shortcutsFilterBlocksKey(filterBase)).toBe(true);
		expect(shortcutsFilterBlocksKey({ ...filterBase, shiftKey: true })).toBe(
			true
		);
	});

	it("keeps Esc and Cmd+F global, passes chords through, ignores outsiders", () => {
		expect(shortcutsFilterBlocksKey({ ...filterBase, key: "Escape" })).toBe(
			false
		);
		expect(
			shortcutsFilterBlocksKey({ ...filterBase, code: "KeyF", metaKey: true })
		).toBe(false);
		expect(shortcutsFilterBlocksKey({ ...filterBase, metaKey: true })).toBe(
			false
		);
		expect(shortcutsFilterBlocksKey({ ...filterBase, inFilter: false })).toBe(
			false
		);
	});
});
