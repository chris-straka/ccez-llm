// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	FETCH_TOOL_NAME,
	fetchToolDef,
	formatFeedItems,
	htmlToText,
	isSearchUrl,
	looksLikeFeed,
	MAX_FEED_ITEMS,
	MAX_FETCH_TEXT_CHARS,
	parseFetchCall,
	parseFeedItems,
	parseSearchResults,
	SEARCH_URL_PREFIX,
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
		expect(fetchToolDef().function.description).toContain(
			"The user doesn't know it exists."
		);
	});
	it("orders call-don't-narrate plus retry-on-failure", () => {
		// Failed fetches once stalled the turn on a narrated "I'll
		// try another source" with no call behind it: the tool must
		// order an immediate call and a different URL on failure.
		const description = fetchToolDef().function.description;
		expect(description).toContain(
			"never write that you will fetch without calling"
		);
		expect(description).toContain(
			"call again with a different URL instead of stopping"
		);
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
		expect(validFetchUrl(`https://example.com/${"a".repeat(2048)}`)).toBe(
			false
		);
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

	it("takes the largest declared media image, else none", () => {
		const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<item><title>Pic</title><link>https://example.com/1</link><media:thumbnail width="240" url="https://img/small.jpg"/><media:content width="700" url="https://img/big.jpg"/><media:content width="140" url="https://img/tiny.jpg"/></item>
<item><title>No pic</title><link>https://example.com/2</link></item>
</channel></rss>`;
		const items = parseFeedItems(xml);
		expect(items[0]?.image).toBe("https://img/big.jpg");
		expect(items[1]).not.toHaveProperty("image");
	});

	it("caps items and never throws on junk", () => {
		const many = `<rss><channel>${"<item><title>t</title></item>".repeat(50)}</channel></rss>`;
		expect(parseFeedItems(many).length).toBe(MAX_FEED_ITEMS);
		expect(parseFeedItems("not xml at all <")).toEqual([]);
		expect(formatFeedItems(parseFeedItems(RSS))).toContain(
			"https://example.com/1"
		);
	});
});

describe("parseFetchCall", () => {
	it("reads a well-formed fetch call", () => {
		expect(
			parseFetchCall({
				id: "call_1",
				function: {
					name: "fetch_url",
					arguments: '{"url":"https://example.com/"}'
				}
			})
		).toEqual({ id: "call_1", url: "https://example.com/" });
	});

	it("rejects wrong names, bad ids, and bad urls", () => {
		expect(
			parseFetchCall({ id: "c", function: { name: "other", arguments: "{}" } })
		).toBe(null);
		expect(
			parseFetchCall({
				id: "",
				function: {
					name: "fetch_url",
					arguments: '{"url":"https://example.com/"}'
				}
			})
		).toBe(null);
		expect(
			parseFetchCall({
				id: "c",
				function: { name: "fetch_url", arguments: '{"url":"file:///x"}' }
			})
		).toBe(null);
		expect(
			parseFetchCall({
				id: "c",
				function: { name: "fetch_url", arguments: "nope{" }
			})
		).toBe(null);
	});
});

/** Trimmed from a live html.duckduckgo.com page (Oct 2026): one ad, two organic hits. */
const SEARCH_HTML = `<div class="serp__results">
<div class="result results_links results_links_deep result--ad">
  <h2 class="result__title"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Sponsored</a></h2>
  <a class="result__snippet" href="https://duckduckgo.com/y.js?ad=1">Buy now</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fde.wikipedia.org%2Fwiki%2FBundestagswahl_2025&amp;rut=2e1c">Bundestagswahl 2025 - Wikipedia</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Die Wahl zum
     21. Deutschen <b>Bundestag</b> fand am 23. Februar 2025 statt.</a>
</div>
<div class="result results_links web-result ">
  <h2 class="result__title"><a class="result__a" href="https://www.tagesschau.de/wahl/">Wahlarchiv</a></h2>
</div>
</div>`;

describe("web search", () => {
	it("teaches the model the keyless search prefix", () => {
		expect(fetchToolDef().function.description).toContain(SEARCH_URL_PREFIX);
		expect(
			validFetchUrl(`${SEARCH_URL_PREFIX}${encodeURIComponent("Wahl 2025")}`)
		).toBe(true);
	});

	it("recognizes only the search host", () => {
		expect(isSearchUrl(`${SEARCH_URL_PREFIX}x`)).toBe(true);
		expect(isSearchUrl("https://duckduckgo.com/?q=x")).toBe(false);
		expect(isSearchUrl("not a url")).toBe(false);
	});

	it("reads organic results with unwrapped links, ads dropped", () => {
		expect(parseSearchResults(SEARCH_HTML)).toEqual([
			{
				title: "Bundestagswahl 2025 - Wikipedia",
				link: "https://de.wikipedia.org/wiki/Bundestagswahl_2025",
				description:
					"Die Wahl zum 21. Deutschen Bundestag fand am 23. Februar 2025 statt."
			},
			{
				title: "Wahlarchiv",
				link: "https://www.tagesschau.de/wahl/",
				description: ""
			}
		]);
	});

	it("yields nothing for a challenge page", () => {
		expect(
			parseSearchResults(
				"<html><body><form>Are you a robot?</form></body></html>"
			)
		).toEqual([]);
	});
});
