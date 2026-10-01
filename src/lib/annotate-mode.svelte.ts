import { tick } from "svelte";
import {
	duplicateAnnotationId,
	deleteAnnotation,
	canPinAnnotation,
	setPromptPinned,
	locateQuote,
	newAnnotationId,
	occurrenceAtPosition,
	paragraphForQuote,
	selMenuPlacement,
	type Annotation,
	type AnnotationId,
	type StoryAnchor
} from "./annotations";
import { selMenuWidthEstimate } from "./selSlices";
import { messageIndexFromId, type ChatMsg, type ChatMsgId } from "./chat";
import {
	equationBodyOf,
	equationBodyRange,
	quoteFragmentText,
	quoteRange,
	quoteTextNodes
} from "./annotations-stamp";
import { placeAnnAnswer, placeAnnCard, placeAnnComposer } from "./annPop";
import { aidDisplayText } from "./reading";
import { vibrateTick } from "./studyMedia";
import type { NewsPanelState } from "./news";

/** Floating Annotate menu state (cursor-anchored, viewport-fixed). */
export interface SelMenuState {
	x: number;
	y: number;
	/** Highlight rect (viewport px): centers the create box when narrow. */
	left: number;
	w: number;
	/** Highlight vertical span: the create box hangs below it with
	an em-scaled gap, never covering the word. */
	hlTop: number;
	hlBottom: number;
	quote: string;
	/** Containing paragraph text: the single-char guess reads it for kana. */
	context: string;
	/** Owning message, null for headline picks (the story owns those). */
	messageId: ChatMsgId | null;
	/** News story owning a headline pick. */
	story?: StoryAnchor;
	/** Live range at summon time: menu hover puts the highlight
	back when WebKit empties it (no DOM change, so still valid). */
	range: Range | null;
}

/** Open answer card (the remodel): an answered note read in context. */
export interface AnswerPopState {
	id: AnnotationId;
	x: number;
	y: number;
	w: number;
}

/** Page-owned collaborators the annotate cluster calls back into. */
export interface AnnotateModeDeps {
	getAnnotations: () => Annotation[];
	setAnnotations: (next: Annotation[]) => void;
	getPending: () => Annotation | null;
	setPending: (next: Annotation | null) => void;
	getAnnDraft: () => string;
	setAnnDraft: (next: string) => void;
	/** File a pending annotation + ask it (the drafts controller's
	merged filing core): returns the filed id, null when nothing
	was pending. */
	filePendingDraft: (
		pending: Annotation | null,
		draft: string
	) => AnnotationId | null;
	getHighlight: () => AnnotationId | null;
	setHighlight: (id: AnnotationId | null) => void;
	setReviewOpen: (open: boolean) => void;
	getChatMessages: () => ChatMsg[];
	getViewMessages: () => ChatMsg[];
	/** Stored content for an id, or null when gone (never throws). */
	getMessageContent: (id: ChatMsgId) => string | null;
	isAidPinned: (messageId: ChatMsgId) => boolean;
	getNews: () => NewsPanelState | null;
	getSettings: () => {
		fontScale: number;
		inspectEnabled: boolean;
		hapticsEnabled: boolean;
	};
	isPhone: () => boolean;
	isIOS: () => boolean;
	isPreviewing: () => boolean;
	getScrollBox: () => HTMLElement | undefined;
	ensureSwapObserver: () => void;
	/** Fire-and-forget quote readback (page wraps speakQuote). */
	speak: (quote: string, key: string, keepMenu: boolean, context: string) => void;
	selSpeakKey: (sel: {
		messageId: ChatMsgId | null;
		story?: StoryAnchor;
	}) => string;
	annSpeakKey: (ann: Pick<Annotation, "messageId" | "story">) => string;
	quoteOffers: (quoted: {
		quote: string;
		messageId: ChatMsgId;
		context: string;
	}) => boolean;
	readingsFor: (
		quoted: {
			quote: string;
			messageId: ChatMsgId;
			context: string;
			at?: number;
		},
		pin: boolean
	) => void;
	dismissSelPanels: () => void;
	/** Desktop create pill open (draft seed, focus, haptic inside). */
	openCreatePill: (id: AnnotationId, x: number, y: number, draft: string) => void;
	/** Cancel the pill when it addresses id; true when it did. */
	cancelPillFor: (id: string) => boolean;
	/** Drop the pill: only id when given, any open pill otherwise. */
	dismissPill: (id?: string | null) => void;
	stopPillMic: () => void;
	refitAnswerCard: (id: string) => void;
	popWidth: () => number;
	hasPromptEdit: () => boolean;
	commitPromptEdit: () => void;
	editInPrompt: (comment: string) => void;
	scrollRectIntoClear: (rect: DOMRect) => void;
	flashJumpMark: (locate: () => Range | null) => void;
	/** Unpin the stream follow (selections/cards read still). */
	unstick: () => void;
	toast: (message: string) => void;
	toastError: (message: string) => void;
	buzzDelete: () => void;
}

