// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	CEFR_LEVELS,
	NEWS_CACHE_TTL_MS,
	NEWS_FEEDS,
	SUMMARY_SIZES,
	cachedArticle,
	cachedNewsUrl,
	fetchArticleText,
	isNewsFallback,
	isNewsSupported,
	jinaUrl,
	loadNewsStories,
	newsConversationInstruction,
	newsErrorCopy,
	newsRegionsFor,
	newsRssUrl,
	newsStoriesFromXml,
	newsSummaryInstruction,
	parseTranslatedLines,
	translateNewsTitles,
	resolveArticleText,
	shapeStory,
	storeArticle,
	storeNewsUrl,
	stripTags
} from "./news";
import {
	AFRICAN_LANGUAGES,
	ASIAN_LANGUAGES,
	CLASSICAL_LANGUAGES,
	EUROPEAN_LANGUAGES
} from "./languages";
import type { KeyValueStore } from "./settings";

const memStore = (): KeyValueStore => {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v)
	};
};

describe("news feeds", () => {
	it("builds Google News URLs for known pairs only", () => {
		expect(newsRssUrl("fr", "FR")).toBe(
			"https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr"
		);
		expect(newsRssUrl("zh", "TW")).toBe(
			"https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-TW"
		);
		expect(newsRssUrl("he", "IL")).toContain("hl=he");
		expect(newsRssUrl("pa", "IN")).toContain("hl=pa-IN");
		expect(newsRssUrl("ms", "MY")).toContain("hl=ms-MY");
		expect(newsRssUrl("xx", "US")).toBeNull();
		expect(newsRssUrl("fr", "XX")).toBeNull();
		expect(newsRssUrl("fr", "DE")).toBeNull();
	});

	it("covers every reply language, fallback where no edition exists", () => {
		// Live-verified gaps: Google redirects these to English or a
		// neighbor language (da → Norwegian, hy → Russian), so they
		// read a fallback English edition instead of nothing.
		const fallback = new Set([
			"tl",
			"yue",
			"hy",
			"am",
			"la",
			"grc",
			"sa",
			"da",
			"fa",
			"ur",
			"sw",
			"is",
			"non",
			"sux",
			"akk",
			"ang"
		]);
		const codes = [
			...EUROPEAN_LANGUAGES,
			...ASIAN_LANGUAGES,
			...AFRICAN_LANGUAGES,
			...CLASSICAL_LANGUAGES
		].map((l) => l.code);
		expect(codes.length).toBeGreaterThan(40);
		for (const code of codes) {
			expect(isNewsSupported(code)).toBe(true);
			const regions = newsRegionsFor(code);
			expect(regions!.length).toBeGreaterThanOrEqual(1);
			expect(isNewsFallback(code)).toBe(fallback.has(code));
			if (fallback.has(code)) {
				// English hl throughout; home-English editions gain a
				// translated U.S. second chip, pure-U.S. ones stay single.
				for (const region of regions!) {
					expect(newsRssUrl(code, region.gl)).toContain("hl=en");
				}
				const pureUs = new Set([
					"da",
					"hy",
					"fa",
					"is",
					"yue",
					"la",
					"grc",
					"non",
					"sux",
					"akk"
				]);
				expect(regions!.length).toBe(pureUs.has(code) ? 1 : 2);
			}
			// Default region first, every region addressable.
			for (const region of regions!) {
				expect(newsRssUrl(code, region.gl)).toContain(`gl=${region.gl}`);
			}
		}
		// No feed orphans: every table entry is a real language.
		for (const code of Object.keys(NEWS_FEEDS)) {
			expect(codes).toContain(code);
		}
		// Mainland China rides the Chinese feed past Taiwan.
		expect(newsRegionsFor("zh")!.map((r) => r.gl)).toEqual([
			"TW",
			"CN",
			"HK",
			"SG",
			"US"
		]);
	});

	it("derives a translated U.S. region unless one is native", () => {
		// French gains translated U.S. headlines, home edition first.
		const fr = newsRegionsFor("fr")!;
		expect(fr[fr.length - 1]).toEqual({
			gl: "US",
			label: "U.S.",
			hl: "en-US",
			translate: true
		});
		expect(newsRssUrl("fr", "US")).toContain("hl=en-US&gl=US");
		// Spanish and pure-U.S. fallbacks keep their native single US.
		for (const code of ["es", "da", "la"]) {
			const regions = newsRegionsFor(code)!;
			expect(regions.filter((r) => r.gl === "US")).toHaveLength(1);
			expect(regions.some((r) => r.translate)).toBe(false);
		}
		// Home-English fallbacks gain a translated second chip.
		expect(newsRegionsFor("ur")!.map((r) => r.gl)).toEqual(["PK", "US"]);
		expect(newsRegionsFor("ang")!.map((r) => r.gl)).toEqual(["GB", "US"]);
	});

	it("parses numbered translation lines, count-exact", () => {
		expect(parseTranslatedLines("1. Un\n2. Deux", 2)).toEqual(["Un", "Deux"]);
		expect(parseTranslatedLines("1) Un\n\n2) Deux\n", 2)).toEqual([
			"Un",
			"Deux"
		]);
		expect(parseTranslatedLines("1. Un", 2)).toBeNull();
		expect(parseTranslatedLines("1. Un\n2. Deux\n3. Trois", 2)).toBeNull();
	});

	it("translates titles in one call, failing loudly when short", async () => {
		const seen: string[] = [];
		const out = await translateNewsTitles(["Markets rally"], "French", async (prompt) => {
			seen.push(prompt);
			return "1. Les marchés montent";
		});
		expect(out).toEqual(["Les marchés montent"]);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain("French");
		await expect(
			translateNewsTitles(["A", "B"], "French", async () => "1. Seul")
		).rejects.toThrow("news-translate");
		expect(await translateNewsTitles([], "French", async () => "")).toEqual([]);
	});
});

