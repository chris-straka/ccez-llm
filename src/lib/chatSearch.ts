/**
 * Full-text search across chats and annotations (search-mobile bucket).
 * Pure logic: importable without Tauri or DOM so Vitest runs it in node.
 * The Worker (`chatSearch.worker.ts`) and the persistence wrapper
 * (`chatSearchStore.ts`) both build on these helpers.
 *
 * Tokenization uses `Intl.Segmenter` (granularity "word") so CJK text
 * segments at word boundaries instead of whitespace — whitespace
 * splitting finds nothing in Chinese/Japanese. Falls back to a simple
 * split where `Intl.Segmenter` is unavailable.
 *
 * Matching runs on folded text (`foldText`): case, accents, and
 * umlauts drop out, so "uber" finds "über". Han text also matches its
 * toneless pinyin ("xuexi" finds 学习). Queries take "quoted phrases"
 * and the `from:me`, `from:ai`, and `in:notes` filters.
 */
import { pinyin } from "pinyin-pro";

export interface SearchDoc {
	/** Chat this document belongs to (jump target). */
	chatId: string;
	/** Message id for message/annotation hits, null for chat-level hits. */
	msgId: string | null;
	kind: "chat" | "message" | "annotation";
	text: string;
	/** Message author; `from:` filters skip docs without one. */
	role?: "user" | "assistant";
	/** Chat creation time: newer chats win score ties. */
	at?: number;
}

export interface SearchHit {
	doc: SearchDoc;
	/** Higher ranks first. */
	score: number;
	/** Query token matched in context, for the palette snippet. */
	snippet: string;
	/** Matched spans inside `snippet` ([start, end) UTF-16 offsets). */
	marks: Array<[number, number]>;
}

/** Letters NFKD leaves whole: folded by hand. */
const FOLD_SPECIAL: Record<string, string> = {
	ß: "ss",
	ẞ: "ss",
	æ: "ae",
	Æ: "ae",
	œ: "oe",
	Œ: "oe",
	ø: "o",
	Ø: "o",
	ł: "l",
	Ł: "l",
	đ: "d",
	Đ: "d",
	ı: "i"
};

/** Latin/Greek/Cyrillic combining accents plus Arabic vowel marks.
Kana voicing marks stay: が and か are different words. */
const FOLD_MARKS_RE = /[\u0300-\u036f\u064b-\u065f\u0670]/g;

function foldChar(ch: string): string {
	const special = FOLD_SPECIAL[ch];
	if (special !== undefined) return special;
	return ch
		.toLowerCase()
		.normalize("NFKD")
		.replace(FOLD_MARKS_RE, "")
		.normalize("NFC");
}

/** Lowercase with accents, umlauts, and Arabic vowel marks removed
(é→e, ü→u, ß→ss, fullwidth→ASCII). Queries and documents fold the
same way, so either side may carry the accents. */
export function foldText(text: string): string {
	// eslint-disable-next-line no-control-regex
	if (/^[\x00-\x7f]*$/.test(text)) return text.toLowerCase();
	let out = "";
	for (const ch of text) out += foldChar(ch);
	return out;
}

/** Folded text plus, per folded UTF-16 unit, the source offset it
came from (null when folding kept every offset). */
function foldWithMap(text: string): { folded: string; map: number[] | null } {
	// eslint-disable-next-line no-control-regex
	if (/^[\x00-\x7f]*$/.test(text)) return { folded: text.toLowerCase(), map: null };
	let folded = "";
	const map: number[] = [];
	let at = 0;
	for (const ch of text) {
		const f = foldChar(ch);
		for (let k = 0; k < f.length; k++) map.push(at);
		folded += f;
		at += ch.length;
	}
	return { folded, map };
}

let segmenter: Intl.Segmenter | null | undefined;
function wordSegmenter(): Intl.Segmenter | null {
	if (segmenter === undefined) {
		try {
			segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		} catch {
			segmenter = null;
		}
	}
	return segmenter;
}

/** Segment text into lowercase word-like tokens. */
export function tokenizeText(text: string): string[] {
	const lowered = text.toLowerCase();
	const seg = wordSegmenter();
	if (!seg) return lowered.split(/[\s\p{P}]+/u).filter((t) => t.length > 0);
	const out: string[] = [];
	for (const { segment, isWordLike } of seg.segment(lowered)) {
		const token = segment.trim();
		if (token && isWordLike) out.push(token);
	}
	return out;
}

/**
 * Message indices containing the query (folded substring):
 * the in-chat find bar cycles these browser-style. Pure over plain
 * message text (not rendered HTML) so Vitest runs it in node.
 */
