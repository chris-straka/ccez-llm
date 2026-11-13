/**
 * Weak spots in replies (owner, 2026-11-13: "it finds what I suck at from
 * other apps and then repeats what I suck at"). In a chat in a language
 * he's learning, the model is asked to use two or three of his due
 * Learning items in that language: the ones he has missed most first
 * (lapses on their review cards, from taps while watching, Again on
 * screen words), then the overdue, then the never reviewed. The cards and
 * statuses are the word list's (wordList.svelte.ts), shared with every
 * app through ccez-words. Pure, apart from the one source the page sets.
 */

import { identifyLangOffline, identifyLangShort } from "./langId";

/** A review card as ccez-words keeps it (seconds). */
export interface ReviewCard {
	due?: number;
	lapses?: number;
	state?: number;
}

export interface WordSource {
	statuses: Record<string, string>;
	review: Record<string, ReviewCard>;
}

let source: (() => WordSource) | null = null;

/** The page's word list, read when a reply is asked for. */
export function useWordSource(read: () => WordSource): void {
	source = read;
}

const base = (lang: string) => (lang.split(/[-_]/)[0] ?? lang).toLowerCase();

/** Up to `n` of the Learning words in `lang` most worth practising now. */
export function dueItems(
	lang: string,
	statuses: Record<string, string>,
	review: Record<string, ReviewCard>,
	nowSec: number,
	n = 3
): string[] {
	const b = base(lang);
	const cards = new Map(
		Object.entries(review).map(([k, v]) => [k.toLowerCase(), v])
	);
	const items = Object.entries(statuses)
		.filter(([k, st]) => st === "learning" && k.startsWith(`${b}:`))
		.map(([k]) => k.slice(b.length + 1))
		// A saved line isn't a word to weave in.
		.filter((w) => w && !w.startsWith("line:") && w.length <= 40)
		.map((w) => ({ w, card: cards.get(`${b}\t${w}`.toLowerCase()) }))
		.filter(({ card }) => !card || (card.due ?? 0) <= nowSec);
	items.sort(
		(x, y) =>
			(y.card?.lapses ?? 0) - (x.card?.lapses ?? 0) ||
			// Reviewed and overdue before never reviewed.
			Number(!!y.card) - Number(!!x.card) ||
			(x.card?.due ?? 0) - (y.card?.due ?? 0)
	);
	return items.slice(0, n).map(({ w }) => w);
}

/** The note to the model: the items, used naturally, never pointed out. */
export function practiceNote(lang: string, items: string[]): string {
	if (!items.length) return "";
	let name = base(lang);
	try {
		name = new Intl.DisplayNames(["en"], { type: "language" }).of(name) ?? name;
	} catch {
		// An unknown code stays as it is.
	}
	return (
		`The user is learning ${name}. Where it fits naturally, use these ${name} words or expressions in your reply, in whatever form the sentence needs: ${items.join(", ")}. ` +
		`Don't point them out, list them or explain them unless asked.`
	);
}

/** The language a chat is practising: its latest user message's, when it can be told. */
export function chatLanguage(text: string): string | null {
	const t = text.trim();
	if (!t) return null;
	return identifyLangOffline(t) ?? identifyLangShort(t);
}

/** The practice note for a chat whose latest user message is `lastUser`, or "". */
export function practiceFor(
	lastUser: string,
	nowSec = Date.now() / 1000
): string {
	if (!source) return "";
	const lang = chatLanguage(lastUser);
	if (!lang || base(lang) === "en") return "";
	const { statuses, review } = source();
	return practiceNote(lang, dueItems(lang, statuses, review, nowSec));
}
