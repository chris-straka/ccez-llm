import { describe, it, expect, vi } from "vitest";
import { nativeSaveMarkdown } from "./nativeExport";

describe("nativeSaveMarkdown", () => {
	it("resolves null outside the shell without touching plugins", async () => {
		const dialog = { save: vi.fn() };
		const fs = { writeTextFile: vi.fn() };
		await expect(nativeSaveMarkdown("chat-2026-09-14.md", "# hi", { shell: false, dialog, fs })).resolves.toBeNull();
		expect(dialog.save).not.toHaveBeenCalled();
		expect(fs.writeTextFile).not.toHaveBeenCalled();
	});

	it("saves through the dialog-picked path", async () => {
		const dialog = { save: vi.fn().mockResolvedValue("/tmp/chat.md") };
		const fs = { writeTextFile: vi.fn().mockResolvedValue(undefined) };
		await expect(
			nativeSaveMarkdown("chat-2026-09-14.md", "# hi", { shell: true, dialog, fs })
		).resolves.toBe("saved");
		expect(dialog.save).toHaveBeenCalledWith({
			defaultPath: "chat-2026-09-14.md",
			filters: [{ name: "Markdown", extensions: ["md"] }]
		});
		expect(fs.writeTextFile).toHaveBeenCalledWith("/tmp/chat.md", "# hi");
	});

	it("resolves dismissed on user cancel", async () => {
		const dialog = { save: vi.fn().mockResolvedValue(null) };
		const fs = { writeTextFile: vi.fn() };
		await expect(
			nativeSaveMarkdown("chat-2026-09-14.md", "# hi", { shell: true, dialog, fs })
		).resolves.toBe("dismissed");
		expect(fs.writeTextFile).not.toHaveBeenCalled();
	});

	it("resolves null when a plugin is missing", async () => {
		const fs = { writeTextFile: vi.fn() };
		await expect(
			nativeSaveMarkdown("chat-2026-09-14.md", "# hi", { shell: true, dialog: null, fs })
		).resolves.toBeNull();
	});

	it("propagates write errors like the picker path", async () => {
		const dialog = { save: vi.fn().mockResolvedValue("/tmp/chat.md") };
		const fs = { writeTextFile: vi.fn().mockRejectedValue(new Error("denied")) };
		await expect(
			nativeSaveMarkdown("chat-2026-09-14.md", "# hi", { shell: true, dialog, fs })
		).rejects.toThrow("denied");
	});
});
