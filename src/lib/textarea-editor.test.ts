// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createTextareaEditor } from "./textarea-editor";
import type { PromptEditorOptions } from "./editor";

function setup(overrides: Partial<PromptEditorOptions> = {}) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const options: PromptEditorOptions = {
		onSubmit: vi.fn(),
		onHopOut: vi.fn(),
		onImagesPasted: vi.fn(),
		onDocChange: vi.fn(),
		...overrides
	};
	const editor = createTextareaEditor(parent, options);
	const ta = parent.querySelector("textarea");
	return { parent, editor, ta: ta as HTMLTextAreaElement, options };
}

function key(target: HTMLElement, init: KeyboardEventInit): void {
	target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

describe("createTextareaEditor", () => {
	it("mounts a plain textarea as the first child (tab order: prompt first)", () => {
		const { parent, ta } = setup();
		expect(ta).not.toBeNull();
		expect(parent.firstElementChild).toBe(ta);
	});

	it("Enter sends, Shift-Enter does not", () => {
		const { ta, options } = setup();
		key(ta, { key: "Enter" });
		expect(options.onSubmit).toHaveBeenCalledWith("send");
		(options.onSubmit as ReturnType<typeof vi.fn>).mockClear();
		key(ta, { key: "Enter", shiftKey: true });
		expect(options.onSubmit).not.toHaveBeenCalled();
	});

	it("Shift-Enter on a fence opener completes the fence with the caret between", () => {
		const { editor, ta } = setup();
		editor.setText("```py");
		ta.setSelectionRange(5, 5);
		key(ta, { key: "Enter", shiftKey: true });
		expect(editor.getText()).toBe("```py\n\n```");
		expect(ta.selectionStart).toBe(6);
	});

	it("Shift-Enter in an empty fence body exits past the fence", () => {
		const { editor, ta } = setup();
		editor.setText("```py\n\n```");
		ta.setSelectionRange(6, 6);
		key(ta, { key: "Enter", shiftKey: true });
		expect(editor.getText()).toBe("```py\n\n```\n");
		expect(ta.selectionStart).toBe(11);
	});

	it("Shift-Enter on plain text sends nothing and types nothing", () => {
		const { editor, ta, options } = setup();
		editor.setText("hi");
		ta.setSelectionRange(2, 2);
		key(ta, { key: "Enter", shiftKey: true });
		expect(options.onSubmit).not.toHaveBeenCalled();
		expect(editor.getText()).toBe("hi");
	});

	it("never hijacks Enter during IME composition", () => {
		const { ta, options } = setup();
		// jsdom KeyboardEvent supports isComposing via the init dict.
		ta.dispatchEvent(
			new KeyboardEvent("keydown", { bubbles: true, key: "Enter", isComposing: true })
		);
		expect(options.onSubmit).not.toHaveBeenCalled();
	});

	it("setText/getText round-trip and clear", () => {
		const { editor } = setup();
		editor.setText("hello");
		expect(editor.getText()).toBe("hello");
		editor.clear();
		expect(editor.getText()).toBe("");
	});

	it("insertText splices at the caret", () => {
		const { editor, ta } = setup();
		editor.setText("ab");
		ta.setSelectionRange(1, 1);
		editor.insertText("X");
		expect(editor.getText()).toBe("aXb");
	});

	it("forwards every pasted image to onImagesPasted", () => {
		const { ta, options } = setup();
		const first = new File(["x"], "one.png", { type: "image/png" });
		const second = new File(["y"], "two.png", { type: "image/png" });
		const event = new Event("paste", { bubbles: true }) as ClipboardEvent & {
			clipboardData: DataTransfer;
		};
		Object.defineProperty(event, "clipboardData", {
			value: { files: [first, second], getData: () => "" }
		});
		ta.dispatchEvent(event);
		expect(options.onImagesPasted).toHaveBeenCalledWith([first, second]);
	});

	it("sends unfolded: getPastes is always empty", () => {
		const { editor } = setup();
		editor.setText("a".repeat(500));
		expect(editor.getPastes()).toEqual([]);
	});

	it("setPlaceholder swaps the hint", () => {
		const { editor, ta } = setup();
		editor.setPlaceholder("Tap to write again");
		expect(ta.placeholder).toBe("Tap to write again");
	});

	it("destroy removes the node", () => {
		const { parent, editor } = setup();
		editor.destroy();
		expect(parent.querySelector("textarea")).toBeNull();
	});
});
