/**
 * Search store: owns the search documents across reloads and runs
 * queries in a Worker, degrading to in-memory main-thread search where
 * Workers or IndexedDB are unavailable (jsdom, privacy modes).
 *
 * - Documents persist in IndexedDB (`chat-search-v1`, single-doc store)
 *   so the palette works before the first re-index settles.
 * - Queries run in `chatSearch.worker.ts`; when worker construction
 *   throws, `querySearch` runs inline on the same snapshot.
 */
import { querySearch, type SearchDoc, type SearchHit } from "./chatSearch";

const DB_NAME = "chat-search-v1";
const STORE_NAME = "docs";
const DOCS_KEY = "snapshot";

function idbAvailable(): boolean {
	try {
		return typeof indexedDB !== "undefined";
	} catch {
		return false;
	}
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		try {
			const request = indexedDB.open(DB_NAME, 1);
			request.onupgradeneeded = () => {
				request.result.createObjectStore(STORE_NAME);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () =>
				reject(request.error ?? new Error("IndexedDB open failed"));
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
		}
	});
}

async function loadPersistedDocs(): Promise<SearchDoc[] | null> {
	if (!idbAvailable()) return null;
	try {
		const db = await openDb();
		try {
			const docs = await new Promise<SearchDoc[] | null>((resolve, reject) => {
				try {
					const tx = db.transaction(STORE_NAME, "readonly");
					const get = tx.objectStore(STORE_NAME).get(DOCS_KEY);
					get.onsuccess = () =>
						resolve((get.result as SearchDoc[] | undefined) ?? null);
					get.onerror = () =>
						reject(get.error ?? new Error("IndexedDB read failed"));
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
			return docs;
		} finally {
			db.close();
		}
	} catch {
		return null;
	}
}

async function persistDocs(docs: SearchDoc[]): Promise<void> {
	if (!idbAvailable()) return;
	try {
		const db = await openDb();
		try {
			await new Promise<void>((resolve, reject) => {
				try {
					const tx = db.transaction(STORE_NAME, "readwrite");
					tx.objectStore(STORE_NAME).put(docs, DOCS_KEY);
					tx.oncomplete = () => resolve();
					tx.onerror = () =>
						reject(tx.error ?? new Error("IndexedDB write failed"));
				} catch (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		} finally {
			db.close();
		}
	} catch {
		// Persistence is best-effort: the in-memory snapshot still serves.
	}
}

interface PendingQuery {
	resolve: (hits: SearchHit[]) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class ChatSearchStore {
	private docs: SearchDoc[] = [];
	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<number, PendingQuery>();
	private workerFailed = false;

	/** Spawn the index worker; failures stay silent (in-memory fallback). */
	constructor(workerFactory?: () => Worker) {
		if (workerFactory) {
			try {
				this.attachWorker(workerFactory());
			} catch {
				this.workerFailed = true;
			}
		}
	}

	private attachWorker(worker: Worker): void {
		this.worker = worker;
		worker.onmessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: string;
				id?: number;
				hits?: SearchHit[];
			};
			if (!data || data.type !== "results" || typeof data.id !== "number")
				return;
			const entry = this.pending.get(data.id);
			if (!entry) return;
			this.pending.delete(data.id);
			clearTimeout(entry.timer);
			entry.resolve(data.hits ?? []);
		};
		worker.onerror = () => {
			this.dropWorker();
		};
		this.pushDocsToWorker();
	}

	private dropWorker(): void {
		this.workerFailed = true;
		try {
			this.worker?.terminate();
		} catch {
			// Already gone; the in-memory path takes over below.
		}
		this.worker = null;
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.resolve(querySearch(this.docs, ""));
		}
		this.pending.clear();
	}

	private pushDocsToWorker(): void {
		if (!this.worker) return;
		try {
			this.worker.postMessage({ type: "index", docs: this.docs });
		} catch {
			this.dropWorker();
		}
	}

	/** Replace the snapshot (and persist it); resolves after IDB settles. */
	async index(docs: SearchDoc[]): Promise<void> {
		this.docs = docs;
		this.pushDocsToWorker();
		await persistDocs(docs);
	}

	/** Restore the persisted snapshot, if any (null where IDB is missing). */
	async restore(): Promise<SearchDoc[] | null> {
		const docs = await loadPersistedDocs();
		if (docs) {
			this.docs = docs;
			this.pushDocsToWorker();
		}
		return docs;
	}

	snapshotSize(): number {
		return this.docs.length;
	}

	/** Ranked hits; falls back to main-thread search without a worker. */
	async query(query: string, limit = 30): Promise<SearchHit[]> {
		if (!this.worker || this.workerFailed)
			return querySearch(this.docs, query, limit);
		const id = this.nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				// Worker stall (suspended WebView): answer inline instead
				// of leaving the palette hanging.
				this.pending.delete(id);
				resolve(querySearch(this.docs, query, limit));
			}, 1500);
			this.pending.set(id, { resolve, timer });
			try {
				this.worker?.postMessage({ type: "query", id, query, limit });
			} catch {
				this.pending.delete(id);
				clearTimeout(timer);
				resolve(querySearch(this.docs, query, limit));
			}
		});
	}

	destroy(): void {
		for (const [, entry] of this.pending) {
			clearTimeout(entry.timer);
			entry.resolve([]);
		}
		this.pending.clear();
		try {
			this.worker?.terminate();
		} catch {
			// Already gone.
		}
		this.worker = null;
	}
}

/** Default worker factory (Vite `?worker` URL, app-rooted like furigana's). */
export function createSearchWorker(): Worker {
	return new Worker(new URL("./chatSearch.worker.ts", import.meta.url), {
		type: "module"
	});
}
