/**
 * News on the website (owner, 2026-11-05): the app fetches feeds and
 * articles through its Rust shell (`fetch_page`, `news_decode_url`);
 * the plain web build has no shell, and CORS keeps a browser page from
 * Google and the outlets. llm.ccez.uk answers the same two calls from
 * its own Pages Functions (`functions/api/`), which import the pure
 * pieces below; the page reaches them through `webFetch*`.
 *
 * The pure helpers mirror `src-tauri/src/fetch.rs` (the URL gate) and
 * `src-tauri/src/news.rs` (Google's signed-redirect decode), whose
 * tests pin the same bytes.
 */

/** Longest URL taken (the shell's MAX_URL_CHARS). */
export const MAX_URL_CHARS = 2048;
/** Page bytes kept: longer pages answer from their head (the shell's MAX_HTML_BYTES). */
export const MAX_HTML_BYTES = 512 * 1024;
/** The marker the functions answer with: a dev server's SPA fallback has none. */
export const WEB_FETCH_HEADER = "x-ccez-fetch";

/**
 * The URL when it may be fetched from the server: http(s), no
 * credentials, no spaces or control bytes, never a loopback, private,
 * link-local or tailnet address (the shell's `public_url`). Pure.
 */
export function publicUrl(raw: string): URL | null {
	if (!raw || raw.length > MAX_URL_CHARS) return null;
	for (const ch of raw) {
		const c = ch.charCodeAt(0);
		if (c <= 0x20 || c === 0x7f) return null;
	}
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	if (url.username || url.password || !url.hostname) return null;
	return privateHost(url.hostname) ? null : url;
}

/** Hosts a server-side fetch never reaches. Pure. */
export function privateHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal")
	)
		return true;
	if (host.includes(":")) {
		// IPv6: loopback, unspecified, unique-local, link-local, mapped v4.
		if (host === "::1" || host === "::") return true;
		if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;
		const mapped = /^::ffff:(.+)$/.exec(host);
		if (mapped) return mapped[1]!.includes(".") ? privateV4(mapped[1]!) : true;
		return false;
	}
	// URL() already normalises 0x7f.1 and friends to dotted quads.
	return /^\d+\.\d+\.\d+\.\d+$/.test(host) && privateV4(host);
}

function privateV4(host: string): boolean {
	const [a = 0, b = 0] = host.split(".").map(Number);
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		a >= 224
	);
}

// ---- Google News links -------------------------------------------------

export const BATCHEXECUTE_URL =
	"https://news.google.com/_/DotsSplashUi/data/batchexecute";

/** Article id out of a Google News URL (`/read/`, `/articles/`, `/rss/articles/`). Pure. */
export function articleId(link: string): string | null {
	let url: URL;
	try {
		url = new URL(link);
	} catch {
		return null;
	}
	if (url.hostname !== "news.google.com") return null;
	const segs = url.pathname.split("/").filter(Boolean);
	if (segs.length < 2) return null;
	const id = segs[segs.length - 1]!;
	const kind = segs[segs.length - 2]!;
	return kind === "articles" || kind === "read" ? id : null;
}

/** The params page for one id, at the US defaults (a foreign-locale signature decodes to null). Pure. */
export function paramsPageUrl(id: string): string {
	return `https://news.google.com/rss/articles/${id}?hl=en-US&gl=US&ceid=US%3Aen`;
}

/** Percent-encoding as the reference decoder does it (Python `quote`, `/` safe). Pure. */
export function percentEncode(input: string): string {
	let out = "";
	for (const byte of new TextEncoder().encode(input)) {
		const ch = String.fromCharCode(byte);
		out += /[A-Za-z0-9\-_.~/]/.test(ch)
			? ch
			: `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	return out;
}

/** The one-id `f.req=…` body (byte-pinned in the shell's tests and here). Pure. */
export function batchexecuteBody(id: string, ts: string, sig: string): string {
	const ctx = [
		[
			"X",
			"X",
			["X", "X"],
			null,
			null,
			1,
			1,
			"US:en",
			null,
			1,
			null,
			null,
			null,
			null,
			null,
			0,
			1
		],
		"X",
		"X",
		1,
		[1, 1, 1],
		1,
		1,
		null,
		0,
		0,
		null,
		0
	];
	const tsValue = /^-?\d+$/.test(ts) ? Number(ts) : ts;
	const inner = JSON.stringify(["garturlreq", ctx, id, tsValue, sig]);
	return `f.req=${percentEncode(JSON.stringify([[["Fbv4je", inner, null, "0"]]]))}`;
}

/** `data-n-a-sg` / `data-n-a-ts` out of a params page. Pure. */
export function parseSignature(
	html: string
): { sig: string; ts: string } | null {
	const attr = (name: string) => {
		const key = `${name}="`;
		const at = html.indexOf(key);
		if (at < 0) return "";
		const start = at + key.length;
		const end = html.indexOf('"', start);
		return end < 0 ? "" : html.slice(start, end);
	};
	const sig = attr("data-n-a-sg");
	const ts = attr("data-n-a-ts");
	return sig && ts ? { sig, ts } : null;
}

