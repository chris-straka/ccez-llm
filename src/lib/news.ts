import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { tauriBackendAvailable } from "./secrets";
import {
	MAX_FEED_ITEMS,
	parseFeedItems,
	type FeedItem
} from "./tools";
import type { KeyValueStore } from "./settings";

/**
 * Learner news: Google News RSS per reply language, region chips,
 * and the story-session prompts (📰 summary, 🗣️ conversation).
 * Transport stays injected (the shell's `fetch_page`), so this
 * module is pure logic plus thin fetch/cache wrappers.
 */

/**
 * One Google News edition: `gl` region plus its chip label. `hl`
 * overrides the feed language for cross-language editions, and
 * `translate` marks headlines shown translated into the learner's
 * language (the U.S. feed, which only Spanish has natively).
 */
export interface NewsRegion {
	gl: string;
	label: string;
	hl?: string;
	translate?: true;
	merge?: { url: string; source?: string }[];
}

/**
 * Feed config for one app language: `hl` plus editions, default
 * first. `fallback` marks a language with no edition of its own —
 * a home-country English edition where one exists (ur → Pakistani
 * English), else US English. Headlines read in English, sessions
 * run in the learner's language (the panel says so).
 */
export interface NewsFeed {
	hl: string;
	regions: NewsRegion[];
	fallback?: true;
}

/**
 * Google News editions per app language code, every `hl` verified
 * live (unknown codes redirect to English or a neighbor language —
 * da → Norwegian, hy → Russian, la/grc/sa → Italian/Greek/Hindi —
 * so anything unverified stays OUT rather than mislabel). Chips
 * show plain country labels, default first. Absent codes (unknown
 * to the app) keep the honest empty state.
 */
