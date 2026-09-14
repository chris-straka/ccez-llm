// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	closestFromTarget,
	consumeEvent,
	isComposerTarget,
	isEditableTarget,
	isFieldTarget,
	isFilterTarget,
	isFindBarTarget,
	isIdleOwnedTarget,
	isInspectFieldTarget,
	isInteractiveTarget,
	isPromptEditorTarget,
	isPromptTarget,
	isScrollEnterOwnedTarget,
	isSidebarTarget,
	isSpaceInteractiveTarget
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
		document.body.innerHTML =
			'<div class="outer"><p id="p">y</p></div>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(closestFromTarget(byId("p"), ".outer")?.className).toBe("outer");
		expect(closestFromTarget(byId("p"), ".missing")).toBe(null);
		expect(closestFromTarget(null, ".outer")).toBe(null);
		expect(closestFromTarget(undefined, ".outer")).toBe(null);
	});

	it("spots the prompt editor, composer, and prompt chrome", () => {
		document.body.innerHTML =
			'<div class="prompt"><div class="cm-content" id="cm">x</div><button id="pb">y</button></div>' +
			'<div class="ta-input" id="ta">z</div><p id="p">w</p>';
		const byId = (id: string): Element | null => document.getElementById(id);
		expect(isPromptEditorTarget(byId("cm"))).toBe(true);
		expect(isPromptEditorTarget(byId("ta"))).toBe(false);
		expect(isPromptEditorTarget(byId("pb"))).toBe(false);
		expect(isComposerTarget(byId("cm"))).toBe(true);
		expect(isComposerTarget(byId("ta"))).toBe(true);
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
});