export function findMessageIndices(
	contents: string[],
	query: string
): number[] {
	const q = foldText(query.trim());
	if (!q) return [];
	const out: number[] = [];
	contents.forEach((content, index) => {
		if (foldText(content).includes(q)) out.push(index);
	});
	return out;
}

/** A raw palette query split into words, phrases, and filters. */
export interface ParsedQuery {
	/** Folded word tokens: every one must match (AND). */
	terms: string[];
	/** Folded "quoted phrases", whitespace collapsed: matched whole. */
	phrases: string[];
	/** `from:me` / `from:ai`. */
	from: "user" | "assistant" | null;
	/** `in:notes`: annotations only. */
	notesOnly: boolean;
}

const FILTER_RE = /(?:^|\s)(from:me|from:ai|in:notes)(?=\s|$)/gi;
const PHRASE_RE = /["“”„]([^"“”„]+)["“”„]?/g;

export function parseQuery(raw: string): ParsedQuery {
	let from: ParsedQuery["from"] = null;
	let notesOnly = false;
	let rest = raw.replace(FILTER_RE, (_m, filter: string) => {
		const f = filter.toLowerCase();
		if (f === "from:me") from = "user";
		else if (f === "from:ai") from = "assistant";
		else notesOnly = true;
		return " ";
	});
	const phrases: string[] = [];
	rest = rest.replace(PHRASE_RE, (_m, phrase: string) => {
		const folded = foldText(phrase).replace(/\s+/g, " ").trim();
		if (folded) phrases.push(folded);
		return " ";
	});
	return { terms: tokenizeText(foldText(rest)), phrases, from, notesOnly };
}

/** Han run inside a folded doc: toneless syllables and where each
character sits in the folded text. */
interface PinyinRun {
	syllables: string[];
	starts: number[];
	ends: number[];
}

/** A document folded and tokenized once per index snapshot. */
interface PreparedDoc {
	doc: SearchDoc;
	/** Whitespace-collapsed source text (snippets cut this). */
	flat: string;
	folded: string;
	map: number[] | null;
	counts: Map<string, number>;
	pinyin: PinyinRun[];
}

const HAN_RE = /\p{Script=Han}/u;

function pinyinRuns(folded: string): PinyinRun[] {
	if (!HAN_RE.test(folded)) return [];
	const runs: PinyinRun[] = [];
	let chars: string[] = [];
	let starts: number[] = [];
	const flush = (): void => {
		if (chars.length === 0) return;
		const syllables = pinyin(chars.join(""), {
			toneType: "none",
			type: "array"
		}).map((syl) => foldText(syl));
		runs.push({
			syllables,
			starts,
			ends: starts.map((at, i) => at + (chars[i]?.length ?? 1))
		});
		chars = [];
		starts = [];
	};
	let at = 0;
	for (const ch of folded) {
		if (HAN_RE.test(ch)) {
			chars.push(ch);
			starts.push(at);
		} else flush();
		at += ch.length;
	}
	flush();
	return runs;
}

function prepareDoc(doc: SearchDoc): PreparedDoc {
	const flat = doc.text.replace(/\s+/g, " ").trim();
	const { folded, map } = foldWithMap(flat);
	const counts = new Map<string, number>();
	for (const token of tokenizeText(folded))
		counts.set(token, (counts.get(token) ?? 0) + 1);
	return { doc, flat, folded, map, counts, pinyin: pinyinRuns(folded) };
}

const preparedCache = new WeakMap<SearchDoc[], PreparedDoc[]>();

function prepared(docs: SearchDoc[]): PreparedDoc[] {
	let out = preparedCache.get(docs);
	if (!out) {
		out = docs.map(prepareDoc);
		preparedCache.set(docs, out);
	}
	return out;
}

/** Folded spans where a pinyin term ("xuexi", "xue") spells
consecutive syllables from a syllable start; the last syllable may
be partial, so typing narrows as you go. */
function pinyinSpans(runs: PinyinRun[], term: string): Array<[number, number]> {
	if (term.length < 2 || !/^[a-z]+$/.test(term)) return [];
	const want = term.replace(/v/g, "u");
	const spans: Array<[number, number]> = [];
	for (const run of runs) {
		for (let i = 0; i < run.syllables.length; i++) {
			let acc = "";
			for (let j = i; j < run.syllables.length; j++) {
				acc += run.syllables[j] ?? "";
				if (acc.startsWith(want)) {
					spans.push([run.starts[i] ?? 0, run.ends[j] ?? 0]);
					break;
				}
				if (!want.startsWith(acc)) break;
			}
		}
	}
	return spans;
}

const SPACED_SCRIPT_RE = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}]/u;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/** Every [start, end) occurrence of needle in folded text. Words in
spaced scripts only count from a word start ("in" never marks
"find"); CJK needles match anywhere. */
function occurrences(folded: string, needle: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	if (!needle) return out;
	const wordStart = SPACED_SCRIPT_RE.test(needle);
	let at = folded.indexOf(needle);
	while (at >= 0) {
		if (!wordStart || at === 0 || !WORD_CHAR_RE.test(folded[at - 1] ?? ""))
			out.push([at, at + needle.length]);
		at = folded.indexOf(needle, at + needle.length);
	}
	return out;
}