export const NEWS_FEEDS: Record<string, NewsFeed> = {
	fr: {
		hl: "fr",
		regions: [
			{ gl: "FR", label: "France" },
			{ gl: "CA", label: "Canada" },
			{ gl: "BE", label: "Belgium" },
			{ gl: "CH", label: "Switzerland" }
		]
	},
	de: {
		hl: "de",
		regions: [
			{ gl: "DE", label: "Germany" },
			{ gl: "AT", label: "Austria" },
			{ gl: "CH", label: "Switzerland" }
		]
	},
	es: {
		hl: "es",
		regions: [
			{ gl: "ES", label: "Spain" },
			{ gl: "MX", label: "Mexico" },
			{ gl: "AR", label: "Argentina" },
			{ gl: "CO", label: "Colombia" },
			{ gl: "US", label: "United States" }
		]
	},
	pt: {
		hl: "pt",
		regions: [
			{ gl: "BR", label: "Brazil" },
			{ gl: "PT", label: "Portugal" }
		]
	},
	ru: {
		hl: "ru",
		regions: [
			{ gl: "RU", label: "Russia" },
			{ gl: "UA", label: "Ukraine" },
			{ gl: "KZ", label: "Kazakhstan" }
		]
	},
	pl: { hl: "pl", regions: [{ gl: "PL", label: "Poland" }] },
	it: {
		hl: "it",
		regions: [
			{ gl: "IT", label: "Italy" },
			{ gl: "CH", label: "Switzerland" }
		]
	},
	no: { hl: "no", regions: [{ gl: "NO", label: "Norway" }] },
	cs: { hl: "cs", regions: [{ gl: "CZ", label: "Czechia" }] },
	el: {
		hl: "el",
		regions: [
			{ gl: "GR", label: "Greece" },
			{ gl: "CY", label: "Cyprus" }
		]
	},
	ro: {
		hl: "ro",
		regions: [
			{ gl: "RO", label: "Romania" },
			{ gl: "MD", label: "Moldova" }
		]
	},
	bg: { hl: "bg", regions: [{ gl: "BG", label: "Bulgaria" }] },
	hu: { hl: "hu", regions: [{ gl: "HU", label: "Hungary" }] },
	uk: { hl: "uk", regions: [{ gl: "UA", label: "Ukraine" }] },
	nl: {
		hl: "nl",
		regions: [
			{ gl: "NL", label: "Netherlands" },
			{ gl: "BE", label: "Belgium" }
		]
	},
	sv: { hl: "sv", regions: [{ gl: "SE", label: "Sweden" }] },
	fi: { hl: "fi", regions: [{ gl: "FI", label: "Finland" }] },
	sr: {
		hl: "sr",
		regions: [
			{ gl: "RS", label: "Serbia" },
			{ gl: "BA", label: "Bosnia" }
		]
	},
	sk: { hl: "sk", regions: [{ gl: "SK", label: "Slovakia" }] },
	zh: {
		hl: "zh-TW",
		regions: [
			{ gl: "TW", label: "Taiwan" },
			{ gl: "CN", label: "China" },
			{ gl: "HK", label: "Hong Kong" },
			{ gl: "SG", label: "Singapore" }
		]
	},
	ja: { hl: "ja", regions: [{ gl: "JP", label: "Japan" }] },
	ko: { hl: "ko", regions: [{ gl: "KR", label: "South Korea" }] },
	ar: {
		hl: "ar",
		regions: [
			{ gl: "SA", label: "Saudi Arabia" },
			{ gl: "EG", label: "Egypt" },
			{ gl: "AE", label: "UAE" }
		]
	},
	hi: { hl: "hi", regions: [{ gl: "IN", label: "India" }] },
	pa: { hl: "pa-IN", regions: [{ gl: "IN", label: "India" }] },
	id: { hl: "id", regions: [{ gl: "ID", label: "Indonesia" }] },
	tr: { hl: "tr", regions: [{ gl: "TR", label: "Türkiye" }] },
	th: { hl: "th", regions: [{ gl: "TH", label: "Thailand" }] },
	vi: { hl: "vi", regions: [{ gl: "VN", label: "Vietnam" }] },
	he: { hl: "he", regions: [{ gl: "IL", label: "Israel" }] },
	bn: {
		hl: "bn",
		regions: [
			{ gl: "BD", label: "Bangladesh" },
			{ gl: "IN", label: "India" }
		]
	},
	ta: { hl: "ta", regions: [{ gl: "IN", label: "India" }] },
	ms: { hl: "ms-MY", regions: [{ gl: "MY", label: "Malaysia" }] },
	// Fallback editions (verified redirect targets above): no
	// in-language edition exists, so English carries the headlines.
	da: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	hy: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	fa: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	is: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	yue: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	la: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	grc: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	non: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	sux: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	akk: { hl: "en-US", regions: [{ gl: "US", label: "U.S." }], fallback: true },
	ur: { hl: "en-PK", regions: [{ gl: "PK", label: "Pakistan" }], fallback: true },
	tl: {
		hl: "en-PH",
		regions: [{ gl: "PH", label: "Philippines" }],
		fallback: true
	},
	am: { hl: "en-ET", regions: [{ gl: "ET", label: "Ethiopia" }], fallback: true },
	sw: { hl: "en-KE", regions: [{ gl: "KE", label: "Kenya" }], fallback: true },
	sa: { hl: "en-IN", regions: [{ gl: "IN", label: "India" }], fallback: true },
	ang: { hl: "en-GB", regions: [{ gl: "GB", label: "Britain" }], fallback: true }
};

/** True when the language has a Google News edition. */
export function isNewsSupported(code: string): boolean {
	return NEWS_FEEDS[code] !== undefined;
}

/** True when the language reads a fallback English edition. */
export function isNewsFallback(code: string): boolean {
	return NEWS_FEEDS[code]?.fallback === true;
}

/** Editions for a language, default first; null when unsupported. */
/**
 * World headlines in the learner's language, derived for every
 * feed: U.S., Canada, Europe (Britain — the only European English
 * edition, so no separate UK chip), Asia (Singapore, the regional
 * English hub), Australia, and a Global mix of the BBC and Al
 * Jazeera world desks (Google has no true global edition, and
 * these link straight to articles — no redirect decoding).
 * Appended after the native regions, skipping any `gl` the feed
 * already carries natively (es-US, zh-SG, ang-GB, fr-CA — every
 * other `hl`+US request redirects home).
 */
