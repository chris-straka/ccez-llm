// @vitest-environment jsdom
/**
 * Canadian Multilingual Standard (CSA) layout: the physical [ key is a
 * dead circumflex (^, ¨ shifted) and ] a dead cedilla, Shift+, types
 * "'", and "?" sits on Shift+6. Real KeyboardEvents shaped the way
 * WebKit and Chromium deliver them with a focused prompt must still
 * reach their chords.
 */
import { describe, expect, it } from "vitest";
import {
	chromeChord,
	imeOwnsKey,
	keyFacts,
	quickLangIndex,
	zoomNarrows,
	type ChromeChordFacts
} from "./keybindings";

function csa(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init
	});
}

function imeFacts(event: KeyboardEvent) {
	return {
		...keyFacts(event),
		isComposing: event.isComposing,
		keyCode: event.keyCode
	};
}

function chord(
	event: KeyboardEvent,
	extra: Partial<ChromeChordFacts> = {}
): ReturnType<typeof chromeChord> {
	return chromeChord({
		...keyFacts(event),
		inEditor: true,
		hovered: false,
		inField: false,
		inShell: true,
		...extra
	});
}

describe("CSA dead-key brackets", () => {
	// WebKit: the dead key is already composing, keyCode 229.
	const webkitShrink = csa({
		key: "Dead",
		code: "BracketLeft",
		ctrlKey: true,
		shiftKey: true,
		isComposing: true,
		keyCode: 229
	});
	// Chromium: key "Dead", not yet composing.
	const chromiumWiden = csa({
		key: "Dead",
		code: "BracketRight",
		ctrlKey: true,
		shiftKey: true
	});

	it("never hands a Cmd/Ctrl bracket chord to the IME", () => {
		expect(imeOwnsKey(imeFacts(webkitShrink))).toBe(false);
		expect(imeOwnsKey(imeFacts(chromiumWiden))).toBe(false);
		expect(
			imeOwnsKey(
				imeFacts(
					csa({
						key: "Dead",
						code: "BracketLeft",
						metaKey: true,
						keyCode: 229
					})
				)
			)
		).toBe(false);
	});

	it("still lets an IME own its own keys", () => {
		// Kanji pick: Enter mid-composition, and WebKit's 229 Enter.
		expect(
			imeOwnsKey(
				imeFacts(csa({ key: "Enter", code: "Enter", isComposing: true }))
			)
		).toBe(true);
		expect(
			imeOwnsKey(imeFacts(csa({ key: "Enter", code: "Enter", keyCode: 229 })))
		).toBe(true);
		// A bare dead key types its accent.
		expect(
			imeOwnsKey(
				imeFacts(csa({ key: "Dead", code: "BracketLeft", keyCode: 229 }))
			)
		).toBe(true);
		// Plain keys are nobody's IME business.
		expect(imeOwnsKey(imeFacts(csa({ key: "a", code: "KeyA" })))).toBe(false);
	});

	it("resizes the prompt from the focused prompt (shell)", () => {
		expect(chord(webkitShrink)).toBe("prompt-width");
		expect(chord(chromiumWiden)).toBe("prompt-width");
		// ⌘[ / ⌘] text size outside fields.
		expect(
			chord(csa({ key: "Dead", code: "BracketLeft", metaKey: true }), {
				inEditor: false
			})
		).toBe("prompt-zoom");
	});

	it("toggles the panels on the web, where the browser keeps width", () => {
		expect(chord(webkitShrink, { inShell: false })).toBe("toggle-sidebar");
		expect(chord(chromiumWiden, { inShell: false })).toBe("toggle-settings");
	});
});

describe("CSA punctuation chords", () => {
	it("⇧⌘, opens settings though Shift+, types an apostrophe", () => {
		expect(
			chord(csa({ key: "'", code: "Comma", metaKey: true, shiftKey: true }))
		).toBe("toggle-settings");
	});

	it("⇧⌘? opens shortcuts from Shift+6", () => {
		expect(
			chord(csa({ key: "?", code: "Digit6", metaKey: true, shiftKey: true }))
		).toBe("shortcuts-toggle");
	});

	it("zoom reads the physical plus and minus keys", () => {
		const minus = csa({ key: "Unidentified", code: "Minus", metaKey: true });
		expect(chord(minus)).toBe("zoom");
		expect(zoomNarrows(minus)).toBe(true);
		const plus = csa({ key: "Unidentified", code: "Equal", metaKey: true });
		expect(chord(plus)).toBe("zoom");
		expect(zoomNarrows(plus)).toBe(false);
		expect(zoomNarrows(csa({ key: "_", code: "Minus" }))).toBe(true);
		expect(zoomNarrows(csa({ key: "+", code: "Equal" }))).toBe(false);
	});

	it("quick-language digits read the digit row on any layout", () => {
		expect(quickLangIndex(csa({ key: "1", code: "Digit1" }))).toBe(0);
		// AZERTY's unshifted 1 key types "&".
		expect(quickLangIndex(csa({ key: "&", code: "Digit1" }))).toBe(0);
		expect(quickLangIndex(csa({ key: "à", code: "Digit0" }))).toBe(9);
		expect(quickLangIndex(csa({ key: "a", code: "KeyA" }))).toBe(-1);
		expect(
			chord(csa({ key: "&", code: "Digit1", metaKey: true }), {
				inEditor: false
			})
		).toBe("quick-lang");
	});
});
