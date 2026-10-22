// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	AnnotationDrafts,
	type AnnotationDraftsDeps
} from "./annotation-drafts.svelte";
import { type Annotation, type AnnotationId } from "./annotations";
import {
	loadDraftAnnotations,
	saveDraftAnnotations
} from "./annotation-drafts-store";
import type { ChatId, ChatMsgId } from "./chat";
import type { ChatProvider } from "./providers/types";
import type { AnnotationQuestion } from "./reading";

function note(over: Partial<Annotation> = {}): Annotation {
	return {
		id: "ann-1" as AnnotationId,
		messageId: "m1" as ChatMsgId,
		quote: "quote",
		comment: "",
		at: 0,
		...over
	};
}

const PROVIDER = {} as ChatProvider;

function harness(
	opts: {
		active?: string;
		chats?: string[];
		phone?: boolean;
		storyOpen?: boolean;
		provider?: ChatProvider | null;
		answer?: (q: AnnotationQuestion, signal: AbortSignal) => Promise<string>;
		followUp?: (reply: string) => Promise<string>;
	} = {}
): {
	drafts: AnnotationDrafts;
	calls: {
		answers: AnnotationQuestion[];
		banners: string[];
		cleared: number;
		errors: string[];
		badges: string[];
		followUps: {
			answer: string;
			thread: { q: string; a?: string }[];
			reply: string;
		}[];
	};
	setActive: (id: string) => void;
	setChats: (ids: string[]) => void;
} {
	const calls = {
		answers: [] as AnnotationQuestion[],
		banners: [] as string[],
		cleared: 0,
		errors: [] as string[],
		badges: [] as string[],
		followUps: [] as {
			answer: string;
			thread: { q: string; a?: string }[];
			reply: string;
		}[]
	};
	let active = (opts.active ?? "c1") as ChatId;
	let chats = (opts.chats ?? ["c1"]).map((c) => c as ChatId);
	const answer = opts.answer ?? (async () => "réponse");
	const deps: AnnotationDraftsDeps = {
		getActiveChatId: () => active,
		getChatIds: () => chats,
		resolveProvider: async () =>
			opts.provider === undefined ? PROVIDER : opts.provider,
		answerQuestion: (provider, q, signal) => {
			void provider;
			calls.answers.push(q);
			return answer(q, signal);
		},
		answerContextFor: () => "ctx",
		answerFollowUp: (provider, q, answer, thread, reply) => {
			void provider;
			calls.followUps.push({ answer, thread: [...thread], reply });
			return (opts.followUp ?? (async () => "suite"))(reply);
		},
		notifyBanner: (message) => {
			calls.banners.push(message);
		},
		clearBanner: () => {
			calls.cleared++;
		},
		toastError: (message) => {
			calls.errors.push(message);
		},
		isPhone: () => opts.phone ?? false,
		isNewsStoryOpen: () => opts.storyOpen ?? false,
		openBadge: (id) => {
			calls.badges.push(id);
		}
	};
	return {
		drafts: new AnnotationDrafts(deps),
		calls,
		setActive: (id) => {
			active = id as ChatId;
		},
		setChats: (ids) => {
			chats = ids.map((c) => c as ChatId);
		}
	};
}

beforeEach(() => {
	localStorage.clear();
});

