import { describe, it, expect } from "vitest";
import {
	createChatState,
	activeChat,
	abortSend,
	newChat,
	newChatMsgId,
	selectChat,
	appendAssistantMessage,
	ensureGameChat,
	setChatReplyLang,
	setChatCorrection,
	swapReplyLang,
	chatVoiceReadback,
	setChatVoice,
	deleteChat,
	deleteMessage,
	stageMessage,
	branchFrom,
	truncateToMessage,
	editMessageContent,
	dismissFailedAssistant,
	takeBackLastReply,
	resendLast,
	planChatStep,
	clampChatIndex,
	messageIndexFromId,
	tokenTotal,
	tokenSplit,
	formatTokens,
	waypoints,
	waypointIndexAt,
	waypointOffsets,
	waypointLabel,
	sendMessage,
	fileAssistantMessage,
	setPasteFold,
	resolveSendCompletion,
	landingSignal,
	replyPhase,
	REPLY_STALL_MS,
	apiContent,
	buildApiMessages,
	selectHistoryWindow,
	refreshChatSummary,
	refreshTrimSummary,
	setTrimPoint,
	trimPointIndex,
	buildSummaryRefreshMessages,
	renderFoldText,
	summaryBlock,
	estimateTokens,
	HISTORY_WINDOW_CHARS,
	MIN_VERBATIM_MESSAGES,
	isSending,
	hasReplyStarted,
	hasFetchActive,
	beginNativeSend,
	beginNativeResend,
	settleNativeSend,
	type ChatState,
	type ChatId
} from "./chat";
import {
	buildTitleMessages,
	cleanTitle,
	generateChatTitle,
	renameChat
} from "./chat";
import type {
	ChatMessage,
	ChatProvider,
	ChatResult,
	StreamCallbacks
} from "./providers/types";
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

