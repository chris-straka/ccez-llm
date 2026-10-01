/**
 * Model-driven web lookup: the `fetch_url` tool the chat endpoint can
 * call mid-turn, so the MODEL fetches pages — the user never pastes
 * markup. Wire shape is OpenAI function-calling (`tools` /
 * `tool_calls` / `tool` messages); providers without tool support
 * simply never call it (the client falls back to plain text).
 *
 * Everything here is pure except the DOM read: URL validation, the
 * tool definition, and HTML-to-text cleaning. Fetching itself lives
 * in `fetchPage.ts` (shell command with a browser fallback); the
 * turn loop lives in `openai-compat.ts`.
 */

/** OpenAI function definition wired into chat requests. */
export const FETCH_TOOL_NAME = "fetch_url";

export interface FetchToolDef {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: {
			type: "object";
			properties: { url: { type: string; description: string } };
			required: string[];
		};
	};
}

export function fetchToolDef(): FetchToolDef {
	return {
		type: "function",
		function: {
			name: FETCH_TOOL_NAME,
			description:
				"Fetch a web page and return its readable text. Use this when the user asks about a URL or " +
				"when current/external facts would answer better than training data. The user doesn't know it exists. " +
				"Do not use it when no external information is required. It returns the page text " +
				"(truncated when long) or a one-line error — never raw HTML. " +
				"RSS/Atom feeds work too and are the best route to recent news: a feed returns its latest " +
				"headlines as one line each. Prefer a feed URL you know for the outlet asked about. " +
				"Call it at once when you need a page — never write that you will fetch without calling. " +
				"When a fetch fails, call again with a different URL instead of stopping. " +
				`To search the web, fetch ${SEARCH_URL_PREFIX}<url-encoded query>: it returns the top results ` +
				"as one line each with their URLs, so fetch the best result next instead of guessing a URL.",
			parameters: {
				type: "object",
				properties: {
					url: {
						type: "string",
						description: "The full http(s) URL to fetch."
					}
				},
				required: ["url"]
			}
		}
	};
}

/**
 * Keyless web search: DuckDuckGo's no-JS HTML endpoint, fetched like
 * any page. The tool description teaches the model this prefix, and
 * {@link parseSearchResults} turns the result page into feed-style
 * lines (title — snippet (url)) so the model can follow a link.
 */
export const SEARCH_URL_PREFIX = "https://html.duckduckgo.com/html/?q=";

/** True when the URL is a search-results page this module can parse. */
export function isSearchUrl(url: string): boolean {
	try {
		return new URL(url).hostname === "html.duckduckgo.com";
	} catch {
		return false;
	}
}

/** Longest URL the tool accepts (guards log spam, not a security line). */
export const MAX_FETCH_URL_CHARS = 2048;

/**
 * True for fetchable URLs: http/https only, no credentials, no
 * whitespace. Pure — the executor trusts nothing else.
 */
export function validFetchUrl(raw: unknown): boolean {
	if (typeof raw !== "string") return false;
	if (!raw || raw.length > MAX_FETCH_URL_CHARS || /\s/.test(raw)) return false;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	if (parsed.username || parsed.password) return false;
	return true;
}

/** Longest page text kept per fetch (chars; the head wins). */
export const MAX_FETCH_TEXT_CHARS = 12000;

/** Most feed items kept per fetch (headlines first). */
export const MAX_FEED_ITEMS = 15;
/** Longest item description kept (chars). */
const MAX_FEED_DESC_CHARS = 200;

export interface FeedItem {
	title: string;
	link: string;
	description: string;
	image?: string;
}

/**
 * True for feed markup (RSS `<rss>`/`<item>`, Atom `<feed>`/`<entry>`).
 * Pure string gate — the parser below decides for real.
 */
export function looksLikeFeed(text: string): boolean {
	const head = text.slice(0, 2000).toLowerCase();
	return (
		head.includes("<rss") ||
		head.includes("<feed") ||
		(head.includes("<?xml") &&
			(head.includes("<item") || head.includes("<entry")))
	);
}

/**
 * Headlines out of RSS/Atom markup: title, link, description per
 * item, head wins. Malformed feeds yield what parses (possibly
 * nothing) — never throw. Pure over the markup.
 */
