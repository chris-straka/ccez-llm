import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The owner's Access login is checked in _access.ts (its own tests in
// news-functions.test.ts); here it is a switch, so each answer below is
// the proxy's own.
const access = vi.hoisted(() => ({ why: null as string | null }));
vi.mock("../../functions/api/_access", () => ({
	notOwner: vi.fn(async () => access.why)
}));

import { onRequest } from "../../functions/api/ai/deepseek/[[path]]";

const FAKE_KEY = "sk-test-fake";

function ctx(
	path: string,
	init: RequestInit = {},
	env: { DEEPSEEK_API_KEY?: string } = { DEEPSEEK_API_KEY: FAKE_KEY }
) {
	return {
		request: new Request(`https://llm.ccez.uk${path}`, init),
		env: { ACCESS_AUD: "aud", ...env },
		waitUntil: () => undefined
	};
}

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
	access.why = null;
	upstream = vi.fn(
		async () =>
			new Response("data: {}\n\n", {
				status: 200,
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					"set-cookie": "upstream=1"
				}
			})
	);
	vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("the DeepSeek proxy (functions/api/ai/deepseek)", () => {
	it("adds the server's key and passes the stream through", async () => {
		const res = await onRequest(
			ctx("/api/ai/deepseek/chat/completions", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
					authorization: "Bearer from-the-browser",
					cookie: "CF_Authorization=x"
				},
				body: JSON.stringify({ model: "deepseek-flash", stream: true })
			})
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.headers.get("set-cookie")).toBeNull();
		expect(await res.text()).toBe("data: {}\n\n");
		expect(upstream).toHaveBeenCalledOnce();
		const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.deepseek.com/chat/completions");
		const headers = new Headers(init.headers);
		// Only the server's key goes up: never the browser's header or cookies.
		expect(headers.get("authorization")).toBe(`Bearer ${FAKE_KEY}`);
		expect(headers.get("cookie")).toBeNull();
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("accept")).toBe("text/event-stream");
		expect(init.method).toBe("POST");
	});

	it("allows only chat/completions, user/balance and models", async () => {
		for (const ok of ["/user/balance", "/models"]) {
			upstream.mockClear();
			const res = await onRequest(ctx(`/api/ai/deepseek${ok}`));
			expect(res.status, ok).toBe(200);
			expect(upstream.mock.calls[0]?.[0]).toBe(`https://api.deepseek.com${ok}`);
		}
		upstream.mockClear();
		for (const bad of [
			"/api/ai/deepseek/v1/tools/asr",
			"/api/ai/deepseek/files",
			"/api/ai/deepseek/chat/completions/../../files",
			"/api/ai/deepseek/beta/chat/completions",
			"/api/ai/deepseek",
			"/api/ai/deepseek/",
			"/api/ai/deepseek//evil.example/chat/completions",
			"/api/ai/deepseek/models?x=1#"
		]) {
			const res = await onRequest(ctx(bad));
			if (bad.endsWith("?x=1#")) {
				// A query string never reaches DeepSeek.
				expect(upstream.mock.calls.at(-1)?.[0]).toBe(
					"https://api.deepseek.com/models"
				);
				continue;
			}
			expect(res.status, bad).toBe(404);
		}
		expect(upstream.mock.calls.length).toBe(1);
	});

	it("answers no login and anyone else before touching DeepSeek", async () => {
		access.why = "login";
		const login = await onRequest(ctx("/api/ai/deepseek/chat/completions"));
		expect(login.status).toBe(401);
		expect(await login.text()).toBe("needs-login");
		access.why = "wrong audience";
		const other = await onRequest(ctx("/api/ai/deepseek/chat/completions"));
		expect(other.status).toBe(403);
		expect(upstream).not.toHaveBeenCalled();
	});

	it("says so when the server has no key yet", async () => {
		const res = await onRequest(
			ctx("/api/ai/deepseek/chat/completions", {}, {})
		);
		expect(res.status).toBe(503);
		expect(await res.text()).toBe("no key on the server");
		expect(upstream).not.toHaveBeenCalled();
	});

	it("passes DeepSeek's own failures through (402: balance used up)", async () => {
		upstream.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ error: { message: "Insufficient Balance" } }),
				{
					status: 402,
					headers: { "content-type": "application/json" }
				}
			)
		);
		const res = await onRequest(
			ctx("/api/ai/deepseek/chat/completions", { method: "POST", body: "{}" })
		);
		expect(res.status).toBe(402);
		expect(await res.text()).toContain("Insufficient Balance");
	});
});
