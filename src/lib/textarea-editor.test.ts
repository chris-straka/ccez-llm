// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createTextareaEditor } from "./textarea-editor";
import type { PromptEditorOptions } from "./textarea-editor";

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

	it("Alt+Enter stages by default", () => {
		const { ta, options } = setup();
		key(ta, { key: "Enter", altKey: true });
		expect(options.onSubmit).toHaveBeenCalledWith("stage");
	});

	it("enterSubmits false leaves Enter and Alt+Enter dead", () => {
		const { ta, options } = setup({ enterSubmits: false });
		key(ta, { key: "Enter" });
		expect(options.onSubmit).not.toHaveBeenCalled();
		key(ta, { key: "Enter", altKey: true });
		expect(options.onSubmit).not.toHaveBeenCalled();
		// Shift+Enter still falls through untouched.
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

	it("routes over-threshold pastes to onLongTextPasted, trimmed", () => {
		const { ta, options } = setup({ onLongTextPasted: vi.fn() });
		const long = `x${"y".repeat(120)}\n\n`;
		const event = new Event("paste", { bubbles: true }) as ClipboardEvent & {
			clipboardData: DataTransfer;
		};
		Object.defineProperty(event, "clipboardData", {
			value: { files: [], getData: () => long }
		});
		ta.dispatchEvent(event);
		expect(options.onLongTextPasted).toHaveBeenCalledWith(long.replace(/\n+$/, ""));
		expect(ta.value).toBe("");
	});

	it("inserts long pastes inline without a host", () => {
		// Trailing newlines take the manual-insert branch (jsdom runs
		// no default paste insertion, so the clean-default path is
		// unobservable here — the browser owns it).
		const { ta } = setup();
		const long = `z${"w".repeat(120)}\n\n`;
		const event = new Event("paste", { bubbles: true }) as ClipboardEvent & {
			clipboardData: DataTransfer;
		};
		Object.defineProperty(event, "clipboardData", {
			value: { files: [], getData: () => long }
		});
		ta.dispatchEvent(event);
		expect(ta.value).toBe(long.replace(/\n+$/, ""));
	});

	it("excisePastedAt drops the indexed tag", () => {
		const { editor } = setup();
		editor.setText(`a [Pasted 120 chars] b [Pasted 130 chars]`);
		expect(editor.excisePastedAt(1)).toBe(true);
		expect(editor.getText()).toBe("a [Pasted 120 chars] b");
		expect(editor.excisePastedAt(5)).toBe(false);
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

describe("atomic marker deletion", () => {
	function backspace(ta: HTMLTextAreaElement, at: number): void {
		ta.setSelectionRange(at, at);
		ta.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward"
			})
		);
	}

	it("Backspace after an image tag takes the whole tag", () => {
		const { editor, ta, options } = setup();
		editor.setText("see [Pasted image] now");
		backspace(ta, 18);
		expect(editor.getText()).toBe("see  now");
		expect(ta.selectionStart).toBe(4);
		expect(options.onDocChange).toHaveBeenCalled();
	});

	it("Delete before an image tag takes the whole tag", () => {
		const { editor, ta } = setup();
		editor.setText("see [Pasted image] now");
		ta.setSelectionRange(4, 4);
		ta.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentForward"
			})
		);
		expect(editor.getText()).toBe("see  now");
		expect(ta.selectionStart).toBe(4);
	});

	it("tag edits prefer the editing engine, falling back to setRangeText", () => {
		const { editor, ta } = setup();
		// No engine here (jsdom): the setRangeText fallback applies.
		const spy = vi.spyOn(ta, "setRangeText");
		editor.setText("see [Pasted image] now");
		backspace(ta, 18);
		expect(spy).toHaveBeenCalledWith("", 4, 18, "end");
		spy.mockClear();
		editor.insertText("[Pasted image] ");
		expect(spy).toHaveBeenCalledWith("[Pasted image] ", 4, 4, "end");
		spy.mockClear();
		expect(editor.exciseMarker("[Pasted image]")).toBe(true);
		expect(spy).toHaveBeenCalledOnce();
		expect(editor.getText()).toBe("see  now");
		spy.mockRestore();
	});

	it("an editing engine takes the delete without the fallback", () => {
		const { editor, ta } = setup();
		const exec = vi.fn(() => true);
		Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
		try {
			const spy = vi.spyOn(ta, "setRangeText");
			editor.setText("see [Pasted image] now");
			backspace(ta, 18);
			expect(exec).toHaveBeenCalledWith("delete");
			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		} finally {
			Object.defineProperty(document, "execCommand", { value: undefined, configurable: true });
		}
	});

	it("Backspace in plain prose keeps the native path", () => {
		const { editor, ta, options } = setup();
		editor.setText("hello");
		(options.onDocChange as ReturnType<typeof vi.fn>).mockClear();
		backspace(ta, 5);
		// Untouched: no manual edit, no change report (the native
		// keystroke owns the deletion from here).
		expect(editor.getText()).toBe("hello");
		expect(options.onDocChange).not.toHaveBeenCalled();
	});
});