const WORLD_REGIONS: NewsRegion[] = [
	{ gl: "US", label: "U.S.", hl: "en-US", translate: true },
	{ gl: "CA", label: "Canada", hl: "en-CA", translate: true },
	{ gl: "GB", label: "Europe", hl: "en-GB", translate: true },
	{ gl: "SG", label: "Asia", hl: "en-SG", translate: true },
	{ gl: "AU", label: "Australia", hl: "en-AU", translate: true },
	{
		gl: "GBL",
		label: "Global",
		translate: true,
		merge: [
			{ url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC" },
			{ url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" }
		]
	}
];

export function newsRegionsFor(code: string): NewsRegion[] | null {
	const feed = NEWS_FEEDS[code];
	if (!feed) return null;
	const have = new Set(feed.regions.map((r) => r.gl));
	return [...feed.regions, ...WORLD_REGIONS.filter((r) => !have.has(r.gl))];
}

/** Raw Top Stories URL for one edition. */
function feedUrl(hl: string, gl: string): string {
	return `https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`;
}

/**
 * Google News RSS URL for a language + region. Null when the pair
 * is unknown (unsupported language, or a `gl` outside its list —
 * never let callers invent editions), or when the region is a
 * merge with no single URL (Global — the loader fans out).
 */
export function newsRssUrl(code: string, gl: string): string | null {
	const feed = NEWS_FEEDS[code];
	const region = newsRegionsFor(code)?.find((r) => r.gl === gl);
	if (!feed || !region || region.merge) return null;
	return feedUrl(region.hl ?? feed.hl, gl);
}

/** One story card: headline, outlet, link, snippet, image. */
export interface NewsStory {
	title: string;
	source: string;
	link: string;
	snippet: string;
	image?: string;
}

/** Tags out of feed descriptions (Google wraps links in HTML). Pure. */
export function stripTags(text: string): string {
	return text
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * A feed item into a story card. Google titles read
 * "Headline - Outlet": the last dash segment is the outlet when
 * short, else the whole title stands sourceless. Linkless items
 * drop (a card that can't launch is a dead end). Pure.
 */
export function shapeStory(item: FeedItem): NewsStory | null {
	if (!item.link) return null;
	const title = item.title.trim();
	if (!title) return null;
	const dash = title.lastIndexOf(" - ");
	const tail = dash >= 0 ? title.slice(dash + 3).trim() : "";
	const source = tail && tail.length <= 48 ? tail : "";
	const image = (item.image ?? "").trim();
	return {
		title: source ? title.slice(0, dash).trim() : title,
		source,
		link: item.link.trim(),
		snippet: stripTags(item.description ?? "").trim(),
		...(image ? { image } : {})
	};
}

/**
 * Stories out of raw feed markup (transport stays with the caller).
 * Never throws: malformed feeds yield no cards, not an error.
 */
export function newsStoriesFromXml(markup: string): NewsStory[] {
	let items: FeedItem[];
	try {
		items = parseFeedItems(markup);
	} catch {
		return [];
	}
	const stories: NewsStory[] = [];
	for (const item of items) {
		const story = shapeStory(item);
		if (story) stories.push(story);
	}
	return stories;
}

/** Session kind: 🗣️ conversation or 📰 summary. */
export type NewsKind = "talk" | "read";

/** News panel fetch state. */
export type NewsStatus =
	| "loading"
	| "translating"
	| "ready"
	| "error"
	| "unsupported"
	| "needs-shell";

/** Everything the news panel renders (page-owned). */
export interface NewsPanelState {
	code: string;
	langName: string;
	regions: NewsRegion[];
	region: string;
	status: NewsStatus;
	stories: NewsStory[];
	error: string;
	/** True when the headlines come from an English fallback edition. */
	fallback: boolean;
}

/** One card's expanded option rows (page-owned, cleared on launch). */
export interface NewsPicker {
	link: string;
	/** Chosen level (B2 until tapped) — talk and read share it. */
	level?: CefrLevel;
	/** Chosen summary length (medium until tapped). */
	size?: SummarySize;
}

/** CEFR levels for conversation sessions. */
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export const CEFR_LEVELS: Array<{ level: CefrLevel; tag: string }> = [
	{ level: "A1", tag: "Beginner" },
	{ level: "A2", tag: "Elementary" },
	{ level: "B1", tag: "Intermediate" },
	{ level: "B2", tag: "Upper intermediate" },
	{ level: "C1", tag: "Advanced" },
	{ level: "C2", tag: "Proficient" }
];

/** Summary lengths (target words guide the model, not a hard cap). */
export type SummarySize = "short" | "medium" | "long";

export const SUMMARY_SIZES: Array<{
	size: SummarySize;
	label: string;
	words: number;
}> = [
	{ size: "short", label: "Short", words: 80 },
	{ size: "medium", label: "Medium", words: 200 },
	{ size: "long", label: "Long", words: 450 }
];

/**
 * Visible session opener for a summary: one short instruction plus
 * the outlet line. The article itself rides as a pasted-text
 * attachment (spliced at send, folded back to a tag after), so the
 * chat shows this line — never a wall of article.
 */
export function newsSummaryInstruction(
	story: NewsStory,
	size: SummarySize,
	level: CefrLevel,
	langName: string
): string {
	const words =
		SUMMARY_SIZES.find((s) => s.size === size)?.words ?? 200;
	const tag = CEFR_LEVELS.find((l) => l.level === level)?.tag ?? "";
	const byline = story.source ? ` (${story.source})` : "";
	return (
		`📰 "${story.title}"${byline}\n` +
		`Summarize the pasted article in ${langName} at CEFR ${level} (${tag}), ` +
		`about ${words} words.`
	);
}

/**
 * Visible session opener for a conversation: two named locals open
 * a substantial discussion of the story at the learner's level —
 * analysis over retelling — then go quiet as a pair; once the
 * learner barges in, one voice answers and corrects. Teaching
 * lives in the corrections only, never in unprompted lectures.
 * Same attachment ride as summaries.
 */
export function newsConversationInstruction(
	story: NewsStory,
	level: CefrLevel,
	langName: string
): string {
	const tag = CEFR_LEVELS.find((l) => l.level === level)?.tag ?? "";
	const byline = story.source ? ` (${story.source})` : "";
	return (
		`🗣️ "${story.title}"${byline}\n` +
		`Two named locals open a substantial discussion of the pasted article in ${langName} ` +
		`at CEFR ${level} (${tag}): reactions, background, and analysis — why it matters, ` +
		`what follows — never a retelling. Varied structures and connectors, spoken texture, ` +
		`key vocabulary reused across turns. End the opener mid-thread: nothing concluded, ` +
		`nobody addressing me. Once I join, one voice answers; when I write in ${langName}, ` +
		`briefly correct my mistakes and continue. Never explain grammar or words unless I ` +
		`ask. Stay in ${langName}.`
	);
}

/** Article fetch failures, machine-readable for the notice copy. */
export class NewsArticleError extends Error {
	readonly code: "unreachable" | "unreadable";
	constructor(code: "unreachable" | "unreadable") {
		super(code);
		this.code = code;
	}
}

/** Shortest usable article body; consent walls and stubs fall below. */
export const MIN_ARTICLE_CHARS = 400;
/** Article text kept for the model (context-friendly head). */
export const MAX_ARTICLE_CHARS = 12000;

/** Jina Reader fetch of a URL (clean markdown, no outlet clutter). */
export function jinaUrl(url: string): string {
	return `https://r.jina.ai/${url}`;
}

/**
 * Best preview image out of raw article HTML: og:image, then
 * twitter:image, resolved against the page URL. Pure (needs DOM).
 */
export function articleImageFromHtml(html: string, baseUrl: string): string | null {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return null;
	}
	const content = (attr: "property" | "name", key: string): string =>
		doc.querySelector(`meta[${attr}="${key}"]`)?.getAttribute("content")?.trim() ?? "";
	const raw = content("property", "og:image") || content("name", "twitter:image");
	if (!raw) return null;
	try {
		return new URL(raw, baseUrl).href;
	} catch {
		return null;
	}
}

const CHROME_IMAGE_HINTS = [
	"logo",
	"icon",
	"avatar",
	"sprite",
	"pixel",
	"spacer",
	"transparent",
	"placeholder",
	"tracking",
	"badge",
	"favicon"
];

/**
 * First content image out of reader markdown, skipping chrome
 * (logos, icons, pixels) by alt and URL. Pure.
 */
export function contentImageFromMarkdown(markdown: string): string | null {
	const pattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(markdown)) !== null) {
		const alt = (match[1] ?? "").toLowerCase();
		const url = match[2] ?? "";
		if (!url) continue;
		const hay = `${alt} ${url.toLowerCase()}`;
		if (CHROME_IMAGE_HINTS.some((hint) => hay.includes(hint))) continue;
		return url;
	}
	return null;
}

/**
 * Article body for a story link. Jina first (clean markdown, used
 * raw); direct fetch plus HTML cleaning when Jina fails or comes
 * back a stub. Throws NewsArticleError when both legs fail.
 * Transport is injected; cleaning decisions are pure below.
 */
const ARTICLE_DROP =
	"script, style, noscript, template, header, nav, footer, aside, form, dialog, menu, " +
	"[role='navigation'], [role='banner'], [role='contentinfo'], [role='complementary'], " +
	"[role='search'], [role='dialog'], " +
	"[id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i], " +
	"[id*='cmp' i], [class*='cmp' i], [class*='gdpr' i], " +
	"[class*='newsletter' i], [class*='subscribe' i], [class*='paywall' i], " +
	"[class*='share' i], [class*='social' i], [class*='related' i], [class*='comment' i], " +
	"[class*='advert' i], [class*='popup' i], [class*='modal' i], [class*='overlay' i], " +
	"[class*='breadcrumb' i]";

/**
 * Article prose out of raw page HTML: chrome stripped (nav, cookie
 * walls, share/related/comment blocks), then the article/main/body
 * scope read as paragraphs. Short crumbs fall away. Pure (needs DOM).
 */
export function extractArticleText(html: string): string {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return "";
	}
	doc.querySelectorAll(ARTICLE_DROP).forEach((el) => el.remove());
	const scope = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
	if (!scope) return "";
	const blocks: string[] = [];
	scope.querySelectorAll("h1, h2, h3, p").forEach((el) => {
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
		if (text.length >= 40) blocks.push(text);
	});
	return blocks.join("\n\n").slice(0, MAX_ARTICLE_CHARS);
}

