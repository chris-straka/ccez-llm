import {
	type ChatMessage,
	type ChatOptions,
	type ChatProvider,
	type ChatResult,
	type StreamCallbacks,
	type TokenUsage,
	ProviderError
} from "./types";
import { thinkingFor, resolveThinkingId } from "./thinking";
import {
	DEEPSEEK_WEB_TOOLS,
	deepseekErrorCopy,
	isDeepSeekProvider,
	streamErrorCopy
} from "./deepseek";
import { APP_HELP_URL, appHelpHere } from "../app-help";
import { fetchToolDef, parseFetchCall } from "../tools";
import { fetchPageText } from "../fetchPage";

export interface OpenAICompatConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	/** Runtime-only, never persisted: phones run no loopback server, so
	a dead on-device endpoint reads differently there (never Ollama). */
	mobile?: boolean;
}

/** Injected seams (tests); the live default fetches real pages. */
export interface OpenAICompatDeps {
	fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>;
	/** `/models` outside the webview (gateways without CORS headers):
	 * raw status and body, parsed and worded here like a fetch. */
	listModelsNative?: (
		baseUrl: string,
		apiKey: string
	) => Promise<{ status: number; body: string }>;
}

/** One model tool call off the wire. */
interface WireToolCall {
	id: string;
	type: string;
	function: { name: string; arguments: string };
}

/**
 * History entries the tool loop appends: plain turns plus the
 * assistant `tool_calls` message and `tool` results. UI messages never
 * carry these — the loop works on its own copy.
 */
type WireMessage =
	| ChatMessage
	| { role: "assistant"; content: string; tool_calls: WireToolCall[] }
	| { role: "tool"; content: string; tool_call_id: string };

/** Tool rounds per streamed turn (each may fetch several pages). */
const MAX_TOOL_ROUNDS = 3;
/** Fetches executed per round (serially, abort-aware). */
const MAX_CALLS_PER_ROUND = 3;
/** Extra streamed rounds when the final answer keeps calling fetch
 * (each retracts its prefix, runs the calls, and re-streams). */
const EXTRA_FINAL_ROUNDS = 2;

/** One streamed round's text, tool calls and usage, plus DeepSeek's
 * extras (its thinking, web-tool steps and citations) when it sent them. */
interface StreamedRound {
	content: string;
	calls: WireToolCall[];
	usage: TokenUsage | null;
	reasoning: string;
	serverToolCalls: unknown[] | undefined;
	cited: string[];
}

/** A message as this provider receives it: DeepSeek's extension fields
 * (`reasoning_content`, `server_tool_calls`) go to DeepSeek only. */
function forProvider(message: WireMessage, deepseek: boolean): WireMessage {
	if (deepseek || message.role !== "assistant") return message;
	if (!("reasoning_content" in message) && !("server_tool_calls" in message))
		return message;
	const plain: ChatMessage = { ...message };
	delete plain.reasoning_content;
	delete plain.server_tool_calls;
	return plain;
}

/** Cited addresses from DeepSeek's `annotations` (url_citation items). */
function citedUrls(annotations: unknown): string[] {
	if (!Array.isArray(annotations)) return [];
	const out: string[] = [];
	for (const item of annotations) {
		const url = (item as { url_citation?: { url?: unknown } } | null)
			?.url_citation?.url;
		if (typeof url === "string" && url && !out.includes(url)) out.push(url);
	}
	return out;
}

/**
 * Minimal OpenAI-compatible chat client used by every provider in this
 * app (DeepSeek, OpenCode Zen, on-device servers, custom endpoints). No
 * SDK dependency: plain fetch + SSE.
 */
export class OpenAICompatProvider implements ChatProvider {
	readonly id: string;
	private readonly config: OpenAICompatConfig;
	private readonly deps: OpenAICompatDeps;

	constructor(id: string, config: OpenAICompatConfig, deps?: OpenAICompatDeps) {
		this.id = id;
		this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
		this.deps = deps ?? {};
	}

	private url(path: string): string {
		return `${this.config.baseUrl}${path}`;
	}

