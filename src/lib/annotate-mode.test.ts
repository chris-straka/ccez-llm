// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
	AnnotateMode,
	type AnnotateModeDeps,
	type SelMenuState
} from "./annotate-mode.svelte";
import {
	filePendingAnnotation,
	type Annotation,
	type AnnotationId
} from "./annotations";
import type { ChatMsg, ChatMsgId } from "./chat";

/** Window stubs for the selection-touching seams (viewport dims ride
along for the placement legs; the jsdom document stays live). */
const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
	if (realWindow === undefined)
		delete (globalThis as { window?: unknown }).window;
	else (globalThis as { window?: unknown }).window = realWindow;
});

function stubWindow(selection: unknown): void {
	(globalThis as { window?: unknown }).window = {
		getSelection: () => selection,
		innerWidth: 1280,
		innerHeight: 800
	};
}

/** Stub deps with call counters; DOM legs run against jsdom. */
function harness(opts: { phone?: boolean; quoteOffers?: boolean } = {}): {
	mode: AnnotateMode;
	calls: {
		asks: string[];
		panels: number;
		toasts: string[];
		errors: string[];
		buzzes: number;
		pillDrops: (string | null | undefined)[];
		review: boolean[];
		filed: { pending: Annotation | null; draft: string }[];
		speak: { quote: string; key: string; keepMenu: boolean }[];
		promptEdits: string[];
		pills: { id: string; draft: string }[];
		readings: number;
		unstuck: number;
	};
	getAnnotations: () => Annotation[];
	setAnnotations: (next: Annotation[]) => void;
	getPending: () => Annotation | null;
	setPending: (next: Annotation | null) => void;
	setDraft: (next: string) => void;
	getHighlight: () => AnnotationId | null;
	setHighlight: (id: AnnotationId | null) => void;
} {
	const calls = {
		asks: [] as string[],
		panels: 0,
		toasts: [] as string[],
		errors: [] as string[],
		buzzes: 0,
		pillDrops: [] as (string | null | undefined)[],
		review: [] as boolean[],
		filed: [] as { pending: Annotation | null; draft: string }[],
		speak: [] as { quote: string; key: string; keepMenu: boolean }[],
		promptEdits: [] as string[],
		pills: [] as { id: string; draft: string }[],
		readings: 0,
		unstuck: 0
	};
	let annotations: Annotation[] = [];
	let pending: Annotation | null = null;
	let draft = "";
	let highlight: AnnotationId | null = null;
	const deps: AnnotateModeDeps = {
		getAnnotations: () => annotations,
		setAnnotations: (next) => {
			annotations = next;
		},
		getPending: () => pending,
		setPending: (next) => {
			pending = next;
		},
		getAnnDraft: () => draft,
		setAnnDraft: (next) => {
			draft = next;
		},
		// Mirrors the drafts controller core: file + ask, null when
		// nothing is pending.
		filePendingDraft: (next, text) => {
			calls.filed.push({ pending: next, draft: text });
			const filed = filePendingAnnotation(annotations, next, text);
			if (!filed) return null;
			annotations = filed;
			const id = next?.id ?? null;
			if (id) calls.asks.push(id);
			return id;
		},
		getHighlight: () => highlight,
		setHighlight: (id) => {
			highlight = id;
		},
		setReviewOpen: (open) => {
			calls.review.push(open);
		},
		getChatMessages: () => [] as ChatMsg[],
		getViewMessages: () => [] as ChatMsg[],
		getMessageContent: () => null,
		isAidPinned: () => false,
		getNews: () => null,
		getSettings: () => ({
			fontScale: 1,
			inspectEnabled: false,
			hapticsEnabled: false
		}),
		isPhone: () => opts.phone ?? false,
		isIOS: () => false,
		isPreviewing: () => false,
		getScrollBox: () => undefined,
		ensureSwapObserver: () => {},
		speak: (quote, key, keepMenu) => {
			calls.speak.push({ quote, key, keepMenu });
		},
		selSpeakKey: () => "sel",
		annSpeakKey: () => "ann",
		quoteOffers: () => opts.quoteOffers ?? false,
		readingsFor: () => {
			calls.readings++;
		},
		dismissSelPanels: () => {
			calls.panels++;
		},
		openCreatePill: (id, _x, _y, text) => {
			calls.pills.push({ id, draft: text });
		},
		cancelPillFor: () => false,
		dismissPill: (id) => {
			calls.pillDrops.push(id);
		},
		stopPillMic: () => {},
		popWidth: () => 300,
		hasPromptEdit: () => false,
		commitPromptEdit: () => {},
		editInPrompt: (comment) => {
			calls.promptEdits.push(comment);
		},
		scrollRectIntoClear: () => {},
		flashJumpMark: () => {},
		unstick: () => {
			calls.unstuck++;
		},
		toast: (message) => {
			calls.toasts.push(message);
		},
		toastError: (message) => {
			calls.errors.push(message);
		},
		buzzDelete: () => {
			calls.buzzes++;
		}
	};
	return {
		mode: new AnnotateMode(deps),
		calls,
		getAnnotations: () => annotations,
		setAnnotations: (next) => {
			annotations = next;
		},
		getPending: () => pending,
		setPending: (next) => {
			pending = next;
		},
		setDraft: (next) => {
			draft = next;
		},
		getHighlight: () => highlight,
		setHighlight: (id) => {
			highlight = id;
		}
	};
}