describe("image-tag copy/cut roundtrip", () => {
	const TAG = "[Pasted image] ";
	const blob = () => new Blob(["img"], { type: "image/png" });

	function richClipboard(write: ReturnType<typeof vi.fn>) {
		vi.stubGlobal(
			"ClipboardItem",
			class {
				constructor(public data: Record<string, Blob>) {}
			}
		);
		Object.defineProperty(window.navigator, "clipboard", {
			value: { write, writeText: vi.fn() },
			configurable: true
		});
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("leaves selections without image tags to the native handler", () => {
		const take = vi.fn(async () => []);
		const { ta } = setup({ onCopyImageTags: take });
		ta.value = "hello";
		ta.setSelectionRange(0, 5);
		const event = new Event("copy", { bubbles: true, cancelable: true });
		ta.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
		expect(take).not.toHaveBeenCalled();
	});

	it("copy enriches the clipboard and a later exact-text paste rehydrates", async () => {
		const write = vi.fn(async () => {});
		richClipboard(write);
		const take = vi.fn(async () => [blob()]);
		const { ta, options } = setup({ onCopyImageTags: take });
		ta.value = TAG;
		ta.setSelectionRange(0, TAG.length);
		const copy = new Event("copy", { bubbles: true, cancelable: true });
		ta.dispatchEvent(copy);
		expect(copy.defaultPrevented).toBe(true);
		expect(take).toHaveBeenCalledWith([0]);
		await vi.waitFor(() => expect(write).toHaveBeenCalled());
		// New chat, plain-text clipboard (rich item lost): the stash
		// rehydrates the picture instead of landing a dead tag.
		ta.value = "";
		const paste = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent & {
			clipboardData: DataTransfer;
		};
		Object.defineProperty(paste, "clipboardData", {
			value: { files: [], getData: () => TAG }
		});
		ta.dispatchEvent(paste);
		expect(paste.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(options.onImagesPasted).toHaveBeenCalled());
		const files = (options.onImagesPasted as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as File[];
		expect(files.length).toBe(1);
		expect(ta.value).toBe("");
	});

	it("reports precise tag indexes for keyboard range deletions", () => {
		// Middle delete (first of two tags): the host drops index 0,
		// never newest-first. jsdom runs no default deletion, so the
		// test applies the keystroke's own edit between the events.
		const { ta, options } = setup();
		ta.value = "[Pasted image] [Pasted image] ";
		ta.setSelectionRange(0, 15);
		ta.dispatchEvent(
			new InputEvent("beforeinput", {
				bubbles: true,
				cancelable: true,
				inputType: "deleteContentBackward"
			})
		);
		ta.value = "[Pasted image] ";
		ta.dispatchEvent(new Event("input", { bubbles: true }));
		expect(options.onDocChange).toHaveBeenCalledWith("[Pasted image] ", {
			image: [0],
			file: []
		});
	});

	it("cut deletes the range and reports precise tag indexes", async () => {
		const write = vi.fn(async () => {});
		richClipboard(write);
		const take = vi.fn(async () => [blob()]);
		const { ta, options } = setup({ onCopyImageTags: take });
		ta.value = TAG;
		ta.setSelectionRange(0, TAG.length);
		const cut = new Event("cut", { bubbles: true, cancelable: true });
		ta.dispatchEvent(cut);
		expect(cut.defaultPrevented).toBe(true);
		expect(ta.value).toBe("");
		// Middle-cut precision survives the textarea (the input event
		// carries no change ranges): the host drops index 0, not newest.
		await vi.waitFor(() =>
			expect(options.onDocChange).toHaveBeenCalledWith("", { image: [0], file: [] })
		);
	});
});