	/**
	 * Fetch-level failure, translated: a user stop is never a network
	 * error (the stop button would report one otherwise); a dead
	 * loopback server names its remedy (Ollama isn't running) instead
	 * of reading as generic net trouble — except on phones, where no
	 * loopback server can run and the message says so without naming
	 * Ollama; remote endpoints keep the generic wording.
	 */
	private connectionError(error: unknown): ProviderError {
		if (error instanceof Error && error.name === "AbortError") {
			return new ProviderError("Reply stopped.");
		}
		if (isLoopbackBaseUrl(this.config.baseUrl)) {
			if (this.config.mobile) {
				return new ProviderError(
					`${this.id} can't use an on-device model on this phone (phones run no local server): ${messageOf(error)}`
				);
			}
			return new ProviderError(
				`${this.id} needs Ollama running on this device (start it with 'ollama serve'): ${messageOf(error)}`
			);
		}
		if (this.id === "deepseek-mac") {
			return new ProviderError(
				`Couldn't reach DeepSeek through the Mac (ccez-words on z, over the tailnet): ${messageOf(error)}`
			);
		}
		return new ProviderError(
			`Network error talking to ${this.id}: ${messageOf(error)}`
		);
	}

	private headers(): Record<string, string> {
		// Keyless on-device servers (Ollama) take no credentials: sending one:
		// An empty credential header would only confuse request logs.
		if (!this.config.apiKey) return { "Content-Type": "application/json" };
		return {
			"Content-Type": "application/json",
			Authorization: `Bearer ${this.config.apiKey}`
		};
	}

	private get deepseek(): boolean {
		return isDeepSeekProvider(this.id);
	}

	private body(
		messages: WireMessage[],
		stream: boolean,
		thinking?: string,
		tools?: boolean
	): string {
		// Native thinking knob for this provider + model (unknown ids and
		// knob-less providers resolve to no extra fields).
		const support = thinkingFor(this.id, this.config.model);
		const extra = support.wireFields(resolveThinkingId(support, thinking));
		const deepseek = this.deepseek;
		// DeepSeek searches and reads pages itself (its web tools can't
		// share a request with function tools); everyone else gets the
		// app's own fetch_url.
		const toolFields =
			tools !== true
				? {}
				: deepseek
					? { tools: DEEPSEEK_WEB_TOOLS }
					: { tools: [fetchToolDef()], tool_choice: "auto" };
		return JSON.stringify({
			model: this.config.model,
			messages: messages.map((m) => forProvider(m, deepseek)),
			stream,
			...(stream && deepseek
				? { stream_options: { include_usage: true } }
				: {}),
			...extra,
			...toolFields
		});
	}

	/** Quick work's thinking: the provider's quick level when it has
	 * one (DeepSeek: off), else the caller's. */
	private quickThinking(thinking: string | undefined): string | undefined {
		return thinkingFor(this.id, this.config.model).quickId ?? thinking;
	}

	/** A failed HTTP answer as an error: DeepSeek's statuses in words,
	 * everyone else's with the server's own text. */
	private httpError(kind: string, status: number, text: string): ProviderError {
		const copy = this.deepseek ? deepseekErrorCopy(status, text) : null;
		return new ProviderError(
			copy ??
				`${this.id} ${kind} failed (HTTP ${status}): ${text.slice(0, 300)}`,
			status
		);
	}

