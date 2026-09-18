import { describe, it, expect } from "vitest";
import {
	createChatState,
	activeChat,
	abortSend,
	newChat,
	newChatMsgId,
	selectChat,
	setChatReplyLang,
	chatVoiceReadback,
	setChatVoice,
	deleteChat,
	deleteAllChats,
	deleteMessage,
	stageMessage,
	branchFrom,
	truncateToMessage,
	editMessageContent,
	dismissFailedAssistant,
	takeBackLastReply,
	resendLast,
	tokenTotal,
	tokenSplit,
	formatTokens,
	waypoints,
	waypointLabel,
	sendMessage,
	setPasteFold,
	resolveSendCompletion,
	apiContent,
	buildApiMessages,
	visibleMessageCount,
	isSending,
	hasReplyStarted,
	type ChatState
} from "./chat";
import type { ChatProvider, ChatResult } from "./providers/types";
import { MockProvider } from "./providers/mock";

function freshStore() {
	return {
		data: new Map<string, string>(),
		getItem(k: string) {
			return this.data.get(k) ?? null;
		},
		setItem(k: string, v: string) {
			void this.data.set(k, v);
		}
	};
}

type Store = ReturnType<typeof freshStore>;

function stateWith(store: Store): { state: ChatState; store: Store } {
	return { state: createChatState(store), store };
}

function scriptedProvider(script: string[], usage = { prompt: 1, completion: 1, total: 2 }): ChatProvider {
	return {
		id: "scripted",
		async chat(): Promise<ChatResult> {
			return { content: script.join(""), usage };
		},
		async stream(_messages, callbacks): Promise<ChatResult> {
			for (const token of script) callbacks.onToken(token);
			return { content: script.join(""), usage };
		}
	};
}

