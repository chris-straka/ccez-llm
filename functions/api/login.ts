/**
 * GET /api/login: Access asks for the owner's login on the way here; once
 * in, back to the app (its /api calls carry the session cookie from then on).
 */
export function onRequestGet(): Response {
	return new Response(null, { status: 302, headers: { location: "/" } });
}
