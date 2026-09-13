import { describe, it, expect } from "vitest";
import {
	deleteChatScope,
	messageKeyAction,
	spaceKeyAction,
	type DeleteKeyFacts,
	type MessageKeyFacts,
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
	it("fires the hovered-message hotkeys bare and hovered", () => {
		expect(messageKeyAction(msgBase)).toBe("toggle-aids");
		expect(messageKeyAction({ ...msgBase, key: "m", code: "KeyM" })).toBe("pin-pinyin");
		expect(messageKeyAction({ ...msgBase, key: "n", code: "KeyN" })).toBe("pin-furigana");
		expect(messageKeyAction({ ...msgBase, key: "f", code: "KeyF" })).toBe("fold-hovered");
		expect(messageKeyAction({ ...msgBase, key: "e", code: "KeyE" })).toBe("edit-hovered");
		expect(messageKeyAction({ ...msgBase, key: "x", code: "KeyX" })).toBe("cut-hovered");
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
		expect(messageKeyAction({ ...unhovered, key: "m", code: "KeyM" })).toBe("pin-pinyin");
		expect(messageKeyAction({ ...unhovered, key: "n", code: "KeyN" })).toBe("pin-furigana");
		expect(messageKeyAction({ ...unhovered, key: "a", code: "KeyA" })).toBe(null);
	});

	it("prefers Esc+f exit over F fold while the hold is armed", () => {
		const armed = { ...msgBase, key: "f", code: "KeyF", escDownAt: 123 };
		expect(messageKeyAction(armed)).toBe("exit-fullscreen");
		expect(messageKeyAction({ ...armed, escDownAt: 0 })).toBe("fold-hovered");
	});

	it("lets Esc+f fire from inside the editor", () => {
		expect(
			messageKeyAction({ ...msgBase, key: "f", code: "KeyF", inEditor: true, escDownAt: 123 })
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
		expect(messageKeyAction({ ...filter, inFieldOrFilter: false })).toBe("exit-fullscreen");
	});

	it("holds X to rich editors while A still fires there", () => {
		// contenteditable: not a plain field, but editable.
		const rich = { ...msgBase, inField: false, inEditable: true };
		expect(messageKeyAction({ ...rich, key: "x", code: "KeyX" })).toBe(null);
		expect(messageKeyAction({ ...rich, key: "a", code: "KeyA" })).toBe("toggle-aids");
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
		expect(spaceKeyAction({ ...spaceBase, repeat: true })).toBe("swallow-repeat");
	});

	it("keeps Space as content while editing, attaching, or composing", () => {
		expect(spaceKeyAction({ ...spaceBase, editing: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, hasAttachments: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, composerEmpty: false })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, isComposing: true })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, inPrompt: false })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, repeat: true, inPrompt: false })).toBe(null);
		expect(spaceKeyAction({ ...spaceBase, key: "Enter" })).toBe(null);
	});
});

describe("deleteChatScope", () => {
	it("drops one chat, or all with Shift", () => {
		expect(deleteChatScope(delBase)).toBe("chat");
		expect(deleteChatScope({ ...delBase, shiftKey: true })).toBe("all");
		expect(deleteChatScope({ ...delBase, key: "Delete" })).toBe("chat");
	});

	it("keeps the chord for typing and line-kill habits", () => {
		expect(deleteChatScope({ ...delBase, altKey: true })).toBe(null);
		expect(deleteChatScope({ ...delBase, metaKey: false, ctrlKey: false })).toBe(null);
		expect(deleteChatScope({ ...delBase, inEditor: true })).toBe(null);
		expect(deleteChatScope({ ...delBase, inEditable: true })).toBe(null);
		expect(deleteChatScope({ ...delBase, key: "d" })).toBe(null);
	});
});