function scriptedProvider(
	script: string[],
	usage = { prompt: 1, completion: 1, total: 2 }
): ChatProvider {
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
		await sendMessage(
			state,
			scriptedProvider(["hel", "lo"]),
			"sys",
			"hi",
			{},
			store
		);
		const chat = activeChat(state);
		expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(chat.messages[1]?.content).toBe("hello");
		expect(chat.messages[1]?.usage?.total).toBe(2);
		expect(tokenTotal(state)).toBe(2);
		expect(state.sending).toBe(false);
	});

	it("files a capture as an assistant message with no send", () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const id = fileAssistantMessage(state, "  なんのヘンテツもない  ", store);
		expect(id).not.toBe(null);
		const messages = activeChat(state).messages;
		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("assistant");
		expect(messages[0]?.content).toBe("なんのヘンテツもない");
		expect(messages[0]?.id).toBe(id);
		expect(state.sending).toBe(false);
	});

	it("files into a fresh chat and ignores blanks", () => {
		const { state, store } = stateWith(freshStore());
		expect(fileAssistantMessage(state, "   ", store)).toBe(null);
		const id = fileAssistantMessage(state, "hello", store);
		expect(id).not.toBe(null);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual([
			"assistant"
		]);
	});

	it("fires onFirstToken once on the first visible token", async () => {
		const { state, store } = stateWith(freshStore());
		let firsts = 0;
		await sendMessage(
			state,
			scriptedProvider(["", "hel", "lo"]),
			"sys",
			"hi",
			{
				onFirstToken: () => {
					firsts += 1;
				}
			},
			store
		);
		expect(firsts).toBe(1);
		expect(activeChat(state).messages[1]?.content).toBe("hello");
	});

	it("marks the reply started on first token, clears it on settle", async () => {
		// The thinking chip reads these two flags: sending (still
		// running) without reply-started (nothing printed yet).
		const { state, store } = stateWith(freshStore());
		let during: boolean[] = [];
		await sendMessage(
			state,
			scriptedProvider(["", "hel", "lo"]),
			"sys",
			"hi",
			{
				onFirstToken: () => {
					during = [
						isSending(state, state.activeChatId),
						hasReplyStarted(state, state.activeChatId)
					];
				}
			},
			store
		);
		expect(during).toEqual([true, true]);
		expect(isSending(state, state.activeChatId)).toBe(false);
		expect(hasReplyStarted(state, state.activeChatId)).toBe(false);
	});

	it("opens, refuses, and settles native sends", () => {
		// The page passes these ids to turn_start; the runner fills the
		// placeholder and the done/scan paths settle the flags.
		const { state, store } = stateWith(freshStore());
		const opened = beginNativeSend(state, "hi", {}, store);
		expect(opened).not.toBeNull();
		expect(activeChat(state).messages).toHaveLength(2);
		expect(activeChat(state).messages[1]).toMatchObject({
			role: "assistant",
			content: ""
		});
		expect(isSending(state, state.activeChatId)).toBe(true);
		// A second send into the same chat races out.
		expect(beginNativeSend(state, "again", {}, store)).toBeNull();
		settleNativeSend(state, opened!.chatId, store);
		expect(isSending(state, state.activeChatId)).toBe(false);
		expect(hasFetchActive(state, state.activeChatId)).toBe(false);
		// Nothing to send: empty text, no attachments.
		expect(beginNativeSend(state, "  ", {}, store)).toBeNull();
	});

	it("opens native resends only on user-last", () => {
		const { state, store } = stateWith(freshStore());
		// Fresh chat ends on the blank assistant stub, not a user message.
		expect(beginNativeResend(state, store)).toBeNull();
		const opened = beginNativeSend(state, "hi", {}, store);
		expect(opened).not.toBeNull();
		settleNativeSend(state, opened!.chatId, store);
		// The send's own placeholder is assistant-last: no resend.
		expect(beginNativeResend(state, store)).toBeNull();
		// A failed turn fills the placeholder's error; dismissing it
		// (the Retry path) leaves user-last.
		const failed = activeChat(state).messages[1];
		activeChat(state).messages[1] = { ...failed!, error: "boom" };
		dismissFailedAssistant(state, store);
		const userOnly = activeChat(state).messages;
		expect(userOnly).toHaveLength(1);
		expect(userOnly[0]?.role).toBe("user");
		const resent = beginNativeResend(state, store);
		expect(resent).not.toBeNull();
		expect(activeChat(state).messages).toHaveLength(2);
		expect(activeChat(state).messages[1]).toMatchObject({
			role: "assistant",
			content: ""
		});
		expect(isSending(state, state.activeChatId)).toBe(true);
	});

	it("tracks the fetch phase, clearing it on settle", async () => {
		// The Fetching chip reads this flag: active during the tool
		// fetch (even with tokens already printed), never stranded after.
		const { state, store } = stateWith(freshStore());
		let during: boolean[] = [];
		const fetching: ChatProvider = {
			id: "fetching",
			async chat(): Promise<ChatResult> {
				return { content: "done", usage: null };
			},
			async stream(_messages, callbacks): Promise<ChatResult> {
				callbacks.onToken("chatter ");
				callbacks.onFetchStart?.("https://example.com/");
				during = [
					isSending(state, state.activeChatId),
					hasFetchActive(state, state.activeChatId)
				];
				callbacks.onFetchEnd?.();
				callbacks.onToken("done");
				return { content: "chatter done", usage: null };
			}
		};
		await sendMessage(state, fetching, "sys", "hi", {}, store);
		expect(during).toEqual([true, true]);
		expect(hasFetchActive(state, state.activeChatId)).toBe(false);
		expect(isSending(state, state.activeChatId)).toBe(false);
	});

	it("clears a stranded fetch phase when the turn throws", async () => {
		// A fetch cut short by an abort must not strand the chip: the
		// send's finally owns the flag, not the fetch end callback.
		const { state, store } = stateWith(freshStore());
		const bomb: ChatProvider = {
			id: "bomb",
			async chat(): Promise<ChatResult> {
				throw new Error("x");
			},
			async stream(_messages, callbacks): Promise<ChatResult> {
				callbacks.onFetchStart?.("https://example.com/");
				throw new Error("boom");
			}
		};
		await sendMessage(state, bomb, "sys", "hi", {}, store);
		expect(hasFetchActive(state, state.activeChatId)).toBe(false);
		expect(isSending(state, state.activeChatId)).toBe(false);
	});

	it("splits tokens into input and output", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(
			state,
			scriptedProvider(["hi"], { prompt: 5, completion: 3, total: 8 }),
			"sys",
			"hello",
			{},
			store
		);
		await sendMessage(
			state,
			scriptedProvider(["yo"], { prompt: 7, completion: 2, total: 9 }),
			"sys",
			"again",
			{},
			store
		);
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
		await sendMessage(
			state,
			scriptedProvider(["ok"]),
			"sys",
			"again",
			{},
			store
		);
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
		expect(activeChat(state).messages.map((m) => m.role)).toEqual([
			"user",
			"assistant"
		]);
		expect(activeChat(state).messages[1]?.content).toBe("recovered");

		takeBackLastReply(state, store);
		await resendLast(state, flaky, "sys", { store });
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("retracts pre-tool text back to thinking when the round discards it", async () => {
		const { state, store } = stateWith(freshStore());
		let callbacks!: StreamCallbacks;
		let resolveStream!: (result: ChatResult) => void;
		const tooly: ChatProvider = {
			id: "tooly",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, cb): Promise<ChatResult> {
				callbacks = cb;
				return new Promise<ChatResult>((resolve) => {
					resolveStream = resolve;
				});
			}
		};
		const sending = sendMessage(state, tooly, "sys", "hi", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		callbacks.onToken("Let me look that up. ");
		expect(activeChat(state).messages[1]?.content).toBe(
			"Let me look that up. "
		);
		expect(hasReplyStarted(state)).toBe(true);
		// Tool round: the streamed prefix retracts (thinking dots
		// again), the fetch runs, and the final answer streams fresh.
		callbacks.onRoundRetract?.();
		expect(activeChat(state).messages[1]?.content).toBe("");
		expect(hasReplyStarted(state)).toBe(false);
		callbacks.onToken("Found it.");
		expect(activeChat(state).messages[1]?.content).toBe("Found it.");
		expect(hasReplyStarted(state)).toBe(true);
		resolveStream({
			content: "Found it.",
			usage: { prompt: 1, completion: 1, total: 2 }
		});
		await sending;
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"hi",
			"Found it."
		]);
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
		expect(
			state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)
		).toEqual(["hi", "hel"]);
		expect(state.sendingChatId).toBe(originId);
		resolveStream({
			content: "hello",
			usage: { prompt: 1, completion: 1, total: 2 }
		});
		await sending;
		expect(state.sending).toBe(false);
		expect(state.sendingChatId).toBeNull();
		expect(
			state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)
		).toEqual(["hi", "hello"]);
		expect(state.chats.find((c) => c.id === awayId)?.messages).toHaveLength(0);
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
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"first",
			""
		]);
		resolveStream({
			content: "reply",
			usage: { prompt: 1, completion: 1, total: 2 }
		});
		await sending;
		// Quiet again: staging works, and the queued text was never lost.
		stageMessage(state, "staged", [], store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"first",
			"reply",
			"staged"
		]);
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
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"one",
			""
		]);
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
		expect(
			state.chats.find((c) => c.id === originId)?.messages.map((m) => m.content)
		).toEqual(["one", "r1"]);
		expect(isSending(state, originId)).toBe(false);
		expect(state.sending).toBe(true);
		expect(state.sendingChatId).toBe(awayId);
		resolvers[1]?.({ content: "r2", usage });
		await second;
		expect(state.sending).toBe(false);
		expect(state.sendingChatId).toBeNull();
		expect(
			state.chats.find((c) => c.id === awayId)?.messages.map((m) => m.content)
		).toEqual(["two", "r2"]);
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
		expect(activeChat(state).messages.map((m) => m.role)).toEqual([
			"user",
			"assistant"
		]);

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
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"one",
			"r",
			"TWO!",
			"r"
		]);

		// Unknown ids and non-user targets are no-ops.
		expect(editMessageContent(state, "nope" as never, "x", {}, store)).toBe(
			false
		);
		const reply = activeChat(state).messages[3];
		if (!reply) throw new Error("seed reply missing");
		expect(editMessageContent(state, reply.id, "x", {}, store)).toBe(false);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"one",
			"r",
			"TWO!",
			"r"
		]);
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
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"q",
			"r",
			"foo"
		]);
		// foo rides unseen until the next submit carries it in order.
		expect(
			buildApiMessages(activeChat(state), "sys").map((m) => m.content)
		).toEqual(["sys", "q", "r", "foo"]);
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
		expect(state.chats).toHaveLength(1);
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
		expect(state.chats.map((c) => c.id)).toEqual([
			first,
			second,
			state.activeChatId
		]);
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
		expect(updated.pasteFolds).toEqual([
			{ start: 0, end: 5, chars: 5, open: true }
		]);
		const again = createChatState(store);
		const reloaded = again.chats
			.flatMap((c) => c.messages)
			.find((m) => m.id === msg.id);
		expect(reloaded?.pasteFolds).toEqual([
			{ start: 0, end: 5, chars: 5, open: true }
		]);
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
		expect(activeChat(state).messages.map((m) => m.role)).toEqual([
			"assistant"
		]);
	});

	it("exposes user-turn waypoints", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(waypoints(state)).toEqual([0, 2]);
	});

	it("positions the waypoint at the scroll line with grace", () => {
		expect(waypointIndexAt([0, 500, 1000], 0)).toBe(1);
		expect(waypointIndexAt([0, 500, 1000], 480)).toBe(2);
		expect(waypointIndexAt([0, 500, 1000], 2000)).toBe(3);
		expect(waypointIndexAt([], 0)).toBe(1);
		expect(waypointIndexAt([5000], 0)).toBe(1);
	});

	it("counts trimmed waypoints as passed instead of stopping at them", () => {
		// Points 0 and 2 sit in the trim (unrendered); 4 and 6 render.
		const tops = new Map([
			[4, 0],
			[6, 900]
		]);
		const offsets = waypointOffsets(
			[0, 2, 4, 6],
			3,
			(p) => tops.get(p) ?? null
		);
		expect(waypointIndexAt(offsets, 1000)).toBe(4);
		expect(waypointIndexAt(offsets, 0)).toBe(3);
		// No trim: a missing node still ends the run.
		expect(waypointOffsets([0, 2], -1, (p) => (p === 0 ? 10 : null))).toEqual([
			10
		]);
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
			JSON.stringify([
				{ id: "c1", createdAt: 1, replyLang: null, messages: [] }
			])
		);
		const state = createChatState(store);
		expect(state.chats.map((c) => c.id)).toEqual(["c1"]);
	});

	it("drill clips saved with their English in the body load as the transcript alone", () => {
		const store = freshStore();
		const clip = (i: number, heard?: number) => ({
			i,
			heard,
			translation: "Let's talk.",
			grade: "done"
		});
		store.setItem(
			"ccez-llm-chats-v1",
			JSON.stringify([
				{
					id: "c1",
					createdAt: 1,
					replyLang: "fr",
					listen: {
						clips: [
							{ i: 0, start: 0, end: 2, text: "Parlons." },
							{ i: 1, start: 2, end: 4, text: "Bon." }
						]
					},
					messages: [
						{
							id: "m1",
							role: "assistant",
							content: "Parlons.\n\n*Let's talk.*",
							clip: clip(0, 1)
						},
						{ id: "m2", role: "assistant", content: "", clip: clip(1) }
					]
				}
			])
		);
		const [m1, m2] = createChatState(store).chats[0]?.messages ?? [];
		expect(m1?.content).toBe("Parlons.");
		expect(m1?.clip?.translation).toBe("Let's talk.");
		expect(m2?.content).toBe("");
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
		const raw = JSON.parse(
			store.getItem("ccez-llm-chats-v1") as string
		) as Array<{
			replyLang: unknown;
		}>;
		raw[1]!.replyLang = "xx";
		store.setItem("ccez-llm-chats-v1", JSON.stringify(raw));
		const healed = createChatState(store);
		expect(healed.chats[1]?.replyLang).toBeNull();
	});

	it("keeps a correction toggle per chat, healing pre-toggle chats to off", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const [first, second] = state.chats;
		expect(first!.correction).toBe(false);
		setChatCorrection(state, second!.id, true, store);
		expect(state.chats[0]?.correction).toBe(false);
		expect(state.chats[1]?.correction).toBe(true);
		const again = createChatState(store);
		expect(again.chats[0]?.correction).toBe(false);
		expect(again.chats[1]?.correction).toBe(true);
		// Missing flags (written before the toggle) heal to off.
		const raw = JSON.parse(
			store.getItem("ccez-llm-chats-v1") as string
		) as Array<Record<string, unknown>>;
		for (const c of raw) delete c["correction"];
		store.setItem("ccez-llm-chats-v1", JSON.stringify(raw));
		const healed = createChatState(store);
		expect(healed.chats[0]?.correction).toBe(false);
		expect(healed.chats[1]?.correction).toBe(false);
	});

	it("mints one unactivated game chat with the Japanese pill", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const active = activeChat(state).id;
		const game = ensureGameChat(state, store);
		expect(game.game).toBe(true);
		expect(game.replyLang).toBe("ja");
		expect(activeChat(state).id).toBe(active);
		expect(ensureGameChat(state, store).id).toBe(game.id);
		expect(state.chats.filter((c) => c.game)).toHaveLength(1);
		const again = createChatState(store);
		expect(again.chats.filter((c) => c.game)).toHaveLength(1);
		// Pre-overlay chats heal to non-game.
		expect(again.chats[0]?.game).toBe(false);
	});

	it("appends assistant lines to one chat by id", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const game = ensureGameChat(state, store);
		const id = appendAssistantMessage(state, game.id, "  行くぞ！  ", store);
		expect(id).toBeTruthy();
		expect(state.chats[0]?.messages).toHaveLength(0);
		expect(game.messages.map((m) => m.content)).toEqual(["行くぞ！"]);
		const again = createChatState(store);
		const regame = again.chats.find((c) => c.game === true);
		expect(regame?.messages.map((m) => m.content)).toEqual(["行くぞ！"]);
		expect(appendAssistantMessage(state, game.id, "   ", store)).toBeNull();
		expect(
			appendAssistantMessage(state, "missing" as never, "x", store)
		).toBeNull();
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
		const raw = JSON.parse(
			store.getItem("ccez-llm-chats-v1") as string
		) as Array<{
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
			JSON.stringify([
				{ id: "old", messages: [], replyLang: null, voice: null }
			])
		);
		const healed = createChatState(store);
		const stamped = healed.chats[0]?.createdAt ?? 0;
		expect(stamped).toBeGreaterThanOrEqual(before);
		expect(stamped).toBeLessThanOrEqual(Date.now());
	});

	it("persists across instances and tolerates corruption", async () => {
		const store = freshStore();
		const first = createChatState(store);
		await sendMessage(
			first,
			scriptedProvider(["hi"]),
			"sys",
			"hello",
			{},
			store
		);
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
		await sendMessage(
			state,
			scriptedProvider(["ok"]),
			"sys",
			"look",
			{
				attachments: [...attachments]
			},
			store
		);
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
		await sendMessage(
			state,
			scriptedProvider(["ok"]),
			"sys",
			"plain",
			{},
			store
		);
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
		await sendMessage(
			state,
			scriptedProvider(["one"]),
			"sys",
			"first",
			{
				attachments: [...attachments]
			},
			store
		);
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
			{
				id: newChatMsgId(),
				role: "user",
				content: "q",
				usage: null,
				error: null
			},
			{
				id: newChatMsgId(),
				role: "assistant",
				content: "old reply",
				usage: null,
				error: null
			}
		];
		newChat(state);
		const second = activeChat(state);
		second.messages = [
			{
				id: newChatMsgId(),
				role: "user",
				content: "new question",
				usage: null,
				error: null
			}
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

describe("landingSignal", () => {
	it("thumps the open chat while foreground", () => {
		expect(landingSignal(true, true, true)).toBe("done");
	});

	it("ticks another chat's reply on phones while foreground", () => {
		expect(landingSignal(false, true, true)).toBe("tick");
	});

	it("stays silent for another chat's reply on desktop", () => {
		expect(landingSignal(false, true, false)).toBe("silent");
	});

	it("stays silent while backgrounded even on the open chat", () => {
		expect(landingSignal(true, false, true)).toBe("silent");
	});

	it("stays silent while backgrounded on another chat", () => {
		expect(landingSignal(false, false, true)).toBe("silent");
	});
});

describe("replyPhase", () => {
	const base = {
		sending: true,
		fetching: false,
		started: false,
		tick: 0,
		nowMs: 10_000,
		lastTokenMs: null as number | null
	};
	it("rests while nothing sends", () => {
		expect(replyPhase({ ...base, sending: false })).toBeNull();
	});
	it("fetches while a page downloads, started or not", () => {
		expect(replyPhase({ ...base, fetching: true })).toBe("fetch");
		expect(replyPhase({ ...base, fetching: true, started: true })).toBe(
			"fetch"
		);
	});
	it("waits before the first token", () => {
		expect(replyPhase(base)).toBe("waiting");
	});
	it("rests while text flows", () => {
		expect(
			replyPhase({ ...base, started: true, lastTokenMs: 9_500 })
		).toBeNull();
	});
	it("waits again when tokens stall between tool rounds", () => {
		expect(
			replyPhase({
				...base,
				started: true,
				lastTokenMs: 10_000 - REPLY_STALL_MS - 1
			})
		).toBe("waiting");
	});
	it("waits at exactly the stall threshold", () => {
		expect(
			replyPhase({
				...base,
				started: true,
				lastTokenMs: 10_000 - REPLY_STALL_MS
			})
		).toBe("waiting");
	});
	it("waits when started but no token stamp survived", () => {
		expect(replyPhase({ ...base, started: true })).toBe("waiting");
	});
});

describe("swapReplyLang", () => {
	it("stashes the language and drops to default", () => {
		expect(swapReplyLang("fr", null)).toEqual({ current: null, stash: "fr" });
	});
	it("restores the stash and keeps it for the next hold", () => {
		expect(swapReplyLang(null, "fr")).toEqual({ current: "fr", stash: "fr" });
	});
	it("does nothing with neither language nor stash", () => {
		expect(swapReplyLang(null, null)).toEqual({ current: null, stash: null });
	});
});

describe("planChatStep", () => {
	it("walks to neighbors and stops at the oldest end", () => {
		const { state } = stateWith(freshStore());
		expect(planChatStep([], "x" as ChatId, 1)).toEqual({ kind: "none" });
		newChat(state);
		newChat(state);
		const [older, newer] = state.chats;
		expect(planChatStep(state.chats, newer!.id, -1)).toEqual({
			kind: "goto",
			id: older!.id,
			index: 0
		});
		expect(planChatStep(state.chats, older!.id, -1)).toEqual({ kind: "none" });
	});

	it("mints past a full newest chat, stays on an empty one", () => {
		const { state } = stateWith(freshStore());
		newChat(state);
		// Single empty chat: stepping down stays (never piles blanks).
		expect(planChatStep(state.chats, state.activeChatId, 1)).toEqual({
			kind: "stay"
		});
		stageMessage(state, "hi");
		expect(planChatStep(state.chats, state.activeChatId, 1)).toEqual({
			kind: "mint"
		});
	});
});

describe("clampChatIndex", () => {
	it("clamps into range, null when empty", () => {
		expect(clampChatIndex(5, 3)).toBe(2);
		expect(clampChatIndex(-2, 3)).toBe(0);
		expect(clampChatIndex(1, 3)).toBe(1);
		expect(clampChatIndex(0, 0)).toBeNull();
	});
});

describe("messageIndexFromId", () => {
	it("parses msg-{index} ids within the list", () => {
		expect(messageIndexFromId("msg-0", 3)).toBe(0);
		expect(messageIndexFromId("msg-2", 3)).toBe(2);
		expect(messageIndexFromId("msg-3", 3)).toBeNull();
		expect(messageIndexFromId("msg-x", 3)).toBeNull();
		expect(messageIndexFromId("other-1", 3)).toBeNull();
	});
});

describe("history compaction", () => {
	function seedTurns(state: ChatState, turns: number, chars: number): void {
		const chat = activeChat(state);
		for (let i = 0; i < turns; i++) {
			chat.messages = [
				...chat.messages,
				{
					id: newChatMsgId(),
					role: "user",
					content: `u${i} ${"x".repeat(chars)}`,
					usage: null,
					error: null
				},
				{
					id: newChatMsgId(),
					role: "assistant",
					content: `a${i} ${"y".repeat(chars)}`,
					usage: null,
					error: null
				}
			];
		}
	}

	function countingProvider(summary: string): {
		provider: ChatProvider;
		chats: ChatMessage[][];
		streams: ChatMessage[][];
	} {
		const chats: ChatMessage[][] = [];
		const streams: ChatMessage[][] = [];
		const usage = { prompt: 1, completion: 1, total: 2 };
		return {
			provider: {
				id: "counting",
				async chat(messages): Promise<ChatResult> {
					chats.push(messages);
					return { content: summary, usage };
				},
				async stream(messages, callbacks): Promise<ChatResult> {
					streams.push(messages);
					callbacks.onToken("hi");
					return { content: "hi", usage };
				}
			},
			chats,
			streams
		};
	}

	it("estimates tokens at chars/4, rounded up", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("abcde")).toBe(2);
	});

	it("keeps small chats whole with no fold", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 3, 10);
		const chat = activeChat(state);
		const window = selectHistoryWindow(chat);
		expect(window.summary).toBeNull();
		expect(window.turns.map((m) => m.id)).toEqual(
			chat.messages.map((m) => m.id)
		);
		expect(window.fold).toEqual([]);
	});

	it("windows large chats newest-first and folds the oldest", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 10, 4000);
		const chat = activeChat(state);
		const window = selectHistoryWindow(chat);
		// No overlap, fold strictly older than turns (a dropped
		// middle may sit between them on giant histories — it folds
		// on later sends).
		const turnIds = new Set(window.turns.map((m) => m.id));
		const foldIds = window.fold.map((m) => m.id);
		expect(foldIds.length).toBeGreaterThan(0);
		expect(foldIds.every((id) => !turnIds.has(id))).toBe(true);
		const firstTurn = chat.messages.findIndex(
			(m) => m.id === window.turns[0]?.id
		);
		const lastFold = chat.messages.findIndex(
			(m) => m.id === foldIds[foldIds.length - 1]
		);
		expect(lastFold).toBeLessThan(firstTurn);
		// Window bounded, newest kept.
		const chars = window.turns.reduce((n, m) => n + m.content.length, 0);
		expect(chars).toBeLessThanOrEqual(HISTORY_WINDOW_CHARS);
		expect(window.turns[window.turns.length - 1]?.content).toContain("a9");
	});

	it("always keeps the floor count verbatim, however large", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 1, HISTORY_WINDOW_CHARS);
		const untouchable = selectHistoryWindow(activeChat(state));
		// Two giant messages: both stay, nothing folds (chat cap,
		// never per-message).
		expect(untouchable.turns).toHaveLength(2);
		expect(untouchable.fold).toEqual([]);
		seedTurns(state, 2, HISTORY_WINDOW_CHARS);
		const floored = selectHistoryWindow(activeChat(state));
		expect(floored.turns).toHaveLength(MIN_VERBATIM_MESSAGES);
		// One giant per round (each counts capped at the fold
		// budget): the watermark still advances instead of wedging.
		expect(floored.fold).toHaveLength(1);
	});

	it("resumes after the watermark and heals an orphaned one", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 3, 10);
		const chat = activeChat(state);
		const through = chat.messages[1]?.id;
		if (!through) throw new Error("seed failed");
		chat.summary = "old stuff";
		chat.summaryThrough = through;
		const resumed = selectHistoryWindow(chat);
		expect(resumed.summary).toBe("old stuff");
		expect(resumed.turns.map((m) => m.id)).toEqual(
			chat.messages.slice(2).map((m) => m.id)
		);
		// Watermark id gone (deleted, truncated): the orphaned
		// summary drops and the full history is eligible again —
		// lossless, since compaction never deletes messages.
		chat.summaryThrough = newChatMsgId();
		const healed = selectHistoryWindow(chat);
		expect(healed.summary).toBeNull();
		expect(healed.turns).toHaveLength(chat.messages.length);
	});

	it("excludes the live placeholder and failed replies", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 3, 10);
		const chat = activeChat(state);
		const last = chat.messages[chat.messages.length - 1];
		if (!last) throw new Error("seed failed");
		const window = selectHistoryWindow(chat, last.id);
		expect(window.turns.map((m) => m.id)).not.toContain(last.id);
		expect(window.fold.map((m) => m.id)).not.toContain(last.id);
		const failed = chat.messages[0];
		if (!failed || failed.role !== "user") throw new Error("seed failed");
		const failedReply = chat.messages[1];
		if (!failedReply) throw new Error("seed failed");
		chat.messages = chat.messages.map((m) =>
			m.id === failedReply.id ? { ...m, error: "boom" } : m
		);
		const dropped = selectHistoryWindow(activeChat(state));
		expect(dropped.turns.map((m) => m.id)).not.toContain(failedReply.id);
	});

	it("sends the summary as a labeled second system message", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 2, 10);
		const chat = activeChat(state);
		const api = buildApiMessages(chat, "sys");
		expect(api.map((m) => m.role)).toEqual([
			"system",
			"user",
			"assistant",
			"user",
			"assistant"
		]);
		const through = chat.messages[1]?.id;
		if (!through) throw new Error("seed failed");
		chat.summary = "old stuff";
		chat.summaryThrough = through;
		const compacted = buildApiMessages(chat, "sys");
		expect(compacted.map((m) => m.role)).toEqual([
			"system",
			"system",
			"user",
			"assistant"
		]);
		expect(compacted[1]).toEqual({
			role: "system",
			content: summaryBlock("old stuff")
		});
		expect(summaryBlock("old stuff")).toContain("old stuff");
	});

	it("renders fold turns as labeled lines for the refresh call", () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 1, 0);
		const chat = activeChat(state);
		expect(renderFoldText(chat.messages)).toBe("User: u0 \n\nAssistant: a0 ");
		const messages = buildSummaryRefreshMessages(null, "folded");
		expect(messages).toHaveLength(2);
		expect(messages[1]?.content).toBe("folded");
		const merged = buildSummaryRefreshMessages("prior", "folded");
		expect(merged[1]?.content).toContain("Previous summary:\nprior");
		expect(merged[1]?.content).toContain("More history:\nfolded");
		expect(messages[0]?.content).toContain("400 words");
	});

	it("refreshes once on overflow and persists summary plus watermark", async () => {
		const store = freshStore();
		const { state } = stateWith(store);
		seedTurns(state, 10, 4000);
		const { provider, chats } = countingProvider("  fresh summary  ");
		await refreshChatSummary(state, activeChat(state), provider, {}, store);
		expect(chats).toHaveLength(1);
		expect(chats[0]).toHaveLength(2);
		const chat = activeChat(state);
		expect(chat.summary).toBe("fresh summary");
		const through = chat.summaryThrough;
		expect(through).toBeDefined();
		const persisted = JSON.parse(
			store.data.get("ccez-llm-chats-v1") ?? "[]"
		) as Array<{ summary?: string }>;
		expect(persisted[0]?.summary).toBe("fresh summary");
		// Giant histories converge over refreshes, then go quiet (no
		// call once the watermark covers everything past the window).
		await refreshChatSummary(state, activeChat(state), provider, {});
		await refreshChatSummary(state, activeChat(state), provider, {});
		expect(chats).toHaveLength(2);
		expect(chat.summaryThrough).not.toBe(through);
	});

	it("never calls for chats under the cap", async () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 2, 10);
		const { provider, chats } = countingProvider("unused");
		await refreshChatSummary(state, activeChat(state), provider, {});
		expect(chats).toHaveLength(0);
		expect(activeChat(state).summary).toBeUndefined();
	});

	it("fails silent so the send still goes out windowed", async () => {
		const { state, store } = stateWith(freshStore());
		seedTurns(state, 10, 4000);
		const failing: ChatProvider = {
			id: "failing",
			async chat(): Promise<ChatResult> {
				throw new Error("down");
			},
			async stream(_messages, callbacks): Promise<ChatResult> {
				callbacks.onToken("hi");
				return {
					content: "hi",
					usage: { prompt: 1, completion: 1, total: 2 }
				};
			}
		};
		await refreshChatSummary(state, activeChat(state), failing, {});
		expect(activeChat(state).summary).toBeUndefined();
		// And the full send still lands (bounded fallback).
		await sendMessage(state, failing, "sys", "again", {}, store);
		const messages = activeChat(state).messages;
		expect(messages[messages.length - 1]?.content).toBe("hi");
		expect(messages[messages.length - 1]?.error).toBeNull();
	});

	it("rethrows a stop instead of swallowing it", async () => {
		const { state } = stateWith(freshStore());
		seedTurns(state, 10, 4000);
		const controller = new AbortController();
		controller.abort();
		const aborting: ChatProvider = {
			id: "aborting",
			async chat(): Promise<ChatResult> {
				throw new DOMException("aborted", "AbortError");
			},
			async stream(_messages, callbacks): Promise<ChatResult> {
				callbacks.onToken("hi");
				return {
					content: "hi",
					usage: { prompt: 1, completion: 1, total: 2 }
				};
			}
		};
		await expect(
			refreshChatSummary(state, activeChat(state), aborting, {
				signal: controller.signal
			})
		).rejects.toThrow();
		expect(activeChat(state).summary).toBeUndefined();
	});

	it("sends overflowed chats with the fresh summary ahead of the window", async () => {
		const { state, store } = stateWith(freshStore());
		seedTurns(state, 10, 4000);
		const { provider, chats, streams } = countingProvider("rolled up");
		await sendMessage(state, provider, "sys", "one more", {}, store);
		expect(chats).toHaveLength(1);
		expect(streams).toHaveLength(1);
		const sent = streams[0] ?? [];
		expect(sent[0]).toEqual({ role: "system", content: "sys" });
		expect(sent[1]).toEqual({
			role: "system",
			content: summaryBlock("rolled up")
		});
		// Oldest turns folded out of the verbatim window.
		const text = JSON.stringify(sent);
		expect(text).not.toContain("u0 xxxx");
		expect(text).toContain("one more");
		expect(activeChat(state).summary).toBe("rolled up");
	});
});

