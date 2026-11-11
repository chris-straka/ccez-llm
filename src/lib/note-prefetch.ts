/**
 * Cards asked for before the note (owner, 2026-11-11: hovering a word
 * should start its card): a hovered word's answer runs in the background
 * and pressing A takes it over mid-flight, replaying what has already
 * landed (the dictionary card, the quick line) and following the rest.
 * Keyed by language, word and its paragraph, so A on the same word in the
 * same place finds it. Few at a time; old ones are given up.
 */
import type { AnnotationQuestion, AnnotationReply } from "./reading";

/** Hovered words kept running at once (the oldest is given up beyond). */
const KEEP = 12;
/** An answer nobody took within this long is dropped. */
const STALE_MS = 10 * 60 * 1000;

interface Entry {
	promise: Promise<AnnotationReply>;
	last: AnnotationReply | null;
	listeners: Set<(reply: AnnotationReply) => void>;
	controller: AbortController;
	at: number;
}

export function noteKey(
	q: Pick<AnnotationQuestion, "quote" | "context" | "lang">
): string {
	return `${(q.lang ?? "").split(/[-_]/)[0]?.toLowerCase()}|${q.quote.trim().toLocaleLowerCase()}|${q.context.trim()}`;
}

export class NotePrefetch {
	private entries = new Map<string, Entry>();

	constructor(private now: () => number = Date.now) {}

	/** Starts `run` for `key` unless it is already running or done. */
	start(
		key: string,
		run: (
			signal: AbortSignal,
			onPartial: (reply: AnnotationReply) => void
		) => Promise<AnnotationReply>
	): void {
		this.sweep();
		if (this.entries.has(key)) return;
		const controller = new AbortController();
		const listeners = new Set<(reply: AnnotationReply) => void>();
		const entry: Entry = {
			promise: Promise.resolve(null as never),
			last: null,
			listeners,
			controller,
			at: this.now()
		};
		entry.promise = run(controller.signal, (reply) => {
			entry.last = reply;
			for (const l of listeners) l(reply);
		});
		// A failed early ask is just forgotten; A asks again.
		entry.promise.catch(() => this.entries.delete(key));
		this.entries.set(key, entry);
		while (this.entries.size > KEEP) {
			const oldest = this.entries.keys().next().value!;
			this.entries.get(oldest)?.controller.abort();
			this.entries.delete(oldest);
		}
	}

	/** The answer for `key` if one was started: what has landed is replayed
	 * at once, the rest follows; null when nothing was asked early. */
	take(
		key: string,
		onPartial?: (reply: AnnotationReply) => void
	): Promise<AnnotationReply> | null {
		this.sweep();
		const entry = this.entries.get(key);
		if (!entry) return null;
		this.entries.delete(key);
		if (onPartial) {
			if (entry.last) onPartial(entry.last);
			entry.listeners.add(onPartial);
		}
		return entry.promise;
	}

	private sweep(): void {
		const now = this.now();
		for (const [key, entry] of this.entries)
			if (now - entry.at > STALE_MS) {
				entry.controller.abort();
				this.entries.delete(key);
			}
	}
}

/** Words of a fresh reply worth a card before anyone asks: those on the
 * learning list first, then long ones not known (alphabetic scripts; for
 * Chinese and Japanese only learning ones), at most `max`. */
export function wordsToPrefetch(
	text: string,
	lang: string,
	status: (word: string) => string | null | undefined,
	max = 4
): string[] {
	const cjk = /^(ja|zh|yue)/i.test(lang);
	const seen = new Set<string>();
	const learning: string[] = [];
	const long: string[] = [];
	const seg = new Intl.Segmenter(lang, { granularity: "word" });
	for (const { segment, isWordLike } of seg.segment(text)) {
		if (!isWordLike) continue;
		const key = segment.toLocaleLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		const st = status(segment);
		if (st === "known") continue;
		if (st === "learning") learning.push(segment);
		else if (!cjk && [...segment].length >= 7 && !/\d/.test(segment))
			long.push(segment);
	}
	return [...learning, ...long].slice(0, max);
}
