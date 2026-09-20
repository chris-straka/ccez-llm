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

/**
 * Minimal OpenAI-compatible chat client used by every provider in this app
 * (DeepSeek and Meta's Model API both speak this protocol — verified live
 * against the Muse Spark endpoint). No SDK dependency: plain fetch + SSE.
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
		const toolFields =
			tools === true ? { tools: [fetchToolDef()], tool_choice: "auto" } : {};
		return JSON.stringify({
			model: this.config.model,
			messages,
			stream,
			...extra,
			...toolFields
		});
	}

	async chat(
		messages: ChatMessage[],
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		let res: Response;
		try {
			res = await fetch(this.url("/chat/completions"), {
				method: "POST",
				headers: this.headers(),
				body: this.body(messages, false, opts.thinking),
				// DOM takes null for absent, not undefined.
				signal: opts.signal ?? null
			});
		} catch (error) {
			throw this.connectionError(error);
		}
		if (!res.ok) {
			throw new ProviderError(
				`${this.id} request failed (HTTP ${res.status}): ${(await safeText(res)).slice(0, 300)}`,
				res.status
			);
		}
		const json = (await res.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
				completion_tokens_details?: { reasoning_tokens?: number };
			};
		};
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
			throw new ProviderError(
				`${this.id} request failed (HTTP ${res.status}): ${(await safeText(res)).slice(0, 300)}`,
				res.status
			);
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
		const run = this.deps.fetchPage ?? fetchPageText;
		try {
			return await run(call.url, signal);
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") throw error;
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
	): Promise<{
		content: string;
		calls: WireToolCall[];
		usage: TokenUsage | null;
	}> {
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
			throw new ProviderError(
				`${this.id} stream failed (HTTP ${res.status}): ${(await safeText(res)).slice(0, 300)}`,
				res.status
			);
		}
		let content = "";
		let usage: TokenUsage | null = null;
		const fragments = new Map<
			number,
			{ id: string; name: string; args: string }
		>();
		// Mid-stream failures translate like fetch-level ones: a cut
		// connection reads as a network error, a user stop as stopped
		// (never the raw "This operation was aborted").
		try {
			for await (const event of readSse(res.body)) {
				if (event === "[DONE]") break;
				let parsed: {
					choices?: Array<{
						delta?: {
							content?: string;
							tool_calls?: Array<{
								index?: number;
								id?: string;
								function?: { name?: string; arguments?: string };
							}>;
						};
					}>;
					usage?: Parameters<typeof toUsage>[0];
				};
				try {
					parsed = JSON.parse(event) as typeof parsed;
				} catch {
					continue;
				}
				const delta = parsed.choices?.[0]?.delta;
				const token = delta?.content ?? "";
				if (token) {
					content += token;
					callbacks.onToken(token);
				}
				for (const call of delta?.tool_calls ?? []) {
					const index = call.index ?? 0;
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
		const calls: WireToolCall[] = [...fragments.values()]
			.filter((slot) => slot.id && slot.name)
			.map((slot) => ({
				id: slot.id,
				type: "function",
				function: { name: slot.name, arguments: slot.args }
			}));
		return { content, calls, usage };
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

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		// Model-driven lookup: the first request streams WITH tools, so
		// a no-fetch turn costs exactly one request, like before. When
		// the model calls fetch_url, the calls run serially into the
		// history and the answer streams after (follow-up fetches ride
		// capped non-streaming rounds). Providers that reject `tools`
		// fall back to a plain turn once; anything else throws exactly
		// as before.
		const history: WireMessage[] = [...messages];
		let first: Awaited<ReturnType<OpenAICompatProvider["streamOnce"]>>;
		try {
			first = await this.streamOnce(history, callbacks, opts, true);
		} catch (error) {
			if (!(error instanceof ProviderError) || error.status !== 400)
				throw error;
			return this.streamOnce(history, callbacks, opts, false);
		}
		let pending = this.executableCalls(first.calls);
		if (pending.length === 0)
			return { content: first.content, usage: first.usage };
		let usage: TokenUsage | null = first.usage;
		let assistantText = first.content;
		for (
			let round = 0;
			round < MAX_TOOL_ROUNDS && pending.length > 0;
			round++
		) {
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
			// Follow-up fetches ride capped non-streaming rounds; the
			// answer itself always streams last.
			if (round + 1 >= MAX_TOOL_ROUNDS) break;
			const follow = await this.complete(history, opts, true);
			if (follow.usage) usage = follow.usage;
			assistantText = follow.content;
			pending = this.executableCalls(follow.calls);
		}
		const final = await this.streamOnce(history, callbacks, opts, false);
		return { content: final.content, usage: final.usage ?? usage };
	}

	/**
	 * List model ids via `GET {baseUrl}/models` (the same endpoint Cline's
	 * picker uses). Failures throw `ProviderError`; the Model field keeps
	 * working as free text regardless.
	 */
	async listModels(): Promise<string[]> {
		let res: Response;
		try {
			res = await fetch(this.url("/models"), { headers: this.headers() });
		} catch (error) {
			throw new ProviderError(
				`Network error listing ${this.id} models: ${messageOf(error)}`
			);
		}
		if (!res.ok) {
			throw new ProviderError(
				`${this.id} model list failed (HTTP ${res.status}): ${(await safeText(res)).slice(0, 300)}`,
				res.status
			);
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

/** Split an SSE byte stream into `data:` payloads. Exported for tests. */
export async function* readSse(
	body: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parts = buffer.split("\n\n");
		buffer = parts.pop() ?? "";
		for (const part of parts) {
			for (const line of part.split("\n")) {
				const text = line.trim();
				if (text.startsWith("data:")) yield text.slice("data:".length).trim();
			}
		}
	}
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
		const host = new URL(baseUrl).hostname.toLowerCase();
		return host === "localhost" || host === "127.0.0.1" || host === "::1";
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
