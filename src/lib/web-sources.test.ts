import { describe, expect, it } from "vitest";
import {
	applyToolEvent,
	lookupLabel,
	storedToolCalls,
	webSources
} from "./web-sources";

/** DeepSeek's `server_tool_calls` for a deep search: two searches, a
page opened, a failed open, and a link read (api-docs.deepseek.com). */
const STEPS = [
	{
		index: 0,
		reasoning_content: "First, search.",
		calls: [
			{
				index: 0,
				id: "srvtoolu_ds_00_a",
				type: "deepseek_web_search",
				kind: "deep_search",
				action: {
					type: "search",
					queries: ["eiffel tower height", "tokyo tower height"]
				},
				status: "completed",
				sources: [
					{
						type: "url",
						url: "https://www.toureiffel.paris/en/the-monument/key-figures",
						title: "Key figures",
						snippet: "330 metres",
						site_name: "Tour Eiffel",
						site_icon: "https://cdn.deepseek.com/site-icons/toureiffel.paris",
						published_at: null
					},
					{
						type: "url",
						url: "https://en.tokyotower.co.jp/",
						title: "https://en.tokyotower.co.jp/",
						snippet: "333 m",
						site_name: null,
						site_icon: null
					}
				]
			}
		]
	},
	{
		index: 1,
		reasoning_content: "Open the official pages.",
		calls: [
			{
				index: 0,
				id: "srvtoolu_ds_01_a",
				action: {
					type: "open_page",
					url: "https://en.tokyotower.co.jp/company/"
				},
				status: "completed",
				page: {
					url: "https://en.tokyotower.co.jp/company/",
					title: "Company",
					published_at: null
				}
			},
			{
				index: 1,
				id: "srvtoolu_ds_01_b",
				action: { type: "open_page", url: "https://gone.example/" },
				status: "failed",
				error: { code: "unavailable" }
			},
			{
				index: 2,
				action: {
					type: "find_in_page",
					url: "https://en.tokyotower.co.jp/company/",
					pattern: "333"
				},
				status: "completed",
				page: { url: "https://en.tokyotower.co.jp/company/", title: null }
			}
		]
	},
	{
		index: 2,
		reasoning_content: "One more search.",
		calls: [
			{
				index: 0,
				action: { type: "search", queries: ["tallest towers japan"] },
				status: "completed",
				sources: [
					{
						type: "url",
						url: "https://www.toureiffel.paris/en/the-monument/key-figures",
						title: "Key figures"
					},
					{ type: "url", url: "javascript:alert(1)", title: "bad" },
					{
						type: "url",
						url: "https://ja.wikipedia.org/wiki/Tokyo_Tower",
						title: "東京タワー",
						site_name: "Wikipedia"
					}
				]
			},
			{
				index: 1,
				action: { type: "read_link", url: "https://example.com/post" },
				status: "completed",
				page: {
					url: "https://example.com/post",
					title: "A post",
					published_at: "2026-01-02"
				},
				signature: "q3J0b1RmZ1c4cE1x"
			}
		]
	}
];

describe("webSources", () => {
	it("lists each search's words and every page found, once each", () => {
		const view = webSources(STEPS);
		expect(view?.searches).toEqual([
			{ queries: ["eiffel tower height", "tokyo tower height"], results: 2 },
			{ queries: ["tallest towers japan"], results: 3 }
		]);
		expect(view?.pages.map((p) => p.url)).toEqual([
			"https://www.toureiffel.paris/en/the-monument/key-figures",
			"https://en.tokyotower.co.jp/",
			"https://en.tokyotower.co.jp/company/",
			"https://ja.wikipedia.org/wiki/Tokyo_Tower",
			"https://example.com/post"
		]);
	});

	it("shows only what DeepSeek returned: names, icons, never a script link", () => {
		const pages = webSources(STEPS)?.pages ?? [];
		expect(pages[0]).toEqual({
			url: "https://www.toureiffel.paris/en/the-monument/key-figures",
			title: "Key figures",
			site: "Tour Eiffel",
			host: "toureiffel.paris",
			icon: "https://cdn.deepseek.com/site-icons/toureiffel.paris"
		});
		// A title that is only the address reads as the site.
		expect(pages[1]).toMatchObject({
			title: "en.tokyotower.co.jp",
			site: "en.tokyotower.co.jp",
			icon: null
		});
		expect(pages.some((p) => p.url.startsWith("javascript"))).toBe(false);
		// The failed open adds nothing.
		expect(pages.some((p) => p.host === "gone.example")).toBe(false);
	});

	it("puts the pages the answer cites first, in citation order", () => {
		const view = webSources(STEPS, [
			"https://example.com/post",
			"https://en.tokyotower.co.jp"
		]);
		expect(view?.pages.slice(0, 3).map((p) => p.url)).toEqual([
			"https://example.com/post",
			"https://en.tokyotower.co.jp/",
			"https://www.toureiffel.paris/en/the-monument/key-figures"
		]);
	});

	it("is null when nothing was looked up, and survives junk", () => {
		expect(webSources(undefined)).toBeNull();
		expect(webSources([])).toBeNull();
		expect(webSources("nope")).toBeNull();
		expect(
			webSources([null, 3, { calls: "x" }, { calls: [null, { action: 5 }] }])
		).toBeNull();
		// A failed search still says what it searched for.
		expect(
			webSources([
				{
					calls: [
						{ action: { type: "search", queries: ["q"] }, status: "failed" }
					]
				}
			])
		).toEqual({ searches: [{ queries: ["q"], results: 0 }], pages: [] });
	});
});

