// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { closestFromTarget, consumeEvent, isEditableTarget, isFieldTarget } from "./events";

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
});
