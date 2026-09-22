import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	INTERRUPTED_COPY,
	applyTurnFile,
	dismissNativeTurn,
	markTurnInterrupted,
	nativeTurnAvailable,
	nativeTurnConfig,
	nativeRouteFor,
	errorTurnFile,
	releaseNativeTurn,
	resumableKilledTurn,
	type NativeTurnOwnership,
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

describe("resumableKilledTurn", () => {
	const file = (): NativeTurnFile => ({
		turn_id: "t1" as TurnId,
		chat_id: "c1" as ChatId,
		message_id: "r1" as ChatMsgId,
		status: "streaming",
		content: "",
		finished_at: 1
	});

	function idle(messages: ChatMsg[]): ChatState {
		const seeded = stateWithMessages(messages);
		seeded.state.chats[0]!.id = "c1" as ChatId;
		return seeded.state;
	}

	it("resumes a clean placeholder still last after a user message", () => {
		const state = idle([msg("u1", "user", "hi"), msg("r1", "assistant", "")]);
		expect(resumableKilledTurn(state, file())).toBe(true);
	});

	it("refuses errored placeholders (explicit Retry owns those)", () => {
		const state = idle([
			msg("u1", "user", "hi"),
			msg("r1", "assistant", "", "boom")
		]);
		expect(resumableKilledTurn(state, file())).toBe(false);
	});

	it("refuses busy chats, moved placeholders, and missing chats", () => {
		const busy = idle([msg("u1", "user", "hi"), msg("r1", "assistant", "")]);
		busy.sendingChatIds = ["c1" as ChatId];
		expect(resumableKilledTurn(busy, file())).toBe(false);
		// Placeholder no longer last: the thread moved on.
		const moved = idle([
			msg("u1", "user", "hi"),
			msg("r1", "assistant", "old"),
			msg("u2", "user", "new")
		]);
		expect(resumableKilledTurn(moved, file())).toBe(false);
		// Placeholder deleted outright.
		const deleted = idle([msg("u1", "user", "hi")]);
		expect(resumableKilledTurn(deleted, file())).toBe(false);
		// Chat itself gone.
		const gone = idle([msg("u1", "user", "hi"), msg("r1", "assistant", "")]);
		expect(
			resumableKilledTurn(gone, { ...file(), chat_id: "gone" as ChatId })
		).toBe(false);
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

describe("nativeRouteFor", () => {
	const facts = { androidUI: true, shell: true, mock: false, onDevice: false };
	const settings = settingsWith("muse", {
		baseUrl: "https://x.test/v1/",
		apiKey: "k",
		model: "m"
	});

	it("routes text turns with config, images stay TypeScript", () => {
		expect(nativeRouteFor(facts, [], settings)?.model).toBe("m");
		expect(
			nativeRouteFor(facts, [{ kind: "image" } as never], settings)
		).toBeNull();
	});

	it("stays TypeScript off the native path", () => {
		expect(
			nativeRouteFor({ ...facts, shell: false }, [], settings)
		).toBeNull();
		expect(
			nativeRouteFor({ ...facts, mock: true }, [], settings)
		).toBeNull();
	});
});

describe("errorTurnFile", () => {
	it("settles an unpollable turn as a failed reply", () => {
		const file = errorTurnFile(
			"t" as TurnId,
			"c" as ChatId,
			"m" as ChatMsgId
		);
		expect(file).toMatchObject({
			turn_id: "t",
			chat_id: "c",
			message_id: "m",
			status: "error",
			content: "",
			error: "Reply failed."
		});
		expect(file.finished_at).toBeGreaterThan(0);
	});
});

describe("releaseNativeTurn", () => {
	function owned(): NativeTurnOwnership {
		return {
			turns: new Map([
				["t1" as TurnId, { chatId: "c1" as ChatId, replyId: "r1" as ChatMsgId }],
				["t2" as TurnId, { chatId: "c1" as ChatId, replyId: "r2" as ChatMsgId }]
			]),
			texts: new Map([["t1" as TurnId, "hi"]]),
			fetching: new Set(["c1" as ChatId]),
			live: new Set(["c1" as ChatId])
		};
	}

	it("drops the turn but holds liveness while a sibling owns the chat", () => {
		const own = owned();
		releaseNativeTurn(own, "t1" as TurnId, "c1" as ChatId);
		expect(own.turns.has("t1" as TurnId)).toBe(false);
		expect(own.texts.has("t1" as TurnId)).toBe(false);
		expect(own.fetching.has("c1" as ChatId)).toBe(false);
		expect(own.live.has("c1" as ChatId)).toBe(true);
	});

	it("stands the chat down with its last turn", () => {
		const own = owned();
		releaseNativeTurn(own, "t1" as TurnId, "c1" as ChatId);
		releaseNativeTurn(own, "t2" as TurnId, "c1" as ChatId);
		expect(own.turns.size).toBe(0);
		expect(own.live.has("c1" as ChatId)).toBe(false);
	});
});