describe("per-chat file and restore", () => {
	it("restores the active chat's drafts on launch", () => {
		saveDraftAnnotations("c1", [note({ comment: "why?" })], ["c1"]);
		const { drafts } = harness({ active: "c1" });
		expect(drafts.list).toHaveLength(1);
		expect(drafts.list[0]?.comment).toBe("why?");
	});

	it("switching chats files the leaving chat and restores the entering one", () => {
		saveDraftAnnotations(
			"c2",
			[note({ id: "b" as AnnotationId })],
			["c1", "c2"]
		);
		const { drafts, setActive } = harness({
			active: "c1",
			chats: ["c1", "c2"]
		});
		drafts.setList([note({ id: "a" as AnnotationId })]);
		drafts.fileChat("c1" as ChatId);
		setActive("c2");
		drafts.restoreChat("c2");
		expect(loadDraftAnnotations("c1").map((a) => a.id)).toEqual(["a"]);
		expect(drafts.list.map((a) => a.id)).toEqual(["b"]);
	});

	it("autosave writes the filed list, never mid-edit seeds", () => {
		const { drafts } = harness({ active: "c1" });
		drafts.setList([note({ id: "filed" as AnnotationId })]);
		drafts.beginOwnEdit("c1" as ChatId, [note({ id: "seed" as AnnotationId })]);
		drafts.autosave();
		expect(loadDraftAnnotations("c1").map((a) => a.id)).toEqual(["filed"]);
	});

	it("draftsFor reads live for the active chat, storage for the rest", () => {
		saveDraftAnnotations(
			"c2",
			[note({ id: "stored" as AnnotationId })],
			["c1", "c2"]
		);
		const { drafts } = harness({ active: "c1", chats: ["c1", "c2"] });
		const live = [note({ id: "live" as AnnotationId })];
		drafts.setList(live);
		// The live list, not a storage copy (deep-equal: $state proxies).
		expect(drafts.draftsFor("c1")).toStrictEqual(live);
		expect(drafts.draftsFor("c2").map((a) => a.id)).toEqual(["stored"]);
	});

	it("discarding the open chat prunes its stored drafts", () => {
		saveDraftAnnotations("c1", [note()], ["c1", "c2"]);
		const { drafts } = harness({ active: "c2", chats: ["c1", "c2"] });
		drafts.discardChat("c1" as ChatId, ["c2" as ChatId]);
		expect(loadDraftAnnotations("c1")).toEqual([]);
	});
});

describe("own-message edits", () => {
	it("ending the edit keeps the filed drafts and the live extras", () => {
		const { drafts } = harness({ active: "c1" });
		const filed = note({ id: "f" as AnnotationId, answer: "yes" });
		drafts.setList([filed]);
		const seeds = [note({ id: "s" as AnnotationId })];
		drafts.beginOwnEdit("c1" as ChatId, seeds);
		expect(drafts.list).toEqual(seeds);
		// A note filed mid-edit survives; seeds never do (they live
		// in the message).
		drafts.setList([...seeds, note({ id: "extra" as AnnotationId })]);
		drafts.endOwnEdit("c1" as ChatId);
		expect(drafts.list.map((a) => a.id)).toEqual(["f", "extra"]);
	});

	it("an edit opened in another chat keeps the live extras only", () => {
		const { drafts } = harness({ active: "c1" });
		drafts.setList([note({ id: "f" as AnnotationId })]);
		drafts.beginOwnEdit("c1" as ChatId, [note({ id: "s" as AnnotationId })]);
		drafts.setList([
			note({ id: "s" as AnnotationId }),
			note({ id: "x" as AnnotationId })
		]);
		drafts.endOwnEdit("c2" as ChatId);
		expect(drafts.list.map((a) => a.id)).toEqual(["x"]);
	});
});