describe("manual trim", () => {
	function seedLong(state: ChatState, turns: number, chars: number): void {
		const chat = activeChat(state);
		for (let i = 0; i < turns; i++) {
			for (const role of ["user", "assistant"] as const) {
				chat.messages = [
					...chat.messages,
					{
						id: newChatMsgId(),
						role,
						content: `${role}${i} ${"z".repeat(chars)}`,
						usage: null,
						error: null
					}
				];
			}
		}
	}

	function recording(summary: string): {
		provider: ChatProvider;
		chats: ChatMessage[][];
	} {
		const chats: ChatMessage[][] = [];
		const usage = { prompt: 1, completion: 1, total: 2 };
		return {
			provider: {
				id: "recording",
				async chat(messages): Promise<ChatResult> {
					chats.push(messages);
					return { content: summary, usage };
				},
				async stream(): Promise<ChatResult> {
					throw new Error("no stream in trim tests");
				}
			},
			chats
		};
	}

	it("pins the trim point by id and heals a deleted one", () => {
		const { state, store } = stateWith(freshStore());
		seedLong(state, 2, 10);
		const chat = activeChat(state);
		expect(trimPointIndex(chat)).toBe(-1);
		const top = chat.messages[2];
		if (!top) throw new Error("seed short");
		setTrimPoint(state, chat, top.id, store);
		expect(trimPointIndex(chat)).toBe(2);
		const persisted = JSON.parse(
			store.data.get("ccez-llm-chats-v1") ?? "[]"
		) as Array<{ trimmedThrough?: string }>;
		expect(persisted[0]?.trimmedThrough).toBe(top.id);
		setTrimPoint(state, chat, null, store);
		expect(trimPointIndex(chat)).toBe(-1);
		chat.trimmedThrough = newChatMsgId();
		expect(trimPointIndex(chat)).toBe(-1);
	});

	it("folds the uncovered prefix and keeps the top message verbatim", async () => {
		const store = freshStore();
		const { state } = stateWith(store);
		seedLong(state, 4, 800);
		const chat = activeChat(state);
		const top = chat.messages[5];
		if (!top) throw new Error("seed short");
		const { provider, chats } = recording("trimmed down");
		const folded = await refreshTrimSummary(
			state,
			chat,
			provider,
			top.id,
			{},
			store
		);
		expect(folded).toBe(5);
		expect(chats).toHaveLength(1);
		// The watermark stops below the top message (it stays on
		// screen, so it must stay in context verbatim).
		expect(chat.summary).toBe("trimmed down");
		expect(chat.summaryThrough).toBe(chat.messages[4]?.id);
		const sent = buildApiMessages(chat, "sys");
		expect(sent[1]).toEqual({
			role: "system",
			content: summaryBlock("trimmed down")
		});
		const text = JSON.stringify(sent);
		expect(text).not.toContain("user0");
		expect(text).toContain(top.content.slice(0, 20));
		const persisted = JSON.parse(
			store.data.get("ccez-llm-chats-v1") ?? "[]"
		) as Array<{ summary?: string }>;
		expect(persisted[0]?.summary).toBe("trimmed down");
	});

	it("skips covered prefixes and folds only the rest on retrim", async () => {
		const { state } = stateWith(freshStore());
		seedLong(state, 5, 800);
		const chat = activeChat(state);
		const first = chat.messages[3];
		const second = chat.messages[7];
		if (!first || !second) throw new Error("seed short");
		const { provider, chats } = recording("first pass");
		await refreshTrimSummary(state, chat, provider, first.id);
		expect(chats).toHaveLength(1);
		// Same point again: covered, no call.
		expect(await refreshTrimSummary(state, chat, provider, first.id)).toBe(0);
		expect(chats).toHaveLength(1);
		// Later point: folds only the gap, merging the prior.
		const folded = await refreshTrimSummary(state, chat, provider, second.id);
		expect(folded).toBe(4);
		expect(chats).toHaveLength(2);
		expect(chats[1]?.[1]?.content).toContain("Previous summary:\nfirst pass");
		expect(chat.summaryThrough).toBe(chat.messages[6]?.id);
	});

	it("calls nothing below the floor, at the head, or off-chat", async () => {
		const { state } = stateWith(freshStore());
		seedLong(state, 2, 10);
		const chat = activeChat(state);
		const { provider, chats } = recording("unused");
		const top = chat.messages[3];
		if (!top) throw new Error("seed short");
		expect(await refreshTrimSummary(state, chat, provider, top.id)).toBe(0);
		const head = chat.messages[0];
		if (!head) throw new Error("seed short");
		expect(await refreshTrimSummary(state, chat, provider, head.id)).toBe(0);
		expect(
			await refreshTrimSummary(state, chat, provider, newChatMsgId())
		).toBe(0);
		expect(chats).toHaveLength(0);
		expect(chat.summary).toBeUndefined();
	});

	it("skips failed replies in the fold like the window does", async () => {
		const { state } = stateWith(freshStore());
		seedLong(state, 3, 800);
		const chat = activeChat(state);
		const failed = chat.messages[1];
		if (!failed) throw new Error("seed short");
		failed.error = "down";
		const top = chat.messages[4];
		if (!top) throw new Error("seed short");
		const { provider, chats } = recording("no failures");
		const folded = await refreshTrimSummary(state, chat, provider, top.id);
		expect(folded).toBe(3);
		const foldText = chats[0]?.[1]?.content ?? "";
		expect(foldText).not.toContain("assistant0");
		expect(foldText).toContain("user0");
	});

	it("throws on model failure and leaves the summary alone", async () => {
		const { state } = stateWith(freshStore());
		seedLong(state, 4, 800);
		const chat = activeChat(state);
		const top = chat.messages[5];
		if (!top) throw new Error("seed short");
		const failing: ChatProvider = {
			id: "failing",
			async chat(): Promise<ChatResult> {
				throw new Error("down");
			},
			async stream(): Promise<ChatResult> {
				throw new Error("down");
			}
		};
		await expect(
			refreshTrimSummary(state, chat, failing, top.id)
		).rejects.toThrow("down");
		expect(chat.summary).toBeUndefined();
		expect(chat.summaryThrough).toBeUndefined();
	});
});