/**
 * Annotation orchestration (selection menu, create/commit, badge
 * cards, review jumps, quote helpers). Moved out of +page.svelte
 * verbatim (STAGE 1); the page wires the deps. Message CRUD, the
 * send pipeline, onKey dispatch, and the idle/gesture systems stay
 * paged and delegate in. Headline badges/stamping already live in
 * NewsPanel/annotations-stamp and stay there.
 */
export class AnnotateMode {
	private readonly deps: AnnotateModeDeps;

	selMenu = $state<SelMenuState | null>(null);
	/**
	 * True while the pointer hovers the selection menu: the auto-dismiss
	 * timer stands down, so moving the mouse from the highlight to the
	 * Annotate button never cancels it. Leaving re-arms the timer.
	 */
	selMenuHover = $state(false);
	/**
	 * Selection-menu open stamp: the rescue in the selectionchange
	 * auto-dismiss below puts the stored range back while NEITHER a
	 * press/key NOR a programmatic clear landed since the menu
	 * opened. lastPressAt covers pointerdown AND keydown, and the
	 * summoning drag's own press predates the open — so the rescue
	 * fires exactly for press-less engine clears (the pointer
	 * cruising other messages, the menu's own shadow), while
	 * click-away, new drags, arrow-collapses, and Escape all stamp
	 * newer and keep dismissing. Same-millisecond ties read as the
	 * summoning gesture, never as a newer press.
	 */
	selMenuOpenedAt = 0;
	/** Last clearSelection() call: programmatic clears dismiss, engine
	hover-clears rescue (see above). Every caller also drops the menu,
	so this is belt-and-braces for future paths. */
	lastProgrammaticClearAt = 0;
	/** Badge currently hovered (paints its quote wash as a preview). */
	hoverBadgeId: string | null = $state(null);
	/** Answer popup (the remodel): open answer read in context. Null
	when closed; the card self-heals (renders nothing) if its
	annotation is deleted or sent while open. The quote itself never
	renders in the card — the highlighted word upstream is the
	title, with Han readings in the panels above it. */
	answerPop = $state<AnswerPopState | null>(null);
	/** Answer fade-out in flight (unmounts when the ramp ends). */
	answerClosing = $state(false);
	answerTimer: ReturnType<typeof setTimeout> | null = null;
	/** Thread scroll offset when the answer card opened: like the
	pill, the card sticks to its document point (never the
	viewport), so scrolls shift it by the delta. */
	answerPopTop = 0;
	/** Last badge a mousedown press opened (or toggled): its trailing
	click re-fire is the same gesture, never a new one (openBadgeClick
	and the answer click-off guard both stand down for it). `seq`
	pins the press itself: pointerdown always precedes its
	mousedown, so a click with no press since is the trailing one.
	Plain field — only the handlers touch it, never the template. */
	lastBadgePress: { id: AnnotationId; at: number; seq: number } | null = null;

	constructor(deps: AnnotateModeDeps) {
		this.deps = deps;
	}