/**
 * Markdown down to its readable text: reader envelope dropped,
 * images shed to alt (or gone), links shed to their label,
 * reference definitions dropped. The model gets prose, not URLs.
 * Pure.
 */
export function stripMarkdownMedia(markdown: string): string {
	return markdown
		.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gm, "")
		.replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "$1")
		.replace(/^\[[^\]]+\]:\s*\S+.*$/gm, "")
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<https?:\/\/[^>\s]+>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Article prose, direct extraction first (static HTML beats reader
 * chrome), reader-rendered markdown second (JS shells need it).
 */
export async function fetchArticleText(
	link: string,
	fetchHtml: (url: string) => Promise<string>
): Promise<string> {
	let firstFailure: unknown = null;
	let threw = 0;
	for (const direct of [true, false]) {
		try {
			const raw = await fetchHtml(direct ? link : jinaUrl(link));
			const text = direct ? extractArticleText(raw) : stripMarkdownMedia(raw);
			if (text.length >= MIN_ARTICLE_CHARS) {
				return text.slice(0, MAX_ARTICLE_CHARS);
			}
		} catch (error) {
			threw++;
			firstFailure ??= error;
		}
	}
	// Both legs erroring is transport (timeout, refused) — say so;
	// stubs back mean the page genuinely won't read.
	if (threw === 2) throw firstFailure;
	throw new NewsArticleError("unreadable");
}

