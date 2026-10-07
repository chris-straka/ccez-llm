import { describe, expect, it } from "vitest";
import { ChatSearchStore } from "./chatSearchStore";
import type { SearchDoc } from "./chatSearch";

const DOCS: SearchDoc[] = [
	{ chatId: "a", msgId: "m1", kind: "message", text: "alpha bravo" },
	{ chatId: "b", msgId: "m2", kind: "message", text: "charlie delta" }
];

describe("ChatSearchStore (in-memory fallback)", () => {
	it("indexes and queries without a worker or IndexedDB", async () => {
		const store = new ChatSearchStore();
		await store.index(DOCS);
		expect(store.snapshotSize()).toBe(2);
		const hits = await store.query("alpha");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.doc.msgId).toBe("m1");
		store.destroy();
	});

	it("restores null where IndexedDB is unavailable (node)", async () => {
		const store = new ChatSearchStore();
		await expect(store.restore()).resolves.toBeNull();
		store.destroy();
	});

	it("answers a query in flight when the worker dies", async () => {
		const worker = {
			onmessage: null as ((event: MessageEvent) => void) | null,
			onerror: null as (() => void) | null,
			postMessage(msg: { type: string }) {
				// The worker script fails to load once queried.
				if (msg.type === "query") setTimeout(() => worker.onerror?.());
			},
			terminate() {}
		};
		const store = new ChatSearchStore(() => worker as unknown as Worker);
		await store.index(DOCS);
		const hits = await store.query("delta");
		expect(hits.map((h) => h.doc.msgId)).toEqual(["m2"]);
		store.destroy();
	});

	it("falls back inline when the worker factory throws", async () => {
		const store = new ChatSearchStore(() => {
			throw new Error("no workers here");
		});
		await store.index(DOCS);
		const hits = await store.query("delta");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.doc.msgId).toBe("m2");
		store.destroy();
	});
});
