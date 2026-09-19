import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	nativeDictateFallback,
	friendlyNativeDictateError,
	startNativeDictation
} from "./nativeDictate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
	vi.useRealTimers();
	mockInvoke.mockReset();
	mockListen.mockReset();
	// No shell outside Tauri: every bridge call rejects, like the real
	// invoke does in browsers and tests.
	mockInvoke.mockRejectedValue(new Error("no bridge"));
	mockListen.mockResolvedValue(() => {});
});

describe("nativeDictateFallback", () => {
	it("falls back on unsupported platforms and missing bridges", () => {
		expect(
			nativeDictateFallback(
				"native dictation is not supported on this platform"
			)
		).toBe(true);
		expect(nativeDictateFallback("native dictation requires Android")).toBe(
			true
		);
		expect(nativeDictateFallback("dictation requires Linux")).toBe(true);
		expect(
			nativeDictateFallback(
				"native dictation is not supported on this platform: Linux has no OS speech-recognition API (install `nerd-dictation` for offline dictation, or use browser dictation)"
			)
		).toBe(true);
		expect(nativeDictateFallback("dictation bridge not initialized")).toBe(
			true
		);
		expect(nativeDictateFallback("no recognizer available")).toBe(true);
	});

	it("treats denials and busy states as real errors", () => {
		expect(nativeDictateFallback("dictate_start not allowed")).toBe(false);
		expect(nativeDictateFallback("recognizer busy")).toBe(false);
		expect(nativeDictateFallback("Mic permission denied")).toBe(false);
	});
});

describe("friendlyNativeDictateError", () => {
	it("maps capability denials to a rebuild hint", () => {
		expect(friendlyNativeDictateError("dictate_start not allowed.")).toContain(
			"rebuild"
		);
	});

	it("maps busy and permission failures to retry hints", () => {
		expect(friendlyNativeDictateError("recognizer busy")).toContain("busy");
		expect(friendlyNativeDictateError("Mic permission denied")).toContain(
			"Mic permission"
		);
	});

	it("maps empty results to the no-speech hint", () => {
		expect(friendlyNativeDictateError("no-speech")).toContain(
			"Didn't catch anything"
		);
	});
});

describe("startNativeDictation", () => {
	it("falls back when there is no event bridge", async () => {
		mockListen.mockRejectedValue(new Error("no bridge"));
		await expect(startNativeDictation("en-US")).resolves.toEqual({
			kind: "fallback"
		});
	});

	it("falls back when the platform has no recognizer", async () => {
		mockInvoke.mockImplementation((cmd) => {
			if (cmd === "dictate_start")
				return Promise.reject(new Error("not supported on this platform"));
			return Promise.resolve();
		});
		await expect(startNativeDictation("en-US")).resolves.toEqual({
			kind: "fallback"
		});
	});

	it("surfaces denials as display-ready errors", async () => {
		mockInvoke.mockImplementation((cmd) => {
			if (cmd === "dictate_start")
				return Promise.reject(new Error("dictate_start not allowed"));
			return Promise.resolve();
		});
		const outcome = await startNativeDictation("en-US");
		expect(outcome.kind).toBe("error");
		if (outcome.kind === "error") expect(outcome.message).toContain("rebuild");
	});

	it("starts listening and routes final transcripts", async () => {
		type ResultHandler = (event: {
			payload: { transcript: string; final: boolean };
		}) => void;
		let handler: ResultHandler = () => {};
		mockListen.mockImplementation((_event, cb) => {
			handler = cb as unknown as ResultHandler;
			return Promise.resolve(() => {});
		});
		mockInvoke.mockResolvedValue(undefined);
		const finals: string[] = [];
		const partials: string[] = [];
		const outcome = await startNativeDictation("en-US", {
			onFinal: (t) => finals.push(t),
			onPartial: (t) => partials.push(t)
		});
		expect(outcome.kind).toBe("started");
		handler({ payload: { transcript: "hel", final: false } });
		handler({ payload: { transcript: "hello", final: true } });
		expect(partials).toEqual(["hel"]);
		expect(finals).toEqual(["hello"]);
		if (outcome.kind === "started") outcome.stop();
		expect(mockInvoke).toHaveBeenCalledWith("dictate_stop");
	});

	it("reports empty finals as no-speech errors", async () => {
		type ResultHandler = (event: {
			payload: { transcript: string; final: boolean };
		}) => void;
		let handler: ResultHandler = () => {};
		mockListen.mockImplementation((_event, cb) => {
			handler = cb as unknown as ResultHandler;
			return Promise.resolve(() => {});
		});
		mockInvoke.mockResolvedValue(undefined);
		const errors: string[] = [];
		const outcome = await startNativeDictation("en-US", {
			onError: (m) => errors.push(m)
		});
		expect(outcome.kind).toBe("started");
		handler({ payload: { transcript: "  ", final: true } });
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Didn't catch anything");
		if (outcome.kind === "started") outcome.stop();
	});
});
