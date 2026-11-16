/**
 * What DeepSeek's web tools looked up for one reply, read from its
 * `server_tool_calls` (the steps it took, each with its calls) and the
 * `server_tool_event`s that stream while it works (api-docs.deepseek.com,
 * Web Tools, Chat Completions API). Everything here is defensive: an
 * unknown or missing field drops that item, never the reply, and only
 * what DeepSeek returned is shown (never an invented source). Pure.
 */

/** One search the model ran: its queries and how many results came back. */
export interface WebSearch {
	queries: string[];
	results: number;
}

/** One page it found or read, as the sources list shows it. */
export interface WebPage {
	url: string;
	/** The page's title, or its address when DeepSeek gave none. */
	title: string;
	/** The site's name (DeepSeek's `site_name`), else its host. */
	site: string;
	host: string;
	/** DeepSeek's `site_icon` (https only), else null. */
	icon: string | null;
}

export interface WebSources {
	searches: WebSearch[];
	pages: WebPage[];
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Json)
		: null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** An http(s) address, or null (never a `javascript:` link in a list). */
function webUrl(value: unknown): URL | null {
	const raw = text(value);
	if (!raw) return null;
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}

/** A host as people read it: no `www.`. */
export function readableHost(host: string): string {
	return host.replace(/^www\./i, "");
}

/** Every call in the steps, in order. */
function calls(serverToolCalls: unknown): Json[] {
	if (!Array.isArray(serverToolCalls)) return [];
	const out: Json[] = [];
	for (const step of serverToolCalls) {
		const list = record(step)?.["calls"];
		if (!Array.isArray(list)) continue;
		for (const call of list) {
			const found = record(call);
			if (found) out.push(found);
		}
	}
	return out;
}

function page(raw: Json | null, fallbackUrl?: unknown): WebPage | null {
	const url = webUrl(raw?.["url"] ?? fallbackUrl);
	if (!url) return null;
	const host = readableHost(url.hostname);
	const title = text(raw?.["title"]);
	const icon = webUrl(raw?.["site_icon"]);
	return {
		url: url.href,
		// DeepSeek sends the address as the title when it has none.
		title:
			title && title !== url.href && title !== text(raw?.["url"])
				? title
				: host,
		site: text(raw?.["site_name"]) || host,
		host,
		icon: icon && icon.protocol === "https:" ? icon.href : null
	};
}

/**
 * The searches and pages behind a reply, deduplicated by address:
 * search results, pages opened during a deep search, and links read.
 * Pages the answer cites (`cited`, from its annotations) come first,
 * in citation order; the rest keep the order they were found. Failed
 * calls add nothing. Null when the reply looked nothing up.
 */
export function webSources(
	serverToolCalls: unknown,
	cited: readonly string[] = []
): WebSources | null {
	const searches: WebSearch[] = [];
	const pages: WebPage[] = [];
	const seen = new Set<string>();
	const add = (found: WebPage | null): void => {
		if (!found || seen.has(found.url)) return;
		seen.add(found.url);
		pages.push(found);
	};
	for (const call of calls(serverToolCalls)) {
		const action = record(call["action"]);
		const type = text(action?.["type"]);
		const failed = text(call["status"]) === "failed";
		if (type === "search") {
			const queries = Array.isArray(action?.["queries"])
				? (action["queries"] as unknown[]).map(text).filter((q) => q !== "")
				: [];
			const results = Array.isArray(call["sources"])
				? (call["sources"] as unknown[])
				: [];
			if (failed && queries.length === 0) continue;
			searches.push({ queries, results: failed ? 0 : results.length });
			if (failed) continue;
			for (const source of results) add(page(record(source)));
			continue;
		}
		if (failed) continue;
		if (type === "open_page" || type === "read_link") {
			// Only a page DeepSeek says it opened: `page` comes with the result.
			const opened = record(call["page"]);
			if (opened) add(page(opened, action?.["url"]));
		}
	}
	if (searches.length === 0 && pages.length === 0) return null;
	const order = cited.map((c) => webUrl(c)?.href ?? c);
	const rank = (p: WebPage): number => {
		const at = order.indexOf(p.url);
		return at < 0 ? order.length : at;
	};
	// Array sort is stable: uncited pages keep their found order.
	return { searches, pages: [...pages].sort((a, b) => rank(a) - rank(b)) };
}

