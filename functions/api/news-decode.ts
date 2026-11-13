/**
 * GET /api/news-decode?link=… — a Google News story link into its
 * publisher URL, as the app's `news_decode_url` does it. Google refuses
 * Cloudflare's servers, so the relay on z decodes it (relay/README.md).
 */

import { articleId } from "../../src/lib/web-fetch";
import { answer, cached, relay, type Context } from "./_shared";
import { notOwner } from "./_access";

export async function onRequestGet(ctx: Context): Promise<Response> {
	// The owner's login only (_access.ts); the old header check was any script's to send.
	const why = await notOwner(ctx);
	if (why)
		return answer(
			why === "login" ? "needs-login" : "forbidden",
			why === "login" ? 401 : 403
		);
	const link = new URL(ctx.request.url).searchParams.get("link") ?? "";
	// Google's ids are long base64: anything else is refused before it
	// costs a call to Google from the relay's budget.
	const id = articleId(link);
	if (!id || !/^[A-Za-z0-9_-]{24,600}$/.test(id)) return answer("bad-url", 400);
	return cached(ctx, ["link", link], () => relay(ctx, "/decode", { link }));
}
