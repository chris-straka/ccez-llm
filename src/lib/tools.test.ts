// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	FETCH_TOOL_NAME,
	fetchToolDef,
	formatFeedItems,
	htmlToText,
	looksLikeFeed,
	MAX_FEED_ITEMS,
	MAX_FETCH_TEXT_CHARS,
	parseFetchCall,
	parseFeedItems,
	validFetchUrl
} from "./tools";

describe("fetchToolDef", () => {
	it("names the fetch_url function with a url parameter", () => {
		const def = fetchToolDef();
		expect(def.type).toBe("function");
		expect(def.function.name).toBe(FETCH_TOOL_NAME);
		expect(def.function.parameters.required).toEqual(["url"]);
	});
	it("never invites the model to self-test the tool", () => {
		// A bare "test" once came back as a narrated fetch: the tool
		// is plumbing the user doesn't know about, firing only for
		// asked external information, never itself.
		expect(fetchToolDef().function.description).toContain("The user doesn't know it exists.");
	});
});

describe("validFetchUrl", () => {
	it("accepts plain http(s) URLs", () => {
		expect(validFetchUrl("https://example.com/page?q=1")).toBe(true);
		expect(validFetchUrl("http://localhost:1420/")).toBe(true);
	});

	it("rejects schemes, credentials, spaces, and junk", () => {
		expect(validFetchUrl("file:///etc/passwd")).toBe(false);
		expect(validFetchUrl("javascript:alert(1)")).toBe(false);
		expect(validFetchUrl("https://user:pass@example.com/")).toBe(false);
		expect(validFetchUrl("https://example.com/a b")).toBe(false);
		expect(validFetchUrl("not a url")).toBe(false);
		expect(validFetchUrl("")).toBe(false);
		expect(validFetchUrl(null)).toBe(false);
		expect(validFetchUrl(42)).toBe(false);
		expect(validFetchUrl(`https://example.com/${"a".repeat(2048)}`)).toBe(false);
	});
});

describe("htmlToText", () => {
	it("prefers article text and drops chrome", () => {
		const text = htmlToText(
			"<html><head><title>T</title><style>.x{}</style></head>" +
				"<body><nav>links</nav><article><h1>Head</h1><p>Body words.</p></article>" +
				"<footer>foot</footer><script>evil()</script></body></html>"
		);
		expect(text).toContain("Head");
		expect(text).toContain("Body words.");
		expect(text).not.toContain("links");
		expect(text).not.toContain("foot");
		expect(text).not.toContain("evil()");
	});

	it("falls back to body and caps length", () => {
		expect(htmlToText("<p>hi</p>")).toBe("hi");
		expect(htmlToText("<script>only()</script>")).toBe("");
		const long = htmlToText(`<main><p>${"w ".repeat(20000)}</p></main>`);
		expect(long.length).toBeLessThanOrEqual(MAX_FETCH_TEXT_CHARS);
	});
});

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>BBC News</title>
<item><title><![CDATA[Head one]]></title><link>https://example.com/1</link><description><![CDATA[Desc one]]></description></item>
<item><title>Head two</title><link>https://example.com/2</link></item>
<item><title></title><link>https://example.com/3</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Example</title>
<entry><title>Atom head</title><link href="https://example.com/a"/><summary>Atom desc</summary></entry>
</feed>`;

describe("looksLikeFeed", () => {
	it("gates feeds in and pages out", () => {
		expect(looksLikeFeed(RSS)).toBe(true);
		expect(looksLikeFeed(ATOM)).toBe(true);
		expect(looksLikeFeed("<html><body>hi</body></html>")).toBe(false);
	});
});

describe("parseFeedItems", () => {
	it("reads RSS items, skipping title-less ones", () => {
		const items = parseFeedItems(RSS);
		expect(items.length).toBe(2);
		expect(items[0]).toEqual({
			title: "Head one",
			link: "https://example.com/1",
			description: "Desc one"
		});
		expect(items[1]?.link).toBe("https://example.com/2");
	});

	it("reads namespaced Atom entries via href links", () => {
		const items = parseFeedItems(ATOM);
		expect(items.length).toBe(1);
		expect(items[0]).toEqual({
			title: "Atom head",
			link: "https://example.com/a",
			description: "Atom desc"
		});
	});

	it("caps items and never throws on junk", () => {
		const many = `<rss><channel>${"<item><title>t</title></item>".repeat(50)}</channel></rss>`;
		expect(parseFeedItems(many).length).toBe(MAX_FEED_ITEMS);
		expect(parseFeedItems("not xml at all <")).toEqual([]);
		expect(formatFeedItems(parseFeedItems(RSS))).toContain("https://example.com/1");
	});
});

describe("parseFetchCall", () => {
	it("reads a well-formed fetch call", () => {
		expect(
			parseFetchCall({
				id: "call_1",
				function: { name: "fetch_url", arguments: '{"url":"https://example.com/"}' }
			})
		).toEqual({ id: "call_1", url: "https://example.com/" });
	});

	it("rejects wrong names, bad ids, and bad urls", () => {
		expect(parseFetchCall({ id: "c", function: { name: "other", arguments: "{}" } })).toBe(null);
		expect(
			parseFetchCall({
				id: "",
				function: { name: "fetch_url", arguments: '{"url":"https://example.com/"}' }
			})
		).toBe(null);
		expect(
			parseFetchCall({
				id: "c",
				function: { name: "fetch_url", arguments: '{"url":"file:///x"}' }
			})
		).toBe(null);
		expect(
			parseFetchCall({ id: "c", function: { name: "fetch_url", arguments: "nope{" } })
		).toBe(null);
	});
});