function note(over: Partial<Annotation> = {}): Annotation {
	return {
		id: "ann-1" as AnnotationId,
		quote: "quote",
		comment: "",
		at: 0,
		...over
	};
}

describe("commitPending", () => {
	it("files the draft, clears, and asks once", () => {
		stubWindow({ removeAllRanges: () => {} });
		const { mode, calls, setPending, setDraft } = harness();
		setPending(note());
		setDraft("why?");
		mode.commitPending();
		expect(calls.asks).toEqual(["ann-1"]);
		expect(calls.panels).toBe(1);
		// Second commit files nothing: the pending is gone.
		mode.commitPending();
		expect(calls.asks).toEqual(["ann-1"]);
	});

	it("no-ops without a pending annotation", () => {
		const { mode, calls } = harness();
		mode.commitPending();
		expect(calls.asks).toEqual([]);
		expect(calls.panels).toBe(0);
	});
});

describe("badge actions", () => {
	it("pins answered notes, never blue ones", () => {
		const { mode, calls, getAnnotations, setAnnotations } = harness();
		setAnnotations([
			note({ id: "a" as AnnotationId, answer: "yes" }),
			note({ id: "b" as AnnotationId })
		]);
		mode.pinAnnotation("a" as AnnotationId);
		mode.pinAnnotation("b" as AnnotationId);
		mode.pinAnnotation("gone" as AnnotationId);
		expect(getAnnotations().find((a) => a.id === "a")?.pinnedToPrompt).toBe(true);
		expect(getAnnotations().find((a) => a.id === "b")?.pinnedToPrompt).not.toBe(true);
		expect(calls.errors).toEqual(["Annotation no longer exists"]);
	});

	it("unpins without deleting", () => {
		const { mode, getAnnotations, setAnnotations } = harness();
		setAnnotations([
			note({ id: "a" as AnnotationId, answer: "yes", pinnedToPrompt: true })
		]);
		mode.unpinAnnotation("a" as AnnotationId);
		const kept = getAnnotations().find((a) => a.id === "a");
		expect(kept).toBeDefined();
		expect(kept?.pinnedToPrompt).not.toBe(true);
	});

	it("removes with a thump, clears the wash, drops the pill", () => {
		const { mode, calls, setAnnotations, setHighlight } = harness();
		setAnnotations([note()]);
		setHighlight("ann-1" as AnnotationId);
		mode.removeAnnotation("ann-1");
		expect(calls.buzzes).toBe(1);
		expect(calls.pillDrops).toEqual(["ann-1"]);
	});
});

