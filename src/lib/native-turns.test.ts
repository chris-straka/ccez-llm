import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
	activeChat,
	createChatState,
	type ChatId,
	type ChatMsgId,
	type ChatState
} from "./chat";
import {
	NativeTurns,
	type NativeRouteFacts,
	type TurnListen
} from "./native-turns.svelte";
import {
	defaultSettings,
	type AppSettings,
	type KeyValueStore
} from "./settings";
import { INTERRUPTED_COPY, type NativeTurnFile, type TurnId } from "./turns";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

function memoryStore(): KeyValueStore {
	const data = new Map<string, string>();
	return {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
}

function keyedSettings(): AppSettings {
	const settings = defaultSettings();
	const conf = settings.providers[settings.activeProviderId];
	if (!conf) throw new Error("no active provider");
	conf.apiKey = "sk-test";
	return settings;
}

/** Invoke stub: per-command answers, every call recorded. */
function stubInvoke(answers: Record<string, (args: unknown) => unknown> = {}): {
	calls: { cmd: string; args: unknown }[];
} {
	const calls: { cmd: string; args: unknown }[] = [];
	mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
		calls.push({ cmd, args });
		const answer = answers[cmd];
		return answer ? answer(args) : true;
	});
	return { calls };
}

function harness(
	opts: { facts?: Partial<NativeRouteFacts>; visible?: boolean } = {}
) {
	const state: ChatState = createChatState(memoryStore());
	const calls = {
		afterSend: [] as ChatId[],
		tokens: [] as ChatId[],
		buzz: [] as boolean[],
		dismissed: 0,
		scrolls: 0
	};
	const settings = keyedSettings();
	const turns = new NativeTurns({
		getChatState: () => state,
		getSettings: () => settings,
		routeFacts: () => ({
			androidUI: true,
			shell: true,
			mock: false,
			onDevice: false,
			...opts.facts
		}),
		systemFor: () => "system",
		isShell: () => opts.facts?.shell ?? true,
		isVisible: () => opts.visible ?? true,
		stuckToBottom: () => true,
		scrollAfterRender: () => void calls.scrolls++,
		afterSend: (id) => void calls.afterSend.push(id),
		markToken: (id) => void calls.tokens.push(id),
		buzzFirst: (fg) => void calls.buzz.push(fg),
		dismissReplyNotification: () => void calls.dismissed++
	});
	return { state, turns, calls };
}

function startArgs(calls: { cmd: string; args: unknown }[]): {
	turn_id: TurnId;
	chat_id: ChatId;
	message_id: ChatMsgId;
	system: string;
	messages: { role: string; content: string }[];
} {
	const start = calls.find((c) => c.cmd === "turn_start");
	if (!start) throw new Error("no turn_start");
	return (start.args as { req: ReturnType<typeof startArgs> }).req;
}

async function sendOne(h: ReturnType<typeof harness>, text = "Hallo") {
	const config = h.turns.route([]);
	if (!config) throw new Error("no route");
	await h.turns.send({
		baked: text,
		kept: [],
		pasteFolds: [],
		config,
		system: "sys"
	});
}

beforeEach(() => {
	mockInvoke.mockReset();
});

describe("NativeTurns.route", () => {
	it("routes text turns on the Android shell", () => {
		expect(harness().turns.route([])).not.toBeNull();
	});

	it("stays on the TypeScript engine off-shell, mocked, on-device, or with images", () => {
		expect(harness({ facts: { shell: false } }).turns.route([])).toBeNull();
		expect(harness({ facts: { mock: true } }).turns.route([])).toBeNull();
		expect(harness({ facts: { onDevice: true } }).turns.route([])).toBeNull();
		expect(
			harness().turns.route([
				{ kind: "image", name: "a.png", dataUrl: "data:" } as never
			])
		).toBeNull();
	});
});

