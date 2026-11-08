/**
 * Phrases into the shared word list (ccez-words): a starred phrase
 * goes in as its dictionary form, the one a learner would look up
 * (owner, 2026-11-08: "s'est éloigné" is learned as "s'éloigner").
 * Single words already carry that form on their word card; a phrase's
 * answer is prose, so the model is asked once, on the first star.
 * Pure: the page sends the messages and keeps the form on the note.
 */
import { isWordQuote } from "./word-card";

/** At most this many words: past it the quote is a clause, not a phrase. */
const MAX_WORDS = 6;

/**
 * A quote the star can save as a phrase: two to six words with no
 * sentence punctuation inside (a single word goes through its card).
 */
export function isPhraseQuote(quote: string): boolean {
	const q = quote.trim();
	if (!q || q.length > 80 || isWordQuote(q)) return false;
	const inner = q.replace(/^\p{P}+|\p{P}+$/gu, "");
	if (/[.!?;:。！？；：]/u.test(inner)) return false;
	const words = inner.split(/\s+/u).filter(Boolean);
	return words.length >= 2 && words.length <= MAX_WORDS;
}

/** The ask for a phrase's dictionary form, in its sentence. */
export function phraseFormMessages(
	quote: string,
	context: string,
	langName: string
): Array<{ role: "system" | "user"; content: string }> {
	return [
		{
			role: "system",
			content:
				`You name the dictionary form of a ${langName} phrase, the form a learner saves to their word list: ` +
				"verbs in the infinitive with any reflexive pronoun kept (s'est éloigné → s'éloigner), " +
				"nouns in the singular with no article, fixed expressions as a dictionary lists them. " +
				"Reply with that form alone: no quotes, no translation, no other words."
		},
		{
			role: "user",
			content: `Sentence: ${context.trim().slice(0, 600)}\nPhrase: ${quote.trim()}`
		}
	];
}

/** The model's reply as a list form: its first line, quotes and
 * trailing stops off; the quote itself when the reply is unusable. */
export function cleanPhraseForm(reply: string, quote: string): string {
	const line = (reply.split("\n").find((l) => l.trim()) ?? "")
		.trim()
		.replace(/^[*_"'«»“”‘’\s]+|[*_"'«»“”‘’.\s]+$/gu, "")
		.trim();
	if (!line || line.length > 80 || line.split(/\s+/u).length > 8)
		return quote.trim();
	return line;
}