describe("ask flow", () => {
	it("ask success attaches the answer and clears the banner", async () => {
		const { drafts, calls } = harness();
		const q = note({ comment: "why?" });
		drafts.setList([q]);
		await drafts.ask(q);
		expect(drafts.list[0]?.answer).toBe("réponse");
		expect(calls.cleared).toBe(1);
		expect(calls.banners).toEqual([]);
		expect(calls.answers).toEqual([
			{ quote: "quote", question: "why?", context: "ctx" }
		]);
	});

	it("ask failure banners, stays blue, and skips later resumes", async () => {
		const { drafts, calls } = harness({
			answer: async () => {
				throw new Error("boom");
			}
		});
		const q = note();
		drafts.setList([q]);
		await drafts.ask(q);
		expect(drafts.list[0]?.answer).toBeUndefined();
		expect(calls.banners).toEqual(["boom"]);
		expect(calls.answers).toHaveLength(1);
		drafts.resumeUnanswered();
		await vi.waitFor(() => expect(calls.answers).toHaveLength(1));
		await new Promise((r) => setTimeout(r, 10));
		expect(calls.answers).toHaveLength(1);
	});

	it("resume refires answerless drafts once, never answered ones", async () => {
		const { drafts, calls } = harness();
		drafts.setList([
			note({ id: "done" as AnnotationId, answer: "yes" }),
			note({ id: "b1" as AnnotationId }),
			note({ id: "b2" as AnnotationId })
		]);
		drafts.resumeUnanswered();
		// A second scan before anything settles doubles nothing.
		drafts.resumeUnanswered();
		await vi.waitFor(() => expect(calls.answers).toHaveLength(2));
		await new Promise((r) => setTimeout(r, 10));
		expect(calls.answers).toHaveLength(2);
		expect(drafts.list.find((a) => a.id === "b1")?.answer).toBe("réponse");
		expect(drafts.list.find((a) => a.id === "b2")?.answer).toBe("réponse");
	});

	it("an answer landing after a chat switch files into its own chat", async () => {
		let release: (() => void) | null = null;
		const { drafts, setActive, setChats } = harness({
			chats: ["c1", "c2"],
			answer: () =>
				new Promise<string>((resolve) => {
					release = () => resolve("late");
				})
		});
		setChats(["c1", "c2"]);
		const q = note();
		drafts.setList([q]);
		const asked = drafts.ask(q);
		await vi.waitFor(() => expect(release).not.toBeNull());
		// Leave for c2 the way the page does: file, switch, restore.
		drafts.fileChat("c1" as ChatId);
		setActive("c2");
		drafts.restoreChat("c2");
		expect(drafts.list).toEqual([]);
		release!();
		await asked;
		// c2's live list stays clean; c1's stored draft carries the answer.
		expect(drafts.list).toEqual([]);
		expect(loadDraftAnnotations("c1")[0]?.answer).toBe("late");
		setActive("c1");
		drafts.restoreChat("c1");
		expect(drafts.list[0]?.answer).toBe("late");
		// Nothing left to resume: the answer landed.
		drafts.resumeUnanswered();
		await new Promise((r) => setTimeout(r, 10));
		expect(drafts.list[0]?.answer).toBe("late");
	});

	it("a late answer for a dropped chat is discarded", async () => {
		let release: (() => void) | null = null;
		const { drafts, setActive, setChats } = harness({
			chats: ["c1", "c2"],
			answer: () =>
				new Promise<string>((resolve) => {
					release = () => resolve("late");
				})
		});
		const q = note();
		drafts.setList([q]);
		const asked = drafts.ask(q);
		await vi.waitFor(() => expect(release).not.toBeNull());
		setChats(["c2"]);
		drafts.discardChat("c1" as ChatId, ["c2" as ChatId]);
		setActive("c2");
		drafts.restoreChat("c2");
		release!();
		await asked;
		expect(loadDraftAnnotations("c1")).toEqual([]);
		expect(drafts.list).toEqual([]);
	});

	it("keyless resumes stay silent but explicit asks banner", async () => {
		const { drafts, calls } = harness({ provider: null });
		const q = note();
		drafts.setList([q]);
		drafts.resumeUnanswered();
		await new Promise((r) => setTimeout(r, 10));
		expect(calls.banners).toEqual([]);
		await drafts.ask(q);
		expect(calls.banners).toEqual(["Set an API key first — open Settings."]);
	});

	it("keyless explicit asks toast on phones", async () => {
		const { drafts, calls } = harness({ provider: null, phone: true });
		const q = note();
		drafts.setList([q]);
		await drafts.ask(q);
		expect(calls.errors).toEqual(["Set an API key first — open Settings."]);
	});

	it("a restart resumes last session's failures", async () => {
		saveDraftAnnotations("c1", [note({ id: "b" as AnnotationId })], ["c1"]);
		const first = harness({
			active: "c1",
			answer: async () => {
				throw new Error("boom");
			}
		});
		await first.drafts.ask(first.drafts.list[0] as Annotation);
		expect(first.calls.answers).toHaveLength(1);
		// Fresh sets after a restart: the failure refires.
		const second = harness({ active: "c1" });
		expect(second.drafts.list.map((a) => a.id)).toEqual(["b"]);
		second.drafts.resumeUnanswered();
		await vi.waitFor(() => expect(second.calls.answers).toHaveLength(1));
	});

	it("an answered story note opens while its story is open", async () => {
		const { drafts, calls } = harness({ storyOpen: true });
		const story: Annotation = {
			id: "ann-1" as AnnotationId,
			story: { link: "l", title: "t", outlet: "o", lang: "French" },
			quote: "quote",
			comment: "",
			at: 0
		};
		drafts.setList([story]);
		await drafts.ask(story);
		expect(drafts.list[0]?.answer).toBe("réponse");
		expect(calls.badges).toEqual(["ann-1"]);
	});

	it("a closed story attaches silently", async () => {
		const { drafts, calls } = harness({ storyOpen: false });
		const story: Annotation = {
			id: "ann-1" as AnnotationId,
			story: { link: "l", title: "t", outlet: "o", lang: "French" },
			quote: "quote",
			comment: "",
			at: 0
		};
		drafts.setList([story]);
		await drafts.ask(story);
		expect(drafts.list[0]?.answer).toBe("réponse");
		expect(calls.badges).toEqual([]);
	});
});