describe("openBadgeClick", () => {
	it("stands down for the press's own trailing click", () => {
		const { mode, calls } = harness();
		mode.lastBadgePress = {
			id: "ann-1" as AnnotationId,
			at: Date.now(),
			seq: 1
		};
		mode.openBadgeClick("ann-1" as AnnotationId, { x: 1, y: 2 });
		expect(mode.answerPop).toBeNull();
		expect(calls.toasts).toEqual([]);
		expect(calls.review).toEqual([]);
	});
});

describe("reviewQuoteClick", () => {
	it("ignores drag-selects ending on the quote", () => {
		stubWindow({ isCollapsed: false });
		const { mode, calls } = harness();
		mode.reviewQuoteClick({ id: "ann-1" as AnnotationId });
		expect(calls.review).toEqual([]);
	});
});

describe("clearSelection", () => {
	it("stamps the programmatic clear", () => {
		let cleared = 0;
		stubWindow({ removeAllRanges: () => cleared++ });
		const { mode } = harness();
		const before = mode.lastProgrammaticClearAt;
		mode.clearSelection();
		expect(cleared).toBe(1);
		expect(mode.lastProgrammaticClearAt).toBeGreaterThanOrEqual(before);
	});
});

function menu(over: Partial<SelMenuState> = {}): SelMenuState {
	return {
		x: 10,
		y: 20,
		left: 0,
		w: 60,
		hlTop: 0,
		hlBottom: 14,
		quote: "Bonjour",
		context: "Bonjour le monde",
		messageId: "m1" as ChatMsgId,
		range: null,
		...over
	};
}

describe("annotate", () => {
	it("phones file the comment in the composer", () => {
		const { mode, calls, getPending, getHighlight } = harness({ phone: true });
		mode.selMenu = menu();
		mode.annotate("why?");
		const pending = getPending();
		expect(pending?.quote).toBe("Bonjour");
		expect(pending?.at).toBe(0);
		expect(pending?.comment).toBe("");
		expect(calls.speak).toEqual([{ quote: "Bonjour", key: "sel", keepMenu: true }]);
		expect(mode.selMenu).toBeNull();
		expect(getHighlight()).toBe(pending?.id);
		expect(calls.promptEdits).toEqual(["why?"]);
		expect(calls.pills).toEqual([]);
	});

	it("desktop opens the create pill under the highlight", () => {
		const { mode, calls, getPending, getHighlight } = harness();
		mode.selMenu = menu();
		mode.annotate("why?");
		const pending = getPending();
		expect(pending?.quote).toBe("Bonjour");
		expect(mode.selMenu).toBeNull();
		expect(getHighlight()).toBe(pending?.id);
		expect(calls.pills).toEqual([{ id: pending?.id, draft: "why?" }]);
		expect(calls.promptEdits).toEqual([]);
	});

	it("instant files at once and asks", () => {
		const { mode, calls, getAnnotations, getPending } = harness();
		mode.selMenu = menu();
		mode.annotate("note", true);
		const filed = getAnnotations();
		expect(filed).toHaveLength(1);
		expect(filed[0]?.comment).toBe("note");
		expect(calls.asks).toEqual([filed[0]?.id]);
		expect(getPending()).toBeNull();
		expect(calls.panels).toBe(1);
	});

	it("starting over submits the composed draft first", () => {
		const { mode, calls, getPending, setPending, setDraft } = harness({
			phone: true
		});
		const old = note({ id: "old" as AnnotationId, quote: "Hola" });
		setPending(old);
		setDraft("old?");
		mode.selMenu = menu();
		mode.annotate("new?");
		// First filing is the old draft (its own comment), then the
		// new quote becomes pending.
		expect(calls.filed[0]).toEqual({ pending: old, draft: "old?" });
		expect(calls.asks[0]).toBe("old");
		expect(getPending()?.quote).toBe("Bonjour");
	});

	it("re-annotating a span replaces it and opens fresh", () => {
		const { mode, calls, getAnnotations, getPending, setAnnotations, setHighlight } =
			harness({ phone: true });
		const dupe = note({
			id: "dupe" as AnnotationId,
			messageId: "m1" as ChatMsgId,
			quote: "Bonjour",
			at: 0
		});
		setAnnotations([dupe]);
		setHighlight("dupe" as AnnotationId);
		mode.answerPop = { id: "dupe" as AnnotationId, anchor: { left: 0, top: 0, right: 1, bottom: 1 }, clearTop: 0, pointX: 0, w: 300, gap: 3 };
		mode.answerTimer = setTimeout(() => {}, 10_000);
		mode.selMenu = menu();
		mode.annotate();
		expect(getAnnotations()).toEqual([]);
		expect(getPending()?.quote).toBe("Bonjour");
		expect(mode.answerPop).toBeNull();
		expect(mode.answerTimer).toBeNull();
		expect(calls.promptEdits).toEqual([""]);
	});

	it("a blank quote just clears", () => {
		const { mode, getPending } = harness();
		mode.selMenu = menu({ quote: "   " });
		mode.annotate();
		expect(mode.selMenu).toBeNull();
		expect(getPending()).toBeNull();
	});

	it("Han quotes earn readings instead of clearing", () => {
		const { mode, calls } = harness({ phone: true, quoteOffers: true });
		mode.selMenu = menu({ messageId: "m1" as ChatMsgId });
		mode.annotate();
		expect(calls.readings).toBe(1);
	});
});