describe("chat", () => {
	it("streams a reply, records usage, and totals tokens", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["hel", "lo"]), "sys", "hi", {}, store);
		const chat = activeChat(state);
		expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(chat.messages[1]?.content).toBe("hello");
		expect(chat.messages[1]?.usage?.total).toBe(2);
		expect(tokenTotal(state)).toBe(2);
		expect(state.sending).toBe(false);
	});

	it("fires onFirstToken once on the first visible token", async () => {
		const { state, store } = stateWith(freshStore());
		let firsts = 0;
		await sendMessage(state, scriptedProvider(["", "hel", "lo"]), "sys", "hi", {
			onFirstToken: () => {
				firsts += 1;
			}
		}, store);
		expect(firsts).toBe(1);
		expect(activeChat(state).messages[1]?.content).toBe("hello");
	});

	it("marks the reply started on first token, clears it on settle", async () => {
		// The thinking chip reads these two flags: sending (still
		// running) without reply-started (nothing printed yet).
		const { state, store } = stateWith(freshStore());
		let during: boolean[] = [];
		await sendMessage(state, scriptedProvider(["", "hel", "lo"]), "sys", "hi", {
			onFirstToken: () => {
				during = [isSending(state, state.activeChatId), hasReplyStarted(state, state.activeChatId)];
			}
		}, store);
		expect(during).toEqual([true, true]);
		expect(isSending(state, state.activeChatId)).toBe(false);
		expect(hasReplyStarted(state, state.activeChatId)).toBe(false);
	});

	it("splits tokens into input and output", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["hi"], { prompt: 5, completion: 3, total: 8 }), "sys", "hello", {}, store);
		await sendMessage(state, scriptedProvider(["yo"], { prompt: 7, completion: 2, total: 9 }), "sys", "again", {}, store);
		expect(tokenSplit(state)).toEqual({ prompt: 12, completion: 5 });
		expect(tokenTotal(state)).toBe(17);
	});

	it("splits zero tokens on an empty chat", () => {
		const { state } = stateWith(freshStore());
		expect(tokenSplit(state)).toEqual({ prompt: 0, completion: 0 });
	});

	it("compacts token counts with K/M/B suffixes", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(42)).toBe("42");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1000)).toBe("1K");
		expect(formatTokens(1536)).toBe("1.5K");
		expect(formatTokens(10_400)).toBe("10.4K");
		expect(formatTokens(99_999)).toBe("100K");
		expect(formatTokens(999_949)).toBe("1M");
		expect(formatTokens(999_950)).toBe("1M");
		expect(formatTokens(2_500_000)).toBe("2.5M");
		expect(formatTokens(1_000_000_000)).toBe("1B");
		expect(formatTokens(-5)).toBe("0");
	});

	it("marks failed replies retryable and keeps the prompt", async () => {
		const failing: ChatProvider = {
			id: "failing",
			async chat(): Promise<ChatResult> {
				throw new Error("bad key");
			},
			async stream(): Promise<ChatResult> {
				throw new Error("bad key");
			}
		};
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, failing, "sys", "hi", {}, store);
		const chat = activeChat(state);
		const last = chat.messages[chat.messages.length - 1];
		expect(last?.error).toBe("bad key");
		expect(last?.content).toBe("");

		dismissFailedAssistant(state, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user"]);
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "again", {}, store);
		expect(activeChat(state).messages).toHaveLength(3);
	});

	it("resends the last prompt after a failure or a take-back", async () => {
		let calls = 0;
		const flaky: ChatProvider = {
			id: "flaky",
			async chat(): Promise<ChatResult> {
				return { content: "x", usage: null };
			},
			async stream(_m, cb): Promise<ChatResult> {
				calls++;
				if (calls === 1) throw new Error("boom");
				cb.onToken("recovered");
				return { content: "recovered", usage: null };
			}
		};
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, flaky, "sys", "q", {}, store);
		expect(activeChat(state).messages).toHaveLength(2);
		dismissFailedAssistant(state, store);
		await resendLast(state, flaky, "sys", { store });
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(activeChat(state).messages[1]?.content).toBe("recovered");

		takeBackLastReply(state, store);
		await resendLast(state, flaky, "sys", { store });
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("aborts the in-flight send when its chat is dropped", async () => {
		const { state, store } = stateWith(freshStore());
		let aborted = false;
		const hanging: ChatProvider = {
			id: "hang",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, _cb, opts): Promise<ChatResult> {
				return new Promise<ChatResult>((_resolve, reject) => {
					opts?.signal?.addEventListener("abort", () => {
						aborted = true;
						reject(new DOMException("aborted", "AbortError"));
					});
				});
			}
		};
		const sending = sendMessage(state, hanging, "sys", "hi", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		expect(state.sending).toBe(true);
		deleteChat(state, state.activeChatId, store);
		await sending;
		expect(aborted).toBe(true);
		expect(state.sending).toBe(false);
		expect(activeChat(state).messages).toHaveLength(0);
	});

	it("keeps streaming into its origin chat across a switch", async () => {
		const { state, store } = stateWith(freshStore());
		let onToken!: (token: string) => void;
		let resolveStream!: (result: ChatResult) => void;
		const gated: ChatProvider = {
			id: "gated",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, callbacks): Promise<ChatResult> {
				onToken = callbacks.onToken;
				return new Promise<ChatResult>((resolve) => {
					resolveStream = resolve;
				});
			}
		};
		const originId = state.activeChatId;
		const sending = sendMessage(state, gated, "sys", "hi", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		expect(state.sending).toBe(true);
		expect(state.sendingChatId).toBe(originId);
		// Away mid-stream: tokens must not land in the new chat, and
		// the indicator's owner stays the origin.
		newChat(state, store);
		const awayId = state.activeChatId;
		expect(awayId).not.toBe(originId);
		onToken("hel");
		await new Promise((r) => setTimeout(r, 20));
		expect(state.chats.find((c) => c.id === awayId)?.messages).toHaveLength(0);
		expect(state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)).toEqual([
			"hi",
			"hel"
		]);
		expect(state.sendingChatId).toBe(originId);
		resolveStream({ content: "hello", usage: { prompt: 1, completion: 1, total: 2 } });
		await sending;
		expect(state.sending).toBe(false);
		expect(state.sendingChatId).toBeNull();
		expect(state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)).toEqual([
			"hi",
			"hello"
		]);
		expect(state.chats.find((c) => c.id === awayId)?.messages).toHaveLength(0);
	});

	it("labels the empty in-flight placeholder as not yet a message", async () => {
		const { state, store } = stateWith(freshStore());
		let onToken!: (token: string) => void;
		let resolveStream!: (result: ChatResult) => void;
		const gated: ChatProvider = {
			id: "gated",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, callbacks): Promise<ChatResult> {
				onToken = callbacks.onToken;
				return new Promise<ChatResult>((resolve) => {
					resolveStream = resolve;
				});
			}
		};
		const originId = state.activeChatId;
		const sending = sendMessage(state, gated, "sys", "hi", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		const origin = state.chats.find((c) => c.id === originId);
		expect(origin?.messages).toHaveLength(2);
		// Placeholder is empty: the label matches the one visible message.
		expect(visibleMessageCount(state, origin!)).toBe(1);
		// First token lands: the reply is visible, the label follows.
		onToken("hel");
		await new Promise((r) => setTimeout(r, 20));
		expect(visibleMessageCount(state, origin!)).toBe(2);
		resolveStream({ content: "hello", usage: { prompt: 1, completion: 1, total: 2 } });
		await sending;
		expect(visibleMessageCount(state, origin!)).toBe(2);
		// A chat that owns no stream always counts straight.
		newChat(state, store);
		const away = state.chats.find((c) => c.id === state.activeChatId);
		expect(visibleMessageCount(state, away!)).toBe(0);
	});

	it("locks send and stage while a reply streams", async () => {
		const { state, store } = stateWith(freshStore());
		let resolveStream!: (result: ChatResult) => void;
		const gated: ChatProvider = {
			id: "gated",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(): Promise<ChatResult> {
				return new Promise<ChatResult>((resolve) => {
					resolveStream = resolve;
				});
			}
		};
		const sending = sendMessage(state, gated, "sys", "first", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		expect(state.sending).toBe(true);
		// A second send and a stage both wait for quiet: neither lands.
		await sendMessage(state, gated, "sys", "second", {}, store);
		stageMessage(state, "staged", [], store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["first", ""]);
		resolveStream({ content: "reply", usage: { prompt: 1, completion: 1, total: 2 } });
		await sending;
		// Quiet again: staging works, and the queued text was never lost.
		stageMessage(state, "staged", [], store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["first", "reply", "staged"]);
	});

	it("sends in a fresh chat while another still streams", async () => {
		const { state, store } = stateWith(freshStore());
		const resolvers: Array<(result: ChatResult) => void> = [];
		const gated: ChatProvider = {
			id: "gated",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(): Promise<ChatResult> {
				return new Promise<ChatResult>((resolve) => {
					resolvers.push(resolve);
				});
			}
		};
		const usage = { prompt: 1, completion: 1, total: 2 };
		const first = sendMessage(state, gated, "sys", "one", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		const originId = state.activeChatId;
		expect(isSending(state, originId)).toBe(true);
		// A second send in the same chat still waits for quiet.
		await sendMessage(state, gated, "sys", "blocked", {}, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one", ""]);
		// But a fresh chat sends concurrently: both stream at once.
		newChat(state, store);
		const awayId = state.activeChatId;
		const second = sendMessage(state, gated, "sys", "two", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		expect(state.sending).toBe(true);
		expect(state.sendingChatIds).toHaveLength(2);
		expect(isSending(state, originId)).toBe(true);
		expect(isSending(state, awayId)).toBe(true);
		resolvers[0]?.({ content: "r1", usage });
		await first;
		// Origin lands with its own reply; the away stream carries on.
		expect(state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)).toEqual([
			"one",
			"r1"
		]);
		expect(isSending(state, originId)).toBe(false);
		expect(state.sending).toBe(true);
		expect(state.sendingChatId).toBe(awayId);
		resolvers[1]?.({ content: "r2", usage });
		await second;
		expect(state.sending).toBe(false);
		expect(state.sendingChatId).toBeNull();
		expect(state.chats.find((c) => c.id === awayId)?.messages.map((m) => m.content)).toEqual([
			"two",
			"r2"
		]);
	});

	it("dropping one chat aborts only its own stream", async () => {
		const { state, store } = stateWith(freshStore());
		const aborted: string[] = [];
		const hanging = (tag: string): ChatProvider => ({
			id: tag,
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, _cb, opts): Promise<ChatResult> {
				return new Promise<ChatResult>((_resolve, reject) => {
					opts?.signal?.addEventListener("abort", () => {
						aborted.push(tag);
						reject(new DOMException("aborted", "AbortError"));
					});
				});
			}
		});
		const originId = state.activeChatId;
		const first = sendMessage(state, hanging("one"), "sys", "one", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		newChat(state, store);
		const awayId = state.activeChatId;
		const second = sendMessage(state, hanging("two"), "sys", "two", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		deleteChat(state, originId, store);
		await first;
		expect(aborted).toEqual(["one"]);
		expect(isSending(state, awayId)).toBe(true);
		expect(state.sending).toBe(true);
		abortSend(awayId);
		await second;
		expect(state.sending).toBe(false);
	});

	it("reruns from any user message, deleting everything after it", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(activeChat(state).messages).toHaveLength(4);

		truncateToMessage(state, 0, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one"]);
		await resendLast(state, provider, "sys", { store });
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);

		// Non-user targets and out-of-range indices are no-ops.
		truncateToMessage(state, 1, store);
		expect(activeChat(state).messages).toHaveLength(2);
		truncateToMessage(state, 99, store);
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("edits an own message in place without touching history", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		const target = activeChat(state).messages[2];
		if (!target) throw new Error("seed message missing");

		expect(editMessageContent(state, target.id, "TWO!", {}, store)).toBe(true);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one", "r", "TWO!", "r"]);

		// Unknown ids and non-user targets are no-ops.
		expect(editMessageContent(state, "nope" as never, "x", {}, store)).toBe(false);
		const reply = activeChat(state).messages[3];
		if (!reply) throw new Error("seed reply missing");
		expect(editMessageContent(state, reply.id, "x", {}, store)).toBe(false);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one", "r", "TWO!", "r"]);
	});

	it("reruns by dropping the last reply, branches fork history", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["a"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		takeBackLastReply(state, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user"]);

		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(state.chats).toHaveLength(1);
		branchFrom(state, 0, store);
		expect(state.chats).toHaveLength(2);
		expect(activeChat(state).messages).toHaveLength(1);
		expect(activeChat(state).messages[0]?.content).toBe("one");
	});

	it("stages messages last without sending, in order", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["r"]), "sys", "q", {}, store);
		stageMessage(state, "foo", [], store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["q", "r", "foo"]);
		// foo rides unseen until the next submit carries it in order.
		expect(buildApiMessages(activeChat(state), "sys").map((m) => m.content)).toEqual([
			"sys",
			"q",
			"r",
			"foo"
		]);
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "bar", {}, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"q",
			"r",
			"foo",
			"bar",
			"ok"
		]);
		// Empty stages are ignored.
		stageMessage(state, "   ", [], store);
		expect(activeChat(state).messages).toHaveLength(5);
	});

	it("creates, selects, and deletes chats without stranding the selection", () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		newChat(state, store);
		expect(state.chats).toHaveLength(2);
		selectChat(state, first);
		expect(state.activeChatId).toBe(first);
		deleteChat(state, first, store);
		expect(state.activeChatId).not.toBe(first);
		deleteAllChats(state, store);
		expect(state.chats).toHaveLength(1);
		expect(activeChat(state).messages).toEqual([]);
	});

	it("appends new and branched chats at the bottom, newest last", async () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		await sendMessage(state, scriptedProvider(["r"]), "sys", "one", {}, store);
		newChat(state, store);
		const second = state.activeChatId;
		expect(state.chats.map((c) => c.id)).toEqual([first, second]);
		expect(activeChat(state).messages).toEqual([]);
		selectChat(state, first);
		branchFrom(state, 0, store);
		expect(state.chats.map((c) => c.id)).toEqual([first, second, state.activeChatId]);
		expect(activeChat(state).messages[0]?.content).toBe("one");
	});

	it("deleting the active chat lands on the one right below it", () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		newChat(state, store);
		const second = state.activeChatId;
		newChat(state, store);
		const third = state.activeChatId;
		expect(state.chats.map((c) => c.id)).toEqual([first, second, third]);
		selectChat(state, second);
		deleteChat(state, second, store);
		expect(state.chats.map((c) => c.id)).toEqual([first, third]);
		expect(state.activeChatId).toBe(third);
		selectChat(state, third);
		deleteChat(state, third, store);
		expect(state.chats.map((c) => c.id)).toEqual([first]);
		expect(state.activeChatId).toBe(first);
	});

	it("folds and unfolds pasted spans by replacing the message", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(
			state,
			scriptedProvider(["r"]),
			"sys",
			"hello world",
			{ pasteFolds: [{ start: 0, end: 5, chars: 5 }] },
			store
		);
		const msg = activeChat(state).messages[0]!;
		expect(msg.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5 }]);
		setPasteFold(state, msg.id, 0, true, store);
		const updated = activeChat(state).messages[0]!;
		expect(updated).not.toBe(msg);
		expect(updated.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5, open: true }]);
		const again = createChatState(store);
		const reloaded = again.chats.flatMap((c) => c.messages).find((m) => m.id === msg.id);
		expect(reloaded?.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5, open: true }]);
		setPasteFold(state, msg.id, 7, true, store);
		setPasteFold(state, "missing" as typeof msg.id, 0, true, store);
		expect(activeChat(state).messages[0]?.pasteFolds).toEqual([
			{ start: 0, end: 5, chars: 5, open: true }
		]);
	});

	it("deletes a single message by index", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["r"]), "sys", "one", {}, store);
		deleteMessage(state, 0, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["assistant"]);
	});

	it("exposes user-turn waypoints", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(waypoints(state)).toEqual([0, 2]);
	});

	it("labels waypoint targets with a collapsed excerpt", () => {
		expect(waypointLabel("once more")).toBe("once more");
		expect(waypointLabel("  line one\nline two  ")).toBe("line one line two");
		expect(waypointLabel("x".repeat(100))).toBe("x".repeat(60));
		expect(waypointLabel("hello", 3)).toBe("hel");
		expect(waypointLabel("   ")).toBe("");
	});

	it("loads chats saved under the pre-rename key", () => {
		const store = freshStore();
		store.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([{ id: "c1", createdAt: 1, replyLang: null, messages: [] }])
		);
		const state = createChatState(store);
		expect(state.chats.map((c) => c.id)).toEqual(["c1"]);
	});

	it("keeps a reply pill per chat and persists it on load", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const [first, second] = state.chats;
		expect(first!.replyLang).toBeNull();
		setChatReplyLang(state, first!.id, null, store);
		setChatReplyLang(state, second!.id, "ar", store);
		expect(activeChat(state).replyLang).toBe("ar");
		selectChat(state, first!.id);
		expect(activeChat(state).replyLang).toBeNull();
		const again = createChatState(store);
		expect(again.chats[0]?.replyLang).toBeNull();
		expect(again.chats[1]?.replyLang).toBe("ar");
		// Unknown codes from retired languages fall back to no pill.
		const raw = JSON.parse(store.getItem("ccez-llm-chats-v1") as string) as Array<{
			replyLang: unknown;
		}>;
		raw[1]!.replyLang = "xx";
		store.setItem("ccez-llm-chats-v1", JSON.stringify(raw));
		const healed = createChatState(store);
		expect(healed.chats[1]?.replyLang).toBeNull();
	});

	it("keeps a voice-readback override per chat, following the global default when unset", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const [first, second] = state.chats;
		// No override anywhere: both follow the global default.
		expect(chatVoiceReadback(first!, false)).toBe(false);
		expect(chatVoiceReadback(second!, true)).toBe(true);
		setChatVoice(state, first!.id, true, store);
		setChatVoice(state, second!.id, false, store);
		// Overrides win over the default in both directions.
		expect(chatVoiceReadback(first!, false)).toBe(true);
		expect(chatVoiceReadback(second!, true)).toBe(false);
		// Switching chats surfaces each chat's own override.
		selectChat(state, first!.id);
		expect(chatVoiceReadback(activeChat(state), false)).toBe(true);
		selectChat(state, second!.id);
		expect(chatVoiceReadback(activeChat(state), false)).toBe(false);
		// Overrides persist; clearing one returns to follow-global.
		const again = createChatState(store);
		expect(chatVoiceReadback(again.chats[0]!, false)).toBe(true);
		expect(chatVoiceReadback(again.chats[1]!, true)).toBe(false);
		setChatVoice(again, again.chats[0]!.id, null, store);
		expect(chatVoiceReadback(again.chats[0]!, true)).toBe(true);
		// Pre-override stores carry no flag: they follow the default.
		const raw = JSON.parse(store.getItem("ccez-llm-chats-v1") as string) as Array<{
			voice: unknown;
		}>;
		for (const c of raw) delete c.voice;
		store.setItem("ccez-llm-chats-v1", JSON.stringify(raw));
		const healed = createChatState(store);
		expect(healed.chats[0]?.voice).toBeNull();
		expect(chatVoiceReadback(healed.chats[0]!, true)).toBe(true);
	});

	it("stamps a missing chat timestamp instead of showing Invalid Date", () => {
		const { store } = stateWith(freshStore());
		const before = Date.now();
		store.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([{ id: "old", messages: [], replyLang: null, voice: null }])
		);
		const healed = createChatState(store);
		const stamped = healed.chats[0]?.createdAt ?? 0;
		expect(stamped).toBeGreaterThanOrEqual(before);
		expect(stamped).toBeLessThanOrEqual(Date.now());
	});

	it("persists across instances and tolerates corruption", async () => {
		const store = freshStore();
		const first = createChatState(store);
		await sendMessage(first, scriptedProvider(["hi"]), "sys", "hello", {}, store);
		const again = createChatState(store);
		expect(activeChat(again).messages).toHaveLength(2);

		store.setItem("ccez-llm-chats-v1", "garbage{");
		const fresh = createChatState(store);
		expect(activeChat(fresh).messages).toEqual([]);
	});

	it("mock provider streams a canned reply", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, new MockProvider(), "sys", "ping", {}, store);
		expect(activeChat(state).messages[1]?.content).toContain("ping");
	});

	it("sends images as content parts and inlines text files", async () => {
		const { state, store } = stateWith(freshStore());
		const attachments = [
			{
				id: "img",
				name: "pic.jpg",
				mime: "image/jpeg",
				kind: "image",
				dataUrl: "data:image/jpeg;base64,AAA",
				text: null,
				width: 100,
				height: 100,
				tokens: 255
			},
			{
				id: "txt",
				name: "notes.txt",
				mime: "text/plain",
				kind: "text",
				dataUrl: null,
				text: "remember this",
				width: null,
				height: null,
				tokens: 4
			}
		] as const;
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "look", {
			attachments: [...attachments]
		}, store);
		const sent = activeChat(state).messages[0];
		expect(sent?.attachments).toHaveLength(2);

		const api = buildApiMessages(activeChat(state), "sys");
		const user = api.find((m) => m.role === "user");
		expect(Array.isArray(user?.content)).toBe(true);
		const parts = user?.content as Array<{ type: string }>;
		expect(parts[0]).toEqual({
			type: "text",
			text: "look\n\n```notes.txt\nremember this\n```"
		});
		expect(parts[1]).toEqual({
			type: "image_url",
			image_url: { url: "data:image/jpeg;base64,AAA" }
		});
	});

	it("sends attachment-free messages as plain strings", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "plain", {}, store);
		const api = buildApiMessages(activeChat(state), "sys");
		expect(api.find((m) => m.role === "user")?.content).toBe("plain");
	});

	it("carries attachments across resend and branch", async () => {
		const { state, store } = stateWith(freshStore());
		const attachments = [
			{
				id: "t",
				name: "a.txt",
				mime: "text/plain",
				kind: "text",
				dataUrl: null,
				text: "x",
				width: null,
				height: null,
				tokens: 1
			}
		] as const;
		await sendMessage(state, scriptedProvider(["one"]), "sys", "first", {
			attachments: [...attachments]
		}, store);
		await resendLast(state, scriptedProvider(["two"]), "sys", { store });
		expect(activeChat(state).messages[0]?.attachments).toHaveLength(1);

		branchFrom(state, 1, store);
		selectChat(state, state.chats[0]!.id);
		expect(activeChat(state).messages[0]?.attachments).toHaveLength(1);
	});
});

