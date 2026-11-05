/**
 * GET /api/fetch?url=… — a public page's markup for the site's news
 * (RSS feeds, articles), as the app's `fetch_page` gives it: the head
 * of the page as text, or a machine code (`bad-url`, `timeout`,
 * `bad-status:403`, `failed`). Google's feeds come through the relay on z.
 */

import { googleFeedUrl, publicUrl } from "../../src/lib/web-fetch";
import {
	answer,
	cached,
	foreign,
	get,
	head,
	relay,
	transportCode,
	type Context
} from "./_shared";

export async function onRequestGet(ctx: Context): Promise<Response> {
	if (foreign(ctx.request)) return answer("forbidden", 403);
	const url = publicUrl(new URL(ctx.request.url).searchParams.get("url") ?? "");
	if (!url) return answer("bad-url", 400);
	return cached(ctx, async () => {
		if (googleFeedUrl(url.href)) return relay(ctx, "/rss", { url: url.href });
		let res: Response;
		try {
			res = await get(url.href);
		} catch (error) {
			return answer(transportCode(error), 424);
		}
		if (!res.ok) return answer(`bad-status:${res.status}`, 424);
		const text = await head(res);
		return text ? answer(text, 200, true) : answer("news-empty", 424);
	});
}
