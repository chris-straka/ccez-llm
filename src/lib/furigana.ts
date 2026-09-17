import { escapeHtml, sanitize } from "./render";
import { pinyinRuby, plainParagraphs } from "./pinyin";
import { classifyAidLine, codeAwareLines, type LocalAid } from "./reading";

/**
 * Japanese furigana via lindera (IPAdic) in a Web Worker. Conversion
 * (and the dictionary load behind it) runs off the main thread —
 * building the dictionary on the main thread freezes the UI until the
 * watchdog kills it. The dictionary still fetches lazily on first use
 * (never at startup) and conversions are cached on the main thread, so
 * hover previews consult the cache without ever waking the worker.
 */

interface ConvertResponse {
	id: number;
	html?: string;
	error?: string;
}

const cache = new Map<string, string>();

let worker: Worker | null = null;
let nextRequestId = 0;
const inflight = new Map<
	number,
	{ resolve: (html: string) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
	if (typeof Worker === "undefined") throw new Error("Web workers are unavailable.");
	if (!worker) {
		const created = new Worker(new URL("./furigana.worker.ts", import.meta.url), {
			type: "module"
		});
		created.onmessage = (event: MessageEvent) => {
			const response = event.data as ConvertResponse;
			const pending = inflight.get(response.id);
			if (!pending) return;
			inflight.delete(response.id);
			if (response.error !== undefined) pending.reject(new Error(response.error));
			else pending.resolve(response.html ?? "");
		};
		created.onerror = (event: Event) => {
			// Drop the worker so the next request starts fresh instead of
			// talking to a dead one; in-flight callers fail loudly.
			const detail = event instanceof ErrorEvent && event.message ? `: ${event.message}` : "";
			const error = new Error(`Furigana worker failed${detail}.`);
			inflight.forEach((pending) => pending.reject(error));
			inflight.clear();
			worker = null;
		};
		worker = created;
	}
	return worker;
}

/**
 * Worker round-trip ceiling: a hung worker (stalled dictionary fetch,
 * no error event) must never leave a conversion pending forever. On
 * timeout the worker is dropped so the next request starts fresh, and
 * every in-flight caller fails loudly through the normal path.
 */
const CONVERT_TIMEOUT_MS = 60_000;

function convertInWorker(text: string): Promise<string> {
	const w = getWorker();
	const id = nextRequestId++;
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => {
			try {
				w.terminate();
			} catch {
				// Already dead; the rejects below still land.
			}
			worker = null;
			const error = new Error("Furigana conversion timed out.");
			inflight.forEach((pending) => pending.reject(error));
			inflight.clear();
		}, CONVERT_TIMEOUT_MS);
		inflight.set(id, {
			resolve: (html) => {
				clearTimeout(timer);
				resolve(html);
			},
			reject: (error) => {
				clearTimeout(timer);
				reject(error);
			}
		});
		w.postMessage({ id, text });
	});
}

/**
 * Convert Japanese text to sanitized furigana ruby HTML. The worker emits
 * bare inline ruby, so lines are wrapped in paragraphs exactly like the
 * pinyin path — the reserved ruby room keys off `p`.
 */
/**
 * True when the furigana for every non-blank line of this text is already
 * computed. Hover previews consult this so hovering never starts the
 * dictionary fetch — fetching happens on click alone.
 */
export function isFuriganaCached(text: string): boolean {
	return text
		.split("\n")
		.every((line) => !line.trim() || cache.has(line));
}

/**
 * Worker-only: runtimes without Web Workers (Vitest, SSR) cannot
 * convert. Unit coverage lives in furiganaRuby.test.ts (pure builder)
 * and the browser e2e spec (real engine end to end).
 */
async function fragment(line: string): Promise<string> {
	const cached = cache.get(line);
	if (cached !== undefined) return cached;
	const raw = await convertInWorker(line);
	cache.set(line, raw);
	return raw;
}

/**
 * One line's furigana conversion (worker-cached): kana-owned lines
 * convert, everything else passes through escaped. Aid mode renders
 * markdown first and converts prose text nodes in place (so code and
 * math blocks survive pinning) — this is the per-node unit the DOM
 * walk calls. Blank lines convert to nothing.
 */
export async function furiganaLine(line: string, preferred: LocalAid | null = null): Promise<string> {
	if (!line.trim()) return "";
	if (classifyAidLine(line, preferred) !== "furigana") return escapeHtml(line);
	return fragment(line);
}

export async function furiganaHtml(text: string, preferred: LocalAid | null = null): Promise<string> {
	// Line by line: tokenization must never see (or eat) a newline, so
	// multi-line messages keep their line structure no matter what the
	// tokenizer does with whitespace. Blank lines convert to nothing;
	// plainParagraphs turns them into paragraph breaks like markdown.
	// Only kana (Japanese) lines convert — readings the tokenizer
	// invents for Chinese Han characters are wrong readings, so
	// Han-only lines pass through escaped, exactly like the dual path.
	const lines = codeAwareLines(text);
	const converted = await Promise.all(
		lines.map(({ line, code }) => {
			if (!line.trim()) return Promise.resolve("");
			// Fenced code never converts, same as the pinyin path.
			if (code || classifyAidLine(line, preferred) !== "furigana")
				return Promise.resolve(escapeHtml(line));
			return fragment(line);
		})
	);
	return sanitize(plainParagraphs(converted.join("\n"), text));
}

/**
 * Dual-aid rendering for mixed messages: each line converts under the
 * aid that owns it (kana lines furigana, Han-only lines pinyin, the
 * rest plain), so both aids pin at once and neither touches the other's
 * parts. Same paragraph shape as the single-aid paths.
 */
export async function dualAidHtml(text: string, preferred: LocalAid | null = null): Promise<string> {
	const lines = codeAwareLines(text);
	const converted = await Promise.all(
		lines.map(({ line, code }) => {
			if (!line.trim()) return Promise.resolve("");
			if (code) return Promise.resolve(escapeHtml(line));
			const kind = classifyAidLine(line, preferred);
			if (kind === "furigana") return fragment(line);
			if (kind === "pinyin") return Promise.resolve(pinyinRuby(line));
			return Promise.resolve(escapeHtml(line));
		})
	);
	return sanitize(plainParagraphs(converted.join("\n"), text));
}
