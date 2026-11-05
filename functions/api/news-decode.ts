/**
 * GET /api/news-decode?link=… — a Google News story link into its
 * publisher URL, as the app's `news_decode_url` does it. Google refuses
 * Cloudflare's servers, so the relay on z decodes it (relay/README.md).
 */

import { articleId } from "../../src/lib/web-fetch";
import { answer, cached, foreign, relay, type Context } from "./_shared";

export async function onRequestGet(ctx: Context): Promise<Response> {
	if (foreign(ctx.request)) return answer("forbidden", 403);
	const link = new URL(ctx.request.url).searchParams.get("link") ?? "";
	if (!articleId(link)) return answer("bad-url", 400);
	return cached(ctx, () => relay(ctx, "/decode", { link }));
}
