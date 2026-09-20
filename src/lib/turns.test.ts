import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	INTERRUPTED_COPY,
	applyTurnFile,
	dismissNativeTurn,
	markTurnInterrupted,
	nativeTurnAvailable,
	nativeTurnConfig,
	type TurnId,
	pollNativeTurn,
	scanNativeTurns,
	seenNativeTurn,
	startNativeTurn,
	stopNativeTurn,
	turnHistory,
	type NativeTurnFile
} from "./turns";
import {
	createChatState,
	type ChatId,
	type ChatMsgId,
	type ChatMsg,
	type ChatState
} from "./chat";
import type { AppSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

afterEach(() => {
	vi.resetAllMocks();
});

function settingsWith(
	provider: string,
	conf: { baseUrl: string; apiKey: string; model: string }
): AppSettings {
	return {
		activeProviderId: provider,
		providers: { [provider]: { ...conf, models: [] } },
		thinking: {}
	} as unknown as AppSettings;
}

function stateWithMessages(messages: ChatMsg[]): {
	state: ChatState;
	store: { data: Map<string, string>; getItem(k: string): string | null; setItem(k: string, v: string): void };
} {
	const store = {
		data: new Map<string, string>(),
		getItem(k: string) {
			return this.data.get(k) ?? null;
		},
		setItem(k: string, v: string) {
			void this.data.set(k, v);
		}
	};
	const state = createChatState(store);
	state.chats[0]!.messages = messages;
	return { state, store };
}

function msg(
	id: string,
	role: "user" | "assistant",
	content: string,
	error: string | null = null
): ChatMsg {
	return { id: id as ChatMsg["id"], role, content, usage: null, error };
}

describe("nativeTurnAvailable", () => {
	it("takes the native path only on Android shell network text turns", () => {
		const base = {
			androidUI: true,
			shell: true,
			mock: false,
			onDevice: false,
			hasImages: false
		};
		expect(nativeTurnAvailable(base)).toBe(true);
		expect(nativeTurnAvailable({ ...base, androidUI: false })).toBe(false);
		expect(nativeTurnAvailable({ ...base, shell: false })).toBe(false);
		expect(nativeTurnAvailable({ ...base, mock: true })).toBe(false);
		expect(nativeTurnAvailable({ ...base, onDevice: true })).toBe(false);
		expect(nativeTurnAvailable({ ...base, hasImages: true })).toBe(false);
	});
});

describe("nativeTurnConfig", () => {
	it("snapshots config plus thinking fields for a keyed provider", () => {
		const settings = settingsWith("muse", {
			baseUrl: "https://x.test/v1/",
			apiKey: "k",
			model: "m"
		});
		const config = nativeTurnConfig(settings);
		expect(config).toMatchObject({
			baseUrl: "https://x.test/v1/",
			apiKey: "k",
			model: "m"
		});
		// Same tables the TypeScript engine sends (medium default).
		expect(config?.extraBody).toEqual({ reasoning_effort: "medium" });
	});

	it("refuses a blank key and an unknown provider", () => {
		const blank = settingsWith("muse", {
			baseUrl: "https://x.test/v1/",
			apiKey: "  ",
			model: "m"
		});
		expect(nativeTurnConfig(blank)).toBeNull();
		const unknown = settingsWith("nope", {
			baseUrl: "https://x.test/v1/",
			apiKey: "k",
			model: "m"
		});
		expect(nativeTurnConfig(unknown)).toBeNull();
	});
});

describe("turnHistory", () => {
	it("skips failed replies and keeps text", () => {
		expect(
			turnHistory([
				msg("u1", "user", "hi"),
				msg("a1", "assistant", "old", "Load failed"),
				msg("a2", "assistant", "kept")
			])
		).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "kept" }
		]);
	});
});

