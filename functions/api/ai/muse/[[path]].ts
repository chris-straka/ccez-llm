/**
 * /api/ai/muse/*: Muse's API with the owner's key added here, so a device
 * he's logged in on (Cloudflare Access, _access.ts) needs no key of its
 * own (owner, 2026-11-13). The key is the Pages secret MUSE_KEY and never
 * reaches the browser. Streams pass straight through.
 */

import type { Context } from "../../_shared";
import { notOwner } from "../../_access";

const UPSTREAM = "https://api.meta.ai/v1";

export async function onRequest(
	ctx: Context & { env: { MUSE_KEY?: string } }
): Promise<Response> {
	const why = await notOwner(ctx);
	if (why)
		return new Response(why === "login" ? "needs-login" : "forbidden", {
			status: why === "login" ? 401 : 403
		});
	const key = ctx.env.MUSE_KEY;
	if (!key) return new Response("no key on the server", { status: 503 });
	const url = new URL(ctx.request.url);
	const rest = url.pathname.replace(/^\/api\/ai\/muse/, "");
	// Only Muse's own API paths, never another host.
	if (!/^\/[a-z0-9/_-]*$/i.test(rest))
		return new Response("bad path", { status: 400 });
	const headers = new Headers();
	headers.set("authorization", `Bearer ${key}`);
	const type = ctx.request.headers.get("content-type");
	if (type) headers.set("content-type", type);
	const accept = ctx.request.headers.get("accept");
	if (accept) headers.set("accept", accept);
	const upstream = await fetch(UPSTREAM + rest + url.search, {
		method: ctx.request.method,
		headers,
		body:
			ctx.request.method === "GET" || ctx.request.method === "HEAD"
				? null
				: ctx.request.body
	});
	const out = new Headers();
	for (const h of ["content-type", "cache-control"]) {
		const v = upstream.headers.get(h);
		if (v) out.set(h, v);
	}
	return new Response(upstream.body, { status: upstream.status, headers: out });
}
