/**
 * The owner's Cloudflare Access login, checked on every /api call
 * (owner, 2026-11-13: "Agreed on llm.ccez.uk's login"). Access gates
 * llm.ccez.uk/api/* for his email; this checks the token it issues too,
 * so nothing reaches the fetcher without it (the old same-origin header
 * check was any script's to send). Same check as ccez-keeps'
 * worker/auth.ts: RS256 against the team's certs, expiry, audience,
 * an email. Fail closed.
 */

import type { Context } from "./_shared";

const TEAM = "silent-bread-ade3.cloudflareaccess.com";

function b64url(input: string): Uint8Array<ArrayBuffer> {
	const bin = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
	return out;
}

let certs: { at: number; keys: Map<string, JsonWebKey> } | null = null;

async function teamCerts(): Promise<Map<string, JsonWebKey>> {
	if (certs && Date.now() - certs.at < 6 * 3600_000) return certs.keys;
	const res = await fetch(`https://${TEAM}/cdn-cgi/access/certs`);
	if (!res.ok) throw new Error(`certs ${res.status}`);
	const body = (await res.json()) as {
		keys?: Array<JsonWebKey & { kid?: string }>;
	};
	const keys = new Map(
		(body.keys ?? []).map((k) => [k.kid ?? "", k as JsonWebKey])
	);
	certs = { at: Date.now(), keys };
	return keys;
}

/** The Access token from its header, else its session cookie. */
function token(request: Request): string | null {
	const header = request.headers.get("cf-access-jwt-assertion");
	if (header) return header;
	for (const part of (request.headers.get("cookie") ?? "").split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === "CF_Authorization") return v.join("=");
	}
	return null;
}

/** Why the caller isn't the owner, or null when they are. */
export async function notOwner(ctx: Context): Promise<string | null> {
	const aud = ctx.env.ACCESS_AUD;
	if (!aud) return "not set up";
	const jwt = token(ctx.request);
	if (!jwt) return "login";
	const [h, p, s] = jwt.split(".");
	if (!h || !p || !s) return "malformed";
	let header: { kid?: unknown; alg?: unknown };
	let claims: { aud?: unknown; exp?: unknown; email?: unknown };
	try {
		header = JSON.parse(new TextDecoder().decode(b64url(h)));
		claims = JSON.parse(new TextDecoder().decode(b64url(p)));
	} catch {
		return "malformed";
	}
	if (header.alg !== "RS256" || typeof header.kid !== "string")
		return "malformed";
	let jwk: JsonWebKey | undefined;
	try {
		jwk = (await teamCerts()).get(header.kid);
	} catch {
		return "no certs";
	}
	if (!jwk) return "unknown key";
	const key = await crypto.subtle.importKey(
		"jwk",
		jwk,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"]
	);
	const ok = await crypto.subtle.verify(
		{ name: "RSASSA-PKCS1-v1_5" },
		key,
		b64url(s),
		new TextEncoder().encode(`${h}.${p}`)
	);
	if (!ok) return "bad signature";
	if (typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000)
		return "expired";
	const audOk = Array.isArray(claims.aud)
		? claims.aud.includes(aud)
		: claims.aud === aud;
	if (!audOk) return "wrong audience";
	if (typeof claims.email !== "string" || !claims.email) return "no email";
	return null;
}
