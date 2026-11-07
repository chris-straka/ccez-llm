/**
 * The owner's word list, shared by every app and device (ccez-words on
 * the Mac mini, on the tailnet): a starred word card is "learning"
 * there, as ccez-tube's 🌱 and ccez-lang's learning are (owner,
 * 2026-11-04). The statuses are kept here too, so the star shows at once
 * and survives a server out of reach; changes that couldn't be sent go
 * on the next try.
 */

export const WORDS_SERVER = "https://z.tailfe37c2.ts.net:8448";

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

	status(lang: string, word: string): WordStatus {
		return this.statuses[wordKey(lang, word)] ?? "new";
	}

	/** Learning, or back to new: the star. */
	async toggleLearning(lang: string, word: string): Promise<void> {
		const next: WordStatus =
			this.status(lang, word) === "learning" ? "new" : "learning";
		const key = wordKey(lang, word);
		this.statuses = { ...this.statuses, [key]: next };
		const [l, w] = [
			key.slice(0, key.indexOf(":")),
			key.slice(key.indexOf(":") + 1)
		];
		this.pending.push({
			lang: l,
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
