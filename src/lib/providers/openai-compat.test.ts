import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatProvider, isLoopbackBaseUrl, parseModelIds, readSse } from "./openai-compat";
import { ProviderError } from "./types";

const CONFIG = { baseUrl: "https://example.test/v1/", apiKey: "k", model: "m" };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function sseResponse(chunks: string[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
			controller.close();
		}
	});
	return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("chat", () => {
	it("posts model + messages to /chat/completions with a bearer key", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ choices: [{ message: { content: "hi" } }] })
		);
		vi.stubGlobal("fetch", fetchMock);

		const provider = new OpenAICompatProvider("probe", CONFIG);
		const result = await provider.chat([{ role: "user", content: "hey" }]);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://example.test/v1/chat/completions");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
		expect(JSON.parse(init.body as string)).toMatchObject({
			model: "m",
			messages: [{ role: "user", content: "hey" }],
			stream: false
		});
		expect(result.content).toBe("hi");
	});

	it("maps usage including reasoning tokens, null when absent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					choices: [{ message: { content: "x" } }],
					usage: {
						prompt_tokens: 23,
						completion_tokens: 219,
						total_tokens: 242,
						completion_tokens_details: { reasoning_tokens: 207 }
					}
				})
			)
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const withUsage = await provider.chat([{ role: "user", content: "x" }]);
		expect(withUsage.usage).toEqual({
			prompt: 23,
			completion: 219,
			total: 242,
			reasoning: 207
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ choices: [{ message: { content: "x" } }] }))
		);
		const withoutUsage = await provider.chat([{ role: "user", content: "x" }]);
		expect(withoutUsage.usage).toBeNull();
	});

	it("wraps HTTP failures and network errors in ProviderError", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider.chat([{ role: "user", content: "x" }]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).status).toBe(401);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("down");
			})
		);
		const net = await provider.chat([{ role: "user", content: "x" }]).catch((e: unknown) => e);
		expect(net).toBeInstanceOf(ProviderError);
	});
});

describe("user stops are never network errors", () => {
	function abortFetch(): void {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("This operation was aborted", "AbortError");
			})
		);
	}

	it("reports a stopped chat() as stopped", async () => {
		abortFetch();
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider.chat([{ role: "user", content: "x" }]).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(String((err as ProviderError).message)).toBe("Reply stopped.");
	});

	it("reports a pre-response stream abort as stopped", async () => {
		abortFetch();
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider
			.stream([{ role: "user", content: "x" }], { onToken: () => {} })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(String((err as ProviderError).message)).toBe("Reply stopped.");
	});

	it("reports a mid-stream abort as stopped", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(`data: {"choices":[{"delta":{"content":"hi"}}]}\n\n`));
				controller.error(new DOMException("This operation was aborted", "AbortError"));
			}
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider
			.stream([{ role: "user", content: "x" }], { onToken: () => {} })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(String((err as ProviderError).message)).toBe("Reply stopped.");
	});

	it("still reports a mid-stream cut as a network error", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(new TypeError("terminated"));
			}
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }))
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider
			.stream([{ role: "user", content: "x" }], { onToken: () => {} })
			.catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect(String((err as ProviderError).message)).toMatch(/Network error talking to probe/);
	});
});

describe("stream", () => {
	it("assembles tokens across split chunks and stops at [DONE]", async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sseResponse([
					`data: {"choices":[{"delta":{"content":"hel`,
					`lo"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n`
				])
			)
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const result = await provider.stream([{ role: "user", content: "x" }], {
			onToken: (t) => void seen.push(t)
		});
		expect(result.content).toBe("hello!");
		expect(seen.join("")).toBe("hello!");
	});
});

describe("readSse", () => {
	it("yields data payloads split across reads", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"a":'));
				controller.enqueue(new TextEncoder().encode('1}\n\ndata: [DONE]\n\n'));
				controller.close();
			}
		});
		const out: string[] = [];
		for await (const event of readSse(stream)) out.push(event);
		expect(out).toEqual(['{"a":1}', "[DONE]"]);
	});
});