describe("lookupLabel", () => {
	const started = (action: unknown) => ({
		type: "call_started",
		step: 0,
		call: { index: 0, action }
	});

	it("names what a starting call looks up", () => {
		expect(
			lookupLabel(started({ type: "search", queries: ["iceland population"] }))
		).toBe("Searching “iceland population”");
		expect(
			lookupLabel(started({ type: "search", queries: ["a", "b", "c", "d"] }))
		).toBe("Searching “a”, “b” and 2 more");
		expect(lookupLabel(started({ type: "search", queries: [] }))).toBe(
			"Searching by image"
		);
		expect(
			lookupLabel(
				started({ type: "open_page", url: "https://www.example.com/a" })
			)
		).toBe("Reading example.com");
		expect(
			lookupLabel(started({ type: "read_link", url: "https://example.com/a" }))
		).toBe("Reading example.com");
		expect(
			lookupLabel(
				started({
					type: "find_in_page",
					url: "https://example.com/a",
					pattern: "x"
				})
			)
		).toBe("Looking through example.com");
		expect(lookupLabel(started({ type: "something_new" }))).toBe(
			"Looking it up"
		);
	});

	it("clears on a finished call or step, ignores what it can't read", () => {
		expect(
			lookupLabel({ type: "call_completed", step: 0, call: {} })
		).toBeNull();
		expect(lookupLabel({ type: "step_reasoning_done", step: 0 })).toBeNull();
		expect(lookupLabel({ type: "mystery" })).toBeUndefined();
		expect(lookupLabel(null)).toBeUndefined();
		expect(lookupLabel("x")).toBeUndefined();
	});
});

describe("applyToolEvent", () => {
	it("builds the steps as the events stream, a finished call replacing its start", () => {
		const search = { type: "search", queries: ["q"] };
		let steps = applyToolEvent(undefined, {
			type: "step_reasoning_done",
			step: 0
		});
		expect(steps).toEqual([]);
		steps = applyToolEvent(steps, {
			type: "call_started",
			step: 0,
			call: { index: 0, action: search }
		});
		steps = applyToolEvent(steps, {
			type: "call_completed",
			step: 0,
			call: {
				index: 0,
				action: search,
				status: "completed",
				sources: [{ url: "https://a.test/" }]
			}
		});
		steps = applyToolEvent(steps, {
			type: "call_started",
			step: 1,
			call: { index: 0, action: { type: "open_page", url: "https://a.test/" } }
		});
		expect(steps).toHaveLength(2);
		const first = steps[0] as { calls: Array<{ status?: string }> };
		expect(first.calls).toHaveLength(1);
		expect(first.calls[0]?.status).toBe("completed");
		// The row reads the same shape as the final list.
		expect(webSources(steps)?.pages.map((p) => p.url)).toEqual([
			"https://a.test/"
		]);
	});

	it("never mutates what it was given and skips junk events", () => {
		const before = [{ index: 0, calls: [] as unknown[] }];
		const after = applyToolEvent(before, {
			type: "call_started",
			step: 0,
			call: { index: 0, action: {} }
		});
		expect(before[0]?.calls).toEqual([]);
		expect(after).not.toBe(before);
		expect(
			applyToolEvent(before, { type: "call_started", step: "0", call: {} })
		).toBe(before);
		expect(applyToolEvent(before, null)).toBe(before);
	});
});

describe("storedToolCalls", () => {
	it("keeps the steps and every signature, drops snippets and step thinking", () => {
		const stored = storedToolCalls(STEPS) as Array<Record<string, unknown>>;
		const text = JSON.stringify(stored);
		expect(text).toContain("q3J0b1RmZ1c4cE1x");
		expect(text).toContain("srvtoolu_ds_00_a");
		expect(text).not.toContain("330 metres");
		expect(stored.every((s) => s["reasoning_content"] === "")).toBe(true);
		expect(webSources(stored)).toEqual(webSources(STEPS));
		// The original is untouched.
		expect(JSON.stringify(STEPS)).toContain("330 metres");
	});

	it("keeps nothing for nothing", () => {
		expect(storedToolCalls(undefined)).toBeUndefined();
		expect(storedToolCalls([])).toBeUndefined();
		expect(storedToolCalls({})).toBeUndefined();
	});
});
