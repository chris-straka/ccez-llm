/**
 * /api/ai/deepseek/*: DeepSeek's API with the owner's key added here, so
 * a browser he's logged in on (Cloudflare Access, _access.ts) needs no
 * key of its own. The key is the Pages secret DEEPSEEK_API_KEY (set by
 * his setup command, `keys ai-key` in ccez-keys) and never reaches the
 * browser. Only the three paths the app uses pass; streams pass
 * straight through.
 */

import type { Context } from "../../_shared";
import { notOwner } from "../../_access";

const UPSTREAM = "https://api.deepseek.com";

/** The API paths this proxies, and nothing else. */
const ALLOWED = new Set(["/chat/completions", "/user/balance", "/models"]);

export async function onRequest(
	ctx: Context & { env: { DEEPSEEK_API_KEY?: string } }
): Promise<Response> {
	const why = await notOwner(ctx);
	if (why)
		return new Response(why === "login" ? "needs-login" : "forbidden", {
			status: why === "login" ? 401 : 403
		});
	const url = new URL(ctx.request.url);
	const rest = url.pathname.replace(/^\/api\/ai\/deepseek/, "");
	if (!ALLOWED.has(rest)) return new Response("bad path", { status: 404 });
	const key = ctx.env.DEEPSEEK_API_KEY;
	if (!key) return new Response("no key on the server", { status: 503 });
	const headers = new Headers();
	headers.set("authorization", `Bearer ${key}`);
	const type = ctx.request.headers.get("content-type");
	if (type) headers.set("content-type", type);
	const accept = ctx.request.headers.get("accept");
	if (accept) headers.set("accept", accept);
	const upstream = await fetch(UPSTREAM + rest, {
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
