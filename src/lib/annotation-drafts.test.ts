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
		answer?: (q: AnnotationQuestion) => Promise<string>;
	} = {}
): {
	drafts: AnnotationDrafts;
	calls: {
		answers: AnnotationQuestion[];
		banners: string[];
		cleared: number;
		errors: string[];
		badges: string[];
	};
	setActive: (id: string) => void;
	setChats: (ids: string[]) => void;
} {
	const calls = {
		answers: [] as AnnotationQuestion[],
		banners: [] as string[],
		cleared: 0,
		errors: [] as string[],
		badges: [] as string[]
	};
	let active = (opts.active ?? "c1") as ChatId;
	let chats = (opts.chats ?? ["c1"]).map((c) => c as ChatId);
	const answer = opts.answer ?? (async () => "réponse");
	const deps: AnnotationDraftsDeps = {
		getActiveChatId: () => active,
		getChatIds: () => chats,
		resolveProvider: async () =>
			opts.provider === undefined ? PROVIDER : opts.provider,
		answerQuestion: (provider, q) => {
			void provider;
			calls.answers.push(q);
			return answer(q);
		},
		answerContextFor: () => "ctx",
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
	it("saving keeps the filed drafts and drops baked pins", () => {
		const { drafts } = harness({ active: "c1" });
		const filed = note({ id: "f" as AnnotationId, answer: "yes" });
		drafts.setList([filed]);
		const seeds = [note({ id: "s" as AnnotationId, pinnedToPrompt: true })];
		drafts.beginOwnEdit("c1" as ChatId, seeds);
		expect(drafts.list).toEqual(seeds);
		// A note filed mid-edit (unpinned) survives the save; seeds
		// never do, and saved pins baked into the message.
		drafts.setList([...seeds, note({ id: "extra" as AnnotationId })]);
		drafts.endOwnEdit("c1" as ChatId, true);
		expect(drafts.list.map((a) => a.id)).toEqual(["f", "extra"]);
	});

	it("cancelling keeps the filed drafts and the live extras", () => {
		const { drafts } = harness({ active: "c1" });
		drafts.setList([note({ id: "f" as AnnotationId })]);
		const seeds = [note({ id: "s" as AnnotationId, pinnedToPrompt: true })];
		drafts.beginOwnEdit("c1" as ChatId, seeds);
		drafts.endOwnEdit("c1" as ChatId, false);
		// Saved=false keeps pinned extras (nothing baked).
		expect(drafts.list.map((a) => a.id)).toEqual(["f"]);
	});

	it("an edit opened in another chat keeps the live extras only", () => {
		const { drafts } = harness({ active: "c1" });
		drafts.setList([note({ id: "f" as AnnotationId })]);
		drafts.beginOwnEdit("c1" as ChatId, [note({ id: "s" as AnnotationId })]);
		drafts.setList([
			note({ id: "s" as AnnotationId }),
			note({ id: "x" as AnnotationId })
		]);
		drafts.endOwnEdit("c2" as ChatId, true);
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

	it("an answered story note pins and opens while its story is open", async () => {
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
		expect(drafts.list[0]?.pinnedToPrompt).toBe(true);
		expect(calls.badges).toEqual(["ann-1"]);
	});

	it("a closed story pins silently", async () => {
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
		expect(drafts.list[0]?.pinnedToPrompt).toBe(true);
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

	it("a bare-A filing asks for the brief gloss", async () => {
		const { drafts, calls } = harness();
		drafts.filePending({ ...note(), brief: true }, "");
		await vi.waitFor(() => expect(calls.answers).toHaveLength(1));
		expect(calls.answers[0]?.brief).toBe(true);
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

describe("pins and send", () => {
	it("pin then send bakes the pin and unpins", () => {
		const { drafts } = harness();
		drafts.setList([
			note({ id: "p" as AnnotationId, answer: "yes", pinnedToPrompt: true }),
			note({ id: "u" as AnnotationId, answer: "yes" })
		]);
		const included = drafts.consumePromptPins();
		expect(included.map((a) => a.id)).toEqual(["p"]);
		// Badges survive; only pins consume.
		expect(drafts.list).toHaveLength(2);
		expect(drafts.list.every((a) => a.pinnedToPrompt !== true)).toBe(true);
	});

	it("clear-all drops pins, keeps unpinned badges", () => {
		const { drafts } = harness();
		drafts.setList([
			note({ id: "p" as AnnotationId, pinnedToPrompt: true }),
			note({ id: "u" as AnnotationId })
		]);
		drafts.clearPromptPins();
		expect(drafts.list.map((a) => a.id)).toEqual(["u"]);
	});

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
