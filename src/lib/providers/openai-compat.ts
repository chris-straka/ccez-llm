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

export interface OpenAICompatConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
}

/**
 * Minimal OpenAI-compatible chat client used by every provider in this app
 * (DeepSeek and Meta's Model API both speak this protocol — verified live
 * against the Muse Spark endpoint). No SDK dependency: plain fetch + SSE.
 */
export class OpenAICompatProvider implements ChatProvider {
	readonly id: string;
	private readonly config: OpenAICompatConfig;

	constructor(id: string, config: OpenAICompatConfig) {
		this.id = id;
		this.config = { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
	}

	private url(path: string): string {
		return `${this.config.baseUrl}${path}`;
	}

	/**
	 * Fetch-level failure, translated: a user stop is never a network
	 * error (the stop button would report one otherwise); a dead
	 * loopback server names its remedy (Ollama isn't running) instead
	 * of reading as generic net trouble; remote endpoints keep the
	 * generic wording.
	 */
	private connectionError(error: unknown): ProviderError {
		if (error instanceof Error && error.name === "AbortError") {
			return new ProviderError("Reply stopped.");
		}
		if (isLoopbackBaseUrl(this.config.baseUrl)) {
			return new ProviderError(
				`${this.id} needs Ollama running on this device (start it with 'ollama serve'): ${messageOf(error)}`
			);
		}
		return new ProviderError(`Network error talking to ${this.id}: ${messageOf(error)}`);
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

	private body(messages: ChatMessage[], stream: boolean, thinking?: string): string {
		// Native thinking knob for this provider + model (unknown ids and
		// knob-less providers resolve to no extra fields).
		const support = thinkingFor(this.id, this.config.model);
		const extra = support.wireFields(resolveThinkingId(support, thinking));
		return JSON.stringify({ model: this.config.model, messages, stream, ...extra });
	}

	async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
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

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		let res: Response;
		try {
			res = await fetch(this.url("/chat/completions"), {
				method: "POST",
				headers: { ...this.headers(), Accept: "text/event-stream" },
				body: this.body(messages, true, opts.thinking),
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
		// Mid-stream failures translate like fetch-level ones: a cut
		// connection reads as a network error, a user stop as stopped
		// (never the raw "This operation was aborted").
		try {
			for await (const event of readSse(res.body)) {
				if (event === "[DONE]") break;
				let parsed: {
					choices?: Array<{ delta?: { content?: string } }>;
					usage?: Parameters<typeof toUsage>[0];
				};
				try {
					parsed = JSON.parse(event) as typeof parsed;
				} catch {
					continue;
				}
				const token = parsed.choices?.[0]?.delta?.content ?? "";
				if (token) {
					content += token;
					callbacks.onToken(token);
				}
				if (parsed.usage) usage = toUsage(parsed.usage);
			}
		} catch (error) {
			throw this.connectionError(error);
		}
		return { content, usage };
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
			throw new ProviderError(`Network error listing ${this.id} models: ${messageOf(error)}`);
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
		: payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
			? ((payload as { data?: unknown }).data as unknown[])
			: [];
	for (const item of candidates) {
		const id = typeof item === "string" ? item : (item as { id?: unknown } | null)?.id;
		if (typeof id === "string" && id.trim()) ids.add(id.trim());
	}
	return [...ids].sort();
}

/** Split an SSE byte stream into `data:` payloads. Exported for tests. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
		total: raw.total_tokens ?? (raw.prompt_tokens ?? 0) + (raw.completion_tokens ?? 0),
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