describe("filing", () => {
	it("filePending files the comment and asks once", async () => {
		const { drafts, calls } = harness();
		const id = drafts.filePending(note(), "why?");
		expect(id).toBe("ann-1");
		expect(drafts.list).toHaveLength(1);
		expect(drafts.list[0]?.comment).toBe("why?");
		await vi.waitFor(() => expect(calls.answers).toHaveLength(1));
	});

	it("filePending nulls out with nothing pending", () => {
		const { drafts, calls } = harness();
		expect(drafts.filePending(null, "why?")).toBeNull();
		expect(drafts.list).toEqual([]);
		expect(calls.answers).toEqual([]);
	});

	it("comment edits rewrite and re-ask; empties keep", async () => {
		const { drafts, calls } = harness();
		drafts.setList([note({ answer: "old" })]);
		expect(drafts.commitCommentEdit("ann-1", "new?")).toBe(true);
		expect(drafts.list[0]?.comment).toBe("new?");
		await vi.waitFor(() => expect(calls.answers).toHaveLength(1));
		expect(drafts.commitCommentEdit("ann-1", "  ")).toBe(false);
		expect(drafts.list[0]?.comment).toBe("new?");
		expect(drafts.commitCommentEdit("gone", "x")).toBe(false);
	});
});

describe("deleting", () => {
	it("deleteById drops one note", () => {
		const { drafts } = harness();
		drafts.setList([
			note({ id: "a" as AnnotationId }),
			note({ id: "b" as AnnotationId })
		]);
		drafts.deleteById("a");
		expect(drafts.list.map((a) => a.id)).toEqual(["b"]);
	});
});