/** Score plus matched folded spans, or null when any part misses. */
function matchDoc(
	p: PreparedDoc,
	q: ParsedQuery
): { score: number; spans: Array<[number, number]> } | null {
	let score = 0;
	const spans: Array<[number, number]> = [];
	for (const term of q.terms) {
		// Exact token match wins; CJK single characters still match as a
		// prefix of a longer segmented word so one-character queries work.
		let termScore = 2 * (p.counts.get(term) ?? 0);
		if (termScore === 0) {
			for (const [token, count] of p.counts)
				if (token.startsWith(term) || term.startsWith(token)) termScore += count;
		}
		const py = pinyinSpans(p.pinyin, term);
		termScore += py.length;
		if (termScore === 0) return null;
		score += termScore;
		spans.push(...occurrences(p.folded, term), ...py);
	}
	for (const phrase of q.phrases) {
		const found = occurrences(p.folded, phrase);
		if (found.length === 0) return null;
		score += 3 * found.length;
		spans.push(...found);
	}
	return { score, spans };
}

function toSource(map: number[] | null, at: number, sourceLength: number): number {
	if (!map) return at;
	return at < map.length ? (map[at] ?? sourceLength) : sourceLength;
}

/** One-line context around the earliest span, with the spans that
fall inside it remapped to snippet offsets. */
function snippetWithMarks(
	p: PreparedDoc,
	spans: Array<[number, number]>,
	radius = 40
): { snippet: string; marks: Array<[number, number]> } {
	const src = spans
		.map(([a, b]): [number, number] => {
			const start = toSource(p.map, a, p.flat.length);
			const end = Math.max(toSource(p.map, b, p.flat.length), start + 1);
			return [start, Math.min(end, p.flat.length)];
		})
		.sort((x, y) => x[0] - y[0]);
	const first = src[0];
	if (!first) return { snippet: p.flat.slice(0, radius * 2), marks: [] };
	const start = Math.max(0, first[0] - radius);
	const end = Math.min(p.flat.length, Math.max(first[1], first[0] + radius));
	const lead = start > 0 ? "…" : "";
	const snippet = lead + p.flat.slice(start, end) + (end < p.flat.length ? "…" : "");
	const marks: Array<[number, number]> = [];
	for (const [a, b] of src) {
		const ms = Math.max(a, start);
		const me = Math.min(b, end);
		if (me <= ms) continue;
		const s0 = ms - start + lead.length;
		const s1 = me - start + lead.length;
		const prev = marks[marks.length - 1];
		if (prev && s0 <= prev[1]) prev[1] = Math.max(prev[1], s1);
		else marks.push([s0, s1]);
	}
	return { snippet, marks };
}

/** Rank documents against a raw query string (AND semantics). */
export function querySearch(
	docs: SearchDoc[],
	query: string,
	limit = 30
): SearchHit[] {
	const q = parseQuery(query);
	if (q.terms.length === 0 && q.phrases.length === 0) return [];
	const hits: SearchHit[] = [];
	for (const p of prepared(docs)) {
		if (q.notesOnly && p.doc.kind !== "annotation") continue;
		if (q.from && p.doc.role !== q.from) continue;
		const match = matchDoc(p, q);
		if (!match) continue;
		hits.push({ doc: p.doc, score: match.score, ...snippetWithMarks(p, match.spans) });
	}
	hits.sort((a, b) => b.score - a.score || (b.doc.at ?? 0) - (a.doc.at ?? 0));
	return hits.slice(0, Math.max(0, limit));
}

export interface SearchableChat {
	id: string;
	createdAt: number;
	messages: { id: string; content: string; role?: "user" | "assistant" }[];
}

export interface SearchableAnnotation {
	chatId: string;
	messageId?: string;
	quote: string;
	comment: string;
}