describe("story shaping", () => {
	it("splits the outlet off Google titles", () => {
		expect(
			shapeStory({ title: "Markets rally - BBC News", link: "https://x", description: "" })
		).toEqual({
			title: "Markets rally",
			source: "BBC News",
			link: "https://x",
			snippet: ""
		});
		// Last dash wins (headlines carry their own dashes).
		expect(
			shapeStory({ title: "War - live updates - Al Jazeera", link: "https://x", description: "" })
		).toMatchObject({ title: "War - live updates", source: "Al Jazeera" });
	});

	it("keeps long tails and sourceless titles whole", () => {
		const long = "Markets rally on news that the central bank will meet again soon";
		expect(shapeStory({ title: long, link: "https://x", description: "" })).toMatchObject({
			title: long,
			source: ""
		});
		expect(shapeStory({ title: "Plain headline", link: "https://x", description: "" })).toMatchObject({
			title: "Plain headline",
			source: ""
		});
	});

	it("drops linkless and titleless items (dead cards)", () => {
		expect(shapeStory({ title: "No link - BBC", link: "", description: "" })).toBeNull();
		expect(shapeStory({ title: "   ", link: "https://x", description: "" })).toBeNull();
	});

	it("strips feed HTML and entities from snippets", () => {
		expect(stripTags('<a href="https://x">Out&shy;let</a>&nbsp;reports &amp; more')).toBe(
			"Out&shy;let reports & more"
		);
		expect(stripTags("<p>One</p><p>Two</p>")).toBe("One Two");
		expect(
			shapeStory({
				title: "T - S",
				link: "https://x",
				description: "<a>Line one</a> &quot;quoted&quot;"
			})?.snippet
		).toBe('Line one "quoted"');
	});

	it("shapes stories out of raw feed markup, never throwing", () => {
		const xml = `<?xml version="1.0"?><rss><channel>
			<item><title>One - BBC</title><link>https://a</link><description><![CDATA[<p>First</p>]]></description></item>
			<item><title>No link here - BBC</title><description>x</description></item>
			<item><title>Solo</title><link>https://b</link></item>
		</channel></rss>`;
		expect(newsStoriesFromXml(xml)).toEqual([
			{ title: "One", source: "BBC", link: "https://a", snippet: "First" },
			{ title: "Solo", source: "", link: "https://b", snippet: "" }
		]);
		expect(newsStoriesFromXml("not xml at all {{{")).toEqual([]);
		expect(newsStoriesFromXml("")).toEqual([]);
	});
});

