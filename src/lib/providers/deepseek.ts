/**
 * DeepSeek (api-docs.deepseek.com): the one cloud model this app ships,
 * reached three ways (registry.ts): with a key, through llm.ccez.uk's
 * login (functions/api/ai/deepseek), and keyless through ccez-words on
 * the owner's Mac. All three speak the same API, so what is specific to
 * it lives here: its server-side web tools and its errors in words.
 * `turn.rs` mirrors both for Android's background turns.
 */

/** Built-in ids that reach DeepSeek's API (see registry.ts). */
export const DEEPSEEK_PROVIDER_IDS = [
	"deepseek",
	"deepseek-login",
	"deepseek-mac"
] as const;

export function isDeepSeekProvider(id: string): boolean {
	return (DEEPSEEK_PROVIDER_IDS as readonly string[]).includes(id);
}

/** DeepSeek's model: DeepSeek-V4.1-Flash (a settings change swaps it). */
export const DEEPSEEK_MODEL = "deepseek-flash";

/**
 * DeepSeek's own web search and page reading, run on its side: the
 * client executes nothing. They can't be combined with function tools
 * (a 400), so with DeepSeek they replace the app's `fetch_url`, and
 * `tool_choice` must never name them.
 */
export const DEEPSEEK_WEB_TOOLS: ReadonlyArray<{ type: string }> = [
	{ type: "deepseek_web_search" },
	{ type: "deepseek_read_url" }
];

/**
 * A DeepSeek failure in the owner's words, keeping the status for a
 * bug report. Null when the status needs no special wording (the
 * caller keeps the server's own text). `body` is the server's reply:
 * llm.ccez.uk's own answers (no login, no key there yet) read from it.
 */
export function deepseekErrorCopy(status: number, body: string): string | null {
	const said = body.trim().slice(0, 200);
	if (status === 401 && /needs-login/.test(body))
		return "Log in to llm.ccez.uk again: reload the page (HTTP 401).";
	if (status === 503 && /no key on the server/.test(body))
		return "llm.ccez.uk has no DeepSeek key yet (its DEEPSEEK_API_KEY): use DeepSeek with a key, or DeepSeek (Mac), until it's set (HTTP 503).";
	switch (status) {
		case 401:
			return "DeepSeek didn't accept the API key: check it in Settings → Model (HTTP 401).";
		case 402:
			return "DeepSeek's balance is used up: top up at platform.deepseek.com (HTTP 402).";
		case 429:
			return "DeepSeek is getting too many requests at once: wait a moment and retry (HTTP 429).";
		case 500:
		case 503:
		case 504:
			return `DeepSeek's servers are busy or down: retry in a moment (HTTP ${status}).`;
		case 400:
		case 422:
			return said
				? `DeepSeek refused the request (HTTP ${status}): ${said}`
				: null;
		default:
			return null;
	}
}

/** A failure sent inside a stream (DeepSeek's last chunk carries
`error` with empty `choices`, and no [DONE] follows), in words; null
when the chunk has none. `name` says whose (another provider's id). */
export function streamErrorCopy(
	chunk: unknown,
	name = "DeepSeek"
): string | null {
	if (chunk === null || typeof chunk !== "object") return null;
	const error = (chunk as { error?: unknown }).error;
	if (error === undefined || error === null) return null;
	const message =
		typeof error === "string"
			? error
			: typeof (error as { message?: unknown }).message === "string"
				? (error as { message: string }).message
				: "";
	return `${name} stopped partway through the reply: ${message || "it failed to finish"}. Retry to ask again.`;
}