describe("resendLast identity", () => {
	it("reuses the user message instead of remounting it", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["one"]), "sys", "q", {}, store);
		const userId = activeChat(state).messages[0]?.id;
		if (!userId) throw new Error("seed message missing");
		takeBackLastReply(state, store);
		await resendLast(state, scriptedProvider(["two"]), "sys", { store });
		const messages = activeChat(state).messages;
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(messages[0]?.id).toBe(userId);
		expect(messages[1]?.content).toBe("two");
	});
});

describe("apiContent", () => {
	it("strips stored image literals, keeping clean prose plus image parts", () => {
		const out = apiContent({
			id: newChatMsgId(),
			role: "user",
			content: "look [Pasted image]",
			usage: null,
			error: null,
			attachments: [
				{
					id: "a1",
					kind: "image",
					name: "solo.png",
					mime: "image/png",
					tokens: 0,
					dataUrl: "data:image/png;base64,AAA",
					text: null,
					width: 8,
					height: 8
				}
			]
		});
		if (typeof out === "string") throw new Error("expected multimodal parts");
		expect(out[0]).toEqual({ type: "text", text: "look " });
		expect(out[1]).toEqual({
			type: "image_url",
			image_url: { url: "data:image/png;base64,AAA" }
		});
	});
});

describe("resolveSendCompletion", () => {
	it("reads the origin chat and flags the open one", () => {
		const { state } = stateWith(freshStore());
		newChat(state);
		const first = activeChat(state);
		first.messages = [
			{ id: newChatMsgId(), role: "user", content: "q", usage: null, error: null },
			{ id: newChatMsgId(), role: "assistant", content: "old reply", usage: null, error: null }
		];
		newChat(state);
		const second = activeChat(state);
		second.messages = [
			{ id: newChatMsgId(), role: "user", content: "new question", usage: null, error: null }
		];
		const open = resolveSendCompletion(state, first.id, first.id);
		expect(open.sent?.content).toBe("old reply");
		expect(open.stillHere).toBe(true);
		const switched = resolveSendCompletion(state, first.id, second.id);
		expect(switched.sent?.content).toBe("old reply");
		expect(switched.stillHere).toBe(false);
		deleteChat(state, first.id);
		const gone = resolveSendCompletion(state, first.id, second.id);
		expect(gone.sent).toBeUndefined();
		expect(gone.stillHere).toBe(false);
	});
});
