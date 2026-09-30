// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	CEFR_LEVELS,
	NEWS_CACHE_TTL_MS,
	NEWS_FEEDS,
	SUMMARY_SIZES,
	articleImageFromHtml,
	cachedArticle,
	cachedNewsImage,
	cachedNewsUrl,
	contentImageFromMarkdown,
	createRateGate,
	extractArticleText,
	imageMissSettles,
	fetchArticleText,
	isNewsFallback,
	isNewsSupported,
	jinaUrl,
	loadNewsStories,
	mergeNewsStories,
	newsConversationInstruction,
	newsErrorCopy,
	newsRegionsFor,
	newsRssUrl,
	newsStoriesFromXml,
	newsSummaryInstruction,
	parseTranslatedLines,
	translateNewsTitles,
	resolveArticleText,
	resolveStoryImage,
	shapeStory,
	storeArticle,
	storeNewsImage,
	storeNewsUrl,
	stripMarkdownMedia,
	stripTags,
	withTranslatedTitles
} from "./news";
import { MAX_FEED_ITEMS } from "./tools";
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
				// English hl throughout (the merge has no single URL);
				// home regions plus world chips, minus gls already native.
				for (const region of regions!) {
					if (region.merge) {
						expect(newsRssUrl(code, region.gl)).toBeNull();
						continue;
					}
					expect(newsRssUrl(code, region.gl)).toContain("hl=en");
				}
				const home = NEWS_FEEDS[code]!.regions;
				const native = home.length;
				const world = ["GBL", "US", "CA", "EUR", "GB", "AU", "LAT", "ASI"].filter(
					(gl) => !home.some((r) => r.gl === gl)
				).length;
				expect(regions!.length).toBe(native + world);
			}
			// Default region first, every region addressable (merges fan out).
			for (const region of regions!) {
				if (region.merge) {
					expect(newsRssUrl(code, region.gl)).toBeNull();
					continue;
				}
				expect(newsRssUrl(code, region.gl)).toContain(`gl=${region.gl}`);
			}
		}
		// No feed orphans: every table entry is a real language.
		for (const code of Object.keys(NEWS_FEEDS)) {
			expect(codes).toContain(code);
		}
		// Mainland China rides the Chinese feed past Taiwan; native
		// Singapore no longer blocks the Asia mix (synthetic key).
		expect(newsRegionsFor("zh")!.map((r) => r.gl)).toEqual([
			"TW",
			"CN",
			"HK",
			"SG",
			"GBL",
			"US",
			"CA",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
	});

	it("derives translated world regions unless one is native", () => {
		// French gains the world row minus Canada (native French
		// Canada stands in), home edition first.
		const fr = newsRegionsFor("fr")!;
		expect(fr.slice(-7).map((r) => r.gl)).toEqual([
			"GBL",
			"US",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
		expect(fr.slice(-7).every((r) => r.translate)).toBe(true);
		expect(fr.find((r) => r.gl === "GBL")).toMatchObject({
			label: "Global",
			merge: [
				{
					url: "https://feeds.bbci.co.uk/news/world/rss.xml",
					source: "BBC"
				},
				{
					url: "https://www.aljazeera.com/xml/rss/all.xml",
					source: "Al Jazeera"
				}
			]
		});
		// Europe mixes the continental five except the learner's own
		// (fr drops the French feed); the U.K. reads Britain alone.
		expect(fr.find((r) => r.gl === "EUR")).toMatchObject({
			label: "Europe",
			merge: [
				{
					url: "https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de",
					lang: "de"
				},
				{
					url: "https://news.google.com/rss?hl=es&gl=ES&ceid=ES:es",
					lang: "es"
				},
				{
					url: "https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it",
					lang: "it"
				},
				{
					url: "https://news.google.com/rss?hl=ru&gl=RU&ceid=RU:ru",
					lang: "ru"
				}
			]
		});
		expect(newsRegionsFor("da")!.find((r) => r.gl === "EUR")?.merge).toHaveLength(
			5
		);
		// Asia mixes the four giants; learners outside the mix keep
		// all four, insiders drop their own (the compound hl still
		// matches by bare language).
		expect(fr.find((r) => r.gl === "ASI")).toMatchObject({
			label: "Asia",
			merge: [
				{
					url: "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en-IN",
					lang: "en"
				},
				{
					url: "https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja",
					lang: "ja"
				},
				{
					url: "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
					lang: "ko"
				},
				{
					url: "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-CN",
					lang: "zh"
				}
			]
		});
		expect(
			newsRegionsFor("zh")!.find((r) => r.gl === "ASI")?.merge
		).toHaveLength(3);
		expect(fr.find((r) => r.gl === "GB")).toMatchObject({
			label: "U.K.",
			hl: "en-GB"
		});
		expect(newsRssUrl("fr", "US")).toContain("hl=en-US&gl=US");
		expect(newsRssUrl("fr", "GB")).toContain("hl=en-GB&gl=GB");
		expect(newsRssUrl("fr", "GBL")).toBeNull();
		expect(newsRssUrl("fr", "EUR")).toBeNull();
		expect(newsRssUrl("fr", "ASI")).toBeNull();
		expect(newsRssUrl("fr", "LAT")).toBeNull();
		// World chips carry icons, home chips don't.
		expect(fr.slice(-7).map((r) => r.icon)).toEqual([
			"🌐",
			"🇺🇸",
			"🇪🇺",
			"🇬🇧",
			"🇦🇺",
			"🌎",
			"🌏"
		]);
		expect(fr.slice(0, -7).every((r) => r.icon === undefined)).toBe(true);
		expect(newsRegionsFor("da")!.find((r) => r.gl === "CA")?.icon).toBe(
			"🇨🇦"
		);
		// Latin America mixes Mexico, Brazil, Argentina; Spanish
		// keeps Brazil only (its home chips cover the Spanish
		// editions), Portuguese the two Spanish ones.
		expect(fr.find((r) => r.gl === "LAT")).toMatchObject({
			label: "Latin America",
			merge: [
				{
					url: "https://news.google.com/rss?hl=es-MX&gl=MX&ceid=MX:es-MX",
					lang: "es"
				},
				{
					url: "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-BR",
					lang: "pt"
				},
				{
					url: "https://news.google.com/rss?hl=es-AR&gl=AR&ceid=AR:es-AR",
					lang: "es"
				}
			]
		});
		const esLat = newsRegionsFor("es")!.find((r) => r.gl === "LAT")?.merge;
		expect(esLat).toHaveLength(1);
		expect(esLat?.[0]?.url).toContain("gl=BR");
		expect(
			newsRegionsFor("pt")!.find((r) => r.gl === "LAT")?.merge
		).toHaveLength(2);
		expect(newsRssUrl("es", "CA")).toContain("hl=en-CA&gl=CA");
		expect(newsRssUrl("es", "AU")).toContain("hl=en-AU&gl=AU");
		// Spanish keeps its native US, gains the other seven translated.
		const es = newsRegionsFor("es")!;
		expect(es.filter((r) => r.gl === "US")).toHaveLength(1);
		expect(es.find((r) => r.gl === "US")?.translate).toBeUndefined();
		expect(es.slice(-7).map((r) => r.gl)).toEqual([
			"GBL",
			"CA",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
		// Pure-U.S. fallbacks: native US first, seven translated chips.
		expect(newsRegionsFor("da")!.map((r) => r.gl)).toEqual([
			"US",
			"GBL",
			"CA",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
		// Home-English fallbacks gain the world row (ang's native GB
		// stands in for the U.K. chip only).
		expect(newsRegionsFor("ur")!.map((r) => r.gl)).toEqual([
			"PK",
			"GBL",
			"US",
			"CA",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
		expect(newsRegionsFor("ang")!.map((r) => r.gl)).toEqual([
			"GB",
			"GBL",
			"US",
			"CA",
			"EUR",
			"AU",
			"LAT",
			"ASI"
		]);
	});

	it("merges editions round-robin, deduped and capped", () => {
		const story = (title: string) => ({
			title,
			source: "S",
			link: `https://${title}`,
			snippet: ""
		});
		const merged = mergeNewsStories(
			[[story("A"), story("B")], [story("C"), story("a!")], [story("D")]],
			10
		);
		// US, Europe, Asia, US, … — the case/punct twin of A drops out.
		expect(merged.map((s) => s.title)).toEqual(["A", "C", "D", "B"]);
		expect(
			mergeNewsStories([[story("A")], [story("B")]], 1).map((s) => s.title)
		).toEqual(["A"]);
		expect(mergeNewsStories([])).toEqual([]);
		// Default depth matches a single feed.
		const many = Array.from({ length: 20 }, (_, i) => story(`S${i}`));
		expect(mergeNewsStories([many, many])).toHaveLength(MAX_FEED_ITEMS);
	});

	it("fans Global loads out across both world desks", async () => {
		const seen: string[] = [];
		const xml = (title: string) =>
			`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://desk/${title}</link></item></channel></rss>`;
		const stories = await loadNewsStories("fr", "GBL", async (url) => {
			seen.push(url);
			if (url.includes("bbci")) return xml("Bbc");
			if (url.includes("aljazeera")) return xml("Aj");
			throw new Error(`unexpected feed ${url}`);
		});
		expect(seen).toHaveLength(2);
		expect(stories.map((s) => s.title)).toEqual(["Bbc", "Aj"]);
		// Suffix-less desk headlines get stamped with their desk.
		expect(stories.map((s) => s.source)).toEqual(["BBC", "Al Jazeera"]);
		await expect(loadNewsStories("xx", "US", async () => "")).rejects.toThrow(
			"news-unsupported"
		);
	});

	it("fans Europe loads out across the continent, minus home", async () => {
		const seen: string[] = [];
		const xml = (title: string) =>
			`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://desk/${title}</link></item></channel></rss>`;
		const feed = async (url: string) => {
			seen.push(url);
			const gl = new URL(url).searchParams.get("gl");
			if (
				gl === "FR" ||
				gl === "DE" ||
				gl === "ES" ||
				gl === "IT" ||
				gl === "RU"
			)
				return xml(gl);
			throw new Error(`unexpected feed ${url}`);
		};
		const stories = await loadNewsStories("da", "EUR", feed);
		expect(seen).toHaveLength(5);
		expect(stories.map((s) => s.title)).toEqual([
			"FR",
			"DE",
			"ES",
			"IT",
			"RU"
		]);
		seen.length = 0;
		await loadNewsStories("es", "EUR", feed);
		expect(seen).toHaveLength(4);
		expect(seen.some((u) => u.includes("gl=ES"))).toBe(false);
	});

	it("fans Asia loads out across the four giants, minus home", async () => {
		const seen: string[] = [];
		const xml = (title: string) =>
			`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://desk/${title}</link></item></channel></rss>`;
		const feed = async (url: string) => {
			seen.push(url);
			const gl = new URL(url).searchParams.get("gl");
			if (gl === "IN" || gl === "JP" || gl === "KR" || gl === "CN")
				return xml(gl);
			throw new Error(`unexpected feed ${url}`);
		};
		const stories = await loadNewsStories("da", "ASI", feed);
		expect(seen).toHaveLength(4);
		expect(stories.map((s) => s.title)).toEqual(["IN", "JP", "KR", "CN"]);
		seen.length = 0;
		await loadNewsStories("ko", "ASI", feed);
		expect(seen).toHaveLength(3);
		expect(seen.some((u) => u.includes("gl=KR"))).toBe(false);
		seen.length = 0;
		await loadNewsStories("zh", "ASI", feed);
		expect(seen).toHaveLength(3);
		expect(seen.some((u) => u.includes("gl=CN"))).toBe(false);
	});

	it("fans Latin America out across Mexico, Brazil, Argentina", async () => {
		const seen: string[] = [];
		const xml = (title: string) =>
			`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://desk/${title}</link></item></channel></rss>`;
		const feed = async (url: string) => {
			seen.push(url);
			const gl = new URL(url).searchParams.get("gl");
			if (gl === "MX" || gl === "BR" || gl === "AR") return xml(gl);
			throw new Error(`unexpected feed ${url}`);
		};
		const stories = await loadNewsStories("da", "LAT", feed);
		expect(seen).toHaveLength(3);
		expect(stories.map((s) => s.title)).toEqual(["MX", "BR", "AR"]);
		seen.length = 0;
		await loadNewsStories("es", "LAT", feed);
		expect(seen).toEqual([
			"https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-BR"
		]);
		seen.length = 0;
		await loadNewsStories("pt", "LAT", feed);
		expect(seen).toHaveLength(2);
		expect(seen.some((u) => u.includes("gl=BR"))).toBe(false);
	});

	it("applies translated titles, dropping cross-language dupes", () => {
		const story = (title: string) => ({
			title,
			link: `https://x/${title}`,
			source: "s",
			snippet: ""
		});
		const stories = [story("Un"), story("Deux"), story("Trois")];
		expect(
			withTranslatedTitles(stories, ["One", "Two", "Three"]).map((s) => s.title)
		).toEqual(["One", "Two", "Three"]);
		// Same event in two languages collapses to the first telling.
		expect(
			withTranslatedTitles(stories, ["One", "one!", "Three"]).map((s) => s.title)
		).toEqual(["One", "Three"]);
		// A short list keeps the original rather than blanking a card.
		expect(withTranslatedTitles(stories, ["One"]).map((s) => s.title)).toEqual([
			"One",
			"Deux",
			"Trois"
		]);
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

	it("carries feed images through, else no key", () => {
		expect(
			shapeStory({ title: "T", link: "https://x", description: "", image: "https://img/a.jpg" })
		).toMatchObject({ image: "https://img/a.jpg" });
		expect(
			shapeStory({ title: "T", link: "https://x", description: "" })
		).not.toHaveProperty("image");
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

	it("writes conversation openers: analysis, open end, one voice", () => {
		const opener = newsConversationInstruction(story, "B1", "French");
		expect(opener).toContain("🗣️");
		expect(opener).toContain("Markets rally");
		expect(opener).toContain("CEFR B1");
		expect(opener).toContain("Intermediate");
		expect(opener).toContain("Two named locals");
		expect(opener).toContain("never a retelling");
		expect(opener).toContain("nothing concluded");
		expect(opener).toContain("one voice answers");
		expect(opener).toContain("correct my mistakes");
		expect(opener).toContain("Never explain grammar or words unless I");
		expect(opener).toContain("Stay in French");
		expect(opener).not.toContain("invite");
	});
});

describe("article fetch", () => {
	const body = "x".repeat(500);

	it("extracts direct HTML first, no reader pass", async () => {
		const seen: string[] = [];
		const text = await fetchArticleText("https://outlet.test/a", async (url) => {
			seen.push(url);
			return `<html><body><nav>Home Politics Sport</nav><article><h1>Head</h1><p>${body}</p></article></body></html>`;
		});
		expect(seen).toEqual(["https://outlet.test/a"]);
		expect(text).toContain(body.slice(0, 20));
		expect(text).not.toContain("Sport");
	});

	it("falls back to reader markdown on direct failure or shells", async () => {
		const seen: string[] = [];
		const text = await fetchArticleText("https://outlet.test/a", async (url) => {
			seen.push(url);
			if (!url.includes("jina")) throw new Error("refused");
			return `Title: Head\nURL Source: https://outlet.test/a\nMarkdown Content:\n# Head\n\n[Lede](${url}) ${body}`;
		});
		expect(seen).toEqual(["https://outlet.test/a", "https://r.jina.ai/https://outlet.test/a"]);
		// Stripped to prose: no envelope, no URLs.
		expect(text).not.toContain("URL Source");
		expect(text).not.toContain("https://");
		expect(text).toContain("Lede");
	});

	it("retries reader when direct returns a stub, throws past both", async () => {
		const text = await fetchArticleText("https://outlet.test/a", async (url) => {
			if (url.includes("jina")) return `# Head\n\n${body}`;
			return "<html><body><div id='root'></div></body></html>";
		});
		expect(text.length).toBeGreaterThanOrEqual(400);
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

	it("extracts article scope, dropping chrome and crumbs", () => {
		const text = extractArticleText(`<html><body>
			<header>Site name</header><nav><a>Home</a><a>Politics</a></nav>
			<div class="cookie-wall">We value your privacy and use cookies to improve everything you see here daily.</div>
			<article><h1>A real headline here</h1><p>${body}</p><p>Ok</p>
			<aside>Related: other stories</aside></article>
			<footer>Copyright 2026</footer></body></html>`);
		expect(text).toContain(body.slice(0, 20));
		expect(text).not.toContain("Politics");
		expect(text).not.toContain("cookies");
		expect(text).not.toContain("Related");
		expect(text).not.toContain("Copyright");
		// Main/body scope when no article; crumbs fall away.
		expect(
			extractArticleText(`<html><body><main><p>${body}</p><p>Hi</p></main></body></html>`)
		).toContain(body.slice(0, 20));
		expect(extractArticleText("<html><body><p>Hi</p></body></html>")).toBe("");
		expect(extractArticleText("not html {{{")).toBe("");
	});

	it("strips reader markdown to prose without URLs", () => {
		expect(
			stripMarkdownMedia(
				"Title: T\nMarkdown Content:\n![Photo of X](https://img/a.jpg)\n\nSee [the report](https://o/r) now.\n\n[ref]: https://o/ref\n\nText[1]."
			)
		).toBe("Photo of X\n\nSee the report now.\n\nText[1].");
		expect(stripMarkdownMedia("![](https://img/a.jpg)\n\nBody here.")).toBe("Body here.");
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
			"fetch:https://outlet.test/a",
			"fetch:https://r.jina.ai/https://outlet.test/a"
		]);
		// Second run serves both legs from the cache: no transport.
		const second = await run();
		expect(second).toEqual(first);
		expect(calls.length).toBe(3);
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

	it("reads preview images out of article HTML", () => {
		const html = (head: string) =>
			`<!doctype html><html><head>${head}</head><body><p>Body</p></body></html>`;
		expect(
			articleImageFromHtml(
				html('<meta property="og:image" content="https://img/a.jpg"/>'),
				"https://outlet.test/s"
			)
		).toBe("https://img/a.jpg");
		// Twitter fallback, relative URLs resolved, junk yields null.
		expect(
			articleImageFromHtml(
				html('<meta name="twitter:image" content="/pic/b.jpg"/>'),
				"https://outlet.test/s"
			)
		).toBe("https://outlet.test/pic/b.jpg");
		expect(articleImageFromHtml(html(""), "https://outlet.test/s")).toBeNull();
		expect(articleImageFromHtml("not html {{{", "https://outlet.test/s")).toBeNull();
		// Reader markdown: first content image, chrome skipped.
		expect(
			contentImageFromMarkdown(
				"![Image 1: Logo](https://img/logo.png)\n\n![](https://img/t.gif?pixel=1)\n\n![Protesters march](https://img/photo.jpg)"
			)
		).toBe("https://img/photo.jpg");
		expect(contentImageFromMarkdown("no images here")).toBeNull();
		expect(contentImageFromMarkdown("![Logo](https://img/logo.png)")).toBeNull();
	});

	it("spaces gated reader calls, first one immediate", async () => {
		let at = 1000;
		const slept: number[] = [];
		const gate = createRateGate(
			3000,
			() => at,
			async (ms) => {
				slept.push(ms);
				at += ms;
			}
		);
		await gate();
		expect(slept).toEqual([]);
		await gate();
		expect(slept).toEqual([3000]);
		at += 3000;
		await gate();
		expect(slept).toEqual([3000]);
	});

	it("serializes concurrent gated calls through one chain", async () => {
		let at = 0;
		const slept: number[] = [];
		const gate = createRateGate(
			100,
			() => at,
			async (ms) => {
				slept.push(ms);
				at += ms;
			}
		);
		await Promise.all([gate(), gate(), gate()]);
		expect(slept).toEqual([100, 100]);
	});

	it("resolves one story image, complete only when settled", async () => {
		const og = '<meta property="og:image" content="https://img/a.jpg"/>';
		const html = (head: string) =>
			`<!doctype html><html><head>${head}</head><body><p>Body</p></body></html>`;
		const deps = (fetchPage: (url: string) => Promise<string>, fresh = true) => ({
			decode: async () => "https://outlet.test/s",
			fetchPage,
			gateJina: async () => {},
			fresh: () => fresh,
			cachedUrl: () => null,
			storeUrl: () => {}
		});
		// Direct hit: reader leg never runs.
		let jina = 0;
		const direct = deps(async (url) => {
			if (url.includes("r.jina.ai")) jina++;
			return html(og);
		});
		expect(await resolveStoryImage("https://g", direct)).toEqual({
			found: "https://img/a.jpg",
			complete: true
		});
		expect(jina).toBe(0);
		// Walled direct fetch falls through to the reader leg.
		const walled = deps(async (url) => {
			if (url.includes("r.jina.ai")) return "![Crowd](https://img/b.jpg)";
			throw new Error("bad-status");
		});
		expect(await resolveStoryImage("https://g", walled)).toEqual({
			found: "https://img/b.jpg",
			complete: true
		});
		// Both legs dry is a settled miss, cacheable as null.
		const dry = deps(async (url) => {
			if (url.includes("r.jina.ai")) return "no images here";
			return html("");
		});
		expect(await resolveStoryImage("https://g", dry)).toEqual({
			found: null,
			complete: true
		});
		// A throwing reader leg is transient: never a settled miss.
		const flaky = deps(async (url) => {
			if (url.includes("r.jina.ai")) throw new Error("bad-status");
			return html("");
		});
		expect(await resolveStoryImage("https://g", flaky)).toEqual({
			found: null,
			complete: false
		});
		// Quota blips retry; a standing reader wall settles now.
		const quota = deps(async (url) => {
			if (url.includes("r.jina.ai")) throw new Error("bad-status:429");
			return html("");
		});
		expect(await resolveStoryImage("https://g", quota)).toEqual({
			found: null,
			complete: false
		});
		const stood = deps(async (url) => {
			if (url.includes("r.jina.ai")) throw new Error("bad-status:403");
			throw new Error("bad-status:403");
		});
		expect(await resolveStoryImage("https://g", stood)).toEqual({
			found: null,
			complete: true
		});
		expect(imageMissSettles(new Error("bad-status:500"))).toBe(true);
		expect(imageMissSettles(new Error("timeout"))).toBe(false);
		expect(imageMissSettles(new Error("failed"))).toBe(false);
		expect(imageMissSettles("bad-status:403")).toBe(false);
		// Stale before the reader leg: incomplete, gate untouched.
		let gated = 0;
		const stale = {
			...deps(async () => html(""), false),
			gateJina: async () => {
				gated++;
			}
		};
		expect(await resolveStoryImage("https://g", stale)).toEqual({
			found: null,
			complete: false
		});
		expect(gated).toBe(0);
	});

	it("caches preview images, capped and corruption-proof", () => {
		const store = memStore();
		storeNewsImage(store, "https://g", "https://img/a.jpg");
		expect(cachedNewsImage(store, "https://g")).toBe("https://img/a.jpg");
		for (let i = 0; i < 105; i++) {
			storeNewsImage(store, `https://g${i}`, `https://img/${i}.jpg`);
		}
		expect(cachedNewsImage(store, "https://g0")).toBeNull();
		expect(cachedNewsImage(store, "https://g104")).toBe("https://img/104.jpg");
		const broken = memStore();
		broken.setItem("ccez-news-images-v1", "{{{nope");
		expect(cachedNewsImage(broken, "https://g")).toBeNull();
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