describe("chat titles", () => {
	async function answered(reply = "Über means over.") {
		const { state, store } = stateWith(freshStore());
		await sendMessage(
			state,
			scriptedProvider([reply]),
			"sys",
			"Was heißt über?",
			{},
			store
		);
		return { state, store, chat: activeChat(state) };
	}

	it("cleans a model title to one plain line", () => {
		expect(cleanTitle('Title: "Deutsche Präpositionen".\nmore')).toBe(
			"Deutsche Präpositionen"
		);
		expect(cleanTitle("**«Le mot fenêtre»**")).toBe("Le mot fenêtre");
		expect(cleanTitle("x".repeat(200))).toHaveLength(60);
		expect(cleanTitle("   ")).toBe("");
	});

	it("asks with the opening exchange only once a reply exists", async () => {
		const { chat } = await answered();
		const messages = buildTitleMessages(chat);
		expect(messages?.[0]?.role).toBe("system");
		const ask = messages?.[1]?.content;
		expect(typeof ask === "string" ? ask : "").toContain("Was heißt über?");
		expect(typeof ask === "string" ? ask : "").toContain("Über means over.");
		expect(
			buildTitleMessages({ ...chat, messages: chat.messages.slice(0, 1) })
		).toBeNull();
	});

	it("names an untitled chat and persists it", async () => {
		const { state, store, chat } = await answered();
		await generateChatTitle(
			state,
			chat,
			scriptedProvider(["Bedeutung von über."]),
			store
		);
		expect(activeChat(state).title).toBe("Bedeutung von über");
		expect(activeChat(state).titleBy).toBe("ai");
		expect(
			createChatState(store).chats.find((c) => c.id === chat.id)?.title
		).toBe("Bedeutung von über");
	});

	it("never overwrites a rename, and stays silent on failure", async () => {
		const { state, store, chat } = await answered();
		renameChat(state, chat.id, "  My German  ", store);
		await generateChatTitle(
			state,
			chat,
			scriptedProvider(["Model name"]),
			store
		);
		expect(activeChat(state).title).toBe("My German");
		expect(activeChat(state).titleBy).toBe("user");
		const failing: ChatProvider = {
			...scriptedProvider([]),
			async chat(): Promise<ChatResult> {
				throw new Error("offline");
			}
		};
		renameChat(state, chat.id, "", store);
		expect(activeChat(state).title).toBeUndefined();
		await generateChatTitle(state, chat, failing, store);
		expect(activeChat(state).title).toBeUndefined();
	});

	it("lets a rename that lands mid-call win", async () => {
		const { state, store, chat } = await answered();
		const slow: ChatProvider = {
			...scriptedProvider([]),
			async chat(): Promise<ChatResult> {
				renameChat(state, chat.id, "Mine", store);
				return {
					content: "Model name",
					usage: { prompt: 1, completion: 1, total: 2 }
				};
			}
		};
		await generateChatTitle(state, chat, slow, store);
		expect(activeChat(state).title).toBe("Mine");
	});
});