describe("background interruptions", () => {
	/** A request the test settles by hand. */
	function deferred(): {
		answer: (q: AnnotationQuestion, signal: AbortSignal) => Promise<string>;
		settle: { resolve: (v: string) => void; reject: (e: Error) => void }[];
		signals: AbortSignal[];
	} {
		const settle: {
			resolve: (v: string) => void;
			reject: (e: Error) => void;
		}[] = [];
		const signals: AbortSignal[] = [];
		return {
			settle,
			signals,
			answer: (_q, signal) =>
				new Promise<string>((resolve, reject) => {
					settle.push({ resolve, reject });
					signals.push(signal);
					signal.addEventListener("abort", () => reject(new Error("aborted")));
				})
		};
	}

	it("a request cut while away re-asks on return, silently", async () => {
		const d = deferred();
		const { drafts, calls } = harness({ phone: true, answer: d.answer });
		const q = note({ comment: "why?" });
		drafts.setList([q]);
		const asked = drafts.ask(q);
		await vi.waitFor(() => expect(d.settle).toHaveLength(1));
		drafts.suspend();
		d.settle[0]?.reject(new Error("Muse Spark: network error"));
		await asked;
		expect(calls.banners).toEqual([]);
		expect(calls.errors).toEqual([]);
		expect(calls.answers).toHaveLength(1);
		drafts.resume();
		await vi.waitFor(() => expect(d.settle).toHaveLength(2));
		d.settle[1]?.resolve("réponse");
		await vi.waitFor(() => expect(drafts.list[0]?.answer).toBe("réponse"));
		expect(calls.errors).toEqual([]);
	});

	it("a failure landing just after return re-asks at once", async () => {
		const d = deferred();
		const { drafts, calls } = harness({ phone: true, answer: d.answer });
		const q = note();
		drafts.setList([q]);
		void drafts.ask(q);
		await vi.waitFor(() => expect(d.settle).toHaveLength(1));
		drafts.suspend();
		drafts.resume();
		d.settle[0]?.reject(new Error("Failed to fetch"));
		await vi.waitFor(() => expect(d.settle).toHaveLength(2));
		expect(calls.errors).toEqual([]);
	});

	it("a request hung across the trip restarts after the grace", async () => {
		vi.useFakeTimers();
		try {
			const d = deferred();
			const { drafts, calls } = harness({ answer: d.answer });
			const q = note();
			drafts.setList([q]);
			void drafts.ask(q);
			await vi.waitFor(() => expect(d.settle).toHaveLength(1));
			drafts.suspend();
			drafts.resume(1000);
			await vi.advanceTimersByTimeAsync(999);
			expect(d.signals[0]?.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			expect(d.signals[0]?.aborted).toBe(true);
			await vi.waitFor(() => expect(d.settle).toHaveLength(2));
			expect(calls.banners).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("a request that lands within the grace is kept", async () => {
		vi.useFakeTimers();
		try {
			const d = deferred();
			const { drafts } = harness({ answer: d.answer });
			const q = note();
			drafts.setList([q]);
			const asked = drafts.ask(q);
			await vi.waitFor(() => expect(d.settle).toHaveLength(1));
			drafts.suspend();
			drafts.resume(1000);
			d.settle[0]?.resolve("réponse");
			await asked;
			await vi.advanceTimersByTimeAsync(2000);
			expect(d.signals[0]?.aborted).toBe(false);
			expect(d.settle).toHaveLength(1);
			expect(drafts.list[0]?.answer).toBe("réponse");
		} finally {
			vi.useRealTimers();
		}
	});

	it("a note deleted while away is never re-asked", async () => {
		const d = deferred();
		const { drafts } = harness({ answer: d.answer });
		const q = note();
		drafts.setList([q]);
		const asked = drafts.ask(q);
		await vi.waitFor(() => expect(d.settle).toHaveLength(1));
		drafts.suspend();
		d.settle[0]?.reject(new Error("network error"));
		await asked;
		drafts.deleteById(q.id);
		drafts.resume();
		await new Promise((r) => setTimeout(r, 10));
		expect(d.settle).toHaveLength(1);
	});

	it("failures in the foreground still banner", async () => {
		const d = deferred();
		const { drafts, calls } = harness({ phone: true, answer: d.answer });
		const q = note();
		drafts.setList([q]);
		const asked = drafts.ask(q);
		await vi.waitFor(() => expect(d.settle).toHaveLength(1));
		d.settle[0]?.reject(new Error("boom"));
		await asked;
		expect(calls.errors).toEqual(["boom"]);
	});
});

describe("follow-up thread", () => {
	it("a reply joins the thread and its answer lands on it", async () => {
		const { drafts, calls } = harness();
		const q = note({ answer: "first" });
		drafts.setList([q]);
		const sent = drafts.askFollowUp(q.id, "  not quite?  ");
		expect(drafts.list[0]?.thread).toEqual([{ q: "not quite?" }]);
		expect(await sent).toBe(true);
		expect(drafts.list[0]?.thread).toEqual([{ q: "not quite?", a: "suite" }]);
		expect(calls.followUps[0]).toEqual({
			answer: "first",
			thread: [],
			reply: "not quite?"
		});
	});

	it("later replies carry the earlier turns", async () => {
		const { drafts, calls } = harness();
		const q = note({ answer: "first", thread: [{ q: "why?", a: "because" }] });
		drafts.setList([q]);
		await drafts.askFollowUp(q.id, "and then?");
		expect(calls.followUps[0]?.thread).toEqual([{ q: "why?", a: "because" }]);
		expect(drafts.list[0]?.thread).toHaveLength(2);
	});

	it("a failed reply leaves the thread and reports", async () => {
		const { drafts, calls } = harness({
			phone: true,
			followUp: async () => {
				throw new Error("boom");
			}
		});
		const q = note({ answer: "first" });
		drafts.setList([q]);
		expect(await drafts.askFollowUp(q.id, "hm")).toBe(false);
		expect(drafts.list[0]?.thread ?? []).toEqual([]);
		expect(calls.errors).toEqual(["boom"]);
	});

	it("unanswered notes and blank replies send nothing", async () => {
		const { drafts, calls } = harness();
		drafts.setList([note()]);
		expect(await drafts.askFollowUp("ann-1", "hm")).toBe(false);
		drafts.setList([note({ answer: "a" })]);
		expect(await drafts.askFollowUp("ann-1", "   ")).toBe(false);
		expect(calls.followUps).toEqual([]);
	});

	it("rewording the question drops the old thread", () => {
		const { drafts } = harness();
		drafts.setList([note({ answer: "a", thread: [{ q: "x", a: "y" }] })]);
		drafts.commitCommentEdit("ann-1", "new question");
		expect(drafts.list[0]?.thread).toBeUndefined();
	});
});