describe("session prompts", () => {
	const story = {
		title: "Markets rally",
		source: "BBC News",
		link: "https://x",
		snippet: "Up all week."
	};

	it("pins CEFR levels and summary sizes", () => {
		expect(CEFR_LEVELS.map((l) => l.level)).toEqual([
			"A1",
			"A2",
			"B1",
			"B2",
			"C1",
			"C2"
		]);
		expect(SUMMARY_SIZES.map((s) => s.size)).toEqual(["short", "medium", "long"]);
	});

	it("writes short summary openers with outlet and word target", () => {
		const short = newsSummaryInstruction(story, "short", "B1", "French");
		expect(short).toContain("📰");
		expect(short).toContain("Markets rally");
		expect(short).toContain("BBC News");
		expect(short).toContain("French");
		expect(short).toContain("80 words");
		expect(short).toContain("CEFR B1");
		expect(short).toContain("Intermediate");
		expect(newsSummaryInstruction(story, "long", "C1", "French")).toContain(
			"450 words"
		);
		// Sourceless stories skip the byline, never dangling parens.
		expect(
			newsSummaryInstruction({ ...story, source: "" }, "short", "B1", "French")
		).not.toContain("()");
	});

	it("writes conversation openers with level, invite, and corrections", () => {
		const opener = newsConversationInstruction(story, "B1", "French");
		expect(opener).toContain("🗣️");
		expect(opener).toContain("Markets rally");
		expect(opener).toContain("CEFR B1");
		expect(opener).toContain("Intermediate");
		expect(opener).toContain("third participant");
		expect(opener).toContain("correct my mistakes");
		expect(opener).toContain("Stay in French");
	});
});

describe("article fetch", () => {
	const body = "x".repeat(500);

	it("reads Jina markdown raw, no HTML pass", async () => {
		const seen: string[] = [];
		const text = await fetchArticleText("https://outlet.test/a", async (url) => {
			seen.push(url);
			return `# Headline\n\n${body}`;
		});
		expect(seen).toEqual(["https://r.jina.ai/https://outlet.test/a"]);
		expect(text.startsWith("# Headline")).toBe(true);
	});

	it("falls back to direct fetch plus cleaning on Jina failure", async () => {
		const seen: string[] = [];
		const text = await fetchArticleText("https://outlet.test/a", async (url) => {
			seen.push(url);
			if (url.includes("jina")) throw new Error("rate limited");
			return `<html><body><article><p>${body}</p></article></body></html>`;
		});
		expect(seen).toEqual([
			"https://r.jina.ai/https://outlet.test/a",
			"https://outlet.test/a"
		]);
		expect(text).toContain(body.slice(0, 20));
	});

	it("retries direct when Jina returns a stub, throws past both", async () => {
		const direct = await fetchArticleText("https://outlet.test/a", async (url) => {
			if (url.includes("jina")) return "consent stub";
			return `<html><body><article><p>${body}</p></article></body></html>`;
		});
		expect(direct.length).toBeGreaterThanOrEqual(400);
		await expect(
			fetchArticleText("https://outlet.test/a", async () => "stub")
		).rejects.toMatchObject({ code: "unreadable" });
		// Both legs erroring propagates the transport failure (so the
		// notice can say timeout/refused); stubs mean unreadable.
		await expect(
			fetchArticleText("https://outlet.test/a", async () => {
				throw new Error("timeout");
			})
		).rejects.toThrow("timeout");
	});

	it("builds Jina URLs by prefix", () => {
		expect(jinaUrl("https://outlet.test/a")).toBe(
			"https://r.jina.ai/https://outlet.test/a"
		);
	});
});

describe("loading and errors", () => {
	it("loads stories through injected transport, honest when unsupported", async () => {
		const seen: string[] = [];
		const stories = await loadNewsStories("fr", "FR", async (url) => {
			seen.push(url);
			return `<?xml version="1.0"?><rss><channel>
				<item><title>Une - BBC</title><link>https://a</link></item>
			</channel></rss>`;
		});
		expect(seen).toEqual([newsRssUrl("fr", "FR")]);
		expect(stories).toEqual([
			{ title: "Une", source: "BBC", link: "https://a", snippet: "" }
		]);
		await expect(loadNewsStories("la", "XX", async () => "")).rejects.toThrow(
			"news-unsupported"
		);
	});

	it("maps every failure to a human sentence", () => {
		expect(newsErrorCopy(new Error("news-needs-shell"))).toContain("app shell");
		expect(newsErrorCopy(new Error("news-unsupported"))).toContain("no edition");
		expect(newsErrorCopy(new Error("news-empty"))).toContain("try another one");
		expect(newsErrorCopy({ code: "unreadable" })).toContain("retry in a bit");
		expect(newsErrorCopy(new Error("no-decoded-url"))).toContain("try another story");
		expect(newsErrorCopy(new Error("no-signature"))).toContain("app update");
		expect(newsErrorCopy(new Error("timed out"))).toContain("timed out");
		expect(newsErrorCopy(new Error("bad-status"))).toContain("refused");
		expect(newsErrorCopy(new Error("too-large"))).toContain("too big");
		expect(newsErrorCopy(new Error("boom"))).toContain("retry in a bit");
		expect(newsErrorCopy("plain string")).toContain("retry in a bit");
	});
});