	/** Article element owning a DOM node, or null outside messages. */
	articleOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('article[id^="msg-"]') ?? null;
	}

	/** Headline span owning a selection node, or null outside titles. */
	headlineOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest(".news-card-title") ?? null;
	}

	/** Story anchor for a headline span: the card carries the
	 * link, the live panel row carries the rest. Null when the
	 * panel moved on (stale highlight, never garbage). */
	storyOfHeadline(headline: Element): StoryAnchor | null {
		const news = this.deps.getNews();
		if (!news) return null;
		const link = headline.closest(".news-open")?.getAttribute("data-story-link");
		if (!link) return null;
		const story = news.stories.find((s) => s.link === link);
		if (!story) return null;
		return { link, title: story.title, outlet: story.source, lang: news.langName };
	}

	/** Message id owning the selection anchor, or null outside messages. */
	selectedMessageId(selection: Selection): ChatMsgId | null {
		const article = this.articleOf(selection.anchorNode);
		if (!article) return null;
		const messages = this.deps.getChatMessages();
		const index = messageIndexFromId(article.id, messages.length);
		if (index === null) return null;
		return messages[index]?.id ?? null;
	}

	currentQuote(): {
		quote: string;
		context: string;
		messageId: ChatMsgId | null;
		story?: StoryAnchor;
	} | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return this.headlineQuote(selection);
		return this.messageQuote(selection);
	}

	/** Quote off a news headline: both ends must sit in one
	 * title (onSelectEnd trims cross-card drags to the anchor
	 * title's edge, like messages), anchored to the live story row. */
	headlineQuote(selection: Selection): {
		quote: string;
		context: string;
		messageId: null;
		story: StoryAnchor;
	} | null {
		const headline = this.headlineOf(selection.anchorNode);
		if (!headline || this.headlineOf(selection.focusNode) !== headline) return null;
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const story = this.storyOfHeadline(headline);
		if (!story) return null;
		const context = (headline.textContent ?? "").slice(0, 2000);
		return { quote, context, messageId: null, story };
	}

	messageQuote(selection: Selection): {
		quote: string;
		context: string;
		messageId: ChatMsgId;
	} | null {
		// Math picks normalize to the whole equation: a partial glyph
		// pick quotes a shard that never re-matches, so when both ends
		// sit in one equation the range expands over its body first.
		const anchorBody = equationBodyOf(selection.anchorNode);
		if (anchorBody && equationBodyOf(selection.focusNode) === anchorBody) {
			try {
				const whole = equationBodyRange(anchorBody);
				if (!whole) return null;
				selection.removeAllRanges();
				selection.addRange(whole);
			} catch {
				// A disturbed range keeps the partial pick below.
			}
		}
		// Clone the range and drop badge buttons and ruby readings:
		// selecting across an existing annotation would otherwise bake
		// its number into the new quote ("Kyoto1 in two sentences"),
		// and ruby would bake its readings in with the base text.
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const messageId = this.selectedMessageId(selection);
		if (!messageId) return null;
		// The paragraph holding the highlight: a lone Han char can
		// never carry kana itself, so Inspect guesses its locale from
		// this text instead. Ruby readings ride along in textContent,
		// but furigana only annotates Japanese lines, so the guess
		// still points the right way.
		const anchorEl =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		const context = (anchorEl?.closest("p, li")?.textContent ?? "").slice(
			0,
			2000
		);
		return { quote, context, messageId };
	}

	/**
	 * Which repeat of a quote the live selection starts in: resolves the
	 * range start against the message's rendered text nodes and counts
	 * the stripped occurrence holding it. Never throws — selection APIs
	 * disagree across engines, and anything odd keeps 0 (first match).
	 */
	occurrenceFromSelection(messageId: ChatMsgId, quote: string): number {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return 0;
			const range = selection.getRangeAt(0);
			let node: Node | null = range.startContainer;
			let offset = range.startOffset;
			// Whole-node starts (triple-click paragraphs) resolve to
			// their first text: the occurrence holding the span's start.
			if (!(node instanceof Text)) {
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				const firstText = walker.nextNode();
				if (!(firstText instanceof Text)) return 0;
				node = firstText;
				offset = 0;
			}
			const index = this.deps.getChatMessages().findIndex((m) => m.id === messageId);
			if (index === -1) return 0;
			const root = document.querySelector(`article#msg-${index} .rendered`);
			if (!(root instanceof HTMLElement)) return 0;
			const nodes = quoteTextNodes(root);
			const nodeIndex = node instanceof Text ? nodes.indexOf(node) : -1;
			if (nodeIndex === -1) return 0;
			return occurrenceAtPosition(
				nodes.map((n) => n.textContent ?? ""),
				quote,
				nodeIndex,
				offset
			);
		} catch {
			return 0;
		}
	}

	placeSelMenu(cursorX?: number, cursorY?: number): void {
		this.deps.ensureSwapObserver();
		// Never summon off preview content: the main column is showing
		// another chat, so the quote would pair with the active chat's
		// message id and Annotate would anchor garbage. The hover gate
		// (previewHover) normally prevents reaching here mid-preview.
		if (this.deps.isPreviewing()) {
			this.selMenu = null;
			return;
		}
		const found = this.currentQuote();
		if (!found) {
			this.selMenu = null;
			return;
		}
		const live = window.getSelection();
		const rect = live?.rangeCount
			? live.getRangeAt(0).getBoundingClientRect()
			: null;
		if (!rect) {
			this.selMenu = null;
			return;
		}
		// A release in another article than the highlight (the drag
		// crossed messages) would dock the menu to the stray cursor,
		// stranding Annotate on a message with no highlight: fall back
		// to the highlight's own rect so the menu stays on the quoted
		// message. Releases outside any article keep the cursor (the
		// gap below a message still docks near the pointer).
		let atX = cursorX;
		let atY = cursorY;
		if (atX !== undefined && atY !== undefined && live && live.rangeCount > 0) {
			const at = document.elementFromPoint(atX, atY);
			const quoteArticle = this.articleOf(live.anchorNode);
			if (
				quoteArticle &&
				at &&
				this.articleOf(at) &&
				this.articleOf(at) !== quoteArticle
			) {
				atX = undefined;
				atY = undefined;
			}
		}
		// The live range, so menu hover can put the highlight back:
		// WebKit empties the document selection when the pointer moves
		// onto the floating menu (no DOM change, no press). Nothing
		// mutates in that path, so these nodes stay valid.
		const stored =
			live && live.rangeCount > 0 ? live.getRangeAt(0).cloneRange() : null;
		const settings = this.deps.getSettings();
		const { x, y } = selMenuPlacement({
			cursorX: atX,
			cursorY: atY,
			rectLeft: rect.left,
			rectTop: rect.top,
			rectBottom: rect.bottom,
			rectWidth: rect.width,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			androidUI: this.deps.isPhone(),
			iosUI: this.deps.isIOS(),
			menuWidth: selMenuWidthEstimate(
				found.quote,
				this.deps.isPhone(),
				settings.inspectEnabled
			),
			fontScale: settings.fontScale
		});
		// The rescue in the selectionchange auto-dismiss restores the
		// stored range while nothing newer landed (see selMenuOpenedAt).
		this.selMenuOpenedAt = Date.now();
		this.selMenu = {
			x,
			y,
			left: rect.left,
			w: rect.width,
			hlTop: rect.top,
			hlBottom: rect.bottom,
			quote: found.quote,
			context: found.context,
			messageId: found.messageId,
			...(found.story ? { story: found.story } : {}),
			range: stored
		};
		// Selecting unpins the stream follow: a reply must not yank
		// the view out from under the highlight (scrolling back to
		// the bottom re-pins, like any unpin).
		this.deps.unstick();
		// No prompt summon: the menu floats viewport-fixed on every
		// platform now (the old phone dock needed the composer shown).
	}

	/**
	 * Menu hover enter: WebKit empties the document selection when the
	 * pointer moves onto the floating menu (no DOM change, no press —
	 * Chromium keeps it), so put the stored live range back and the
	 * highlight survives the trip to Annotate. Nothing mutated, so the
	 * stored nodes are still valid; never stomps a non-empty selection,
	 * and one restore per enter is enough (the engine clears once).
	 */
	enterSelMenu(): void {
		this.selMenuHover = true;
		const range = this.selMenu?.range;
		if (!range) return;
		const live = window.getSelection();
		if (!live || live.toString() !== "") return;
		try {
			if (
				!document.contains(range.startContainer) ||
				!document.contains(range.endContainer)
			)
				return;
			live.removeAllRanges();
			live.addRange(range);
		} catch {
			// Cosmetic: the menu stands on its stored quote regardless.
		}
	}

	clearSelection(): void {
		this.lastProgrammaticClearAt = Date.now();
		window.getSelection()?.removeAllRanges();
	}

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. The
	annotation stays pending (no badge, no count) until submit. */
	annotate(initialComment: string = "", instant = false): void {
		const menu = this.selMenu;
		if (!menu) return;
		if (!menu.quote.trim()) {
			this.clearSelection();
			this.selMenu = null;
			return;
		}
		// Starting over submits whatever is being composed first: typed
		// comments are never silently dropped.
		if (this.deps.getPending()) this.commitPending();
		// An in-prompt note edit owns the composer: filing it first
		// hands the draft back before the new annotation takes over.
		if (this.deps.hasPromptEdit()) this.deps.commitPromptEdit();
		const quote = menu.quote.trim();
		// Repeats disambiguate here, from the live selection: the
		// last "c" in "ccc" records occurrence 2, so its badge
		// lands where the highlight was. Anything unresolvable
		// keeps 0 (first match, the old behavior) — headlines
		// always keep 0 (no message row to locate in).
		const at = menu.messageId
			? this.occurrenceFromSelection(menu.messageId, quote)
			: 0;
		// A quote picked from vocalized (tashkeel) text locates against
		// that text only: its badge shows while the aid is on, never on
		// the bare form. Headlines never carry aid scope.
		const aidScope =
			menu.messageId && this.deps.isAidPinned(menu.messageId)
				? ("tashkeel" as const)
				: undefined;
		// Same span twice would stack two badges on one anchor (and
		// hovering them oscillates): delete the existing annotation
		// and start the new one clean — no toast, no lockout, the
		// create box opens for the fresh wording either way (even on
		// the instant path: re-annotating means rewriting).
		const dupe = duplicateAnnotationId(
			this.deps.getAnnotations(),
			{
				...(menu.messageId ? { messageId: menu.messageId } : {}),
				...(menu.story ? { story: menu.story } : {})
			},
			quote,
			at,
			aidScope
		);
		if (dupe) {
			this.deps.setAnnotations(
				deleteAnnotation(this.deps.getAnnotations(), dupe)
			);
			if (this.answerPop?.id === dupe) {
				if (this.answerTimer) {
					clearTimeout(this.answerTimer);
					this.answerTimer = null;
				}
				this.answerClosing = false;
				this.answerPop = null;
			}
			if (this.deps.getHighlight() === dupe) this.deps.setHighlight(null);
			instant = false;
		}
		const pending: Annotation = {
			id: newAnnotationId(),
			...(menu.messageId ? { messageId: menu.messageId } : {}),
			...(menu.story ? { story: menu.story } : {}),
			quote,
			comment: "",
			at,
			...(aidScope ? { aidScope } : {})
		};
		this.deps.setPending(pending);
		// Creating an annotation always reads the quote back out
		// (no readback gate): filing is an explicit listen moment,
		// exactly like tapping Speak on the highlight.
		this.deps.speak(quote, this.deps.selSpeakKey(menu), true, menu.context);
		// Han quotes earn their readings panel above the quote while
		// creating too: the highlight stays (instead of clearing) so
		// the panels have a live rect — the selectionchange watcher
		// drops them with it on submit or cancel. Headlines skip
		// readings (message-DOM panels have nothing to place on).
		const quoted = {
			quote,
			messageId: menu.messageId,
			context: menu.context,
			at
		};
		const keepHighlight =
			quoted.messageId != null &&
			this.deps.quoteOffers({ ...quoted, messageId: quoted.messageId });
		if (keepHighlight && quoted.messageId != null)
			this.deps.readingsFor({ ...quoted, messageId: quoted.messageId }, true);
		else this.clearSelection();
		// Instant file (hover A): the pill never opens — the empty
		// note files at once and the request fires, on desktop and
		// phones alike (no in-prompt edit either).
		if (instant) {
			this.deps.setAnnDraft(initialComment);
			this.commitPending();
			return;
		}
		// Phones file the comment in the composer, never the
		// transplanted pill (its textbox can't reliably summon the
		// phone keyboard — see editAnnotationInPrompt). Desktop
		// falls through to the popover below.
		const settings = this.deps.getSettings();
		if (this.deps.isPhone()) {
			this.selMenu = null;
			this.deps.setHighlight(pending.id);
			this.deps.editInPrompt(initialComment);
			if (settings.hapticsEnabled) vibrateTick(6);
			return;
		}
		const width = this.deps.popWidth();
		// The comment box hangs below the highlight itself (never
		// covering the word, at any font size): narrow highlights
		// center the box over themselves; wide ones keep the
		// end-of-selection placement. The Annotate button itself
		// never moves (stays at the cursor end). Phone: the keyboard
		// eats the lower screen, so the composer pins high and
		// centered instead of at the selection — it is never
		// covered, wherever the quote sits.
		const { x, y } = placeAnnComposer({
			android: this.deps.isPhone(),
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			width,
			menuX: menu.x,
			highlightLeft: menu.left,
			highlightWidth: menu.w,
			highlightTop: menu.hlTop,
			highlightBottom: menu.hlBottom,
			fontScale: settings.fontScale
		});
		this.selMenu = null;
		this.deps.setHighlight(pending.id);
		this.deps.openCreatePill(pending.id, x, y, initialComment);
	}

	/** Submit the annotation being composed (Enter or Save). The id is
	kept from composition so wash, pill, and badge address one thing.
	Filing fires the annotation's own request at once — blue while it
	waits, orange when the reply lands. */
	commitPending(): void {
		const id = this.deps.filePendingDraft(
			this.deps.getPending(),
			this.deps.getAnnDraft()
		);
		if (!id) return;
		this.deps.setPending(null);
		// The filed draft owned the highlight (kept for readings
		// panels while creating): both go with the submit.
		this.clearSelection();
		this.deps.dismissSelPanels();
	}

	/** Paragraph holding a quote, for the answer request's context. */
	answerContextFor(
		ann: Pick<Annotation, "messageId" | "story">,
		quote: string,
		occurrence = 0
	): string {
		if (!ann.messageId && ann.story) {
			const story = ann.story;
			return `${story.title} — ${story.outlet} (${story.lang})`;
		}
		const content = ann.messageId
			? this.deps.getMessageContent(ann.messageId)
			: null;
		return paragraphForQuote(
			content === null ? "" : aidDisplayText(content),
			quote,
			occurrence
		);
	}

	/** Select an answered quote's text (anchors are empty gap
	markers, never wraps): the answer highlights its quote like a
	selection, so the existing text reads as context and the
	readings panels place against it. Null when the quote is gone
	(aid swap, edit). */
	selectAnswerQuote(
		id: AnnotationId
	): { quote: string; messageId: ChatMsgId; context: string; at: number } | null {
		const ann = this.deps.getAnnotations().find((a) => a.id === id);
		if (!ann) return null;
		// Story notes select nothing (no message row to locate
		// in): their card still opens, panel-less.
		if (!ann.messageId) return null;
		const quoted = {
			quote: ann.quote,
			messageId: ann.messageId,
			context: this.answerContextFor(ann, ann.quote, ann.at ?? 0),
			at: ann.at ?? 0
		};
		// Readings panels ride the live range (their scroll tracker
		// dismisses with it), so only quotes bound for panels take a
		// live selection. Everything else highlights wash-only while
		// its card reads — never a native-blue flash.
		if (!this.deps.quoteOffers(quoted)) return quoted;
		const index = this.deps.getChatMessages().findIndex((m) => m.id === ann.messageId);
		if (index === -1) return null;
		const root = document.querySelector(`article#msg-${index} .rendered`);
		if (!(root instanceof HTMLElement)) return null;
		const nodes = quoteTextNodes(root);
		const loc = locateQuote(
			nodes.map((n) => n.textContent ?? ""),
			ann.quote,
			ann.at ?? 0
		);
		if (!loc) return null;
		const startNode = nodes[loc.startNode];
		const endNode = nodes[loc.endNode];
		if (!startNode || !endNode) return null;
		try {
			window.getSelection()?.setBaseAndExtent(
				startNode,
				Math.min(loc.startOffset, startNode.length),
				endNode,
				Math.min(loc.endOffset, endNode.length)
			);
		} catch {
			return null;
		}
		return quoted;
	}

	/**
	 * Badge click: a ready answer opens in its own popup, anything
	 * else opens the review dock on the annotation's row — filed
	 * notes never edit inline in the dock (the pencil opens the
	 * edit card). Re-pressing an open card's badge toggles its
	 * prompt pin (a double-click's second press lands here); the
	 * card stays put and the badge keeps its number — Esc and
	 * click-away close, the dock's Unpin removes.
	 */
	openBadge(id: AnnotationId, anchor?: { x: number; y: number }): void {
		const current = this.deps.getAnnotations().find((a) => a.id === id);
		// Android: tapping a blue (unanswered) badge only toasts
		// Loading — the answer is still on the wire, so there is no
		// card to open and the review dock must not open either (it
		// used to open and strand the tap there).
		if (this.deps.isPhone() && !this.deps.isIOS() && current && !current.answer) {
			this.deps.toast("Loading");
			return;
		}
		// A badge press unpins the stream follow, like a selection:
		// the card reads against a still thread.
		this.deps.unstick();
		// Re-pressing a badge with its create pill open cancels the
		// pill, like cancel.
		if (this.deps.cancelPillFor(id)) return;
		if (!current) return;
		// A ready answer opens in its own popup: re-press toggles
		// its prompt pin instead of shutting the card — pin, or
		// unpin when already pinned (double-click both ways). An
		// open pill for the same note settles first through the
		// proper cancel path so typed text is never dropped.
		if (current.answer) {
			const open = this.answerPop;
			if (open && !this.answerClosing && open.id === id) {
				if (current.pinnedToPrompt === true) this.unpinAnnotation(id);
				else this.pinAnnotation(id);
				return;
			}
			this.deps.cancelPillFor(id);
			const anchorAt = anchor ?? {
				x: window.innerWidth / 2,
				y: window.innerHeight / 2
			};
			const settings = this.deps.getSettings();
			const width = this.deps.popWidth();
			// The card hangs below the quote like the create pill
			// (same gap and x math), never flipped above and never
			// covering the word: when the bottom edge would clip, the
			// thread scrolls to make room instead (below). Phones
			// keep the centered card (keyboard geometry).
			const quoteRect = document
				.querySelector(`[data-ann-badge="${id}"]`)
				?.parentElement?.getBoundingClientRect();
			const placed =
				!this.deps.isPhone() && quoteRect
					? placeAnnAnswer({
							viewportWidth: window.innerWidth,
							menuX: anchorAt.x,
							highlightLeft: quoteRect.left,
							highlightWidth: quoteRect.width,
							highlightBottom: quoteRect.bottom,
							width,
							fontScale: settings.fontScale
						})
					: placeAnnCard({
							anchorX: anchorAt.x,
							anchorY: anchorAt.y,
							width,
							viewportWidth: window.innerWidth,
							viewportHeight: window.innerHeight,
							// Open-time estimate; the tick below refits
							// to the measured card on Android.
							cardHeight: 240
						});
			if (this.answerTimer) {
				clearTimeout(this.answerTimer);
				this.answerTimer = null;
			}
			this.answerClosing = false;
			this.answerPop = { id, x: placed.x, y: placed.y, w: width };
			this.answerPopTop = this.deps.getScrollBox()?.scrollTop ?? 0;
			if (this.deps.isPhone()) void tick().then(() => this.deps.refitAnswerCard(id));
			// The quote stays highlighted while its answer reads, and
			// opening the reply always reads the annotated thing back
			// out — same listen moment as creating the annotation.
			this.deps.setHighlight(id);
			this.deps.speak(
				current.quote,
				this.deps.annSpeakKey(current),
				false,
				this.answerContextFor(current, current.quote, current.at ?? 0)
			);
			// The quote highlights wash-only (its own text is the
			// context) and Han quotes earn the right-click readings
			// panel above it — nothing repeated in the card, no
			// extra request, no native-blue flash. A quote with no
			// readings to offer drops a previous quote's panel (the
			// press no longer clears it above): the panel goes away
			// with the card it rode in on. Story notes offer no
			// readings (no message row to place on).
			const quoted = {
				quote: current.quote,
				messageId: current.messageId,
				context: this.answerContextFor(current, current.quote, current.at ?? 0)
			};
			if (
				!current.messageId ||
				!this.deps.quoteOffers({ ...quoted, messageId: current.messageId })
			)
				this.deps.dismissSelPanels();
			const selected = this.selectAnswerQuote(id);
			if (selected) this.deps.readingsFor(selected, true);
			if (!this.deps.isPhone() && quoteRect) {
				void (async () => {
					await tick();
					if (this.answerPop?.id !== id || this.answerClosing) return;
					const card = document.querySelector(".ann-answer");
					if (!(card instanceof HTMLElement)) return;
					const overflow =
						card.getBoundingClientRect().bottom - (window.innerHeight - 8);
					if (overflow <= 0) return;
					const scrollBox = this.deps.getScrollBox();
					if (!scrollBox) return;
					// Instant: a smooth scroll would still be animating
					// when the re-place below measures the quote.
					scrollBox.scrollTo({
						top: scrollBox.scrollTop + overflow,
						behavior: "instant"
					});
					await tick();
					if (this.answerPop?.id !== id || this.answerClosing) return;
					const fresh = document
						.querySelector(`[data-ann-badge="${id}"]`)
						?.parentElement?.getBoundingClientRect();
					if (!fresh) return;
					const gap = Math.max(2, Math.round(2 + (settings.fontScale - 1) * 12));
					const pop = this.answerPop;
					if (pop) this.answerPop = { ...pop, y: Math.floor(fresh.bottom + gap) };
					this.answerPopTop = this.deps.getScrollBox()?.scrollTop ?? 0;
					// The room-making scroll above re-pinned the bottom:
					// unpin again, the card still reads against stillness.
					this.deps.unstick();
				})();
			}
			return;
		}
		// No answer yet: open the review dock on this row (both
		// platforms — the dock renders in the composer everywhere).
		// Filed notes never edit inline in the dock: the row offers
		// pin, pencil (answered only — it opens the edit card),
		// inclusion toggle, copy, and delete. Opening still reads
		// the annotated text back out, like the answer path. The
		// dock summons no readings panel, so a previous quote's
		// panel goes with the press (it no longer clears above).
		this.deps.stopPillMic();
		this.deps.dismissSelPanels();
		this.deps.speak(
			current.quote,
			this.deps.annSpeakKey(current),
			false,
			this.answerContextFor(current, current.quote, current.at ?? 0)
		);
		this.deps.setHighlight(id);
		this.deps.dismissPill();
		this.deps.setReviewOpen(true);
	}

	/**
	 * Delegated badge click (MessageBody): the keyboard path, plus the
	 * trailing click of a press gesture. A press's own click re-fire —
	 * same badge within the tap window — is the gesture just handled,
	 * not a re-press: running the toggle would shut the menu the press
	 * opened (the iOS tap bug). Anything else toggles as before.
	 */
	openBadgeClick(id: AnnotationId, anchor: { x: number; y: number }): void {
		if (
			this.lastBadgePress &&
			this.lastBadgePress.id === id &&
			Date.now() - this.lastBadgePress.at < 800
		)
			return;
		this.openBadge(id, anchor);
	}

	/** Fade the answer card out, then unmount it. The quote's wash
	releases with the fade, not after it. */
	closeAnswerPop(): void {
		const pop = this.answerPop;
		if (!pop || this.answerClosing) return;
		if (this.deps.getHighlight() === pop.id) this.deps.setHighlight(null);
		// The answer owned the quote highlight (and its readings
		// panels): both go with the card.
		this.clearSelection();
		this.deps.dismissSelPanels();
		this.answerClosing = true;
		if (this.answerTimer) clearTimeout(this.answerTimer);
		this.answerTimer = setTimeout(() => {
			this.answerTimer = null;
			this.answerPop = null;
			this.answerClosing = false;
		}, 160);
	}

	/**
	 * Quote-tap jumps to the mark — and only the quote taps: the note
	 * stays selectable text, buttons keep their clicks, and the row's
	 * dead space navigates nowhere. A drag-select ending here is a pick
	 * (the click still fires), so only collapsed selections navigate.
	 * The review closes so the landing clears the composer dock.
	 */
	reviewQuoteClick(ann: {
		id: AnnotationId;
		messageId?: ChatMsgId | null;
		story?: StoryAnchor;
	}): void {
		if (!window.getSelection()?.isCollapsed) return;
		this.deps.setReviewOpen(false);
		this.gotoAnnotation(ann);
	}

	gotoAnnotation(ann: {
		id: AnnotationId;
		messageId?: ChatMsgId | null;
		story?: StoryAnchor;
	}): void {
		const all = this.deps.getAnnotations();
		// Story notes have no message row: scroll their card into
		// view while news is open (flashing the quote in the
		// title), else open the answer card when answered.
		if (!ann.messageId) {
			const current = all.find((a) => a.id === ann.id);
			const story = ann.story ?? current?.story;
			const card = story
				? document.querySelector(
						`.news-open[data-story-link="${CSS.escape(story.link)}"]`
					)
				: null;
			if (card instanceof HTMLElement) {
				this.deps.setHighlight(ann.id);
				this.deps.scrollRectIntoClear(card.getBoundingClientRect());
				if (current) {
					const quote = current.quote;
					this.deps.flashJumpMark(() => quoteRange(card, quote, 0));
				}
				return;
			}
			if (current?.answer) {
				this.openBadge(ann.id);
				return;
			}
			this.deps.toastError("That story is no longer open");
			return;
		}
		const index = this.deps.getViewMessages().findIndex((m) => m.id === ann.messageId);
		if (index < 0) {
			this.deps.toastError("Annotation no longer exists");
			return;
		}
		this.deps.setHighlight(ann.id);
		// Scroll the mark itself, clear of the composer dock: an
		// already-clear mark never moves (like nearest), but a covered
		// one lands in the open instead of stranding behind the dock
		// (nearest's down-landing trap). Fall back to the message when
		// the badge is somehow missing.
		const badge = document.querySelector(`[data-ann-badge="${ann.id}"]`);
		if (badge instanceof HTMLElement)
			this.deps.scrollRectIntoClear(badge.getBoundingClientRect());
		else {
			document
				.querySelector(`#msg-${index}`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		// The quote flashes once like a sent jump (one registry
		// flash; the jump clears the hover wash first, so no twin
		// layers under it): the badge
		// scroll lands the eye nearby, the flash lands it on the
		// words. Every paint re-locates against the repeat it was
		// filed from.
		const current = all.find((a) => a.id === ann.id);
		if (current) {
			const quote = current.quote;
			const at = current.at ?? 0;
			const locate = (): Range | null => {
				const article = document.querySelector(`#msg-${index}`);
				const root = article?.querySelector(".rendered") ?? article;
				return root instanceof HTMLElement ? quoteRange(root, quote, at) : null;
			};
			this.deps.flashJumpMark(locate);
		}
	}

	/** Pin an answered annotation to the send prompt (the only
	Add-to-prompt in the app): the overlay chip lists it as quote,
	question, and answer, and the next send bakes all three as
	context. Blue annotations never pin — creating one only files
	its badge until the reply lands. */
	pinAnnotation(id: AnnotationId): void {
		const current = this.deps.getAnnotations().find((a) => a.id === id);
		if (!current) {
			this.deps.toastError("Annotation no longer exists");
			return;
		}
		if (!canPinAnnotation(current)) return;
		this.deps.setAnnotations(setPromptPinned(this.deps.getAnnotations(), id, true));
	}

	/** Unpin: the annotation stays filed (badge, dock) — only the
	next send omits it. */
	unpinAnnotation(id: AnnotationId): void {
		this.deps.setAnnotations(setPromptPinned(this.deps.getAnnotations(), id, false));
	}

	removeAnnotation(id: string): void {
		// Annotation deletes thump like message deletes (the shared
		// triple-beat contract: call sites carry no haptic of their own).
		this.deps.buzzDelete();
		this.deps.setAnnotations(deleteAnnotation(this.deps.getAnnotations(), id));
		if (this.deps.getHighlight() === id) this.deps.setHighlight(null);
		this.deps.dismissPill(id);
	}
}