export function parseFeedItems(markup: string): FeedItem[] {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(markup, "text/xml");
	} catch {
		return [];
	}
	// Namespace-agnostic on purpose (Atom rides a default namespace
	// that CSS selectors can't see through).
	const child = (node: Element, name: string): string => {
		for (const el of node.children) {
			if (el.localName === name) return (el.textContent ?? "").trim();
		}
		return "";
	};
	const items = doc.getElementsByTagName("item");
	const entries = items.length > 0 ? items : doc.getElementsByTagName("entry");
	const out: FeedItem[] = [];
	for (const node of entries) {
		if (out.length >= MAX_FEED_ITEMS) break;
		let link = child(node, "link");
		if (!link) {
			for (const el of node.children) {
				if (el.localName === "link" && el.getAttribute("href")) {
					link = (el.getAttribute("href") ?? "").trim();
					break;
				}
			}
		}
		const title = child(node, "title");
		if (!title) continue;
		// Largest declared media image (BBC thumbs, Guardian sizes);
		// Atom body `<content>` carries no url and falls through.
		let image = "";
		let width = -1;
		for (const el of node.children) {
			if (el.localName !== "thumbnail" && el.localName !== "content") continue;
			const url = (el.getAttribute("url") ?? "").trim();
			if (!url) continue;
			const w = Number(el.getAttribute("width") ?? 0) || 0;
			if (w >= width) {
				image = url;
				width = w;
			}
		}
		out.push({
			title,
			link,
			description: (child(node, "description") || child(node, "summary")).slice(
				0,
				MAX_FEED_DESC_CHARS
			),
			...(image ? { image } : {})
		});
	}
	return out;
}

/** Feed items rendered as model food: one line each, capped overall. */
export function formatFeedItems(items: FeedItem[]): string {
	return items
		.map((item) => {
			const head = item.description
				? `${item.title} — ${item.description}`
				: item.title;
			return item.link ? `- ${head} (${item.link})` : `- ${head}`;
		})
		.join("\n")
		.slice(0, MAX_FETCH_TEXT_CHARS);
}

/**
 * Real target out of a DuckDuckGo redirect (`//duckduckgo.com/l/?uddg=…`);
 * direct links pass through. Pure.
 */
function unwrapSearchLink(href: string): string {
	try {
		const url = new URL(href, "https://duckduckgo.com");
		return url.searchParams.get("uddg") ?? url.href;
	} catch {
		return href;
	}
}

/**
 * Organic results out of a DuckDuckGo HTML result page, ads dropped,
 * shaped as feed items so {@link formatFeedItems} renders them. Pure
 * over the markup (DOMParser is the only host need).
 */
export function parseSearchResults(html: string): FeedItem[] {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const out: FeedItem[] = [];
	for (const node of doc.querySelectorAll(".result")) {
		if (out.length >= MAX_FEED_ITEMS) break;
		if (node.classList.contains("result--ad")) continue;
		const anchor = node.querySelector("a.result__a");
		const title = (anchor?.textContent ?? "").trim();
		const href = anchor?.getAttribute("href") ?? "";
		if (!title || !href) continue;
		out.push({
			title,
			link: unwrapSearchLink(href),
			description: (node.querySelector(".result__snippet")?.textContent ?? "")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, MAX_FEED_DESC_CHARS)
		});
	}
	return out;
}

/**
 * Readable text out of a page's HTML: prefers `<article>`/`<main>`,
 * drops scripts, styles, nav, headers, footers, forms, and templates,
 * then collapses whitespace. Returns "" when nothing readable
 * remains. Pure over the markup (DOMParser is the only host need).
 */
export function htmlToText(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	doc
		.querySelectorAll(
			"script, style, noscript, nav, header, footer, form, template, svg, canvas, iframe"
		)
		.forEach((el) => el.remove());
	const root =
		doc.querySelector("article") ??
		doc.querySelector("main") ??
		doc.body ??
		doc.documentElement;
	const text = (root?.textContent ?? "")
		.split("\n")
		.map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
		.filter((line) => line.length > 0)
		.join("\n");
	return text.slice(0, MAX_FETCH_TEXT_CHARS);
}

/** One tool call off the wire (`{id, url}`); null when not a fetch call. Pure. */
export function parseFetchCall(call: {
	id?: unknown;
	function?: { name?: unknown; arguments?: unknown };
}): { id: string; url: string } | null {
	if (typeof call.id !== "string" || !call.id) return null;
	if (call.function?.name !== FETCH_TOOL_NAME) return null;
	let args: unknown;
	try {
		args = JSON.parse(
			typeof call.function.arguments === "string" ? call.function.arguments : ""
		);
	} catch {
		return null;
	}
	const url = (args as { url?: unknown } | null)?.url;
	if (typeof url !== "string" || !validFetchUrl(url)) return null;
	return { id: call.id, url };
}
