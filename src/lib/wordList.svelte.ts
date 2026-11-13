/**
 * The owner's word list, shared by every app and device (ccez-words on
 * the Mac mini, on the tailnet): a starred word card is "learning"
 * there, as ccez-tube's 🌱 and ccez-lang's learning are (owner,
 * 2026-11-04). The statuses are kept here too, so the star shows at once
 * and survives a server out of reach; changes that couldn't be sent go
 * on the next try.
 */

export const WORDS_SERVER = "https://z.tailfe37c2.ts.net:8448";

import type { ReviewCard } from "./weakSpots";

export type WordStatus = "known" | "learning" | "new";

interface Change {
	lang: string;
	word: string;
	status: WordStatus;
	at: number;
	from: string;
}

const KEY = "ccez-llm-word-list-v1";

/** "fr:fragiliser": a language's base code and the word, lowercased (the server folds case too). */
export function wordKey(lang: string, word: string): string {
	return `${(lang.split(/[-_]/)[0] ?? lang).toLowerCase()}:${word.trim().toLowerCase()}`;
}

interface Stored {
	statuses: Record<string, WordStatus>;
	pending: Change[];
	seq: number;
}

function read(): Stored {
	try {
		const raw = JSON.parse(
			localStorage.getItem(KEY) ?? "null"
		) as Partial<Stored> | null;
		return {
			statuses: raw?.statuses ?? {},
			pending: raw?.pending ?? [],
			seq: raw?.seq ?? 0
		};
	} catch {
		return { statuses: {}, pending: [], seq: 0 };
	}
}

const changeId = (c: Change) => `${c.lang}:${c.word}:${c.status}:${c.at}`;

/** How often an open app asks for other apps' changes. */
const WATCH_MS = 5 * 60_000;

export class WordList {
	statuses = $state<Record<string, WordStatus>>({});
	/** The review schedule's cards ("lang\tword" → card), for weak spots in replies (weakSpots.ts). */
	review: Record<string, ReviewCard> = {};
	private pending: Change[] = [];
	private seq = 0;

	constructor(
		private server = WORDS_SERVER,
		private send: typeof fetch = (...a) => fetch(...a)
	) {
		if (typeof localStorage === "undefined") return;
		// The browser tests' mock app never reaches the owner's real list:
		// only a stand-in they name (ccez-words-server).
		if (localStorage.getItem("ccez-mock-provider") === "1") {
			const stand = localStorage.getItem("ccez-words-server");
			if (stand) this.server = stand;
			else this.send = () => Promise.reject(new Error("no word list in tests"));
		}
		const s = read();
		this.statuses = s.statuses;
		this.pending = s.pending;
		this.seq = s.seq;
	}

	/**
	 * Headwords the server answered this session ("lang:word" → its
	 * headword, or null: nothing to save). Unanswered asks aren't kept:
	 * off the tailnet says nothing about the word.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a plain cache; `headsSeq` tells readers when it grows.
	private heads = new Map<string, string | null>();
	/** Bumped when a headword arrives, so a star drawn before it redraws. */
	private headsSeq = $state(0);
	/** Asks under way, and when a failed one may be tried again. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
	private asking = new Map<string, number>();

	/**
	 * A card is open on this word: its headword is asked for now, so its
	 * star shows the status of the form every app saves it under
	 * ("freinent" lit when "freiner" is Learning). Before, the headword
	 * was only asked on a tap, the star showed empty, and that tap then
	 * cleared the word in every app. Safe to call while rendering.
	 */
	want(lang: string, word: string): void {
		const key = wordKey(lang, word);
		if (this.heads.has(key) || (this.asking.get(key) ?? 0) > Date.now()) return;
		// Off the tailnet: asked again in a minute, not on every redraw.
		this.asking.set(key, Date.now() + 60_000);
		void this.headword(lang, word);
	}

	status(lang: string, word: string): WordStatus {
		void this.headsSeq;
		const head = this.heads.get(wordKey(lang, word));
		return (
			(head ? this.statuses[wordKey(lang, head)] : undefined) ??
			this.statuses[wordKey(lang, word)] ??
			"new"
		);
	}