describe("article resolution", () => {
	const body = "x".repeat(500);

	it("caches the mapping and the body across calls", async () => {
		const store = memStore();
		const calls: string[] = [];
		const run = () =>
			resolveArticleText(
				"https://news.google.com/rss/articles/AAA",
				async (link) => {
					calls.push(`decode:${link}`);
					return "https://outlet.test/a";
				},
				async (url) => {
					calls.push(`fetch:${url}`);
					return url.includes("jina") ? `# T\n\n${body}` : "stub";
				},
				store
			);
		const first = await run();
		expect(first).toEqual({ url: "https://outlet.test/a", text: `# T\n\n${body}` });
		expect(calls).toEqual([
			"decode:https://news.google.com/rss/articles/AAA",
			"fetch:https://r.jina.ai/https://outlet.test/a"
		]);
		// Second run serves both legs from the cache: no transport.
		const second = await run();
		expect(second).toEqual(first);
		expect(calls.length).toBe(2);
	});

	it("reuses a cached mapping with a fresh body fetch", async () => {
		const store = memStore();
		storeNewsUrl(store, "https://g", "https://outlet.test/a");
		let decoded = 0;
		const out = await resolveArticleText(
			"https://g",
			async () => {
				decoded++;
				return "https://other.test/";
			},
			async () => `# T\n\n${body}`,
			store
		);
		expect(decoded).toBe(0);
		expect(out.url).toBe("https://outlet.test/a");
	});

	it("propagates decode and fetch failures uncached", async () => {
		const store = memStore();
		await expect(
			resolveArticleText(
				"https://g",
				async () => {
					throw new Error("no-decoded-url");
				},
				async () => "x",
				store
			)
		).rejects.toThrow("no-decoded-url");
		expect(cachedNewsUrl(store, "https://g")).toBeNull();
		await expect(
			resolveArticleText(
				"https://g",
				async () => "https://outlet.test/a",
				async () => {
					throw new Error("timeout");
				},
				store
			)
		).rejects.toThrow("timeout");
		expect(cachedArticle(store, "https://g")).toBeNull();
		// But the mapping files even when the body fetch fails.
		expect(cachedNewsUrl(store, "https://g")).toBe("https://outlet.test/a");
	});

	it("caps mappings and ignores corrupt entries", () => {
		const store = memStore();
		for (let i = 0; i < 105; i++) {
			storeNewsUrl(store, `https://g${i}`, `https://o${i}`);
		}
		expect(cachedNewsUrl(store, "https://g0")).toBeNull();
		expect(cachedNewsUrl(store, "https://g104")).toBe("https://o104");
		const broken = memStore();
		broken.setItem("ccez-news-urls-v1", "{{{nope");
		expect(cachedNewsUrl(broken, "https://g")).toBeNull();
	});
});

describe("article cache", () => {
	it("hits fresh bodies and evicts stale ones on read", () => {
		const store = memStore();
		expect(cachedArticle(store, "https://a")).toBeNull();
		storeArticle(store, "https://a", "body", 1000);
		expect(cachedArticle(store, "https://a", 2000)).toBe("body");
		// Past the TTL the body is gone — and the entry with it.
		expect(cachedArticle(store, "https://a", 1000 + NEWS_CACHE_TTL_MS + 1)).toBeNull();
		expect(cachedArticle(store, "https://a", 2000)).toBeNull();
	});

	it("evicts oldest past the cap and survives corrupt stores", () => {
		const store = memStore();
		for (let i = 0; i < 25; i++) {
			storeArticle(store, `https://n${i}`, `b${i}`, 1000 + i);
		}
		expect(cachedArticle(store, "https://n0", 2000)).toBeNull();
		expect(cachedArticle(store, "https://n24", 2000)).toBe("b24");
		const broken = memStore();
		broken.setItem("ccez-news-cache-v1", "{{{nope");
		expect(cachedArticle(broken, "https://a")).toBeNull();
		// Writes into a hostile store never throw.
		const hostile: KeyValueStore = {
			getItem: () => null,
			setItem: () => {
				throw new Error("full");
			}
		};
		expect(() => storeArticle(hostile, "https://a", "b")).not.toThrow();
	});
});
