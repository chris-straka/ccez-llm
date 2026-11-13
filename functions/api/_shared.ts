/**
 * What both news functions share: only the site's own pages may call
 * them, every answer says it came from here (WEB_FETCH_HEADER), errors
 * are the shell's machine codes as plain text (424 for the far side's
 * failures: Cloudflare replaces a 502's body with its own page), and answers are cached
 * for ten minutes so the same feed isn't fetched again by every visit.
 */

import { MAX_HTML_BYTES, WEB_FETCH_HEADER } from "../../src/lib/web-fetch";

export const TIMEOUT_MS = 20_000;
const CACHE_SECONDS = 600;
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

export interface Context {
	request: Request;
	env: { RELAY_TOKEN?: string; RELAY_URL?: string; ACCESS_AUD?: string };
	waitUntil(p: Promise<unknown>): void;
}

/** Google refuses Cloudflare's servers: its two calls go through the relay on z (relay/README.md). */
const RELAY_URL = "https://z.tailfe37c2.ts.net:10000";

/** One relay call: its answer as ours (the relay speaks the same codes). */
export async function relay(
	ctx: Context,
	path: string,
	params: Record<string, string>
): Promise<Response> {
	const token = ctx.env.RELAY_TOKEN;
	if (!token) return answer("failed", 424);
	try {
		const res = await fetch(
			`${ctx.env.RELAY_URL ?? RELAY_URL}${path}?${new URLSearchParams(params)}`,
			{
				headers: { "x-relay-token": token },
				signal: AbortSignal.timeout(TIMEOUT_MS + 5000)
			}
		);
		const body = await res.text();
		return res.ok ? answer(body, 200, true) : answer(body || "failed", 424);
	} catch (error) {
		return answer(transportCode(error), 424);
	}
}

export function answer(
	body: string,
	status = 200,
	cache = false,
	seconds = CACHE_SECONDS
): Response {
	const keep = cache || seconds !== CACHE_SECONDS;
	return new Response(body, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			// Other sites' markup on this origin, which holds the API keys:
			// never sniffed into a page, and inert if opened directly
			// (_headers doesn't reach a function's answers).
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			[WEB_FETCH_HEADER]: "1",
			"cache-control": keep ? `public, max-age=${seconds}` : "no-store"
		}
	});
}

/**
 * The answer cached for this request, else `make`'s (cached when it
 * worked). Keyed on `param` alone, so extra query junk can't force a
 * fresh fetch (or a fresh relay call to Google) on every request.
 */
export async function cached(
	ctx: Context,
	param: [string, string],
	make: () => Promise<Response>
): Promise<Response> {
	const cache = (caches as unknown as { default: Cache }).default;
	const own = new URL(ctx.request.url);
	const keyUrl = new URL(own.pathname, own.origin);
	keyUrl.searchParams.set(...param);
	const key = new Request(keyUrl.href, { method: "GET" });
	const hit = await cache.match(key);
	if (hit) return hit;
	const res = await make();
	if (res.ok) ctx.waitUntil(cache.put(key, res.clone()));
	// A link that didn't decode or a page that refused: kept ten minutes,
	// so asking again can't spend the relay's Google budget each time. A
	// timeout or a busy relay isn't kept: the next ask may well work.
	else {
		const why = await res.clone().text();
		if (
			/^(bad-url|bad-status:4\d\d|news-empty|news-decode-failed|no-decoded-url)/.test(
				why
			)
		) {
			ctx.waitUntil(cache.put(key, answer(why, res.status, false, 600)));
		}
	}
	return res;
}

export function transportCode(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	return name === "TimeoutError" || name === "AbortError"
		? "timeout"
		: "failed";
}

export async function get(
	url: string,
	init: RequestInit = {}
): Promise<Response> {
	return fetch(url, {
		...init,
		redirect: "follow",
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			"user-agent": UA,
			accept:
				"text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
			"accept-language": "en-US,en;q=0.8",
			...(init.headers ?? {})
		}
	});
}

/** The body's head, at most `max` bytes, in the charset the page says (UTF-8 otherwise). */
export async function head(
	res: Response,
	max = MAX_HTML_BYTES
): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const parts: Uint8Array[] = [];
	let size = 0;
	while (size < max) {
		const { done, value } = await reader.read();
		if (done) break;
		parts.push(value);
		size += value.length;
	}
	await reader.cancel().catch(() => {});
	const bytes = new Uint8Array(Math.min(size, max));
	let at = 0;
	for (const p of parts) {
		const take = p.subarray(0, Math.min(p.length, bytes.length - at));
		bytes.set(take, at);
		at += take.length;
		if (at >= bytes.length) break;
	}
	const charset = /charset=([^;]+)/i
		.exec(res.headers.get("content-type") ?? "")?.[1]
		?.trim();
	try {
		return new TextDecoder(charset || "utf-8").decode(bytes);
	} catch {
		return new TextDecoder("utf-8").decode(bytes);
	}
}
