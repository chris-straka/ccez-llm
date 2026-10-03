/**
 * The baked annotation text block: formatting prompt inclusions into
 * messages, splitting them back into refs, and rebaking on edit.
 * Split out of annotations.ts (section C).
 */

/**
 * Render annotations for the prompt tail, matching the review-panel shape:
 * numbered quote plus comment.
 */
export function formatAnnotations(
	list: { quote: string; comment: string; answer?: string }[]
): string {
	return list
		.map((a, i) => {
			const head = `${i + 1}. "${a.quote}"`;
			// Empty comments file as "?" so the model sees the confusion
			// instead of a bare quote that reads as settled context.
			// Newlines collapse like the reply's: a Shift+Enter comment
			// would otherwise split the entry and corrupt the parse.
			const comment = a.comment.trim().replace(/\s+/g, " ");
			const asked = comment ? `${head} — ${comment}` : `${head} — ?`;
			// The reply rides on its own continuation line, newlines
			// collapsed: answers stay short (capped at ask time), and a
			// single line keeps the block line-parseable — a raw
			// multi-line reply could fake an entry boundary.
			const reply = a.answer?.trim().replace(/\s+/g, " ");
			return reply ? `${asked}\n   Answer: ${reply}` : asked;
		})
		.join("\n");
}

/**
 * Append the annotation block to outgoing prompt text. Only pinned
 * annotations ever reach here (see promptInclusions) — approval is
 * the pin, and deleting the annotation is the only removal.
 * Numbering sequences from the kept order with no gaps.
 */
export function withAnnotations(
	prompt: string,
	list: {
		quote: string;
		comment: string;
		answer?: string;
	}[]
): string {
	if (list.length === 0) return prompt;
	const block = `Annotated selections:\n${formatAnnotations(list)}`;
	return prompt ? `${prompt}\n\n${block}` : block;
}

/**
 * Rewrite one baked ref's comment (the previous-menu pencil save):
 * parse the trailing block, swap ref n's comment, rebake. Null when
 * the content holds no clean block or n isn't in it — the caller
 * treats that as gone. Numbering re-sequences from the kept order,
 * so an unchanged comment rebakes byte-for-byte.
 */
export function rewriteAnnotationComment(
	content: string,
	n: number,
	comment: string
): string | null {
	const split = splitAnnotationBlock(content);
	if (!split) return null;
	if (!split.refs.some((ref) => ref.n === n)) return null;
	return withAnnotations(
		split.text,
		// Rewording the note keeps the reply it already got (the pencil
		// never re-asks), so the Answer line survives the rebake.
		split.refs.map((ref) => (ref.n === n ? { ...ref, comment } : ref))
	);
}

/** One baked annotation reference, as displayed under its message. */
export interface AnnotationRef {
	n: number;
	quote: string;
	comment: string;
	/** Baked reply (see formatAnnotations): absent on older blocks. */
	answer?: string;
}

/**
 * Split a sent message into display text plus its baked annotation
 * block (see withAnnotations). The chat renders the text with a count
 * pill instead of the full block; hovering the pill reveals these refs.
 * Returns null when no clean trailing block is present — the message
 * then renders untouched (including user-typed lookalikes).
 */