describe("openBadge", () => {
	it("a ready answer opens its own card and reads back", () => {
		const { mode, calls, setAnnotations, getHighlight } = harness();
		setAnnotations([
			note({ messageId: "m1" as ChatMsgId, answer: "it means hello" })
		]);
		mode.openBadge("ann-1" as AnnotationId, { x: 100, y: 100 });
		expect(mode.answerPop?.id).toBe("ann-1");
		expect(getHighlight()).toBe("ann-1");
		expect(calls.speak).toEqual([{ quote: "quote", key: "ann", keepMenu: false }]);
		expect(calls.review).toEqual([]);
		expect(calls.unstuck).toBe(1);
	});

	it("re-pressing an open card toggles its prompt pin", () => {
		const { mode, calls, getAnnotations, setAnnotations } = harness();
		setAnnotations([note({ answer: "yes", pinnedToPrompt: true })]);
		mode.answerPop = { id: "ann-1" as AnnotationId, anchor: { left: 0, top: 0, right: 1, bottom: 1 }, clearTop: 0, pointX: 0, w: 300, gap: 3 };
		mode.openBadge("ann-1" as AnnotationId);
		expect(getAnnotations()[0]?.pinnedToPrompt).not.toBe(true);
		expect(mode.answerPop?.id).toBe("ann-1");
		mode.openBadge("ann-1" as AnnotationId);
		expect(getAnnotations()[0]?.pinnedToPrompt).toBe(true);
		// Toggling never re-reads or re-opens.
		expect(calls.speak).toEqual([]);
		expect(calls.review).toEqual([]);
	});

	it("no answer yet opens the review dock on the row", () => {
		const { mode, calls, getHighlight, setAnnotations } = harness();
		setAnnotations([note()]);
		mode.openBadge("ann-1" as AnnotationId, { x: 5, y: 5 });
		expect(mode.answerPop).toBeNull();
		expect(calls.review).toEqual([true]);
		expect(getHighlight()).toBe("ann-1");
		expect(calls.speak).toEqual([{ quote: "quote", key: "ann", keepMenu: false }]);
	});

	it("android toasts Loading on a blue badge", () => {
		const { mode, calls, setAnnotations } = harness({ phone: true });
		setAnnotations([note()]);
		mode.openBadge("ann-1" as AnnotationId, { x: 5, y: 5 });
		expect(calls.toasts).toEqual(["Loading"]);
		expect(calls.review).toEqual([]);
		expect(mode.answerPop).toBeNull();
	});

	it("a missing note opens nothing", () => {
		const { mode, calls } = harness();
		mode.openBadge("gone" as AnnotationId, { x: 5, y: 5 });
		expect(mode.answerPop).toBeNull();
		expect(calls.review).toEqual([]);
		expect(calls.speak).toEqual([]);
	});
});