/** Draft-annotation shape the index snapshot needs (structural so
this module stays dependency-free). */
export interface IndexableAnnotation {
	id: string;
	messageId?: string;
	quote: string;
	comment: string;
}

/** Collect one index snapshot's annotations: the open chat's live
drafts plus every other chat's stored ones, de-duplicated by
chat+annotation so repeat entries collapse. A throwing draft loader
yields nothing for that chat — search never breaks the chat, the
stale snapshot stays live. */
export function collectSearchAnnotations(
	chats: Array<{ id: string }>,
	activeChatId: string | null,
	liveAnnotations: IndexableAnnotation[],
	loadDraft: (chatId: string) => IndexableAnnotation[]
): SearchableAnnotation[] {
	const anns: SearchableAnnotation[] = [];
	const seen = new Set<string>();
	for (const chat of chats) {
		let drafts: IndexableAnnotation[];
		try {
			drafts =
				chat.id === activeChatId ? liveAnnotations : loadDraft(chat.id);
		} catch {
			drafts = [];
		}
		for (const ann of drafts) {
			const key = `${chat.id}:${ann.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			anns.push({
				chatId: chat.id,
				...(ann.messageId ? { messageId: ann.messageId } : {}),
				quote: ann.quote,
				comment: ann.comment
			});
		}
	}
	return anns;
}

/** Flatten chats + annotations into indexable documents. */
export function buildSearchDocs(
	chats: SearchableChat[],
	annotations: SearchableAnnotation[]
): SearchDoc[] {
	const docs: SearchDoc[] = [];
	for (const chat of chats) {
		for (const msg of chat.messages) {
			if (!msg.content.trim()) continue;
			docs.push({
				chatId: chat.id,
				msgId: msg.id,
				kind: "message",
				text: msg.content,
				...(msg.role ? { role: msg.role } : {}),
				at: chat.createdAt
			});
		}
	}
	const createdAt = new Map(chats.map((c) => [c.id, c.createdAt]));
	for (const ann of annotations) {
		const text = [ann.quote, ann.comment].filter((t) => t.trim()).join("\n");
		if (!text) continue;
		const at = createdAt.get(ann.chatId);
		docs.push({
			chatId: ann.chatId,
			msgId: ann.messageId ?? null,
			kind: "annotation",
			text,
			...(at !== undefined ? { at } : {})
		});
	}
	return docs;
}

/**
 * Sidebar chat-list filter: true when the label or any message contains
 * every query token (folded substring — cheaper than the
 * ranked index and enough for a short visible list).
 */
export function chatMatchesQuery(
	label: string,
	messageTexts: string[],
	query: string
): boolean {
	const tokens = tokenizeText(foldText(query));
	if (tokens.length === 0) return true;
	const haystack = foldText([label, ...messageTexts].join("\n"));
	return tokens.every((token) => haystack.includes(token));
}

/** Hits regrouped so each chat's hits sit together, chats ordered by
their best hit (stable otherwise): the result list prints one chat
header per run, and the keyboard cursor walks the same order. */
export function groupHitsByChat(hits: SearchHit[]): SearchHit[] {
	const groups = new Map<string, SearchHit[]>();
	for (const hit of hits) {
		const group = groups.get(hit.doc.chatId);
		if (group) group.push(hit);
		else groups.set(hit.doc.chatId, [hit]);
	}
	return [...groups.values()].flat();
}

/** Snippet split into plain and matched runs for rendering. */
export function markSegments(
	snippet: string,
	marks: Array<[number, number]>
): Array<{ text: string; hit: boolean }> {
	const out: Array<{ text: string; hit: boolean }> = [];
	let at = 0;
	for (const [a, b] of marks) {
		if (a < at || b <= a) continue;
		if (a > at) out.push({ text: snippet.slice(at, a), hit: false });
		out.push({ text: snippet.slice(a, b), hit: true });
		at = b;
	}
	if (at < snippet.length) out.push({ text: snippet.slice(at), hit: false });
	return out;
}

/** Short who-said-it tag for a hit row. */
export function hitTag(doc: SearchDoc): string {
	if (doc.kind === "annotation") return "note";
	if (doc.role === "user") return "you";
	if (doc.role === "assistant") return "AI";
	return doc.kind;
}

/** Palette query as a find-bar query: filters and quote marks drop,
the words stay (find matches one folded substring). */
export function findQueryFor(query: string): string {
	return query
		.replace(FILTER_RE, " ")
		.replace(/["“”„]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}
