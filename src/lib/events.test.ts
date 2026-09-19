// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	closestFromTarget,
	consumeEvent,
	isClickControlTarget,
	isComposerTarget,
	isEditableTarget,
	isFieldTarget,
	isFilterTarget,
	isFindBarTarget,
	isIdleOwnedTarget,
	isInspectFieldTarget,
	isInteractiveTarget,
	isMathTarget,
	isPromptEditorTarget,
	isPromptTarget,
	isScrollEnterOwnedTarget,
	isSidebarTarget,
	isSpaceInteractiveTarget,
	isTapOverlayTarget,
	mouseupKeepsSelection,
	isAnnotationUiTarget,
	middleDragGesture
} from "./events";

describe("page event idioms", () => {
	it("consumes both default and bubble", () => {
		let def = true;
		let bub = true;
		const event = new Event("keydown", { cancelable: true, bubbles: true });
		const prevent = () => (def = false);
		const stop = () => (bub = false);
		event.preventDefault = prevent;
		event.stopPropagation = stop;
		consumeEvent(event);
		expect(def).toBe(false);
		expect(bub).toBe(false);
	});

	it("spots plain form fields only", () => {
		document.body.innerHTML =
			'<input id="i"><textarea id="t"></textarea><select id="s"></select><div id="d" contenteditable="true">x</div><p id="p">y</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isFieldTarget(byId("i"))).toBe(true);
		expect(isFieldTarget(byId("t"))).toBe(true);
		expect(isFieldTarget(byId("s"))).toBe(true);
		expect(isFieldTarget(byId("d"))).toBe(false);
		expect(isFieldTarget(byId("p"))).toBe(false);
		expect(isFieldTarget(null)).toBe(false);
	});

	it("includes rich editors in the editable check", () => {
		document.body.innerHTML =
			'<input id="i"><div id="d" contenteditable="true">x</div><p id="p">y</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isEditableTarget(byId("i"))).toBe(true);
		expect(isEditableTarget(byId("d"))).toBe(true);
		expect(isEditableTarget(byId("p"))).toBe(false);
		expect(isEditableTarget(null)).toBe(false);
	});

	it("finds the closest ancestor without a cast at each call", () => {
		document.body.innerHTML = '<div class="outer"><p id="p">y</p></div>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(closestFromTarget(byId("p"), ".outer")?.className).toBe("outer");
		expect(closestFromTarget(byId("p"), ".missing")).toBe(null);
		expect(closestFromTarget(null, ".outer")).toBe(null);
		expect(closestFromTarget(undefined, ".outer")).toBe(null);
	});

	it("spots the prompt editor, composer, and prompt chrome", () => {
		document.body.innerHTML =
			'<div class="prompt"><div class="ta-input" id="ta">x</div><button id="pb">y</button></div>' +
			'<div class="ta-input" id="loose">z</div><p id="p">w</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isPromptEditorTarget(byId("ta"))).toBe(true);
		expect(isPromptEditorTarget(byId("loose"))).toBe(false);
		expect(isPromptEditorTarget(byId("pb"))).toBe(false);
		expect(isComposerTarget(byId("ta"))).toBe(true);
		expect(isComposerTarget(byId("loose"))).toBe(true);
		expect(isComposerTarget(byId("p"))).toBe(false);
		expect(isPromptTarget(byId("pb"))).toBe(true);
		expect(isPromptTarget(byId("p"))).toBe(false);
		expect(isPromptTarget(null)).toBe(false);
	});

	it("spots filter, find bar, and sidebar targets", () => {
		document.body.innerHTML =
			'<input class="shortcuts-filter" id="f"><aside id="a"><div class="find-bar" id="fb">x</div></aside><p id="p">y</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isFilterTarget(byId("f"))).toBe(true);
		expect(isFilterTarget(byId("p"))).toBe(false);
		expect(isFindBarTarget(byId("fb"))).toBe(true);
		expect(isFindBarTarget(byId("f"))).toBe(false);
		expect(isSidebarTarget(byId("fb"))).toBe(true);
		expect(isSidebarTarget(byId("p"))).toBe(false);
	});

	it("keeps the wider interactive and field spellings apart", () => {
		document.body.innerHTML =
			'<button id="b">x</button><a id="a" href="#">y</a><input id="i"><div id="d" contenteditable="true">z</div>' +
			'<input class="shortcuts-filter" id="f"><p id="p">w</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isInteractiveTarget(byId("b"))).toBe(true);
		expect(isInteractiveTarget(byId("a"))).toBe(true);
		expect(isInteractiveTarget(byId("p"))).toBe(false);
		expect(isInspectFieldTarget(byId("f"))).toBe(true);
		expect(isInspectFieldTarget(byId("i"))).toBe(true);
		expect(isInspectFieldTarget(byId("b"))).toBe(false);
		expect(isSpaceInteractiveTarget(byId("b"))).toBe(true);
		expect(isSpaceInteractiveTarget(byId("f"))).toBe(true);
		expect(isSpaceInteractiveTarget(byId("p"))).toBe(false);
	});

	it("spots click controls, math, and tap overlays", () => {
		document.body.innerHTML =
			'<button id="b">x</button><summary id="s">y</summary><div class="ccez-code" id="c">z</div>' +
			'<div data-math-index="0" id="m">w</div><aside id="a">v</aside><div class="modal" id="mo">u</div><p id="p">t</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isClickControlTarget(byId("b"))).toBe(true);
		expect(isClickControlTarget(byId("s"))).toBe(true);
		expect(isClickControlTarget(byId("c"))).toBe(true);
		expect(isClickControlTarget(byId("p"))).toBe(false);
		expect(isMathTarget(byId("m"))).toBe(true);
		expect(isMathTarget(byId("p"))).toBe(false);
		expect(isTapOverlayTarget(byId("a"))).toBe(true);
		expect(isTapOverlayTarget(byId("mo"))).toBe(true);
		expect(isTapOverlayTarget(byId("b"))).toBe(false);
		expect(isTapOverlayTarget(byId("p"))).toBe(false);
	});

	it("keeps the selection for editable press targets and focused fields", () => {
		document.body.innerHTML =
			'<input id="i"><div id="d" contenteditable="true">x</div><button id="b">y</button><p id="p">z</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		// A press into a field: the caret just landed there.
		expect(mouseupKeepsSelection(byId("i"), byId("p"))).toBe(true);
		expect(mouseupKeepsSelection(byId("d"), byId("p"))).toBe(true);
		// A button press while a field holds focus (preventDefault
		// presses keep it there): spare the kept caret.
		expect(mouseupKeepsSelection(byId("b"), byId("i"))).toBe(true);
		// Ordinary control presses still clear.
		expect(mouseupKeepsSelection(byId("b"), byId("p"))).toBe(false);
		expect(mouseupKeepsSelection(byId("b"), null)).toBe(false);
		expect(mouseupKeepsSelection(null, null)).toBe(false);
	});

	it("keeps annotation-UI picks out of the menu", () => {
		document.body.innerHTML =
			'<div class="review"><span id="r">note</span></div><div class="ann-pop"><span id="p">draft</span></div>' +
			'<div class="ann-refs-pop"><span id="s">saved</span></div>' +
			'<article><div class="rendered" id="m">prose</div></article><p id="x">other</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isAnnotationUiTarget(byId("r"))).toBe(true);
		expect(isAnnotationUiTarget(byId("p"))).toBe(true);
		expect(isAnnotationUiTarget(byId("s"))).toBe(true);
		expect(isAnnotationUiTarget(byId("m"))).toBe(false);
		expect(isAnnotationUiTarget(byId("x"))).toBe(false);
		expect(isAnnotationUiTarget(null)).toBe(false);
	});

	it("keeps the two owned-stage spellings deliberately apart", () => {
		document.body.innerHTML =
			'<div class="lang-menu" id="lm">x</div><summary id="s">y</summary>' +
			'<div class="modal" id="m">z</div><p id="p">w</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		// Idle-restore yields in the language menu and summaries...
		expect(isIdleOwnedTarget(byId("lm"))).toBe(true);
		expect(isIdleOwnedTarget(byId("s"))).toBe(true);
		expect(isIdleOwnedTarget(byId("m"))).toBe(true);
		expect(isIdleOwnedTarget(byId("p"))).toBe(false);
		// ...while Ctrl+G entry does not.
		expect(isScrollEnterOwnedTarget(byId("lm"))).toBe(false);
		expect(isScrollEnterOwnedTarget(byId("s"))).toBe(false);
		expect(isScrollEnterOwnedTarget(byId("m"))).toBe(true);
		expect(isScrollEnterOwnedTarget(byId("p"))).toBe(false);
	});

	it("classifies middle-drag displacements by dominant axis", () => {
		// Still a press: the shortcuts toggle owns it.
		expect(middleDragGesture(0, 0)).toBeNull();
		expect(middleDragGesture(5, -4)).toBeNull();
		// Horizontal run folds either way.
		expect(middleDragGesture(40, 3)).toBe("fold-message");
		expect(middleDragGesture(-60, -8)).toBe("fold-message");
		// Vertical run switches: up goes older, down newer.
		expect(middleDragGesture(4, -50)).toBe("older-chat");
		expect(middleDragGesture(-6, 80)).toBe("newer-chat");
		// Near-diagonal stays a press: never fold and switch at once.
		expect(middleDragGesture(40, 38)).toBeNull();
		expect(middleDragGesture(30, 60)).toBe("newer-chat");
	});
});
