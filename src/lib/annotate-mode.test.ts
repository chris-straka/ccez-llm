import { describe, it, expect, afterEach } from "vitest";
import { AnnotateMode, type AnnotateModeDeps } from "./annotate-mode.svelte";
import type { Annotation, AnnotationId } from "./annotations";
import type { ChatMsg } from "./chat";

/** Window stubs for the selection-touching seams (node has none). */
const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
	if (realWindow === undefined)
		delete (globalThis as { window?: unknown }).window;
	else (globalThis as { window?: unknown }).window = realWindow;
});

function stubWindow(selection: unknown): void {
	(globalThis as { window?: unknown }).window = {
		getSelection: () => selection
	};
}

/** Stub deps with call counters; DOM legs never run in these tests. */
function harness(): {
	mode: AnnotateMode;
	calls: {
		asks: string[];
		panels: number;
		toasts: string[];
		errors: string[];
		buzzes: number;
		pillDrops: (string | null | undefined)[];
		review: boolean[];
	};
	getAnnotations: () => Annotation[];
	setAnnotations: (next: Annotation[]) => void;
	setPending: (next: Annotation | null) => void;
	setDraft: (next: string) => void;
	setHighlight: (id: AnnotationId | null) => void;
} {
	const calls = {
		asks: [] as string[],
		panels: 0,
		toasts: [] as string[],
		errors: [] as string[],
		buzzes: 0,
		pillDrops: [] as (string | null | undefined)[],
		review: [] as boolean[]
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
		isPhone: () => false,
		isIOS: () => false,
		isPreviewing: () => false,
		getScrollBox: () => undefined,
		ensureSwapObserver: () => {},
		speak: () => {},
		selSpeakKey: () => "",
		annSpeakKey: () => "",
		quoteOffers: () => false,
		readingsFor: () => {},
		dismissSelPanels: () => {
			calls.panels++;
		},
		openCreatePill: () => {},
		cancelPillFor: () => false,
		dismissPill: (id) => {
			calls.pillDrops.push(id);
		},
		stopPillMic: () => {},
		refitAnswerCard: () => {},
		popWidth: () => 300,
		hasPromptEdit: () => false,
		commitPromptEdit: () => {},
		editInPrompt: () => {},
		requestAsk: (id) => {
			calls.asks.push(id);
		},
		scrollRectIntoClear: () => {},
		flashJumpMark: () => {},
		unstick: () => {},
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
		setPending: (next) => {
			pending = next;
		},
		setDraft: (next) => {
			draft = next;
		},
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
