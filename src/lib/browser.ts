/**
 * The browser pane's pure rules (docs/design/browser-pane.md): what an
 * address-bar entry opens, how the URL reads, how wide the chat and the
 * pane are, which tab a close lands on, what's kept between launches.
 * The pages themselves are native child webviews (src-tauri/src/browser.rs);
 * browser-pane.svelte.ts drives them.
 */

export const BROWSER_HOME_URL = "https://duckduckgo.com/";
export const BROWSER_SEARCH_PREFIX = "https://duckduckgo.com/?q=";

/**
 * A bare host: "example.com", "münchen.de", "localhost:3000",
 * "192.168.1.4", "[::1]:8080", a punycode TLD ("xn--p1ai").
 */
const BARE_HOST_RE =
	/^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\]|([\p{L}\p{N}-]+\.)+(\p{L}{2,}|xn--[a-z0-9-]+))(:\d{1,5})?([/?#].*)?$/iu;

/** This computer and the home network: no certificate there, so plain http. */
const LOCAL_HOST_RE =
	/^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[[0-9a-f:]+\]|[^/:]+\.local)(:\d{1,5})?([/?#].*)?$/i;

/**
 * DuckDuckGo's region for a reply language (its `kl`): a search from the
 * address bar comes back in the language the chat is in (owner,
 * 2026-11-06). Languages DuckDuckGo has no region for search as usual.
 */
const SEARCH_REGIONS: Record<string, string> = {
	fr: "fr-fr",
	de: "de-de",
	es: "es-es",
	pt: "pt-pt",
	ru: "ru-ru",
	pl: "pl-pl",
	it: "it-it",
	no: "no-no",
	cs: "cz-cs",
	el: "gr-el",
	ro: "ro-ro",
	bg: "bg-bg",
	hu: "hu-hu",
	uk: "ua-uk",
	nl: "nl-nl",
	sv: "se-sv",
	da: "dk-da",
	fi: "fi-fi",
	sk: "sk-sk",
	zh: "cn-zh",
	ja: "jp-jp",
	ko: "kr-kr",
	th: "th-th",
	vi: "vn-vi",
	tr: "tr-tr"
};

export function searchRegion(lang: string | null | undefined): string | null {
	return lang ? (SEARCH_REGIONS[lang] ?? null) : null;
}

/**
 * What an address-bar entry opens: a URL as typed (https added to a bare
 * host, http to a local one), anything else a search, in the reply
 * language's region when it has one. Never anything but http(s).
 */
export function resolveBrowserUrl(raw: string, lang?: string | null): string {
	const input = raw.trim();
	if (!input) return BROWSER_HOME_URL;
	if (!/\s/.test(input)) {
		// A bare host first: "localhost:3000" isn't a scheme called localhost.
		const typed = BARE_HOST_RE.test(input)
			? `${LOCAL_HOST_RE.test(input) ? "http" : "https"}://${input}`
			: /^https?:\/\//i.test(input)
				? input
				: null;
		if (typed) {
			try {
				return new URL(typed).toString();
			} catch {
				// Not a URL: searched below.
			}
		}
	}
	const region = searchRegion(lang);
	return (
		BROWSER_SEARCH_PREFIX +
		encodeURIComponent(input) +
		(region ? `&kl=${region}` : "")
	);
}

/** How the address bar shows a URL at rest: the host, then the rest dimmer. */
export interface ShownUrl {
	host: string;
	rest: string;
	/** Plain http (not a local address): "Not secure". */
	insecure: boolean;
}

export function shownUrl(raw: string): ShownUrl {
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" && u.protocol !== "https:")
			return { host: raw, rest: "", insecure: false };
		const host = u.host.replace(/^www\./, "");
		const sent = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
		// Read as written (Christkindelsmärik), not as sent (%C3%A4).
		let rest = sent;
		try {
			rest = decodeURI(sent);
		} catch {
			// Not valid percent-encoding: shown as it is.
		}
		const local = /^(localhost|127\.|\[::1\])/.test(u.hostname);
		return { host, rest, insecure: u.protocol === "http:" && !local };
	} catch {
		return { host: raw, rest: "", insecure: false };
	}
}

/** The chat never narrower than this beside the pane (px). */
export const CHAT_MIN_PX = 320;
/** The pane never narrower than this (px). */
export const PANE_MIN_PX = 360;
/** The pane's share of the window when nothing was chosen. */
export const PANE_SHARE_DEFAULT = 0.5;
/** Shares the divider settles on when let go near one (a third, a half, two thirds). */
const SNAPS = [1 / 3, 1 / 2, 2 / 3];
const SNAP_PX = 12;

/**
 * How the room splits: the pane's width for its share of `room` (the
 * window less the chat list), kept to both minimums; `expanded` when
 * there isn't room for both (the pane then takes it all).
 */
export function paneWidth(
	share: number,
	room: number
): { width: number; expanded: boolean } {
	if (room < CHAT_MIN_PX + PANE_MIN_PX) return { width: room, expanded: true };
	const want = Math.round(room * clampShare(share));
	return {
		width: Math.min(room - CHAT_MIN_PX, Math.max(PANE_MIN_PX, want)),
		expanded: false
	};
}

export function clampShare(share: number): number {
	return Number.isFinite(share)
		? Math.min(0.85, Math.max(0.15, share))
		: PANE_SHARE_DEFAULT;
}

/**
 * The share for a divider let go `paneWidthPx` from the right in `room`:
 * onto a third, a half or two thirds when within a few pixels of one.
 */
export function shareFor(paneWidthPx: number, room: number): number {
	if (room <= 0) return PANE_SHARE_DEFAULT;
	for (const snap of SNAPS)
		if (Math.abs(paneWidthPx - room * snap) <= SNAP_PX) return snap;
	return clampShare(paneWidthPx / room);
}

/** One tab as the pane keeps it. */
export interface BrowserTab {
	id: string;
	url: string;
	title: string;
	icon: string;
	loading: boolean;
	back: boolean;
	forward: boolean;
	/** The page couldn't load (no network, a bad address). */
	failed: boolean;
	/** The page's background colour (CSS), for the room past its snapshot. */
	bg: string;
}

export function newTab(id: string, url: string): BrowserTab {
	return {
		id,
		url,
		title: "",
		icon: "",
		// Loading only once its page is made (a tab not yet shown has none).
		loading: false,
		back: false,
		forward: false,
		failed: false,
		bg: ""
	};
}

/** The tab a close lands on: the one to its right, else its left; null when none are left. */
export function afterClose(
	tabs: readonly BrowserTab[],
	closing: string
): string | null {
	const at = tabs.findIndex((t) => t.id === closing);
	if (at < 0) return tabs[0]?.id ?? null;
	return tabs[at + 1]?.id ?? tabs[at - 1]?.id ?? null;
}

/** `tabs` with the tab `id` moved to index `to`. */
export function moveTab(
	tabs: readonly BrowserTab[],
	id: string,
	to: number
): BrowserTab[] {
	const from = tabs.findIndex((t) => t.id === id);
	if (from < 0) return [...tabs];
	const out = [...tabs];
	const [tab] = out.splice(from, 1);
	out.splice(Math.max(0, Math.min(out.length, to)), 0, tab!);
	return out;
}

/** The tab a step of `by` (±1, wrapping) from `id` lands on. */
export function stepTab(
	tabs: readonly BrowserTab[],
	id: string | null,
	by: number
): string | null {
	if (!tabs.length) return null;
	const at = Math.max(
		0,
		tabs.findIndex((t) => t.id === id)
	);
	return tabs[(at + by + tabs.length) % tabs.length]!.id;
}

/** What a tab's strip shows: its title, else its host, else New tab. */
export function tabLabel(tab: Pick<BrowserTab, "title" | "url">): string {
	if (tab.title.trim()) return tab.title.trim();
	if (tab.url === "about:blank") return "New tab";
	return shownUrl(tab.url).host || "New tab";
}

/** What's kept between launches. */
export interface KeptBrowser {
	open: boolean;
	expanded: boolean;
	share: number;
	active: string | null;
	tabs: Array<{ id: string; url: string; title: string; icon: string }>;
}

export const BROWSER_KEY = "ccez-llm-browser-v1";

/** The kept state from storage; anything unreadable starts fresh. */
export function readKept(raw: string | null): KeptBrowser {
	const fresh: KeptBrowser = {
		open: false,
		expanded: false,
		share: PANE_SHARE_DEFAULT,
		active: null,
		tabs: []
	};
	if (!raw) return fresh;
	try {
		const v = JSON.parse(raw) as Partial<KeptBrowser>;
		const tabs = Array.isArray(v.tabs)
			? v.tabs
					.filter(
						(
							t
						): t is { id: string; url: string; title: string; icon: string } =>
							!!t &&
							typeof t.id === "string" &&
							/^[a-z0-9-]{1,32}$/.test(t.id) &&
							typeof t.url === "string" &&
							(/^https?:/.test(t.url) || t.url === "about:blank")
					)
					.map((t) => ({
						id: t.id,
						url: t.url,
						title: typeof t.title === "string" ? t.title : "",
						// Its icon from the web only (an img in the app's page loads it).
						icon:
							typeof (t as { icon?: unknown }).icon === "string" &&
							/^https:\/\//.test((t as { icon: string }).icon)
								? (t as { icon: string }).icon
								: ""
					}))
			: [];
		const active = tabs.some((t) => t.id === v.active)
			? (v.active as string)
			: (tabs[0]?.id ?? null);
		return {
			open: v.open === true && tabs.length > 0,
			expanded: v.expanded === true,
			share: clampShare(
				typeof v.share === "number" ? v.share : PANE_SHARE_DEFAULT
			),
			active,
			tabs
		};
	} catch {
		return fresh;
	}
}

/** An excerpt never runs much past this (chars), whatever the paragraph. */
const EXCERPT_MAX = 420;

/**
 * The sentence (or sentences) of a page's `block` that hold the selected
 * `text`, for the chat to annotate in context; the selection itself when
 * it isn't in the block (it ran across paragraphs).
 */
export function pageExcerpt(text: string, block: string): string {
	const quote = text.replace(/\s+/g, " ").trim();
	// The line it's on first (a card's heading and links are lines of
	// their own), else the whole block (the selection ran across lines).
	const line = block
		.split("\n")
		.find((l) => l.replace(/\s+/g, " ").includes(quote));
	const all = (line ?? block).replace(/\s+/g, " ").trim();
	const at = all.indexOf(quote);
	if (!quote || at < 0) return quote;
	// A sentence ends at . ! ? … (then a space) or a CJK full stop.
	const isEnd = (i: number): boolean =>
		/[。！？]/.test(all[i] ?? "") ||
		(/[.!?…]/.test(all[i] ?? "") && /\s/.test(all[i + 1] ?? " "));
	let from = at;
	while (from > 0 && !isEnd(from - 1) && at - from < EXCERPT_MAX / 2) from--;
	let to = at + quote.length;
	while (to < all.length && !isEnd(to - 1) && to - at < EXCERPT_MAX) to++;
	const cut = all.slice(from, to).trim();
	return `${from > 0 && !isEnd(from - 1) ? "…" : ""}${cut}${to < all.length && !isEnd(to - 1) ? "…" : ""}`;
}

/**
 * `text` as Markdown that shows exactly as written: every ASCII
 * punctuation mark escaped (CommonMark allows it for all of them), so a
 * page's "1.", "- ", "$5", "&amp;", "<b>" or "*" stay characters, never
 * a list, maths, an entity or a tag.
 */
export function plainMarkdown(text: string): string {
	// Not ( and ): "\\(" opens maths here, and with [ ] escaped they
	// make no link.
	return text.replace(/[!-'*-/:-@[-`{-~]/g, "\\$&");
}

/**
 * Selects the first `quote` in `root`'s text (across inline elements);
 * whether it was found.
 */
export function selectQuote(root: Element, quote: string): boolean {
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let joined = "";
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		nodes.push(n as Text);
		joined += n.textContent ?? "";
	}
	const at = joined.indexOf(quote);
	if (!quote || at < 0) return false;
	const end = at + quote.length;
	const range = doc.createRange();
	let seen = 0;
	let started = false;
	for (const node of nodes) {
		const len = node.textContent?.length ?? 0;
		if (!started && at < seen + len) {
			range.setStart(node, at - seen);
			started = true;
		}
		if (started && end <= seen + len) {
			range.setEnd(node, end - seen);
			break;
		}
		seen += len;
	}
	const selection = doc.getSelection();
	if (!selection) return false;
	selection.removeAllRanges();
	selection.addRange(range);
	return true;
}
