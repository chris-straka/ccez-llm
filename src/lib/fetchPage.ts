import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { tauriBackendAvailable } from "./secrets";
import {
	formatFeedItems,
	htmlToText,
	looksLikeFeed,
	parseFeedItems,
	validFetchUrl
} from "./tools";

/**
 * Page-fetch executor behind the model's `fetch_url` tool.
 *
 * In the shell a Rust command fetches (no CORS wall); in plain
 * browser dev it falls back to frontend fetch (CORS-limited, honest
 * about it). Either way the markup is cleaned to readable text here,
 * so both legs share the cap and the copy. Throws short one-sentence
 * errors the turn loop hands back to the model.
 */
export class FetchPageError extends Error {}

/** Fetch + clean one page (or feed). Pure validation, impure transport. */
export async function fetchPageText(
	url: string,
	signal?: AbortSignal
): Promise<string> {
	if (!validFetchUrl(url))
		throw new FetchPageError("That URL can't be fetched.");
	const html = tauriBackendAvailable()
		? await invokeHtml(url)
		: await browserHtml(url, signal);
	if (looksLikeFeed(html)) {
		const text = formatFeedItems(parseFeedItems(html));
		if (!text) throw new FetchPageError("That feed had no readable headlines.");
		return text;
	}
	const text = htmlToText(html);
	if (!text) throw new FetchPageError("That page had no readable text.");
	return text;
}

async function invokeHtml(url: string): Promise<string> {
	let out: unknown;
	try {
		out = await tauriInvoke<unknown>("fetch_page", { url });
	} catch (error) {
		throw new FetchPageError(fetchReason(error));
	}
	if (typeof out !== "string" || !out)
		throw new FetchPageError("That page came back empty.");
	return out;
}

async function browserHtml(url: string, signal?: AbortSignal): Promise<string> {
	let res: Response;
	try {
		res = await fetch(url, { signal: signal ?? null });
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") throw error;
		throw new FetchPageError(
			"That page can't be reached from browser preview (try the app)."
		);
	}
	if (!res.ok)
		throw new FetchPageError(`That page failed (HTTP ${res.status}).`);
	return res.text();
}

function fetchReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (/timeout|timed out/i.test(message)) return "That page took too long.";
	if (/too large|too-big/i.test(message)) return "That page is too large.";
	return "That page couldn't be fetched.";
}