describe("NativeTurns send → stream → done", () => {
	it("opens a placeholder and starts the runner with its history", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		await sendOne(h);
		const chat = activeChat(h.state);
		expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		const req = startArgs(calls);
		expect(req.chat_id).toBe(chat.id);
		expect(req.message_id).toBe(chat.messages[1]?.id);
		expect(req.system).toBe("sys");
		expect(req.messages).toEqual([{ role: "user", content: "Hallo" }]);
		expect(h.turns.live.has(chat.id)).toBe(true);
		expect(h.state.sendingChatIds).toEqual([chat.id]);
		expect(h.calls.scrolls).toBe(1);
	});

	it("streams tokens wholesale, buzzes once, and tracks fetch/retry", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		await sendOne(h);
		const { turn_id } = startArgs(calls);
		const chat = activeChat(h.state);
		h.turns.onToken({ turn_id, token: "Gu" });
		const first = chat.messages[1];
		h.turns.onToken({ turn_id, token: "ten" });
		expect(chat.messages[1]?.content).toBe("Guten");
		expect(chat.messages[1]).not.toBe(first);
		expect(h.calls.buzz).toEqual([true]);
		expect(h.calls.tokens).toHaveLength(2);
		h.turns.onFetch({ turn_id, phase: "start" } as never);
		expect(h.turns.fetching.has(chat.id)).toBe(true);
		h.turns.onFetch({ turn_id, phase: "end" } as never);
		expect(h.turns.fetching.has(chat.id)).toBe(false);
		h.turns.onRetry({ turn_id, token: "" });
		expect(chat.messages[1]?.content).toBe("");
		expect(h.state.replyStartedChatIds).toEqual([]);
	});

	it("done renders the file, settles, marks seen, and runs the tail", async () => {
		const { calls } = stubInvoke({
			turn_poll: (args) => {
				const req = startArgs(calls);
				expect((args as { turnId: TurnId }).turnId).toBe(req.turn_id);
				return {
					turn_id: req.turn_id,
					chat_id: req.chat_id,
					message_id: req.message_id,
					status: "done",
					content: "Hallo zurück",
					finished_at: 1
				} satisfies NativeTurnFile;
			}
		});
		const h = harness();
		await sendOne(h);
		const { turn_id, chat_id } = startArgs(calls);
		await h.turns.onDone({ turn_id } as never);
		expect(activeChat(h.state).messages[1]?.content).toBe("Hallo zurück");
		expect(h.state.sendingChatIds).toEqual([]);
		expect(h.turns.live.has(chat_id)).toBe(false);
		expect(h.turns.turns.size).toBe(0);
		expect(calls.map((c) => c.cmd)).toEqual([
			"turn_start",
			"turn_poll",
			"turn_seen",
			"turn_dismiss"
		]);
		expect(h.calls.dismissed).toBe(1);
		expect(h.calls.afterSend).toEqual([chat_id]);
	});

	it("a backgrounded done never marks the turn seen", async () => {
		const { calls } = stubInvoke({
			turn_poll: () => {
				const req = startArgs(calls);
				return { ...req, status: "done", content: "x", finished_at: 1 };
			}
		});
		const h = harness({ visible: false });
		await sendOne(h);
		await h.turns.onDone({ turn_id: startArgs(calls).turn_id } as never);
		expect(calls.map((c) => c.cmd)).not.toContain("turn_seen");
		expect(h.calls.dismissed).toBe(0);
	});

	it("an unpollable done still settles as a failed reply", async () => {
		const { calls } = stubInvoke({
			turn_poll: () => {
				throw new Error("gone");
			}
		});
		const h = harness();
		await sendOne(h);
		await h.turns.onDone({ turn_id: startArgs(calls).turn_id } as never);
		expect(activeChat(h.state).messages[1]?.error).toBe("Reply failed.");
		expect(h.state.sendingChatIds).toEqual([]);
	});

	it("a late done for an unowned turn only dismisses its file", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		await h.turns.onDone({ turn_id: "stray" as TurnId } as never);
		expect(calls.map((c) => c.cmd)).toEqual(["turn_dismiss"]);
		expect(h.calls.afterSend).toEqual([]);
	});

	it("a failed spawn settles as a Retry-able error", async () => {
		stubInvoke({
			turn_start: () => {
				throw new Error("spawn");
			}
		});
		const h = harness();
		await sendOne(h);
		const chat = activeChat(h.state);
		expect(chat.messages[1]?.error).toBe("Couldn't start the reply.");
		expect(h.state.sendingChatIds).toEqual([]);
		expect(h.turns.live.size).toBe(0);
		expect(h.calls.afterSend).toEqual([chat.id]);
	});
});

describe("NativeTurns.resend", () => {
	it("reopens a placeholder under the last user message", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		const chat = activeChat(h.state);
		chat.messages = [
			{
				id: "u1" as ChatMsgId,
				role: "user",
				content: "Noch mal",
				usage: null,
				error: null
			}
		];
		const config = h.turns.route([]);
		if (!config) throw new Error("no route");
		await h.turns.resend(config);
		expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(startArgs(calls).system).toBe("system");
	});

	it("no-ops when the last message is not the user's", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		const config = h.turns.route([]);
		if (!config) throw new Error("no route");
		await h.turns.resend(config);
		expect(calls).toEqual([]);
	});
});

describe("NativeTurns.stopChat", () => {
	it("stops the chat's turns, releases them, and settles the send", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		await sendOne(h);
		const chat = activeChat(h.state);
		await h.turns.stopChat(chat.id);
		expect(calls.map((c) => c.cmd)).toEqual(["turn_start", "turn_stop"]);
		expect(h.turns.live.has(chat.id)).toBe(false);
		expect(h.state.sendingChatIds).toEqual([]);
	});
});