	/**
	 * The form to save a word under, from the server (`GET /headword`,
	 * the one headword every app uses): its dictionary headword, null
	 * for nothing to save (a number, a name, a fragment), undefined
	 * when the server can't be reached — then the word goes as it is
	 * and the server maps it later.
	 */
	private async headword(
		lang: string,
		word: string
	): Promise<string | null | undefined> {
		const cache = wordKey(lang, word);
		if (this.heads.has(cache)) return this.heads.get(cache);
		try {
			const base = (lang.split(/[-_]/)[0] ?? lang).toLowerCase();
			const res = await this.send(
				`${this.server}/headword?lang=${base}&word=${encodeURIComponent(word.trim())}`,
				{ signal: AbortSignal.timeout(4_000) }
			);
			if (!res.ok) return undefined;
			const got = (await res.json()) as { headword?: unknown };
			if (!("headword" in got)) return undefined;
			const head =
				typeof got.headword === "string" && got.headword ? got.headword : null;
			this.heads.set(cache, head);
			this.headsSeq++;
			return head;
		} catch {
			return undefined;
		}
	}

	/** Learning, or back to new: the star. */
	async toggleLearning(lang: string, word: string): Promise<void> {
		// Saved under its headword, the same form in every app; a word
		// with none saves nothing (unstarring one kept from before the
		// move still works, by the form it was kept in).
		// The direction is what the star showed when it was tapped: a star
		// drawn empty before the headword was known must never clear the
		// word once the headword turns out to be Learning.
		const shown = this.status(lang, word);
		const asked = await this.headword(lang, word);
		if (asked === null && shown !== "learning") return;
		const w = asked ?? word.trim();
		const next: WordStatus = shown === "learning" ? "new" : "learning";
		const key = wordKey(lang, w);
		this.statuses = { ...this.statuses, [key]: next };
		this.pending.push({
			lang: key.slice(0, key.indexOf(":")),
			// As written, not lowercased here: a German noun keeps its
			// capital ("Wasser"); the server folds case for its key.
			word: w,
			status: next,
			at: Date.now(),
			from: "ccez-llm"
		});
		this.save();
		await this.sync();
	}

	/**
	 * Keeps the list current while the app stays open: a round every few
	 * minutes and whenever the window comes back into view, so a star
	 * added on the phone shows here without a restart. Returns the stop.
	 */
	watch(everyMs = WATCH_MS): () => void {
		void this.sync();
		const timer = setInterval(() => void this.sync(), everyMs);
		const back = () => {
			if (document.visibilityState === "visible") void this.sync();
		};
		document.addEventListener("visibilitychange", back);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", back);
		};
	}

	private syncing: Promise<void> = Promise.resolve();

	/**
	 * Sends what's waiting and takes in what other apps changed, one round
	 * at a time (two at once sent changes twice and dropped a quick
	 * unstar). Quiet when the server is out of reach.
	 */
	sync(): Promise<void> {
		this.syncing = this.syncing.then(() => this.round());
		return this.syncing;
	}

	private async round(): Promise<void> {
		// Another tab's stars still waiting (each tab saves the whole list,
		// so one tab's save dropped the other's): taken along. One sent
		// twice changes nothing on the server.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
		const seen = new Set(this.pending.map(changeId));
		for (const c of read().pending)
			if (!seen.has(changeId(c))) this.pending.push(c);
		try {
			if (this.pending.length) {
				const out = [...this.pending];
				const res = await this.send(`${this.server}/words`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(out),
					// One hung call held every later round behind it.
					signal: AbortSignal.timeout(15_000)
				});
				if (!res.ok) throw new Error(`words server answered ${res.status}`);
				this.pending = this.pending.slice(out.length);
			}
			const res = await this.send(`${this.server}/words?since=${this.seq}`, {
				signal: AbortSignal.timeout(15_000)
			});
			if (!res.ok) throw new Error(`words server answered ${res.status}`);
			const got = (await res.json()) as {
				words: Array<{ lang: string; word: string; status: WordStatus }>;
				seq: number;
			};
			if (got.words.length) {
				const next = { ...this.statuses };
				for (const c of got.words) next[wordKey(c.lang, c.word)] = c.status;
				// What's still waiting to go out wins over what came in.
				for (const p of this.pending) next[wordKey(p.lang, p.word)] = p.status;
				this.statuses = next;
			}
			this.seq = got.seq;
			// The review schedule, for what to practise in replies.
			const rev = await this.send(`${this.server}/review`, {
				signal: AbortSignal.timeout(15_000)
			});
			if (rev.ok)
				this.review =
					((await rev.json()) as { cards?: Record<string, ReviewCard> })
						.cards ?? {};
		} catch {
			// Off the tailnet: tried again next time.
		}
		this.save();
	}

	private save(): void {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					statuses: this.statuses,
					pending: this.pending,
					seq: this.seq
				} satisfies Stored)
			);
		} catch {
			// Storage full or blocked: the server still has it.
		}
	}
}