/**
 * Raw page markup through the shell (RSS XML, outlet HTML). The
 * browser preview has no shell transport — CORS would block Google
 * and most outlets anyway — so it fails honest up front. Errors
 * carry machine-readable messages for newsErrorCopy.
 */
export async function fetchRawPage(url: string): Promise<string> {
	if (!tauriBackendAvailable()) throw new Error("news-needs-shell");
	const out = await tauriInvoke<unknown>("fetch_page", { url });
	if (typeof out !== "string" || !out) throw new Error("news-empty");
	return out;
}

/** One Google News link into its publisher URL (shell only). */
export async function decodeNewsLink(link: string): Promise<string> {
	if (!tauriBackendAvailable()) throw new Error("news-needs-shell");
	const out = await tauriInvoke<unknown>("news_decode_url", { link });
	if (typeof out !== "string" || !out.startsWith("http")) {
		throw new Error("news-decode-failed");
	}
	return out;
}

/** Stories for a language + region (transport injected). Pure flow. */
/**
 * Several feeds interleaved round-robin (BBC, Al Jazeera, …) so
 * no one desk's agenda leads, deduped by normalized headline,
 * capped at single-feed depth. Pure.
 */
export function mergeNewsStories(
	feeds: NewsStory[][],
	cap = MAX_FEED_ITEMS
): NewsStory[] {
	const seen = new Set<string>();
	const merged: NewsStory[] = [];
	const depth = Math.max(0, ...feeds.map((feed) => feed.length));
	for (let i = 0; i < depth && merged.length < cap; i++) {
		for (const feed of feeds) {
			const story = feed[i];
			if (!story) continue;
			const key = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
			if (seen.has(key)) continue;
			seen.add(key);
			merged.push(story);
			if (merged.length >= cap) break;
		}
	}
	return merged;
}