describe("NativeTurns.reconcile", () => {
	function placeholderChat(h: ReturnType<typeof harness>, sending: boolean) {
		const chat = activeChat(h.state);
		chat.messages = [
			{
				id: "u1" as ChatMsgId,
				role: "user",
				content: "Hallo",
				usage: null,
				error: null
			},
			{
				id: "a1" as ChatMsgId,
				role: "assistant",
				content: "",
				usage: null,
				error: null
			}
		];
		if (sending) h.state.sendingChatIds = [chat.id];
		return chat;
	}

	function file(chatId: ChatId, status: string): NativeTurnFile {
		return {
			turn_id: "old" as TurnId,
			chat_id: chatId,
			message_id: "a1" as ChatMsgId,
			status,
			content: "Fertig",
			finished_at: 1
		};
	}

	it("does nothing outside the shell", async () => {
		const { calls } = stubInvoke();
		await harness({ facts: { shell: false } }).turns.reconcile();
		expect(calls).toEqual([]);
	});

	it("renders a finished file and runs the tail for a waiting chat", async () => {
		const h = harness();
		const chat = placeholderChat(h, true);
		const { calls } = stubInvoke({ turn_scan: () => [file(chat.id, "done")] });
		await h.turns.reconcile();
		expect(chat.messages[1]?.content).toBe("Fertig");
		expect(h.state.sendingChatIds).toEqual([]);
		expect(h.calls.afterSend).toEqual([chat.id]);
		expect(calls.map((c) => c.cmd)).toEqual(["turn_scan", "turn_dismiss"]);
	});

	it("a finished file for an idle chat renders without the tail", async () => {
		const h = harness();
		const chat = placeholderChat(h, false);
		stubInvoke({ turn_scan: () => [file(chat.id, "done")] });
		await h.turns.reconcile();
		expect(chat.messages[1]?.content).toBe("Fertig");
		expect(h.calls.afterSend).toEqual([]);
	});

	it("restarts a turn a dead process left streaming", async () => {
		const h = harness();
		const chat = placeholderChat(h, false);
		const { calls } = stubInvoke({
			turn_scan: () => [file(chat.id, "streaming")]
		});
		await h.turns.reconcile();
		const req = startArgs(calls);
		expect(req.message_id).toBe("a1");
		expect(req.turn_id).not.toBe("old");
		expect(h.turns.live.has(chat.id)).toBe(true);
		expect(h.state.sendingChatIds).toEqual([chat.id]);
		expect(calls.map((c) => c.cmd)).toEqual([
			"turn_scan",
			"turn_start",
			"turn_dismiss"
		]);
	});

	it("overlapping scans resume a dead turn once, never mark it interrupted", async () => {
		const h = harness();
		const chat = placeholderChat(h, false);
		let dismissed = false;
		const { calls } = stubInvoke({
			turn_scan: () => (dismissed ? [] : [file(chat.id, "streaming")]),
			turn_dismiss: () => {
				dismissed = true;
				return true;
			}
		});
		await Promise.all([h.turns.reconcile(), h.turns.reconcile()]);
		expect(calls.filter((c) => c.cmd === "turn_start")).toHaveLength(1);
		expect(chat.messages[1]?.error).toBeNull();
		expect(h.state.sendingChatIds).toEqual([chat.id]);
		expect(h.calls.afterSend).toEqual([]);
	});

	it("marks a dead turn interrupted when it cannot be rebuilt", async () => {
		const h = harness({ facts: { mock: true } });
		const chat = placeholderChat(h, false);
		stubInvoke({ turn_scan: () => [file(chat.id, "streaming")] });
		await h.turns.reconcile();
		expect(chat.messages[1]?.error).toBe(INTERRUPTED_COPY);
	});

	it("skips streaming files a live listener still owns", async () => {
		const { calls } = stubInvoke();
		const h = harness();
		await sendOne(h);
		const req = startArgs(calls);
		mockInvoke.mockImplementation(async (cmd: string) => {
			calls.push({ cmd, args: undefined });
			return cmd === "turn_scan"
				? [
						{
							...file(req.chat_id, "streaming"),
							turn_id: req.turn_id,
							message_id: req.message_id
						}
					]
				: true;
		});
		await h.turns.reconcile();
		expect(calls.map((c) => c.cmd)).toEqual(["turn_start", "turn_scan"]);
		expect(h.turns.live.has(req.chat_id)).toBe(true);
	});
});

describe("NativeTurns.listen", () => {
	it("subscribes the four turn events in the shell and tears them down", async () => {
		const offs: string[] = [];
		const events: string[] = [];
		const listen: TurnListen = async (event) => {
			events.push(event);
			return () => void offs.push(event);
		};
		const stop = harness().turns.listen(listen);
		await Promise.resolve();
		await Promise.resolve();
		expect(events).toEqual([
			"turn-token",
			"turn-fetch",
			"turn-retry",
			"turn-done"
		]);
		stop();
		expect(offs).toEqual(events);
	});

	it("subscribes nothing outside the shell", () => {
		let subscribed = 0;
		const listen: TurnListen = async () => {
			subscribed++;
			return () => {};
		};
		harness({ facts: { shell: false } }).turns.listen(listen);
		expect(subscribed).toBe(0);
	});
});