	/**
	 * One whole answer, no tools: every quick call (notes, titles,
	 * summaries, translation, grading) comes through here, so DeepSeek
	 * answers these with thinking off whatever the chat's dial says.
	 */
	async chat(
		messages: ChatMessage[],
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		let res: Response;
		try {
			res = await fetch(this.url("/chat/completions"), {
				method: "POST",
				headers: this.headers(),
				body: this.body(messages, false, this.quickThinking(opts.thinking)),
				// DOM takes null for absent, not undefined.
				signal: opts.signal ?? null
			});
		} catch (error) {
			throw this.connectionError(error);
		}
		if (!res.ok) {
			throw this.httpError("request", res.status, await safeText(res));
		}
		const json = (await res.json()) as {
			error?: unknown;
			choices?: Array<{ message?: { content?: string } }>;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
				completion_tokens_details?: { reasoning_tokens?: number };
			};
		};
		// A generation that failed after it started still answers 200,
		// with `error` in the body (DeepSeek).
		const failed = this.deepseek ? streamErrorCopy(json) : null;
		if (failed) throw new ProviderError(failed);
		return {
			content: json.choices?.[0]?.message?.content ?? "",
			usage: toUsage(json.usage)
		};
	}

	/**
	 * One non-streaming turn with tools offered. Resolves the text plus
	 * the raw tool calls (transport only — no token output).
	 */
	private async complete(
		history: WireMessage[],
		opts: ChatOptions,
		tools: boolean
	): Promise<{
		content: string;
		calls: WireToolCall[];
		usage: TokenUsage | null;
	}> {
		let res: Response;
		try {
			res = await fetch(this.url("/chat/completions"), {
				method: "POST",
				headers: this.headers(),
				body: this.body(history, false, opts.thinking, tools),
				// DOM takes null for absent, not undefined.
				signal: opts.signal ?? null
			});
		} catch (error) {
			throw this.connectionError(error);
		}
		if (!res.ok) {
			throw this.httpError("request", res.status, await safeText(res));
		}
		const json = (await res.json()) as {
			choices?: Array<{
				message?: { content?: string | null; tool_calls?: WireToolCall[] };
			}>;
			usage?: Parameters<typeof toUsage>[0];
		};
		const message = json.choices?.[0]?.message;
		return {
			content: message?.content ?? "",
			calls: Array.isArray(message?.tool_calls)
				? (message.tool_calls ?? [])
				: [],
			usage: toUsage(json.usage)
		};
	}

	/**
	 * One fetch call run to text. Page failures read as one-line
	 * results (the model reports them in its reply); a user stop
	 * still stops.
	 */
	private async runFetch(
		call: { id: string; url: string },
		signal: AbortSignal | undefined
	): Promise<string> {
		// The app's own guide answers its reserved address, never the
		// network (app-help.ts).
		if (call.url === APP_HELP_URL) return appHelpHere();
		const run = this.deps.fetchPage ?? fetchPageText;
		try {
			return await run(call.url, signal);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError")
				throw new ProviderError("Reply stopped.");
			return error instanceof Error ? error.message : "Page fetch failed.";
		}
	}

	/**
	 * One streaming turn, optionally offering tools. Resolves the
	 * streamed text plus any tool calls the model assembled in the
	 * deltas (streaming tool calls arrive fragmented by index and are
	 * joined here). Token output flows through `callbacks` as before.
	 */
	private async streamOnce(
		history: WireMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions,
		tools: boolean
	): Promise<StreamedRound> {
		let res: Response;
		try {
			res = await fetch(this.url("/chat/completions"), {
				method: "POST",
				headers: { ...this.headers(), Accept: "text/event-stream" },
				body: this.body(history, true, opts.thinking, tools),
				// DOM takes null for absent, not undefined.
				signal: opts.signal ?? null
			});
		} catch (error) {
			throw this.connectionError(error);
		}
		if (!res.ok || !res.body) {
			throw this.httpError("stream", res.status, await safeText(res));
		}
		let content = "";
		let usage: TokenUsage | null = null;
		// DeepSeek: thinking streams in `reasoning_content`; the reply
		// keeps its last step's (what the API's own message holds), so
		// each `step_reasoning_done` starts it over.
		let reasoning = "";
		let serverToolCalls: unknown[] | undefined;
		let cited: string[] = [];
		let failure: string | null = null;
		const fragments = new Map<
			number,
			{ id: string; name: string; args: string }
		>();
		// Some compatible servers omit each call's index: a new id
		// opens a new call, a fragment without one continues the last
		// (same rule as turn.rs, so parallel calls never merge).
		let lastSlot = -1;
		const placeFragment = (
			slots: Map<number, { id: string }>,
			id: string | undefined
		): number => {
			const last = slots.get(lastSlot);
			if (!last) return 0;
			return id && last.id && id !== last.id
				? Math.max(...slots.keys()) + 1
				: lastSlot;
		};
		// Mid-stream failures translate like fetch-level ones: a cut
		// connection reads as a network error, a user stop as stopped
		// (never the raw "This operation was aborted").
		try {
			for await (const event of readSse(res.body)) {
				if (event === "[DONE]") break;
				let parsed: {
					error?: unknown;
					choices?: Array<{
						delta?: {
							content?: string | null;
							reasoning_content?: string | null;
							server_tool_calls?: unknown;
							annotations?: unknown;
							tool_calls?: Array<{
								index?: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}>;
						};
						server_tool_event?: unknown;
					}>;
					usage?: Parameters<typeof toUsage>[0];
				};
				try {
					parsed = JSON.parse(event) as typeof parsed;
				} catch {
					continue;
				}
				if (parsed === null || typeof parsed !== "object") continue;
				// A failure after the reply started: the last chunk
				// carries `error` and no [DONE] follows.
				const streamFailure = streamErrorCopy(
					parsed,
					this.deepseek ? "DeepSeek" : this.id
				);
				if (streamFailure) {
					failure = streamFailure;
					break;
				}
				const choice = parsed.choices?.[0];
				const delta = choice?.delta;
				const thought = delta?.reasoning_content;
				if (typeof thought === "string") reasoning += thought;
				const toolEvent = choice?.server_tool_event;
				if (toolEvent && typeof toolEvent === "object") {
					if ((toolEvent as { type?: unknown }).type === "step_reasoning_done")
						reasoning = "";
					callbacks.onLookup?.(toolEvent);
				}
				if (Array.isArray(delta?.server_tool_calls))
					serverToolCalls = delta.server_tool_calls;
				if (delta?.annotations !== undefined)
					cited = citedUrls(delta.annotations);
				const token = typeof delta?.content === "string" ? delta.content : "";
				if (token) {
					content += token;
					callbacks.onToken(token);
				}
				for (const call of delta?.tool_calls ?? []) {
					const index = call.index ?? placeFragment(fragments, call.id);
					lastSlot = index;
					const slot = fragments.get(index) ?? { id: "", name: "", args: "" };
					if (call.id) slot.id = call.id;
					if (call.function?.name) slot.name += call.function.name;
					if (call.function?.arguments) slot.args += call.function.arguments;
					fragments.set(index, slot);
				}
				if (parsed.usage) usage = toUsage(parsed.usage);
			}
		} catch (error) {
			throw this.connectionError(error);
		}
		if (failure !== null) throw new ProviderError(failure);
		const calls: WireToolCall[] = [...fragments.values()]
			.filter((slot) => slot.id && slot.name)
			.map((slot) => ({
				id: slot.id,
				type: "function",
				function: { name: slot.name, arguments: slot.args }
			}));
		return { content, calls, usage, reasoning, serverToolCalls, cited };
	}

	/**
	 * DeepSeek's turn: one stream with its own web tools, which it runs
	 * itself (nothing executes here). A 400 with them on (an endpoint
	 * that refuses the tools) gets one plain turn, like the fetch path.
	 */
	private async streamDeepSeek(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions
	): Promise<ChatResult> {
		let round: StreamedRound;
		try {
			round = await this.streamOnce(messages, callbacks, opts, true);
		} catch (error) {
			if (!(error instanceof ProviderError) || error.status !== 400)
				throw error;
			round = await this.streamOnce(messages, callbacks, opts, false);
		}
		return {
			content: round.content,
			usage: round.usage,
			...(round.reasoning ? { reasoning: round.reasoning } : {}),
			...(round.serverToolCalls
				? { serverToolCalls: round.serverToolCalls }
				: {}),
			...(round.cited.length > 0 ? { cited: round.cited } : {})
		};
	}

	/** Fetch calls worth executing from one round's raw calls (capped). */
	private executableCalls(calls: WireToolCall[]): Array<{
		raw: WireToolCall;
		parsed: { id: string; url: string };
	}> {
		return calls
			.map((raw) => ({ raw, parsed: parseFetchCall(raw) }))
			.filter(
				(
					entry
				): entry is {
					raw: WireToolCall;
					parsed: { id: string; url: string };
				} => entry.parsed !== null
			)
			.slice(0, MAX_CALLS_PER_ROUND);
	}

	/**
	 * One fetch batch run into the history: the assistant tool_calls
	 * message first, then each page's text (or its one-line failure)
	 * as a tool result. Abort-aware; the fetch phase brackets each
	 * page. Shared by the follow-up rounds and the extra final
	 * rounds below.
	 */
	private async runFetchBatch(
		history: WireMessage[],
		assistantText: string,
		pending: Array<{
			raw: WireToolCall;
			parsed: { id: string; url: string };
		}>,
		callbacks: StreamCallbacks,
		opts: ChatOptions
	): Promise<void> {
		history.push({
			role: "assistant",
			content: assistantText,
			tool_calls: pending.map((entry) => entry.raw)
		});
		for (const entry of pending) {
			if (opts.signal?.aborted) throw new ProviderError("Reply stopped.");
			callbacks.onFetchStart?.(entry.parsed.url);
			try {
				history.push({
					role: "tool",
					content: await this.runFetch(entry.parsed, opts.signal),
					tool_call_id: entry.parsed.id
				});
			} finally {
				callbacks.onFetchEnd?.();
			}
		}
	}

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		// Model-driven lookup: the first request streams WITH tools, so
		// a no-fetch turn costs exactly one request, like before. When
		// the model calls fetch_url, the calls run serially into the
		// history (follow-up fetches ride capped non-streaming rounds;
		// a follow-up that answers with no calls IS the reply) and the
		// answer streams last — with tools still on, so a last "let me
		// try another source" can act instead of stalling. Providers
		// that reject `tools` fall back to a plain turn once; anything
		// else throws exactly as before.
		if (this.deepseek) return this.streamDeepSeek(messages, callbacks, opts);
		const history: WireMessage[] = [...messages];
		let first: StreamedRound;
		try {
			first = await this.streamOnce(history, callbacks, opts, true);
		} catch (error) {
			if (!(error instanceof ProviderError) || error.status !== 400)
				throw error;
			return this.streamOnce(history, callbacks, opts, false);
		}
		let pending = this.executableCalls(first.calls);
		if (pending.length === 0) {
			// Only unusable calls (unknown tool, bare domain, cut-off
			// arguments) and no text: ask once more without tools rather
			// than file a blank reply. Same rule as `turn.rs`.
			if (first.content.trim() === "" && first.calls.length > 0) {
				const plain = await this.streamOnce(history, callbacks, opts, false);
				return { content: plain.content, usage: plain.usage ?? first.usage };
			}
			return { content: first.content, usage: first.usage };
		}
		// Tool round: the streamed prefix was provisional chatter, not
		// the answer — retract it (thinking dots again) before the
		// fetch runs, so the reply never shows text the final round
		// later replaces.
		callbacks.onRoundRetract?.();
		let usage: TokenUsage | null = first.usage;
		let assistantText = first.content;
		for (
			let round = 0;
			round < MAX_TOOL_ROUNDS && pending.length > 0;
			round++
		) {
			await this.runFetchBatch(
				history,
				assistantText,
				pending,
				callbacks,
				opts
			);
			// Follow-up fetches ride capped non-streaming rounds; the
			// answer itself always streams last (or lands here when a
			// follow-up answers with no calls left to make).
			if (round + 1 >= MAX_TOOL_ROUNDS) break;
			const follow = await this.complete(history, opts, true);
			if (follow.usage) usage = follow.usage;
			assistantText = follow.content;
			pending = this.executableCalls(follow.calls);
			if (pending.length === 0 && assistantText !== "") {
				// The follow-up is the answer (no more calls): emit it
				// as the reply instead of discarding it and re-asking —
				// the re-ask regenerated blind and stalled promising
				// retries it could never make (its tools were off).
				callbacks.onToken(assistantText);
				return { content: assistantText, usage };
			}
		}
		// The final answer streams WITH tools: after failed fetches the
		// model often wants one more source, and with tools off that
		// promise always stalled. Calls here run bounded extra rounds
		// (retract the prefix, fetch, re-stream) before the reply must
		// land.
		for (let extra = 0; ; extra++) {
			const final = await this.streamOnce(history, callbacks, opts, true);
			const more = this.executableCalls(final.calls);
			if (more.length === 0 || extra >= EXTRA_FINAL_ROUNDS)
				return { content: final.content, usage: final.usage ?? usage };
			callbacks.onRoundRetract?.();
			if (final.usage) usage = final.usage;
			await this.runFetchBatch(history, final.content, more, callbacks, opts);
		}
	}

	/**
	 * List model ids via `GET {baseUrl}/models` (the same endpoint Cline's
	 * picker uses). Failures throw `ProviderError`; the Model field keeps
	 * working as free text regardless.
	 */
	async listModels(): Promise<string[]> {
		const native = this.deps.listModelsNative;
		if (native) {
			let res: { status: number; body: string };
			try {
				res = await native(this.config.baseUrl, this.config.apiKey);
			} catch (error) {
				throw new ProviderError(
					`Network error listing ${this.id} models: ${messageOf(error)}`
				);
			}
			if (res.status < 200 || res.status >= 300) {
				throw new ProviderError(
					`${this.id} model list failed (HTTP ${res.status}): ${res.body.slice(0, 300)}`,
					res.status
				);
			}
			try {
				return parseModelIds(JSON.parse(res.body));
			} catch {
				throw new ProviderError(`${this.id} model list was not JSON`);
			}
		}
		let res: Response;
		try {
			res = await fetch(this.url("/models"), { headers: this.headers() });
		} catch (error) {
			throw new ProviderError(
				`Network error listing ${this.id} models: ${messageOf(error)}`
			);
		}
		if (!res.ok) {
			throw this.httpError("model list", res.status, await safeText(res));
		}
		let json: unknown;
		try {
			json = await res.json();
		} catch {
			throw new ProviderError(`${this.id} model list was not JSON`);
		}
		return parseModelIds(json);
	}
}

