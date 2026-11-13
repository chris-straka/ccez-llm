/**
 * Learning words underlined in replies, and reading as review (owner,
 * 2026-11-13: weak spots, step 2). A finished reply's words are matched
 * to their headwords (the words server's POST /headwords, the one
 * headword every app saves under) and the ones the owner is learning are
 * underlined in their own colour, as in his other apps. Each one in a
 * reply counts as seen once (POST /review/seen, a pass when the word is
 * due: the server decides); a tap on one counts as a miss, and no pass
 * follows for it in that reply. Off the tailnet nothing is underlined
 * and nothing is sent.
 */

import { wordKey } from "./wordList.svelte";

export interface LearningSource {
	server: string;
	statuses: Record<string, string>;
}

let source: (() => LearningSource) | null = null;
let send: typeof fetch = (...a) => fetch(...a);

/** The page's word list (server and statuses), read when a reply settles. */
export function useLearningSource(
	read: () => LearningSource,
	fetcher?: typeof fetch
): void {
	source = read;
	if (fetcher) send = fetcher;
}

const base = (lang: string) => (lang.split(/[-_]/)[0] ?? lang).toLowerCase();
/** Headwords asked this session ("lang:word" → headword, or null). */
const heads = new Map<string, string | null>();

/** A reply's distinct words in reading order, at most `most`. */
export function replyWords(text: string, lang: string, most = 400): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	let seg: Intl.Segmenter | null;
	try {
		seg = new Intl.Segmenter(lang, { granularity: "word" });
	} catch {
		seg = null;
	}
	const pieces = seg
		? [...seg.segment(text)].filter((s) => s.isWordLike).map((s) => s.segment)
		: text.split(/[^\p{L}\p{M}'’-]+/u);
	for (const p of pieces) {
		const w = p.trim();
		if (!w || /^\d+$/.test(w) || seen.has(w.toLowerCase())) continue;
		seen.add(w.toLowerCase());
		out.push(w);
		if (out.length >= most) break;
	}
	return out;
}

/**
 * The reply's surface forms that are Learning words, each with its
 * headword. Pure apart from the headwords asked: `ask` gives
 * word → headword (null: none).
 */
export function learningForms(
	words: string[],
	lang: string,
	statuses: Record<string, string>,
	headOf: (w: string) => string | null | undefined
): Map<string, string> {
	const out = new Map<string, string>();
	for (const w of words) {
		// Reported under the form it's saved as: its headword, else the
		// saved key's own spelling ("Trotzdem" opening a sentence is "trotzdem").
		const head = headOf(w);
		const savedAs = (word: string) =>
			wordKey(lang, word).slice(wordKey(lang, "").length);
		if (head && statuses[wordKey(lang, head)] === "learning") out.set(w, head);
		else if (statuses[wordKey(lang, w)] === "learning") out.set(w, savedAs(w));
	}
	return out;
}

/** The Learning words in a settled reply: surface form → headword. Empty off the tailnet. */
export async function learningIn(
	text: string,
	lang: string
): Promise<Map<string, string>> {
	if (!source) return new Map();
	const { server, statuses } = source();
	const b = base(lang);
	// Only languages with something being learned.
	if (
		!Object.entries(statuses).some(
			([k, v]) => v === "learning" && k.startsWith(`${b}:`)
		)
	)
		return new Map();
	const words = replyWords(text, b);
	const ask = words.filter((w) => !heads.has(`${b}:${w.toLowerCase()}`));
	if (ask.length) {
		try {
			const res = await send(`${server}/headwords`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ lang: b, words: ask }),
				signal: AbortSignal.timeout(8_000)
			});
			if (res.ok) {
				const got = (await res.json()) as Record<string, string | null>;
				for (const w of ask)
					heads.set(
						`${b}:${w.toLowerCase()}`,
						typeof got[w] === "string" && got[w] ? got[w] : null
					);
			}
		} catch {
			// Off the tailnet: matched as written only.
		}
	}
	return learningForms(words, b, statuses, (w) =>
		heads.get(`${b}:${w.toLowerCase()}`)
	);
}

/**
 * Replies seen streaming this session (message id): only these count as
 * read when they settle. Old replies redrawn on opening the app don't
 * (they'd flood the schedule), and the body that streamed isn't always
 * the one that shows the settled reply.
 */
const streamed = new Set<string>();

export function markStreaming(messageId: string): void {
	streamed.add(messageId);
}

export function wasStreamed(messageId: string): boolean {
	return streamed.has(messageId);
}

/** Replies already counted (message id), and words tapped in each. */
const counted = new Set<string>();
const tapped = new Set<string>();

/** A reply's Learning words went by: a pass for each not tapped, once per reply. */
export function readThrough(
	messageId: string,
	lang: string,
	headsSeen: Iterable<string>
): void {
	if (counted.has(messageId)) return;
	counted.add(messageId);
	const words = [...new Set(headsSeen)].filter(
		(h) => !tapped.has(`${messageId}|${h.toLowerCase()}`)
	);
	report(lang, words, false);
}

/** A Learning word in a reply was tapped: a miss, and no pass for it in that reply. */
export function tappedWord(
	messageId: string,
	lang: string,
	head: string
): void {
	const k = `${messageId}|${head.toLowerCase()}`;
	if (tapped.has(k)) return;
	tapped.add(k);
	report(lang, [head], true);
}

function report(lang: string, words: string[], wasTapped: boolean): void {
	if (!source || !words.length) return;
	const { server } = source();
	const at = Date.now();
	void send(`${server}/review/seen`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(
			words.map((word) => ({
				lang: base(lang),
				word,
				tapped: wasTapped,
				at,
				from: "ccez-llm"
			}))
		),
		signal: AbortSignal.timeout(15_000)
	}).catch(() => undefined);
}

/**
 * Wraps the Learning words in `root`'s text in `<span class="ccez-learning">`
 * (code, ruby readings and links left alone). Idempotent: already wrapped
 * text is skipped.
 */
export function stampLearning(
	root: HTMLElement,
	forms: Map<string, string>,
	lang: string
): void {
	if (!forms.size) return;
	const cjk = /^(zh|ja|ko)/.test(base(lang));
	const list = [...forms.keys()]
		.sort((a, b) => b.length - a.length)
		.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const pattern = cjk
		? `(${list.join("|")})`
		: `(?<![\\p{L}\\p{M}])(${list.join("|")})(?![\\p{L}\\p{M}])`;
	const re = new RegExp(pattern, "giu");
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
		{
			acceptNode: (n) =>
				n.parentElement?.closest(
					"pre, code, rt, rp, a, button, .ccez-code, .ccez-learning, textarea"
				)
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT
		}
	);
	const nodes: Text[] = [];
	for (let n = walker.nextNode(); n; n = walker.nextNode())
		nodes.push(n as Text);
	const lower = new Map([...forms].map(([k, v]) => [k.toLowerCase(), v]));
	for (const node of nodes) {
		const text = node.data;
		re.lastIndex = 0;
		if (!re.test(text)) continue;
		re.lastIndex = 0;
		const frag = root.ownerDocument.createDocumentFragment();
		let at = 0;
		for (const m of text.matchAll(re)) {
			const i = m.index ?? 0;
			if (i > at) frag.append(text.slice(at, i));
			const span = root.ownerDocument.createElement("span");
			span.className = "ccez-learning";
			span.dataset.head = lower.get(m[0].toLowerCase()) ?? m[0];
			span.textContent = m[0];
			frag.append(span);
			at = i + m[0].length;
		}
		if (at < text.length) frag.append(text.slice(at));
		node.replaceWith(frag);
	}
}
