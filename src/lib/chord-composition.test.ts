// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChordCompositionGuard } from "./chord-composition";

describe("createChordCompositionGuard", () => {
	let field: HTMLTextAreaElement;
	let clock = 1000;
	beforeEach(() => {
		vi.useFakeTimers();
		field = document.createElement("textarea");
		document.body.append(field);
		field.value = "bonjour";
		field.setSelectionRange(7, 7);
	});
	afterEach(() => {
		field.remove();
		vi.useRealTimers();
	});

	/** The dead key composes its ^ at the caret. */
	function composeCaret(): void {
		field.dispatchEvent(
			new CompositionEvent("compositionstart", { bubbles: true })
		);
		field.value = "bonjour^";
		field.dispatchEvent(new Event("input", { bubbles: true }));
	}

	it("undoes a ^ composed before the chord's keydown (WebKit)", () => {
		const guard = createChordCompositionGuard(document, () => clock);
		const inputs = vi.fn();
		field.addEventListener("input", inputs);
		composeCaret();
		clock += 5;
		guard.undo(field);
		expect(field.value).toBe("bonjour");
		expect(field.selectionStart).toBe(7);
		// The editor hears the restore (plus the compose before it).
		expect(inputs).toHaveBeenCalledTimes(2);
		guard.dispose();
	});

	it("undoes a ^ composed after the chord's keydown (Chromium)", () => {
		const guard = createChordCompositionGuard(document, () => clock);
		guard.undo(field);
		composeCaret();
		vi.runAllTimers();
		expect(field.value).toBe("bonjour");
		guard.dispose();
	});

	it("leaves an older composition alone", () => {
		const guard = createChordCompositionGuard(document, () => clock);
		composeCaret();
		clock += 5000;
		guard.undo(field);
		vi.runAllTimers();
		expect(field.value).toBe("bonjour^");
		guard.dispose();
	});

	it("does nothing when the chord composed nothing", () => {
		const guard = createChordCompositionGuard(document, () => clock);
		const inputs = vi.fn();
		field.addEventListener("input", inputs);
		guard.undo(field);
		vi.runAllTimers();
		expect(field.value).toBe("bonjour");
		expect(inputs).not.toHaveBeenCalled();
		guard.dispose();
	});
});