/**
 * Sorted, de-duplicated model ids from a `/models` payload. Tolerates the
 * OpenAI `{ data: [{ id }] }` shape as well as bare id arrays; anything
 * else yields an empty list instead of throwing. Exported for tests.
 */
export function parseModelIds(payload: unknown): string[] {
	const ids = new Set<string>();
	const candidates: unknown[] = Array.isArray(payload)
		? payload
		: payload &&
			  typeof payload === "object" &&
			  Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data?: unknown }).data as unknown[])
			: [];
	for (const item of candidates) {
		const id =
			typeof item === "string" ? item : (item as { id?: unknown } | null)?.id;
		if (typeof id === "string" && id.trim()) ids.add(id.trim());
	}
	return [...ids].sort();
}

/** Split an SSE byte stream into `data:` payloads, one per event.
Lines may end CRLF, LF, or CR; an event's data lines join with `\n`
(as `turn.rs` does); a last event the server never closed with a
blank line still counts. Exported for tests. */
export async function* readSse(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const payload = (block: string): string | null => {
		const data: string[] = [];
		for (const line of block.split("\n"))
			if (line.startsWith("data:"))
				data.push(line.slice("data:".length).trim());
		return data.length > 0 ? data.join("\n") : null;
	};
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// A trailing CR may be half of a CRLF split across reads: hold it.
		const held = buffer.endsWith("\r") ? "\r" : "";
		const text = (held ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
		const parts = text.split("\n\n");
		buffer = (parts.pop() ?? "") + held;
		for (const part of parts) {
			const data = payload(part);
			if (data !== null) yield data;
		}
	}
	buffer += decoder.decode();
	const data = payload(buffer.replace(/\r\n?/g, "\n"));
	if (data !== null) yield data;
}

function toUsage(
	raw:
		| {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
				completion_tokens_details?: { reasoning_tokens?: number };
		  }
		| null
		| undefined
): TokenUsage | null {
	if (raw == null) return null;
	if (raw.prompt_tokens == null && raw.completion_tokens == null) return null;
	return {
		prompt: raw.prompt_tokens ?? 0,
		completion: raw.completion_tokens ?? 0,
		total:
			raw.total_tokens ??
			(raw.prompt_tokens ?? 0) + (raw.completion_tokens ?? 0),
		reasoning: raw.completion_tokens_details?.reasoning_tokens
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * True for on-device server URLs (Ollama on loopback): a refused
 * connection there means "not running", not "offline".
 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
	try {
		// URL keeps IPv6 hosts bracketed ("[::1]").
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
	} catch {
		return false;
	}
}

async function safeText(res: Response): Promise<string> {
	try {
		return await res.text();
	} catch {
		return "";
	}
}