describe("listModels", () => {
	it("reads sorted, de-duplicated ids from an OpenAI payload", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					data: [{ id: "b-model" }, { id: "a-model" }, { id: "b-model" }, { id: "  " }, { id: 42 }]
				})
			)
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		await expect(provider.listModels()).resolves.toEqual(["a-model", "b-model"]);
	});

	it("sends the Bearer [REDACTED] to a trimmed /models URL", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));
		vi.stubGlobal("fetch", fetchMock);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		await provider.listModels();
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://example.test/v1/models");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
	});

	it("throws ProviderError on HTTP and network failures", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 401)));
		const provider = new OpenAICompatProvider("probe", CONFIG);
		await expect(provider.listModels()).rejects.toBeInstanceOf(ProviderError);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("down");
			})
		);
		await expect(provider.listModels()).rejects.toBeInstanceOf(ProviderError);
	});
});

describe("parseModelIds", () => {
	it("tolerates bare arrays, junk payloads, and empties", () => {
		expect(parseModelIds(["x", { id: "y" }])).toEqual(["x", "y"]);
		expect(parseModelIds({})).toEqual([]);
		expect(parseModelIds(null)).toEqual([]);
		expect(parseModelIds({ data: "nope" })).toEqual([]);
	});
});

describe("thinking", () => {
	async function postedBody(
		id: string,
		model: string,
		thinking?: string
	): Promise<Record<string, unknown>> {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ choices: [{ message: { content: "x" } }] })
		);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new OpenAICompatProvider(id, { ...CONFIG, model });
		await provider.chat([{ role: "user", content: "x" }], { thinking });
		const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		return JSON.parse(init.body as string) as Record<string, unknown>;
	}

	it("sends reasoning_effort for Muse Spark", async () => {
		const body = await postedBody("muse", "muse-spark-1.3-contributor", "high");
		expect(body).toMatchObject({ reasoning_effort: "high" });
		expect(body).not.toHaveProperty("thinking");
	});

	it("sends the thinking toggle plus effort for DeepSeek v4", async () => {
		const max = await postedBody("deepseek", "deepseek-v4-pro", "max");
		expect(max).toMatchObject({
			thinking: { type: "enabled" },
			reasoning_effort: "max"
		});
		const off = await postedBody("deepseek", "deepseek-v4-pro", "off");
		expect(off).toMatchObject({ thinking: { type: "disabled" } });
		expect(off).not.toHaveProperty("reasoning_effort");
	});

	it("reads the level per request: a mid-stream change lands on the next call", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ choices: [{ message: { content: "x" } }] })
		);
		vi.stubGlobal("fetch", fetchMock);
		const provider = new OpenAICompatProvider("muse", {
			...CONFIG,
			model: "muse-spark-1.3-contributor"
		});
		// Same instance, two sends: the second carries the new level,
		// never a cached copy of the first.
		await provider.chat([{ role: "user", content: "x" }], { thinking: "low" });
		await provider.chat([{ role: "user", content: "x" }], { thinking: "high" });
		const bodies = fetchMock.mock.calls.map((call) => {
			const [, init] = call as unknown as [string, RequestInit];
			return JSON.parse(init.body as string) as Record<string, unknown>;
		});
		expect(bodies[0]).toMatchObject({ reasoning_effort: "low" });
		expect(bodies[1]).toMatchObject({ reasoning_effort: "high" });
	});

	it("sends nothing native for unknown providers and ids", async () => {
		const body = await postedBody("probe", "m", "high");
		expect(body).not.toHaveProperty("reasoning_effort");
		expect(body).not.toHaveProperty("thinking");
		// Unknown ids resolve to the model's default before sending.
		const museBogus = await postedBody("muse", "muse-spark-1.3-contributor", "bogus");
		expect(museBogus).toMatchObject({ reasoning_effort: "medium" });
	});
});

describe("loopback failures", () => {
	function deadFetch(): void {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("fetch failed");
			})
		);
	}

	it("names Ollama for on-device servers, stays generic for remote ones", async () => {
		deadFetch();
		const local = new OpenAICompatProvider("local-gemma", {
			baseUrl: "http://localhost:11434/v1",
			apiKey: "",
			model: "gemma4:latest"
		});
		await expect(local.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
			/local-gemma needs Ollama running/
		);
		const remote = new OpenAICompatProvider("probe", CONFIG);
		await expect(remote.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
			/Network error talking to probe/
		);
	});

	it("classifies loopback hosts, never the open net", async () => {
		expect(isLoopbackBaseUrl("http://localhost:11434/v1")).toBe(true);
		expect(isLoopbackBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
		expect(isLoopbackBaseUrl("https://example.test/v1")).toBe(false);
		expect(isLoopbackBaseUrl("not a url")).toBe(false);
	});
});
