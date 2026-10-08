// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	cachedFeed,
	loadNewsPicks,
	parseNewsLaunch,
	storeFeed,
	storeNewsPicks,
	NEWS_FEED_TTL_MS,
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
	decodeNewsLink,
	extractArticleText,
	imageMissSettles,
	fetchArticleText,
	isDirectStoryLink,
	isNewsFallback,
	isWebviewUnsupported,
	isNewsSupported,
	isUnopenableOutlet,
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
	resolveImageBatch,
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
			"ang",
			"lzh",
			"hbo"
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

	it("translates fallback natives so headlines never show English", () => {
		// Old Norse reads a US English edition: its default region
		// must translate, while native editions (fr) stay as-is.
		const non = newsRegionsFor("non")!;
		expect(non[0]?.gl).toBe("US");
		expect(non[0]?.translate).toBe(true);
		const fr = newsRegionsFor("fr")!;
		expect(fr[0]?.translate).toBeFalsy();
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
		expect(
			fr
				.slice(-7)
				.filter((r) => r.translate)
				.map((r) => r.gl)
		).toEqual([]);
		// French, Spanish, Portuguese, Chinese, and Persian
		// read every world chip natively — nothing left to
		// translate.
		for (const code of ["fr", "es", "pt", "zh", "fa"]) {
			const regions = newsRegionsFor(code)!;
			expect(regions.some((r) => r.translate)).toBe(false);
		}
		expect(fr.find((r) => r.gl === "GBL")?.translate).toBeUndefined();
		expect(fr.find((r) => r.gl === "GBL")).toMatchObject({
			label: "Global",
			merge: [
				{
					url: "https://www.france24.com/fr/rss",
					source: "France 24"
				},
				{
					url: "https://www.rfi.fr/fr/rss",
					source: "RFI"
				}
			]
		});
		// Europe mixes the continental five except the learner's own
		// (da keeps all five); French and Italian read native desks.
		expect(newsRegionsFor("da")!.find((r) => r.gl === "EUR")).toMatchObject({
			label: "Europe",
			merge: [
				{
					url: "https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr",
					lang: "fr"
				},
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
		// matches by bare language). French reads a native desk.
		expect(newsRegionsFor("da")!.find((r) => r.gl === "ASI")).toMatchObject({
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
			newsRegionsFor("ko")!.find((r) => r.gl === "ASI")?.merge
		).toHaveLength(3);
		expect(fr.find((r) => r.gl === "GB")).toMatchObject({
			label: "U.K.",
			merge: [
				{
					url: "https://www.france24.com/fr/tag/royaume-uni/rss",
					source: "France 24"
				},
				{
					url: "https://www.rfi.fr/fr/tag/royaume-uni/rss",
					source: "RFI"
				}
			]
		});
		expect(newsRssUrl("fr", "US")).toBeNull();
		expect(newsRssUrl("fr", "GB")).toBeNull();
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
		// Latin America mixes Mexico, Brazil, Argentina; Spanish,
		// Portuguese, French, Chinese, and Persian read native desks.
		expect(newsRegionsFor("da")!.find((r) => r.gl === "LAT")).toMatchObject({
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
		expect(fr.find((r) => r.gl === "LAT")).toMatchObject({
			label: "Latin America",
			merge: [
				{
					url: "https://www.france24.com/fr/tag/am%C3%A9rique-latine/rss",
					source: "France 24"
				}
			]
		});
		const esLat = newsRegionsFor("es")!.find((r) => r.gl === "LAT");
		expect(esLat?.translate).toBeUndefined();
		expect(esLat?.merge).toMatchObject([
			{
				url: "https://www.france24.com/es/am%C3%A9rica-latina/rss",
				source: "France 24"
			}
		]);
		const ptLat = newsRegionsFor("pt")!.find((r) => r.gl === "LAT");
		expect(ptLat?.translate).toBeUndefined();
		expect(ptLat?.merge).toMatchObject([
			{
				url: "https://www.rfi.fr/br/tag/am%C3%A9rica-latina/rss",
				source: "RFI"
			}
		]);
		expect(newsRssUrl("es", "CA")).toBeNull();
		expect(newsRssUrl("es", "AU")).toBeNull();
		// Spanish keeps its native US; every world chip is native.
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

	it("reads native desks where a world service publishes the language", () => {
		// French U.S. and Global go fully native (no AI
		// translation); German keeps the translated feeds.
		const frUs = newsRegionsFor("fr")!.find((r) => r.gl === "US")!;
		expect(frUs.translate).toBeUndefined();
		expect(frUs.merge).toMatchObject([
			{ url: "https://www.france24.com/fr/am%C3%A9riques/rss", source: "France 24" },
			{ url: "https://www.rfi.fr/fr/am%C3%A9riques/rss", source: "RFI" }
		]);
		const frGbl = newsRegionsFor("fr")!.find((r) => r.gl === "GBL")!;
		expect(frGbl.translate).toBeUndefined();
		expect(frGbl.merge).toMatchObject([
			{ url: "https://www.france24.com/fr/rss", source: "France 24" },
			{ url: "https://www.rfi.fr/fr/rss", source: "RFI" }
		]);
		const esGbl = newsRegionsFor("es")!.find((r) => r.gl === "GBL")!;
		expect(esGbl.translate).toBeUndefined();
		expect(esGbl.merge).toMatchObject([
			{ url: "https://feeds.bbci.co.uk/mundo/rss.xml", source: "BBC Mundo" },
			{ url: "https://www.france24.com/es/rss", source: "France 24" }
		]);
		const arGbl = newsRegionsFor("ar")!.find((r) => r.gl === "GBL")!;
		expect(arGbl.translate).toBeUndefined();
		expect(arGbl.merge).toMatchObject([
			{ url: "https://feeds.bbci.co.uk/arabic/rss.xml", source: "BBC Arabic" },
			{ url: "https://www.france24.com/ar/rss", source: "France 24" }
		]);
		const frEur = newsRegionsFor("fr")!.find((r) => r.gl === "EUR")!;
		expect(frEur.translate).toBeUndefined();
		expect(frEur.merge).toMatchObject([
			{ url: "https://www.france24.com/fr/europe/rss", source: "France 24" },
			{ url: "https://www.rfi.fr/fr/europe/rss", source: "RFI" }
		]);
		const itEur = newsRegionsFor("it")!.find((r) => r.gl === "EUR")!;
		expect(itEur.translate).toBeUndefined();
		expect(itEur.merge).toMatchObject([
			{ url: "https://it.euronews.com/rss", source: "Euronews" }
		]);
		const ptGbl = newsRegionsFor("pt")!.find((r) => r.gl === "GBL")!;
		expect(ptGbl.translate).toBeUndefined();
		expect(ptGbl.merge).toMatchObject([
			{ url: "https://feeds.bbci.co.uk/portuguese/rss.xml", source: "BBC Brasil" },
			{ url: "https://www.rfi.fr/br/rss", source: "RFI Brasil" }
		]);
		const deGbl = newsRegionsFor("de")!.find((r) => r.gl === "GBL")!;
		expect(deGbl.translate).toBeUndefined();
		expect(deGbl.merge).toMatchObject([
			{
				url: "https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml",
				source: "tagesschau"
			}
		]);
		const zhUs = newsRegionsFor("zh")!.find((r) => r.gl === "US")!;
		expect(zhUs.translate).toBeUndefined();
		expect(zhUs.merge).toMatchObject([
			{ url: "https://www.rfi.fr/cn/%E7%BE%8E%E6%B4%B2/rss", source: "RFI" }
		]);
		const zhGbl = newsRegionsFor("zh")!.find((r) => r.gl === "GBL")!;
		expect(zhGbl.translate).toBeUndefined();
		expect(zhGbl.merge).toMatchObject([
			{ url: "https://www.rfi.fr/cn/rss", source: "RFI" }
		]);
		const jaGbl = newsRegionsFor("ja")!.find((r) => r.gl === "GBL")!;
		expect(jaGbl.translate).toBeUndefined();
		expect(jaGbl.merge).toMatchObject([
			{ url: "https://www3.nhk.or.jp/rss/news/cat6.xml", source: "NHK" },
			{ url: "https://feeds.bbci.co.uk/japanese/rss.xml", source: "BBC Japanese" }
		]);
		const koGbl = newsRegionsFor("ko")!.find((r) => r.gl === "GBL")!;
		expect(koGbl.translate).toBeUndefined();
		expect(koGbl.merge).toMatchObject([
			{ url: "https://www.yna.co.kr/rss/international.xml", source: "Yonhap" },
			{ url: "https://feeds.bbci.co.uk/korean/rss.xml", source: "BBC Korean" }
		]);
		// BBC/RFI world services across Asia, Africa, and Europe.
		const desks: Array<[string, string[]]> = [
			["ru", ["bbci.co.uk/russian", "rfi.fr/ru"]],
			["fa", ["bbci.co.uk/persian", "rfi.fr/fa"]],
			["vi", ["bbci.co.uk/vietnamese", "rfi.fr/vi"]],
			["sw", ["bbci.co.uk/swahili", "rfi.fr/sw"]],
			["ur", ["bbci.co.uk/urdu"]],
			["hi", ["bbci.co.uk/hindi"]],
			["id", ["bbci.co.uk/indonesia"]],
			["uk", ["bbci.co.uk/ukrainian"]],
			["bn", ["bbci.co.uk/bengali"]],
			["pa", ["bbci.co.uk/punjabi"]],
			["am", ["bbci.co.uk/amharic"]],
			["ta", ["bbci.co.uk/tamil"]],
			["th", ["bbci.co.uk/thai"]],
			["tr", ["voaturkce.com/api/"]],
			["it", ["ansa.it/sito/notizie/mondo/"]]
		];
		for (const [code, hosts] of desks) {
			const gbl = newsRegionsFor(code)!.find((r) => r.gl === "GBL")!;
			expect(gbl.translate).toBeUndefined();
			expect(gbl.merge?.map((t) => t.url)).toHaveLength(hosts.length);
			for (const [i, host] of hosts.entries()) {
				expect(gbl.merge?.[i]?.url).toContain(host);
				expect(gbl.merge?.[i]?.source?.length).toBeGreaterThan(0);
			}
		}
		// VOA and RFI/France 24 section desks beyond Global.
		const sections: Array<[string, string, string[]]> = [
			["ru", "US", ["golosameriki.com/api/"]],
			["fa", "US", ["ir.voanews.com/api/"]],
			["vi", "US", ["voatiengviet.com/api/", "rfi.fr/vi/"]],
			["th", "US", ["voathai.com/api/"]],
			["id", "US", ["voaindonesia.com/api/"]],
			["pt", "US", ["rfi.fr/br/am"]],
			["es", "EUR", ["france24.com/es/europa", "rfi.fr/es/europa"]],
			["pt", "EUR", ["rfi.fr/br/europa"]],
			["ar", "EUR", ["france24.com/ar/"]],
			["zh", "ASI", ["rfi.fr/cn/"]],
			["fr", "GB", ["france24.com/fr/tag/", "rfi.fr/fr/tag/"]],
			["fr", "AU", ["france24.com/fr/tag/", "rfi.fr/fr/tag/"]],
			["es", "GB", ["france24.com/es/tag/", "rfi.fr/es/tag/"]],
			["es", "AU", ["france24.com/es/tag/", "rfi.fr/es/tag/"]],
			["pt", "GB", ["rfi.fr/br/tag/"]],
			["pt", "AU", ["rfi.fr/br/tag/"]],
			["pt", "LAT", ["rfi.fr/br/tag/"]],
			["zh", "GB", ["rfi.fr/cn/"]],
			["zh", "AU", ["rfi.fr/cn/"]],
			["ru", "GB", ["rfi.fr/ru/"]],
			["ru", "AU", ["rfi.fr/ru/"]],
			["ru", "EUR", ["rfi.fr/ru/"]],
			["ru", "CA", ["rfi.fr/ru/"]],
			["sw", "US", ["rfi.fr/sw/"]],
			["sw", "GB", ["rfi.fr/sw/"]],
			["sw", "EUR", ["rfi.fr/sw/"]],
			["sw", "AU", ["rfi.fr/sw/"]],
			["vi", "EUR", ["rfi.fr/vi/"]],
			["vi", "AU", ["rfi.fr/vi/"]],
			["vi", "CA", ["rfi.fr/vi/"]],
			["es", "CA", ["france24.com/es/tag/"]],
			["zh", "EUR", ["rfi.fr/cn/"]],
			["zh", "LAT", ["rfi.fr/cn/"]],
			["zh", "CA", ["rfi.fr/cn/"]],
			["fr", "LAT", ["france24.com/fr/tag/"]],
			["fr", "ASI", ["france24.com/fr/asie-pacifique"]],
			["es", "ASI", ["france24.com/es/tag/"]],
			["pt", "ASI", ["rfi.fr/br/tag/"]],
			["ar", "ASI", ["france24.com/ar/"]],
			["fa", "GB", ["rfi.fr/fa/"]],
			["fa", "EUR", ["rfi.fr/fa/"]],
			["fa", "AU", ["rfi.fr/fa/"]],
			["fa", "CA", ["rfi.fr/fa/"]],
			["fa", "ASI", ["rfi.fr/fa/"]],
			["fa", "LAT", ["rfi.fr/fa/"]],
			["ko", "US", ["voakorea.com/api/"]],
			["am", "US", ["amharic.voanews.com/api/"]],
			["sw", "CA", ["rfi.fr/sw/"]],
			["pt", "CA", ["rfi.fr/br/tag/"]]
		];
		for (const [code, gl, hosts] of sections) {
			const region = newsRegionsFor(code)!.find((r) => r.gl === gl)!;
			expect(region.translate).toBeUndefined();
			expect(region.merge?.map((t) => t.url)).toHaveLength(hosts.length);
			for (const [i, host] of hosts.entries()) {
				expect(region.merge?.[i]?.url).toContain(host);
				expect(region.merge?.[i]?.source?.length).toBeGreaterThan(0);
			}
		}
		// A native desk stands in for a fallback home region too
		// (Persian U.S. reads VOA first, untranslated).
		const faHome = newsRegionsFor("fa")!;
		expect(faHome[0]?.gl).toBe("US");
		expect(faHome[0]?.translate).toBeUndefined();
		expect(faHome[0]?.merge).toHaveLength(1);
		// Overrides keep chip position, label, and icon.
		expect(newsRegionsFor("fr")!.slice(-7).map((r) => r.gl)).toEqual([
			"GBL",
			"US",
			"EUR",
			"GB",
			"AU",
			"LAT",
			"ASI"
		]);
		expect(frUs).toMatchObject({ label: "U.S.", icon: "🇺🇸" });
		expect(frGbl).toMatchObject({ label: "Global", icon: "🌐" });
		// Everyone else keeps the translated English feeds.
		expect(newsRegionsFor("de")!.find((r) => r.gl === "US")).toMatchObject({
			hl: "en-US",
			translate: true
		});
		expect(newsRegionsFor("pl")!.find((r) => r.gl === "GBL")?.merge).toMatchObject([
			{ url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
			{ url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" }
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
		const stories = await loadNewsStories("pl", "GBL", async (url) => {
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

	it("degrades a merge when one desk dies", async () => {
		const xml = (title: string) =>
			`<?xml version="1.0"?><rss><channel><item><title>${title}</title><link>https://desk/${title}</link></item></channel></rss>`;
		const stories = await loadNewsStories("pl", "GBL", async (url) => {
			if (url.includes("aljazeera")) throw new Error("bad-status:403");
			return xml("Bbc");
		});
		expect(stories.map((s) => s.title)).toEqual(["Bbc"]);
		expect(stories.map((s) => s.source)).toEqual(["BBC"]);
		// Both desks dead: no cards, not an error.
		const empty = await loadNewsStories("pl", "GBL", async () => {
			throw new Error("timeout");
		});
		expect(empty).toEqual([]);
	});

	it("passes direct desk links through, decoding only Google links", async () => {
		expect(isDirectStoryLink("https://news.google.com/rss/articles/AAA")).toBe(false);
		expect(isDirectStoryLink("https://www.france24.com/fr/a")).toBe(true);
		expect(isDirectStoryLink("not a url")).toBe(false);
		// Passthrough needs no shell: native-desk cards launch anywhere.
		await expect(decodeNewsLink("https://www.rfi.fr/fr/a")).resolves.toBe(
			"https://www.rfi.fr/fr/a"
		);
		// Google links still need the shell decoder.
		await expect(
			decodeNewsLink("https://news.google.com/rss/articles/AAA")
		).rejects.toThrow("news-needs-shell");
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
		await loadNewsStories("es", "EUR", async (url) => {
			seen.push(url);
			return xml("Europa");
		});
		expect(seen).toEqual([
			"https://www.france24.com/es/europa/rss",
			"https://www.rfi.fr/es/europa/rss"
		]);
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
		await loadNewsStories("zh", "ASI", async (url) => {
			seen.push(url);
			return xml("Asia");
		});
		expect(seen).toEqual(["https://www.rfi.fr/cn/%E4%BA%9A%E6%B4%B2/rss"]);
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
		await loadNewsStories("es", "LAT", async (url) => {
			seen.push(url);
			return xml("AmLat");
		});
		expect(seen).toEqual(["https://www.france24.com/es/am%C3%A9rica-latina/rss"]);
		seen.length = 0;
		await loadNewsStories("pt", "LAT", async (url) => {
			seen.push(url);
			return xml("AmLat");
		});
		expect(seen).toEqual(["https://www.rfi.fr/br/tag/am%C3%A9rica-latina/rss"]);
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

	it("matches unopenable outlets whole-word, diacritics folded", () => {
		expect(isUnopenableOutlet("NZZ")).toBe(true);
		expect(isUnopenableOutlet("NZZ am Sonntag")).toBe(true);
		expect(isUnopenableOutlet("Neue Zürcher Zeitung")).toBe(true);
		expect(isUnopenableOutlet("  nzz.ch ")).toBe(true);
		expect(isUnopenableOutlet("Le Monde")).toBe(false);
		expect(isUnopenableOutlet("Les Echos")).toBe(false);
		expect(isUnopenableOutlet("Anzz Ledger")).toBe(false);
		expect(isUnopenableOutlet("")).toBe(false);
	});

	it("drops unopenable outlets before they take a card", () => {
		const xml = `<?xml version="1.0"?><rss><channel>
			<item><title>Rates rise - NZZ</title><link>https://a</link></item>
			<item><title>Rates rise - BBC</title><link>https://b</link></item>
		</channel></rss>`;
		expect(newsStoriesFromXml(xml)).toEqual([
			{ title: "Rates rise", source: "BBC", link: "https://b", snippet: "" }
		]);
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
		const deps = (
			fetchPage: (url: string) => Promise<string>,
			fresh = true,
			over: Record<string, unknown> = {}
		) => ({
			decode: async () => "https://outlet.test/s",
			fetchPage,
			gateJina: async () => {},
			fresh: () => fresh,
			cachedUrl: () => null,
			storeUrl: () => {},
			jinaQuotaBlown: () => false,
			flagJinaQuota: () => {},
			...over
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
		// Quota settles to the letter tile (retrying every open
		// skeletons the card forever and hammers a blown quota);
		// a standing reader wall settles now.
		let flagged = 0;
		const quota = deps(
			async (url) => {
				if (url.includes("r.jina.ai")) throw new Error("bad-status:429");
				return html("");
			},
			true,
			{ flagJinaQuota: () => void flagged++ }
		);
		expect(await resolveStoryImage("https://g", quota)).toEqual({
			found: null,
			complete: true
		});
		expect(flagged).toBe(1);
		// Blown quota skips the reader leg entirely: no gate wait,
		// no fetch burn, straight to the settled letter.
		let jinaBurned = 0;
		let gatedQuota = 0;
		const blown = deps(
			async (url) => {
				if (url.includes("r.jina.ai")) jinaBurned++;
				return html("");
			},
			true,
			{
				jinaQuotaBlown: () => true,
				gateJina: async () => void gatedQuota++
			}
		);
		expect(await resolveStoryImage("https://g", blown)).toEqual({
			found: null,
			complete: true
		});
		expect(jinaBurned).toBe(0);
		expect(gatedQuota).toBe(0);
		// Undecodable links settle too (no URL, no image possible).
		const undecodable = deps(async () => html(""), true, {
			decode: async () => {
				throw new Error("news-decode-failed");
			}
		});
		expect(await resolveStoryImage("https://g", undecodable)).toEqual({
			found: null,
			complete: true
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

	it("reads walled stories through the hidden browser last", async () => {
		const html = (head: string) =>
			`<!doctype html><html><head>${head}</head><body><p>Body</p></body></html>`;
		const wall = async (url: string) => {
			if (url.includes("r.jina.ai")) return "no images here";
			throw new Error("bad-status:403");
		};
		const deps = (over: Record<string, unknown> = {}) => ({
			decode: async () => "https://outlet.test/s",
			fetchPage: wall,
			gateJina: async () => {},
			fresh: () => true,
			cachedUrl: () => null,
			storeUrl: () => {},
			jinaQuotaBlown: () => false,
			flagJinaQuota: () => {},
			...over
		});
		// Walled direct + dry reader + hidden hit: the wall falls.
		let attempts = 0;
		const hit = deps({
			fetchWebview: async (url: string) => {
				attempts++;
				expect(url).toBe("https://outlet.test/s");
				return "https://outlet.test/w.jpg";
			}
		});
		expect(await resolveStoryImage("https://g", hit)).toEqual({
			found: "https://outlet.test/w.jpg",
			complete: true
		});
		expect(attempts).toBe(1);
		// Dry hidden read keeps the reader leg's miss verdict.
		const dry = deps({ fetchWebview: async () => null });
		expect(await resolveStoryImage("https://g", dry)).toEqual({
			found: null,
			complete: true
		});
		// Hidden timeout stays transient (retry next open).
		const slow = deps({
			fetchWebview: async () => {
				throw new Error("timeout");
			}
		});
		expect(await resolveStoryImage("https://g", slow)).toEqual({
			found: null,
			complete: false
		});
		// No hidden leg: the reader verdict stands, silently.
		expect(isWebviewUnsupported(new Error("unsupported"))).toBe(true);
		expect(isWebviewUnsupported(new Error("timeout"))).toBe(false);
		const bare = deps({
			fetchWebview: async () => {
				throw new Error("unsupported");
			}
		});
		expect(await resolveStoryImage("https://g", bare)).toEqual({
			found: null,
			complete: true
		});
		// Blown quota skips the reader burn but still tries hidden.
		let quotaGate = 0;
		const quota = deps({
			jinaQuotaBlown: () => true,
			gateJina: async () => {
				quotaGate++;
			},
			fetchWebview: async () => "https://outlet.test/q.jpg"
		});
		expect(await resolveStoryImage("https://g", quota)).toEqual({
			found: "https://outlet.test/q.jpg",
			complete: true
		});
		expect(quotaGate).toBe(0);
		// Direct-imageless pages never pay for the hidden leg.
		let wasted = 0;
		const seen = deps({
			fetchPage: async () => html(""),
			fetchWebview: async () => {
				wasted++;
				return "https://outlet.test/w.jpg";
			}
		});
		expect(await resolveStoryImage("https://g", seen)).toEqual({
			found: null,
			complete: true
		});
		expect(wasted).toBe(0);
	});

	it("retries transient images once, then settles the letter tile", async () => {
		const settled: Array<[string, string | null, boolean]> = [];
		const calls = new Map<string, number>();
		const script: Record<string, Array<{ found: string | null; complete: boolean }>> = {
			hit: [{ found: "https://img/h.jpg", complete: true }],
			miss: [{ found: null, complete: true }],
			flaky: [
				{ found: null, complete: false },
				{ found: "https://img/f.jpg", complete: true }
			],
			dead: [
				{ found: null, complete: false },
				{ found: null, complete: false }
			]
		};
		await resolveImageBatch(Object.keys(script), {
			resolveOne: async (link) => {
				calls.set(link, (calls.get(link) ?? 0) + 1);
				const step = script[link]?.[(calls.get(link) ?? 1) - 1];
				if (!step) throw new Error("no script step");
				return step;
			},
			fresh: () => true,
			onSettled: (link, found, complete) => void settled.push([link, found, complete])
		});
		// Complete links settle once, never retried.
		expect(calls.get("hit")).toBe(1);
		expect(calls.get("miss")).toBe(1);
		// Flaky recovers on round two; dead settles UI-only.
		expect(calls.get("flaky")).toBe(2);
		expect(calls.get("dead")).toBe(2);
		const byLink = new Map(settled.map(([link, found, complete]) => [link, [found, complete]]));
		expect(byLink.get("hit")).toEqual(["https://img/h.jpg", true]);
		expect(byLink.get("miss")).toEqual([null, true]);
		expect(byLink.get("flaky")).toEqual(["https://img/f.jpg", true]);
		expect(byLink.get("dead")).toEqual([null, false]);
		expect(settled.filter(([link]) => link === "dead").length).toBe(1);
	});

	it("settles nothing visible once stale, and never throws", async () => {
		const settled: string[] = [];
		const calls: string[] = [];
		let fresh = true;
		await resolveImageBatch(
			["a", "b"],
			{
				resolveOne: async (link) => {
					calls.push(link);
					if (link === "b") {
						fresh = false;
						return { found: null, complete: false };
					}
					return { found: `https://img/${link}.jpg`, complete: true };
				},
				fresh: () => fresh,
				onSettled: (link) => void settled.push(link)
			},
			2,
			1
		);
		// One lane runs the links in order: the first settles, the
		// stale second never retries and the leftover pass stays home.
		expect(settled).toEqual(["a"]);
		expect(calls).toEqual(["a", "b"]);
		// Throwing legs and listeners still resolve the batch.
		await expect(
			resolveImageBatch(["x"], {
				resolveOne: async () => {
					throw new Error("timeout");
				},
				fresh: () => true,
				onSettled: () => {
					throw new Error("listener blew up");
				}
			})
		).resolves.toBeUndefined();
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

describe("feed cache", () => {
	const mem = (): KeyValueStore => {
		const m = new Map<string, string>();
		return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
	};
	const stories = [{ title: "T", source: "S", link: "l", snippet: "" }];

	it("returns fresh headlines per language and region", () => {
		const store = mem();
		storeFeed(store, "fr", "FR", stories, 1000);
		expect(cachedFeed(store, "fr", "FR", 2000)).toEqual(stories);
		expect(cachedFeed(store, "fr", "CA", 2000)).toBeNull();
		expect(cachedFeed(store, "fr", "FR", 1000 + NEWS_FEED_TTL_MS + 1)).toBeNull();
	});

	it("evicts the oldest past the cap and never throws", () => {
		const store = mem();
		for (let i = 0; i < 14; i++) storeFeed(store, "fr", `R${i}`, stories, i + 1);
		expect(cachedFeed(store, "fr", "R0", 20)).toBeNull();
		expect(cachedFeed(store, "fr", "R13", 20)).toEqual(stories);
		const hostile: KeyValueStore = {
			getItem: () => "{broken",
			setItem: () => {
				throw new Error("full");
			}
		};
		expect(() => storeFeed(hostile, "fr", "FR", stories)).not.toThrow();
		expect(cachedFeed(hostile, "fr", "FR")).toBeNull();
	});
});

describe("remembered session picks", () => {
	it("defaults to B2 medium and round-trips valid picks only", () => {
		const m = new Map<string, string>();
		const store: KeyValueStore = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
		expect(loadNewsPicks(store)).toEqual({ level: "B2", size: "medium" });
		storeNewsPicks(store, { level: "A1", size: "long" });
		expect(loadNewsPicks(store)).toEqual({ level: "A1", size: "long" });
		m.set("ccez-news-picks-v1", JSON.stringify({ level: "Z9", size: "huge" }));
		expect(loadNewsPicks(store)).toEqual({ level: "B2", size: "medium" });
	});
});

describe("parseNewsLaunch", () => {
	const story = { title: "Soupçons de peste en Russie", source: "CNews", link: "l", snippet: "" };
	it("reads a conversation opener back into its tag", () => {
		const text = `${newsConversationInstruction(story, "B2", "French")} [Pasted 3491 chars] `;
		expect(parseNewsLaunch(text)).toEqual({
			kind: "talk",
			title: "Soupçons de peste en Russie",
			source: "CNews",
			level: "B2",
			size: null
		});
	});
	it("reads a summary opener with its length", () => {
		const text = newsSummaryInstruction({ ...story, source: "" }, "long", "C1", "German");
		expect(parseNewsLaunch(text)).toEqual({
			kind: "read",
			title: "Soupçons de peste en Russie",
			source: "",
			level: "C1",
			size: "long"
		});
	});
	it("leaves ordinary messages alone", () => {
		expect(parseNewsLaunch("hello")).toBeNull();
		expect(parseNewsLaunch('📰 "A quote"\nmy own words about CEFR B2')).toBeNull();
	});
});