export function splitAnnotationBlock(
	content: string
): { text: string; refs: AnnotationRef[] } | null {
	const marker = "\n\nAnnotated selections:\n";
	const head = "Annotated selections:\n";
	const at = content.lastIndexOf(marker);
	let text: string;
	let body: string;
	if (at !== -1) {
		text = content.slice(0, at);
		body = content.slice(at + marker.length);
	} else if (content.startsWith(head)) {
		// Annotations-only message: no prompt text ahead of the block.
		text = "";
		body = content.slice(head.length);
	} else return null;
	const refs: AnnotationRef[] = [];
	const entry =
		/(\d+)\.\s+"([\s\S]*?)"(?:\s+—\s+([^\n]*))?(?:\n[ \t]+Answer:[ \t]*([^\n]*))?(?=\n\d+\.\s+"|$)/g;
	let m: RegExpExecArray | null;
	let covered = 0;
	while ((m = entry.exec(body)) !== null) {
		covered = m.index + m[0].length;
		const reply = (m[4] ?? "").trim();
		refs.push({
			n: Number(m[1] ?? 0),
			quote: m[2] ?? "",
			comment: (m[3] ?? "").trim(),
			...(reply ? { answer: reply } : {})
		});
	}
	if (refs.length === 0) return null;
	// Trailing garbage means this isn't our block (or a comment broke
	// the shape): fall back to full text rather than half a list.
	if (body.slice(covered).trim() !== "") return null;
	return { text, refs };
}

/**
 * Strip every baked annotation from sent content, returning the bare
 * prompt text (or null when no clean block closes the content): the
 * sent-refs card's Clear-all. Refs-only content clears to "" — the
 * caller deletes that message instead of keeping an empty one.
 */
export function clearBakedAnnotations(content: string): string | null {
	const split = splitAnnotationBlock(content);
	if (!split) return null;
	return split.text;
}

/**
 * Baked annotation refs by exact message content, memoized: sent
 * messages render redacted (count pill instead of the full block), so
 * this runs per render and must never re-parse. Display-only — results
 * are never fed back into reactive effects.
 */
const refsCache = new Map<
	string,
	{ text: string; refs: AnnotationRef[] } | null
>();
export function annRefsFor(
	content: string
): { text: string; refs: AnnotationRef[] } | null {
	if (!content.includes("Annotated selections:")) return null;
	const hit = refsCache.get(content);
	if (hit !== undefined) return hit;
	const split = splitAnnotationBlock(content);
	if (refsCache.size > 200) refsCache.clear();
	refsCache.set(content, split);
	return split;
}

/**
 * Body shown for a message holding ONLY a baked annotation block: an
 * em-dash at normal text size, with the annotation count UI above it.
 * The stored content stays the full block (provider context is
 * unaffected) — only the display collapses to this.
 */
export const REFS_ONLY_BODY = "—";

/**
 * Display-copy text for a message body: the baked annotation block is
 * metadata, never prose, so message copy redacts it. A refs-only body
 * holds nothing else — copying an empty string would strand the
 * button, so it falls back to the quotes themselves (the message's
 * only substance). Pure and unit-tested.
 */
export function redactedCopyText(body: string): string {
	const split = annRefsFor(body);
	if (!split) return body;
	if (split.text.trim()) return split.text;
	return split.refs.map((ref) => ref.quote).join("\n");
}

/** Row-edit commit outcome: rebake, no-op, or gone. */
export type RefsEditCommit =
	| { kind: "rewrote"; content: string }
	| { kind: "untouched" }
	| { kind: "gone" };

/**
 * Row-edit commit decision: rebake the message with the one comment
 * swapped (see rewriteAnnotationComment) — history rewrites in place
 * with no resend. An unparseable block (or a missing message) reads
 * as gone; an untouched draft writes nothing. Toasts and the focus
 * park stay paged.
 */
export function commitRefsEdit(
	content: string | null,
	n: number,
	draft: string
): RefsEditCommit {
	if (content === null) return { kind: "gone" };
	const next = rewriteAnnotationComment(content, n, draft);
	if (next === null) return { kind: "gone" };
	if (next === content) return { kind: "untouched" };
	return { kind: "rewrote", content: next };
}

/** Sent-card Clear-all outcome. */
export type ClearSentRefsPlan =
	| { kind: "skip" }
	| { kind: "gone" }
	| { kind: "delete" }
	| { kind: "rewrote"; bare: string };

/**
 * Sent-card Clear-all decision: strip the baked block, keeping the
 * bare prompt (see clearBakedAnnotations). A refs-only message
 * clears to nothing — delete it instead of keeping an empty one.
 * Own messages only (baked blocks ride the outgoing prompt), so
 * anything else skips silently. Toasts and the pop close stay paged.
 */
export function planClearSentRefs(
	role: string,
	content: string
): ClearSentRefsPlan {
	if (role !== "user") return { kind: "skip" };
	const bare = clearBakedAnnotations(content);
	if (bare === null) return { kind: "gone" };
	if (bare.trim() === "") return { kind: "delete" };
	return { kind: "rewrote", bare };
}
