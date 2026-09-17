// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPageText, FetchPageError } from "./fetchPage";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("fetchPageText", () => {
	it("rejects unfetchable URLs without touching the network", async () => {
		const fetchMock = vi.fn(async () => new Response("x"));
		vi.stubGlobal("fetch", fetchMock);
		await expect(fetchPageText("file:///etc/passwd")).rejects.toThrow(FetchPageError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("cleans browser-fetched HTML to text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<html><body><nav>n</nav><article><p>Words.</p></article></body></html>", {
						status: 200
					})
			)
		);
		await expect(fetchPageText("https://example.com/")).resolves.toBe("Words.");
	});

	it("reads feeds as headlines and errors read short", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						`<rss><channel><item><title>H</title><link>https://example.com/h</link></item></channel></rss>`,
						{ status: 200 }
					)
			)
		);
		const text = await fetchPageText("https://example.com/feed.xml");
		expect(text).toContain("H");
		expect(text).toContain("https://example.com/h");
		vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 404 })));
		await expect(fetchPageText("https://example.com/")).rejects.toThrow("HTTP 404");
	});
});