export async function loadNewsStories(
	code: string,
	gl: string,
	fetchXml: (url: string) => Promise<string>
): Promise<NewsStory[]> {
	const region = newsRegionsFor(code)?.find((r) => r.gl === gl);
	if (!region) throw new Error("news-unsupported");
	if (region.merge) {
		const targets = region.merge;
		const xmls = await Promise.all(targets.map((target) => fetchXml(target.url)));
		// Single-desk feeds carry no outlet suffix — stamp the desk.
		const feeds = xmls.map((xml, i) => {
			const desk = targets[i]?.source ?? "";
			return newsStoriesFromXml(xml).map((story) =>
				story.source || !desk ? story : { ...story, source: desk }
			);
		});
		return mergeNewsStories(feeds);
	}
	const url = newsRssUrl(code, gl);
	if (!url) throw new Error("news-unsupported");
	return newsStoriesFromXml(await fetchXml(url));
}

/**
 * Numbered translation lines back into titles: strips "1. "/"1) ",
 * drops blanks, and demands the exact count (a model that merges
 * or splits lines fails loudly instead of mislabeling cards).
 * Pure.
 */
export function parseTranslatedLines(text: string, count: number): string[] | null {
	const lines = text
		.split("\n")
		.map((line) => line.replace(/^\s*\d+[.)]\s*/, "").trim())
		.filter((line) => line.length > 0);
	return lines.length === count ? lines : null;
}

/**
 * U.S. headlines into the learner's language in one batched model
 * call (completion injected, like the feed transport). Throws
 * news-translate on a short reply — the feed errors retryably
 * rather than showing half-translated cards.
 */
export async function translateNewsTitles(
	titles: string[],
	langName: string,
	complete: (prompt: string) => Promise<string>
): Promise<string[]> {
	if (titles.length === 0) return [];
	const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
	const out = await complete(
		`Translate these ${titles.length} headlines into ${langName}. ` +
			`Reply with exactly ${titles.length} numbered lines ("1. …") and nothing else:\n${numbered}`
	);
	const lines = parseTranslatedLines(out, titles.length);
	if (!lines) throw new Error("news-translate");
	return lines;
}

/**
 * One machine-readable failure into its notice sentence. Covers the
 * news codes plus the shared fetch_page codes (timeout, bad-status,
 * too-large, bad-url, failed) and the article unreadable case.
 */
export function newsErrorCopy(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("news-needs-shell")) {
		return "News needs the app shell — the browser preview can't reach it.";
	}
	if (message.includes("news-unsupported")) {
		return "Google News has no edition in this language yet.";
	}
	if (message.includes("news-translate")) {
		return "The headlines wouldn't translate — retry in a bit.";
	}
	if (message.includes("news-empty") || message.includes("unreadable")) {
		return "That story wouldn't open — try another one.";
	}
	if (message.includes("news-decode-failed") || message.includes("no-decoded-url")) {
		return "Google wouldn't give up that link — try another story.";
	}
	if (message.includes("no-signature")) {
		return "Google changed its redirect page — this needs an app update.";
	}
	if (message.includes("timed out") || message.includes("timeout")) {
		return "The news fetch timed out — check your connection and retry.";
	}
	if (message.includes("bad-status")) {
		return "The news server refused — retry in a bit.";
	}
	if (message.includes("too-large")) {
		return "That page is too big to read — try another story.";
	}
	return "The news fetch failed — retry in a bit.";
}

/** Article cache record: body plus fetch time. */
export interface NewsCacheEntry {
	text: string;
	at: number;
}

const NEWS_CACHE_KEY = "ccez-news-cache-v1";
/** Article bodies keep a day; the list always refetches fresh. */
export const NEWS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Cap the cache (12k bodies × entries stays localStorage-safe). */
const NEWS_CACHE_MAX = 20;