describe("applyTurnFile", () => {
	const file = (
		status: string,
		content = "",
		error?: string
	): NativeTurnFile => ({
		turn_id: "t1" as TurnId,
		chat_id: "c1" as ChatId,
		message_id: "r1" as ChatMsgId,
		status,
		content,
		error,
		finished_at: 1
	});

	function stateWithPlaceholder(): ReturnType<typeof stateWithMessages> {
		const seeded = stateWithMessages([
			msg("u1", "user", "hi"),
			msg("r1", "assistant", "")
		]);
		seeded.state.chats[0]!.id = "c1" as ChatId;
		return seeded;
	}

	it("fills a finished turn and reports streaming hands-off", () => {
		const seeded = stateWithPlaceholder();
		expect(
			applyTurnFile(seeded.state, file("done", "hello", undefined), seeded.store)
		).toBe("applied");
		expect(seeded.state.chats[0]!.messages[1]).toMatchObject({
			content: "hello",
			error: null
		});
		expect(applyTurnFile(seeded.state, file("streaming"), seeded.store)).toBe(
			"streaming"
		);
	});

	it("fills errors for the existing Retry UI", () => {
		const seeded = stateWithPlaceholder();
		expect(
			applyTurnFile(seeded.state, file("error", "", "boom"), seeded.store)
		).toBe("applied");
		expect(seeded.state.chats[0]!.messages[1]?.error).toBe("boom");
	});

	it("reports missing placeholders and chats", () => {
		const seeded = stateWithPlaceholder();
		expect(
			applyTurnFile(
				seeded.state,
				{ ...file("done", "x"), message_id: "gone" as ChatMsgId },
				seeded.store
			)
		).toBe("missing");
		expect(
			applyTurnFile(
				seeded.state,
				{ ...file("done", "x"), chat_id: "gone" as ChatId },
				seeded.store
			)
		).toBe("missing");
	});
});

describe("markTurnInterrupted", () => {
	it("fills the interrupted copy on the placeholder", () => {
		const seeded = stateWithMessages([
			msg("u1", "user", "hi"),
			msg("r1", "assistant", "")
		]);
		seeded.state.chats[0]!.id = "c1" as ChatId;
		const file: NativeTurnFile = {
			turn_id: "t1" as TurnId,
			chat_id: "c1" as ChatId,
			message_id: "r1" as ChatMsgId,
			status: "streaming",
			content: "",
			finished_at: 1
		};
		expect(markTurnInterrupted(seeded.state, file, seeded.store)).toBe(true);
		expect(seeded.state.chats[0]!.messages[1]?.error).toBe(INTERRUPTED_COPY);
	});

	it("skips deleted placeholders", () => {
		const seeded = stateWithMessages([msg("u1", "user", "hi")]);
		seeded.state.chats[0]!.id = "c1" as ChatId;
		const file: NativeTurnFile = {
			turn_id: "t1" as TurnId,
			chat_id: "c1" as ChatId,
			message_id: "gone" as ChatMsgId,
			status: "streaming",
			content: "",
			finished_at: 1
		};
		expect(markTurnInterrupted(seeded.state, file, seeded.store)).toBe(false);
	});
});

describe("invoke wrappers", () => {
	it("maps camelCase to the Rust snake_case contract", async () => {
		mockInvoke.mockResolvedValue("t1");
		await expect(
			startNativeTurn({
				turn_id: "t1" as TurnId,
				chat_id: "c1" as ChatId,
				message_id: "r1" as ChatMsgId,
				baseUrl: "https://x.test/v1/",
				apiKey: "k",
				model: "m",
				extraBody: {},
				system: "sys",
				messages: [{ role: "user", content: "hi" }]
			})
		).resolves.toBe("t1");
		expect(mockInvoke).toHaveBeenCalledWith("turn_start", {
			req: {
				turn_id: "t1" as TurnId,
				chat_id: "c1" as ChatId,
				message_id: "r1" as ChatMsgId,
				base_url: "https://x.test/v1/",
				api_key: "k",
				model: "m",
				extra_body: {},
				system: "sys",
				messages: [{ role: "user", content: "hi" }]
			}
		});
	});

	it("passes poll/scan/stop/seen/dismiss through", async () => {
		const tid = "t1" as TurnId;
		mockInvoke.mockResolvedValueOnce({ turn_id: "t1" });
		await pollNativeTurn(tid);
		expect(mockInvoke).toHaveBeenCalledWith("turn_poll", { turnId: "t1" });
		mockInvoke.mockResolvedValueOnce([]);
		await scanNativeTurns();
		expect(mockInvoke).toHaveBeenCalledWith("turn_scan");
		mockInvoke.mockResolvedValueOnce(true);
		await stopNativeTurn(tid);
		expect(mockInvoke).toHaveBeenCalledWith("turn_stop", { turnId: "t1" });
		mockInvoke.mockResolvedValueOnce(true);
		await seenNativeTurn(tid);
		expect(mockInvoke).toHaveBeenCalledWith("turn_seen", { turnId: "t1" });
		mockInvoke.mockResolvedValueOnce(true);
		await dismissNativeTurn(tid);
		expect(mockInvoke).toHaveBeenCalledWith("turn_dismiss", { turnId: "t1" });
	});
});