/** The publisher URL out of a batchexecute answer, or null. Pure. */
export function parseBatchexecute(text: string): string | null {
	const start = text.indexOf("[");
	if (start < 0) return null;
	let rows: unknown;
	try {
		rows = JSON.parse(text.slice(start));
	} catch {
		return null;
	}
	if (!Array.isArray(rows)) return null;
	for (const row of rows) {
		if (!Array.isArray(row)) continue;
		if (row[0] !== "wrb.fr" && row[1] !== "Fbv4je") continue;
		let inner: unknown = row[2];
		if (typeof inner === "string") {
			try {
				inner = JSON.parse(inner);
			} catch {
				continue;
			}
		}
		if (
			Array.isArray(inner) &&
			inner[0] === "garturlres" &&
			typeof inner[1] === "string"
		)
			return inner[1];
	}
	return null;
}

/**
 * A Google News story id into its publisher URL: the params page's
 * signature, then one batchexecute POST. `get` does the fetching (the
 * relay on z; Google refuses Cloudflare's servers). Throws the shell's
 * machine codes.
 */
export async function decodeGoogleStory(
	id: string,
	get: (url: string, init?: RequestInit) => Promise<Response>
): Promise<string> {
	const page = await get(paramsPageUrl(id));
	if (!page.ok) throw new Error("bad-status");
	const signed = parseSignature(await page.text());
	if (!signed) throw new Error("no-signature");
	const res = await get(BATCHEXECUTE_URL, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded;charset=UTF-8"
		},
		body: batchexecuteBody(id, signed.ts, signed.sig)
	});
	if (!res.ok) throw new Error("bad-status");
	const url = parseBatchexecute(await res.text());
	if (!url) throw new Error("no-decoded-url");
	return url;
}

/** An edition parameter (hl, gl, ceid): letters, digits, - and :, short. */
const EDITION_RE = /^[A-Za-z0-9:-]{1,16}$/;
/** The one search the news makes: one site's stories of the last days. */
const SITE_SEARCH_RE =
	/^site:[a-z0-9.-]{1,64}(\/[a-z0-9_-]{1,32}){0,3} when:\d{1,2}d$/;

/**
 * A Google News feed URL the relay may fetch, in the two shapes the
 * news makes: an edition's Top Stories (`/rss?hl&gl&ceid`) and one
 * site's recent stories (`/rss/search?q=site:… when:3d`). Anything else
 * would let a caller have z search Google for them. Pure.
 */
export function googleFeedUrl(raw: string): URL | null {
	const url = publicUrl(raw);
	if (!url || url.protocol !== "https:" || url.hostname !== "news.google.com")
		return null;
	if (url.port || url.hash) return null;
	const search = url.pathname === "/rss/search";
	if (url.pathname !== "/rss" && !search) return null;
	const allowed = new Set(["hl", "gl", "ceid", ...(search ? ["q"] : [])]);
	const seen = new Set<string>();
	for (const [key, value] of url.searchParams) {
		if (!allowed.has(key) || seen.has(key)) return null;
		seen.add(key);
		if (key === "q" ? !SITE_SEARCH_RE.test(value) : !EDITION_RE.test(value))
			return null;
	}
	return search && !seen.has("q") ? null : url;
}

// ---- the page's side -----------------------------------------------------

/**
 * One call to the site's own functions: the answer's text, or an Error
 * whose message is the shell's machine code (`bad-url`, `timeout`,
 * `bad-status:403`, …). No functions behind the page (a dev server):
 * `news-needs-shell`, the honest state the preview always had.
 */
export async function webFetch(
	path: string,
	params: Record<string, string>
): Promise<string> {
	// Not on a web page at all (tests, a worker): no functions to ask.
	if (typeof location === "undefined" || !/^https?:$/.test(location.protocol))
		throw new Error("news-needs-shell");
	let res: Response;
	try {
		res = await fetch(`${path}?${new URLSearchParams(params)}`, {
			headers: { accept: "text/plain" }
		});
	} catch {
		throw new Error("failed");
	}
	if (!res.headers.has(WEB_FETCH_HEADER)) throw new Error("news-needs-shell");
	const body = await res.text();
	if (!res.ok) throw new Error(body || "failed");
	if (!body) throw new Error("news-empty");
	return body;
}
