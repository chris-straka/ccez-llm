import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	parseCcezDeepLink,
	isSummonHotkey,
	studySheetMarkdown,
	sanitizeFileStem,
	studySheetFilename,
	sheetTitle,
	shareStudySheet,
	printStudySheet,
	requestAreaPhoto,
	listenAreaPickRequested,
	listenAreaPhotoRequest,
	answerAreaPhoto,
	desktopSleepBlock,
	desktopSleepUnblock,
	exportStudySheet,
	shareOutcomeToast,
	type StudyLine
} from "./desktop";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(),
	emit: vi.fn(),
	emitTo: vi.fn()
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
	mockInvoke.mockReset();
	// No shell outside Tauri: every bridge call rejects, like the real
	// invoke does in browsers and tests.
	mockInvoke.mockRejectedValue(new Error("no bridge"));
});

describe("parseCcezDeepLink", () => {
	it("reads the path form", () => {
		expect(parseCcezDeepLink("ccez://chat/abc123")).toEqual({
			kind: "open-chat",
			chatId: "abc123"
		});
	});

	it("reads the query form with decoding", () => {
		expect(parseCcezDeepLink("ccez://chat?id=hello%20world")).toEqual({
			kind: "open-chat",
			chatId: "hello world"
		});
	});

	it("reads new-chat", () => {
		expect(parseCcezDeepLink("ccez://new")).toEqual({ kind: "new-chat" });
	});

	it("rejects foreign input without throwing", () => {
		for (const bad of [
			"https://chat/abc",
			"ccez://chat/",
			"ccez://chat",
			"ccez://chat/a/b",
			"ccez://chat/../x",
			"ccez://unknown",
			"ccez://new/extra",
			"",
			"ccez://"
		]) {
			expect(parseCcezDeepLink(bad), bad).toBeNull();
		}
	});
});

describe("isSummonHotkey", () => {
	const base = {
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		code: ""
	};
	it("matches Cmd/Ctrl+Shift+Space", () => {
		expect(
			isSummonHotkey({ ...base, metaKey: true, shiftKey: true, code: "Space" })
		).toBe(true);
		expect(
			isSummonHotkey({ ...base, ctrlKey: true, shiftKey: true, code: "Space" })
		).toBe(true);
	});
	it("rejects missing modifiers and other keys", () => {
		expect(isSummonHotkey({ ...base, metaKey: true, code: "Space" })).toBe(
			false
		);
		expect(
			isSummonHotkey({ ...base, metaKey: true, shiftKey: true, code: "KeyS" })
		).toBe(false);
		expect(
			isSummonHotkey({
				...base,
				metaKey: true,
				shiftKey: true,
				altKey: true,
				code: "Space"
			})
		).toBe(false);
	});
});

describe("studySheetMarkdown", () => {
	const lines: StudyLine[] = [
		{ role: "user", content: "Explain être" },
		{ role: "assistant", content: "Être means to be." },
		{ role: "user", content: "   " }
	];

	it("renders roles, skips empties, counts messages (backend mirror)", () => {
		const md = studySheetMarkdown("French verbs", lines);
		expect(md).toContain("# French verbs");
		expect(md).toContain("## You\n\nExplain être");
		expect(md).toContain("## Ccez\n\nÊtre means to be.");
		expect(md).toContain("2 messages");
	});

	it("falls back to Untitled chat and truncates giant histories", () => {
		expect(
			studySheetMarkdown("   ", [{ role: "user", content: "hi" }])
		).toContain("# Untitled chat");
		const big = studySheetMarkdown("t", [
			{ role: "user", content: "x".repeat(200_010) }
		]);
		expect(big.length).toBeLessThanOrEqual(200_100);
		expect(big).toContain("truncated");
	});
});

describe("sheetTitle", () => {
	it("uses the first non-empty line, capped at 60 chars", () => {
		expect(
			sheetTitle([{ role: "user", content: "  \nExplain être\nmore" }])
		).toBe("Explain être");
		expect(sheetTitle([{ role: "user", content: "x".repeat(70) }])).toBe(
			`${"x".repeat(60)}…`
		);
		expect(sheetTitle([{ role: "user", content: "   " }])).toBe(
			"Untitled chat"
		);
		expect(sheetTitle([])).toBe("Untitled chat");
	});
});

describe("sanitizeFileStem / studySheetFilename", () => {
	it("collapses runs, lowercases, falls back", () => {
		expect(sanitizeFileStem("French verbs: être!")).toBe("french-verbs-tre");
		expect(sanitizeFileStem("???")).toBe("chat");
		expect(studySheetFilename("French verbs")).toBe(
			"french-verbs-study-sheet.md"
		);
	});
});

describe("shell wrappers without a bridge", () => {
	it("sleep block resolves null, unblock and export no-op cleanly", async () => {
		await expect(desktopSleepBlock("speech")).resolves.toBeNull();
		await expect(desktopSleepUnblock(1)).resolves.toBeUndefined();
		await expect(
			exportStudySheet("t", [{ role: "user", content: "hi" }])
		).resolves.toBeNull();
	});

	it("print returns false without a DOM printer", () => {
		expect(printStudySheet()).toBe(false);
	});
});

describe("shareStudySheet", () => {
	it("rides the OS sheet when available", async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { share });
		await expect(shareStudySheet("t", "body")).resolves.toBe("shared");
		expect(share).toHaveBeenCalledWith({ title: "t", text: "body" });
		vi.unstubAllGlobals();
	});

	it("treats user-cancel as done, not a fallback", async () => {
		const cancelled = new Error("cancelled");
		cancelled.name = "AbortError";
		vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(cancelled) });
		await expect(shareStudySheet("t", "body")).resolves.toBe("shared");
		vi.unstubAllGlobals();
	});

	it("is unavailable with no share, clipboard, or DOM", async () => {
		vi.stubGlobal("navigator", {});
		await expect(shareStudySheet("t", "body")).resolves.toBe("unavailable");
		vi.unstubAllGlobals();
	});
});

describe("shareOutcomeToast", () => {
	it("names where the sheet landed", () => {
		expect(shareOutcomeToast("shared", "/tmp/a.md")).toEqual({
			error: false,
			text: "Study sheet shared (/tmp/a.md)"
		});
		expect(shareOutcomeToast("shared", null)).toEqual({
			error: false,
			text: "Study sheet shared"
		});
		expect(shareOutcomeToast("copied", null).error).toBe(false);
		expect(shareOutcomeToast("downloaded", null).error).toBe(false);
		expect(shareOutcomeToast("unavailable", null)).toEqual({
			error: true,
			text: "Sharing is unavailable here"
		});
	});
});

describe("area photo handoff", () => {
	it("stays quiet outside the shell", async () => {
		const noop = (): void => {};
		await expect(requestAreaPhoto(10)).resolves.toBe(null);
		expect(await listenAreaPickRequested(noop)).toBe(null);
		expect(await listenAreaPhotoRequest(noop)).toBe(null);
		await expect(answerAreaPhoto("data:image/png;base64,x")).resolves.toBeUndefined();
	});
});
