/**
 * Google News relay on z (owner, 2026-11-05): Google refuses requests
 * from Cloudflare's servers, so llm.ccez.uk's functions ask this for the
 * two Google calls its news needs; everything else (articles, pictures)
 * the site fetches itself. Two routes, both behind a token only the
 * site holds:
 *
 *   GET /rss?url=https://news.google.com/rss…   the feed's XML
 *   GET /decode?link=https://news.google.com/…  the story's publisher URL
 *
 * Nothing else is fetched: the home address only ever talks to
 * news.google.com. Published through Tailscale Funnel on :10000
 * (relay/README.md); the token lives in ~/.config/ccez-news-relay/token.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import {
	articleId,
	decodeGoogleStory,
	googleFeedUrl
} from "../src/lib/web-fetch";

const PORT = Number(process.env.NEWS_RELAY_PORT ?? 8789);
const TOKEN = readFileSync(
	join(homedir(), ".config/ccez-news-relay/token"),
	"utf8"
).trim();
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2 * 1024 * 1024;
const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

const get = (url: string, init: RequestInit = {}) =>
	fetch(url, {
		...init,
		redirect: "follow",
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: {
			"user-agent": UA,
			"accept-language": "en-US,en;q=0.8",
			...(init.headers ?? {})
		}
	});

function allowed(token: string | undefined): boolean {
	const got = Buffer.from(token ?? "");
	const want = Buffer.from(TOKEN);
	return got.length === want.length && timingSafeEqual(got, want);
}

function code(error: unknown): string {
	if (
		error instanceof Error &&
		(error.name === "TimeoutError" || error.name === "AbortError")
	)
		return "timeout";
	return error instanceof Error && /^[a-z-]+(:\d+)?$/.test(error.message)
		? error.message
		: "failed";
}

/**
 * Google calls this relay makes, at most GOOGLE_BUDGET per window: it
 * speaks from the home address, and Google answering that with a
 * captcha would reach every browser in the house. One person reading
 * the news makes a feed call per edition and two per story opened.
 */
const GOOGLE_BUDGET = 120;
const WINDOW_MS = 10 * 60_000;
const calls: number[] = [];

function spend(cost: number, now = Date.now()): boolean {
	while (calls.length && calls[0]! <= now - WINDOW_MS) calls.shift();
	if (calls.length + cost > GOOGLE_BUDGET) return false;
	for (let i = 0; i < cost; i++) calls.push(now);
	return true;
}

/** One request's answer: a status and plain text. */
async function route(
	method: string,
	url: URL,
	token: string | undefined
): Promise<[number, string]> {
	if (url.pathname === "/health") return [200, "ok"];
	if (method !== "GET") return [405, "method"];
	if (!allowed(token)) return [403, "forbidden"];
	try {
		if (url.pathname === "/rss") {
			const feed = googleFeedUrl(url.searchParams.get("url") ?? "");
			if (!feed) return [400, "bad-url"];
			if (!spend(1)) return [429, "busy"];
			const res = await get(feed.href, {
				headers: {
					accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8"
				}
			});
			if (!res.ok) return [424, `bad-status:${res.status}`];
			const body = await res.text();
			return body ? [200, body.slice(0, MAX_BYTES)] : [424, "news-empty"];
		}
		if (url.pathname === "/decode") {
			const id = articleId(url.searchParams.get("link") ?? "");
			if (!id) return [400, "bad-url"];
			if (!spend(2)) return [429, "busy"];
			return [200, await decodeGoogleStory(id, get)];
		}
		return [404, "not-found"];
	} catch (error) {
		return [424, code(error)];
	}
}

createServer((req, res) => {
	const token = req.headers["x-relay-token"];
	void route(
		req.method ?? "GET",
		new URL(req.url ?? "/", "http://relay"),
		Array.isArray(token) ? token[0] : token
	).then(([status, body]) => {
		res.writeHead(status, {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store"
		});
		res.end(body);
	});
}).listen(PORT, "127.0.0.1", () =>
	console.log(`news relay on 127.0.0.1:${PORT}`)
);
