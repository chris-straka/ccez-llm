/**
 * GET /api/news-decode?link=… — a Google News story link into its
 * publisher URL, as the app's `news_decode_url` does it: the params
 * page's signature, then one batchexecute POST.
 */

import {
	articleId,
	BATCHEXECUTE_URL,
	batchexecuteBody,
	paramsPageUrl,
	parseBatchexecute,
	parseSignature
} from "../../src/lib/web-fetch";
import {
	answer,
	cached,
	foreign,
	get,
	head,
	transportCode,
	type Context
} from "./_shared";

/** The params page's signature sits near the end of ~600 KB of markup. */
const PARAMS_BYTES = 1024 * 1024;

export async function onRequestGet(ctx: Context): Promise<Response> {
	if (foreign(ctx.request)) return answer("forbidden", 403);
	const id = articleId(new URL(ctx.request.url).searchParams.get("link") ?? "");
	if (!id) return answer("bad-url", 400);
	return cached(ctx, async () => {
		try {
			const page = await get(paramsPageUrl(id));
			if (!page.ok) return answer("bad-status", 424);
			const signed = parseSignature(await head(page, PARAMS_BYTES));
			if (!signed) return answer("no-signature", 424);
			const res = await get(BATCHEXECUTE_URL, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded;charset=UTF-8"
				},
				body: batchexecuteBody(id, signed.ts, signed.sig)
			});
			if (!res.ok) return answer("bad-status", 424);
			const url = parseBatchexecute(await res.text());
			return url ? answer(url, 200, true) : answer("no-decoded-url", 424);
		} catch (error) {
			return answer(transportCode(error), 424);
		}
	});
}
