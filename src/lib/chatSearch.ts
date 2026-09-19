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
 */

export interface SearchDoc {
	/** Chat this document belongs to (jump target). */
	chatId: string;
	/** Message id for message/annotation hits, null for chat-level hits. */
	msgId: string | null;
	kind: "chat" | "message" | "annotation";
	text: string;
}

export interface SearchHit {
	doc: SearchDoc;
	/** Higher ranks first. */
	score: number;
	/** Query token matched in context, for the palette snippet. */
	snippet: string;
}

/** Segment text into lowercase word-like tokens. */
export function tokenizeText(text: string): string[] {
	const lowered = text.toLowerCase();
	try {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		const out: string[] = [];
		for (const { segment, isWordLike } of segmenter.segment(lowered)) {
			const token = segment.trim();
			if (token && isWordLike) out.push(token);
		}
		return out;
	} catch {
		return lowered.split(/[\s\p{P}]+/u).filter((t) => t.length > 0);
	}
}

/** One-line context around the first query-token occurrence. */
export function snippetFor(
	text: string,
	queryTokens: string[],
	radius = 40
): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (!flat) return "";
	const lower = flat.toLowerCase();
	let at = -1;
	for (const token of queryTokens) {
		const hit = lower.indexOf(token);
		if (hit >= 0 && (at < 0 || hit < at)) at = hit;
	}
	if (at < 0) return flat.slice(0, radius * 2);
	const start = Math.max(0, at - radius);
	const end = Math.min(flat.length, at + radius);
	return (
		(start > 0 ? "…" : "") +
		flat.slice(start, end) +
		(end < flat.length ? "…" : "")
	);
}

function scoreDoc(tokens: string[], queryTokens: string[]): number {
	if (queryTokens.length === 0) return 0;
	const counts = new Map<string, number>();
	for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	let score = 0;
	for (const query of queryTokens) {
		// Exact token match wins; CJK single characters still match as a
		// prefix of a longer segmented word so one-character queries work.
		if (counts.has(query)) {
			score += 2 * (counts.get(query) ?? 0);
			continue;
		}
		let partial = 0;
		for (const [token, count] of counts) {
			if (token.startsWith(query) || query.startsWith(token)) partial += count;
		}
		if (partial === 0) return 0;
		score += partial;
	}
	return score;
}

/**
 * Message indices containing the query (case-insensitive substring):
 * the in-chat find bar cycles these browser-style. Pure over plain
 * message text (not rendered HTML) so Vitest runs it in node.
 */
export function findMessageIndices(
	contents: string[],
	query: string
): number[] {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const out: number[] = [];
	contents.forEach((content, index) => {
		if (content.toLowerCase().includes(q)) out.push(index);
	});
	return out;
}

/** Rank documents against a raw query string (AND semantics). */
export function querySearch(
	docs: SearchDoc[],
	query: string,
	limit = 30
): SearchHit[] {
	const queryTokens = tokenizeText(query);
	if (queryTokens.length === 0) return [];
	const hits: SearchHit[] = [];
	for (const doc of docs) {
		const score = scoreDoc(tokenizeText(doc.text), queryTokens);
		if (score > 0)
			hits.push({ doc, score, snippet: snippetFor(doc.text, queryTokens) });
	}
	hits.sort((a, b) => b.score - a.score);
	return hits.slice(0, Math.max(0, limit));
}

export interface SearchableChat {
	id: string;
	createdAt: number;
	messages: { id: string; content: string }[];
}

export interface SearchableAnnotation {
	chatId: string;
	messageId: string;
	quote: string;
	comment: string;
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
				text: msg.content
			});
		}
	}
	for (const ann of annotations) {
		const text = [ann.quote, ann.comment].filter((t) => t.trim()).join("\n");
		if (!text) continue;
		docs.push({
			chatId: ann.chatId,
			msgId: ann.messageId,
			kind: "annotation",
			text
		});
	}
	return docs;
}

/**
 * Sidebar chat-list filter: true when the label or any message contains
 * every query token (substring, case-insensitive — cheaper than the
 * ranked index and enough for a short visible list).
 */
export function chatMatchesQuery(
	label: string,
	messageTexts: string[],
	query: string
): boolean {
	const tokens = tokenizeText(query);
	if (tokens.length === 0) return true;
	const haystack = [label, ...messageTexts].join("\n").toLowerCase();
	return tokens.every((token) => haystack.includes(token));
}