function readNewsCache(store: KeyValueStore): Record<string, NewsCacheEntry> {
	try {
		const raw = store.getItem(NEWS_CACHE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as Record<string, NewsCacheEntry>;
	} catch {
		return {};
	}
}

/** Fresh cached body for a link, else null (stale entries evict on read). */
export function cachedArticle(
	store: KeyValueStore,
	link: string,
	now = Date.now()
): string | null {
	const cache = readNewsCache(store);
	const entry = cache[link];
	if (!entry || typeof entry.text !== "string") return null;
	if (now - entry.at > NEWS_CACHE_TTL_MS) {
		delete cache[link];
		try {
			store.setItem(NEWS_CACHE_KEY, JSON.stringify(cache));
		} catch {
			// Eviction is hygiene, never fatal.
		}
		return null;
	}
	return entry.text;
}

/** File an article body (oldest evicted past the cap). Never throws. */
export function storeArticle(
	store: KeyValueStore,
	link: string,
	text: string,
	now = Date.now()
): void {
	try {
		const cache = readNewsCache(store);
		cache[link] = { text, at: now };
		const keys = Object.keys(cache);
		if (keys.length > NEWS_CACHE_MAX) {
			keys
				.sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0))
				.slice(0, keys.length - NEWS_CACHE_MAX)
				.forEach((k) => delete cache[k]);
		}
		store.setItem(NEWS_CACHE_KEY, JSON.stringify(cache));
	} catch {
		// A full or broken store must never break the session.
	}
}

const NEWS_URL_KEY = "ccez-news-urls-v1";
/** Decoded mappings keep (a Google link always unwraps the same). */
const NEWS_URL_MAX = 100;

function readNewsUrls(store: KeyValueStore): Record<string, string> {
	try {
		const raw = store.getItem(NEWS_URL_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as Record<string, string>;
	} catch {
		return {};
	}
}

/** Cached publisher URL for a Google link, else null. Never throws. */
export function cachedNewsUrl(store: KeyValueStore, link: string): string | null {
	const found = readNewsUrls(store)[link];
	return typeof found === "string" && found.startsWith("http") ? found : null;
}

/** File a decoded mapping (oldest evicted past the cap). Never throws. */
export function storeNewsUrl(store: KeyValueStore, link: string, url: string): void {
	try {
		const urls = readNewsUrls(store);
		delete urls[link];
		urls[link] = url;
		const keys = Object.keys(urls);
		for (const key of keys.slice(0, Math.max(0, keys.length - NEWS_URL_MAX))) {
			delete urls[key];
		}
		store.setItem(NEWS_URL_KEY, JSON.stringify(urls));
	} catch {
		// Mapping cache is a speedup, never load-bearing.
	}
}

const NEWS_IMAGE_KEY = "ccez-news-images-v1";
const NEWS_IMAGE_MAX = 100;

function readNewsImages(store: KeyValueStore): Record<string, string> {
	try {
		const raw = store.getItem(NEWS_IMAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return {};
		return parsed as Record<string, string>;
	} catch {
		return {};
	}
}

/** Cached preview image for a story link, else null. Never throws. */
export function cachedNewsImage(store: KeyValueStore, link: string): string | null {
	const found = readNewsImages(store)[link];
	return typeof found === "string" && found.startsWith("http") ? found : null;
}

/** File a preview image (oldest evicted past the cap). Never throws. */
export function storeNewsImage(store: KeyValueStore, link: string, image: string): void {
	try {
		const images = readNewsImages(store);
		delete images[link];
		images[link] = image;
		const keys = Object.keys(images);
		for (const key of keys.slice(0, Math.max(0, keys.length - NEWS_IMAGE_MAX))) {
			delete images[key];
		}
		store.setItem(NEWS_IMAGE_KEY, JSON.stringify(images));
	} catch {
		// Image cache is a speedup, never load-bearing.
	}
}

/**
 * A story link into its publisher URL plus article body, both legs
 * cached (transport injected). Throws the decode/fetch errors for
 * newsErrorCopy — the caller stays in news mode to retry.
 */
export async function resolveArticleText(
	link: string,
	decode: (link: string) => Promise<string>,
	fetchHtml: (url: string) => Promise<string>,
	store: KeyValueStore
): Promise<{ url: string; text: string }> {
	const hit = cachedArticle(store, link);
	if (hit) return { url: cachedNewsUrl(store, link) ?? link, text: hit };
	const url = cachedNewsUrl(store, link) ?? (await decode(link));
	storeNewsUrl(store, link, url);
	const text = await fetchArticleText(url, fetchHtml);
	storeArticle(store, link, text);
	return { url, text };
}
