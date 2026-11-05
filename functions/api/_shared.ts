/**
 * What both news functions share: only the site's own pages may call
 * them, every answer says it came from here (WEB_FETCH_HEADER), errors
 * are the shell's machine codes as plain text, and answers are cached
 * for ten minutes so the same feed isn't fetched again by every visit.
 */

import { MAX_HTML_BYTES, WEB_FETCH_HEADER } from "../../src/lib/web-fetch";

export const TIMEOUT_MS = 20_000;
const CACHE_SECONDS = 600;
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

export interface Context {
	request: Request;
	waitUntil(p: Promise<unknown>): void;
}

export function answer(body: string, status = 200, cache = false): Response {
	return new Response(body, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			[WEB_FETCH_HEADER]: "1",
			"cache-control": cache ? `public, max-age=${CACHE_SECONDS}` : "no-store"
		}
	});
}

/** A call from another site's page (or one naming another origin): refused. */
export function foreign(request: Request): boolean {
	const site = request.headers.get("sec-fetch-site");
	if (site && site !== "same-origin") return true;
	const origin = request.headers.get("origin");
	return !!origin && new URL(origin).host !== new URL(request.url).host;
}

/** The answer cached for this request, else `make`'s (cached when it worked). */
export async function cached(
	ctx: Context,
	make: () => Promise<Response>
): Promise<Response> {
	const cache = (caches as unknown as { default: Cache }).default;
	const key = new Request(ctx.request.url, { method: "GET" });
	const hit = await cache.match(key);
	if (hit) return hit;
	const res = await make();
	if (res.ok) ctx.waitUntil(cache.put(key, res.clone()));
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