/**
 * The live line while DeepSeek works: what a starting call looks up.
 * `call_started` names it; any other event clears it (null), and an
 * event this can't read changes nothing (undefined).
 */
export function lookupLabel(event: unknown): string | null | undefined {
	const found = record(event);
	const type = text(found?.["type"]);
	if (type === "call_completed" || type === "step_reasoning_done") return null;
	if (type !== "call_started") return undefined;
	const action = record(record(found?.["call"])?.["action"]);
	const kind = text(action?.["type"]);
	if (kind === "search") {
		const queries = Array.isArray(action?.["queries"])
			? (action["queries"] as unknown[]).map(text).filter((q) => q !== "")
			: [];
		if (queries.length === 0) return "Searching by image";
		const shown = queries.slice(0, 2).map((q) => `“${clip(q, 60)}”`);
		const more = queries.length > 2 ? ` and ${queries.length - 2} more` : "";
		return `Searching ${shown.join(", ")}${more}`;
	}
	const url = webUrl(action?.["url"]);
	const host = url ? readableHost(url.hostname) : "a page";
	if (kind === "find_in_page") return `Looking through ${host}`;
	if (kind === "open_page" || kind === "read_link") return `Reading ${host}`;
	return "Looking it up";
}

function clip(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Fold one `server_tool_event` into the steps seen so far (the same
 * shape as the final `server_tool_calls`, minus signatures), so the
 * sources row fills in while the answer streams. A completed call
 * replaces its started one. Returns a new array; unreadable events
 * return the old one.
 */
export function applyToolEvent(steps: unknown, event: unknown): unknown[] {
	const prior: unknown[] = Array.isArray(steps) ? (steps as unknown[]) : [];
	const found = record(event);
	const type = text(found?.["type"]);
	if (type !== "call_started" && type !== "call_completed") return prior;
	const call = record(found?.["call"]);
	const stepIndex = found?.["step"];
	if (!call || typeof stepIndex !== "number" || stepIndex < 0) return prior;
	const next = prior.map((s) => s);
	let at = next.findIndex((s) => record(s)?.["index"] === stepIndex);
	if (at < 0) {
		next.push({ index: stepIndex, calls: [] });
		at = next.length - 1;
	}
	const step = record(next[at]) ?? { index: stepIndex };
	const list = Array.isArray(step["calls"])
		? [...(step["calls"] as unknown[])]
		: [];
	const callIndex = call["index"];
	const same =
		typeof callIndex === "number"
			? list.findIndex((c) => record(c)?.["index"] === callIndex)
			: -1;
	if (same >= 0) list[same] = call;
	else list.push(call);
	next[at] = { ...step, calls: list };
	return next;
}

/**
 * The copy kept with a message: DeepSeek's `server_tool_calls` as
 * returned, minus what it ignores when they come back (search snippets,
 * each step's thinking), so a chat's saved history stays small. The
 * structure, ids and the `signature` of every link read (the page
 * itself, restored into later turns) stay as they were. Undefined
 * when there is nothing to keep.
 */
export function storedToolCalls(
	serverToolCalls: unknown
): unknown[] | undefined {
	if (!Array.isArray(serverToolCalls) || serverToolCalls.length === 0)
		return undefined;
	return (serverToolCalls as unknown[]).map((step): unknown => {
		const s = record(step);
		if (!s) return step;
		const out: Json = { ...s };
		if (typeof out["reasoning_content"] === "string")
			out["reasoning_content"] = "";
		if (Array.isArray(out["calls"]))
			out["calls"] = (out["calls"] as unknown[]).map((call): unknown => {
				const c = record(call);
				if (!c || !Array.isArray(c["sources"])) return call;
				return {
					...c,
					sources: (c["sources"] as unknown[]).map((source): unknown => {
						const src = record(source);
						if (!src) return source;
						const kept: Json = { ...src };
						delete kept["snippet"];
						return kept;
					})
				};
			});
		return out;
	});
}
