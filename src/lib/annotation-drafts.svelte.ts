import { SvelteMap, SvelteSet } from "svelte/reactivity";
import {
	addFollowUp,
	annotationsAfterEdit,
	attachAnnotationAnswer,
	attachFollowUpAnswer,
	deleteAnnotation,
	dropFollowUp,
	filePendingAnnotation,
	unansweredAnnotations,
	type Annotation,
	type AnnotationId
} from "./annotations";
import {
	loadDraftAnnotations,
	saveDraftAnnotations
} from "./annotation-drafts-store";
import type { ChatId } from "./chat";
import type { ChatProvider } from "./providers/types";
import type { AnnotationQuestion } from "./reading";

/** How long a request that rode out a trip to the background gets,
once the app is back, before it is restarted as hung. */
export const RESUME_GRACE_MS = 15_000;

/** Page-owned collaborators the drafts controller calls back into. */
export interface AnnotationDraftsDeps {
	getActiveChatId: () => ChatId;
	getChatIds: () => ChatId[];
	resolveProvider: () => Promise<ChatProvider | null>;
	answerQuestion: (
		provider: ChatProvider,
		q: AnnotationQuestion,
		signal: AbortSignal
	) => Promise<string>;
	answerContextFor: (ann: Annotation) => string;
	/** One follow-up in an answer card's thread (see
	annotationFollowUp in reading.ts). */
	answerFollowUp: (
		provider: ChatProvider,
		q: AnnotationQuestion,
		answer: string,
		thread: ReadonlyArray<{ q: string; a?: string }>,
		reply: string
	) => Promise<string>;
	notifyBanner: (message: string) => void;
	clearBanner: () => void;
	toastError: (message: string) => void;
	isPhone: () => boolean;
	isNewsStoryOpen: (link: string) => boolean;
	openBadge: (id: AnnotationId) => void;
}

/**
 * Draft annotation state for the active chat (filed list, edit stash,
 * per-chat load/save, filing, and the ask flow). Moved out of
 * +page.svelte verbatim (B); the page wires the deps and keeps DOM,
 * focus, and toasts. Same shape as AnnotateMode/NewsMode: a plain
 * const holding the instance, never inside $state.
 */
export class AnnotationDrafts {
	private readonly deps: AnnotationDraftsDeps;

	/**
	 * Draft annotations for the active chat, restored from storage on
	 * launch: filed notes survive a restart and outlive sends;
	 * switching chats starts clean (the save below records the empty
	 * list either way).
	 */
	list = $state<Annotation[]>([]);

	/**
	 * The chat's filed annotations while an own-message edit borrows
	 * the live list for its ref seeds (see annotationsAfterEdit):
	 * stashed at entry, restored when the edit ends.
	 */
	private stash: {
		chatId: ChatId;
		list: Annotation[];
		seedIds: SvelteSet<string>;
	} | null = null;

	/** Annotation ids with a model request in flight (plain set,
	never state): the resume scan below never doubles one. */
	private asking = new SvelteSet<string>();
	/** Annotation ids whose ask already failed this session: the
	switch scan leaves those for an explicit re-ask (browsing chats
	must never banner-fail the same note on every visit). A restart
	starts empty, so last session's failures still resume. */
	private failed = new SvelteSet<string>();
	/** In-flight requests' aborts, keyed by annotation id. */
	private controllers = new SvelteMap<string, AbortController>();
	/** Requests that were in flight while the app sat in the
	background: phones freeze the webview and cut its sockets, so
	their failures are the OS's, never the provider's. They re-ask
	quietly instead of bannering and stranding the badge blue. */
	private interrupted = new SvelteSet<string>();
	/** Requests that died in the background, re-asked on return. */
	private retryOnReturn = new SvelteSet<string>();
	private away = false;

	constructor(deps: AnnotationDraftsDeps) {
		this.deps = deps;
		this.list = loadDraftAnnotations(deps.getActiveChatId());
	}

	/** The active chat's annotations as storage should see them: mid-edit
	 * the live list holds the edited message's seeds, not the drafts. */
	filed(): Annotation[] {
		const stash = this.stash;
		if (!stash) return this.list;
		return annotationsAfterEdit(stash.list, this.list, stash.seedIds);
	}

	/** Raw list replace: the annotate-mode seam (delete, clear) and
	nothing else — named verbs below cover the rest. */
	setList(next: Annotation[]): void {
		this.list = next;
	}

	/** Drafts for any chat: the filed list for the active chat,
	storage for the rest (harvest and search read through here). */
	draftsFor(chatId: string): Annotation[] {
		if (chatId === this.deps.getActiveChatId()) return this.filed();
		return loadDraftAnnotations(chatId);
	}

	/** File one chat's drafts away (verbatim chat-switch/new/drop save). */
	fileChat(chatId: ChatId): void {
		saveDraftAnnotations(chatId, this.filed(), this.deps.getChatIds());
	}

	/** Restore one chat's filed drafts into the live list. */
	restoreChat(chatId: string): void {
		this.list = loadDraftAnnotations(chatId);
	}

	/** Dropping the open chat discards its drafts (the stored entry
	prunes via the empty save over the surviving ids). */
	discardChat(chatId: ChatId, remainingIds: ChatId[]): void {
		saveDraftAnnotations(chatId, [], remainingIds);
	}

	/** Autosave-tick write for the active chat. */
	autosave(): void {
		saveDraftAnnotations(
			this.deps.getActiveChatId(),
			this.filed(),
			this.deps.getChatIds()
		);
	}

	/** Minted-chat reset (stash + list only; the page resets the rest). */
	clearForNewChat(): void {
		this.stash = null;
		this.list = [];
	}

	/** Own-message edit entry: stash the filed list, swap in the
	message's ref seeds. */
	beginOwnEdit(chatId: ChatId, seeds: Annotation[]): void {
		this.stash = {
			chatId,
			list: this.list,
			seedIds: new SvelteSet(seeds.map((a) => a.id))
		};
		this.list = seeds;
	}

	/** Own-message edit exit: the filed list comes back, plus anything
	filed during the edit (null stash — an edit opened in another
	chat — keeps the live extras only). */
	endOwnEdit(activeChatId: ChatId): void {
		const stash = this.stash;
		this.stash = null;
		this.list = annotationsAfterEdit(
			stash && stash.chatId === activeChatId ? stash.list : null,
			this.list,
			stash?.seedIds ?? new SvelteSet()
		);
	}

	/** File a pending annotation with its comment and ask it at once —
	the merged commitPending/commitPromptAnnEdit core (blue while it
	waits, orange when the reply lands). Null when nothing is pending;
	callers keep their own aftermath (pill vs prompt). */
	filePending(
		pending: Annotation | null,
		comment: string
	): AnnotationId | null {
		const filed = filePendingAnnotation(this.list, pending, comment);
		if (!filed) return null;
		this.list = filed;
		const id = pending?.id ?? null;
		if (id) {
			const ann = filed.find((a) => a.id === id);
			if (ann) void this.ask(ann);
		}
		return id;
	}

	/** Edit-card save (orange pencil): rewrite the filed comment and
	re-ask at once. True when a note was rewritten — an emptied draft
	keeps the old comment, a deleted-while-editing note just closes. */
	commitCommentEdit(id: string, draft: string): boolean {
		const target = this.list.find((a) => a.id === id);
		// An emptied draft keeps the old comment — the no-loss
		// rule cancel already follows. A deleted-while-editing
		// note just closes.
		if (target && target.answer !== undefined && draft.trim()) {
			// A reworded question gets a fresh answer: the old card's
			// thread argued with the old one.
			const { thread: _stale, ...rest } = target;
			void _stale;
			const edited = { ...rest, comment: draft };
			this.list = this.list.map((a) => (a.id === id ? edited : a));
			void this.ask(edited);
			return true;
		}
		return false;
	}

	/**
	 * Send a reply from an answer card: it joins the note's thread at
	 * once (waiting), and the model's answer lands on it. The thread
	 * lives with the note's chat, like its answer. False when nothing
	 * was sent or the request failed: the reply leaves the thread and
	 * the card puts the text back in its field.
	 */
	async askFollowUp(id: string, reply: string): Promise<boolean> {
		const text = reply.trim();
		const ann = this.list.find((a) => a.id === id);
		if (!text || !ann || ann.answer === undefined) return false;
		const prior = ann.thread ?? [];
		if (prior.some((t) => t.a === undefined)) return false;
		const index = prior.length;
		const chatId = this.deps.getActiveChatId();
		this.list = addFollowUp(this.list, id, text);
		try {
			const provider = await this.deps.resolveProvider();
			if (!provider) throw new Error("Set an API key first — open Settings.");
			const answer = await this.deps.answerFollowUp(
				provider,
				{
					quote: ann.quote,
					question: ann.comment,
					context: this.deps.answerContextFor(ann)
				},
				ann.answer,
				prior,
				text
			);
			if (chatId === this.deps.getActiveChatId())
				this.list = attachFollowUpAnswer(this.list, id, index, answer);
			return true;
		} catch (error) {
			if (chatId === this.deps.getActiveChatId())
				this.list = dropFollowUp(this.list, id, index);
			const message = error instanceof Error ? error.message : String(error);
			this.deps.notifyBanner(message);
			if (this.deps.isPhone()) this.deps.toastError(message);
			return false;
		}
	}

	/** Delete one filed note by id (pill-cancel fresh path). */
	deleteById(id: string): void {
		this.list = deleteAnnotation(this.list, id);
	}

	/** Fire one annotation's own model request: never linked to the
	main prompt or history — later questions file while earlier ones
	are still waiting. Failures banner (toast on phones) and leave
	the badge blue; the question keeps its note for a re-ask. */
	async ask(
		ann: Annotation,
		opts: { skipWhenKeyless?: boolean } = {}
	): Promise<void> {
		// One request per annotation: the boot/switch resume scan
		// refires answerless drafts, but never one already asking
		// (its reply still lands on the same id).
		if (this.asking.has(ann.id)) return;
		this.asking.add(ann.id);
		const controller = new AbortController();
		this.controllers.set(ann.id, controller);
		let lostToBackground = false;
		// The chat the ask fired from: the reply may land after a
		// switch, and it belongs to that chat's drafts, never the
		// one on screen.
		const chatId = this.deps.getActiveChatId();
		try {
			const provider = await this.deps.resolveProvider();
			if (!provider) {
				// Resume scans stay silent without a key: banner
				// spam for stale drafts helps nobody (an explicit
				// ask still banners like today).
				if (opts.skipWhenKeyless) return;
				const message = "Set an API key first — open Settings.";
				this.deps.notifyBanner(message);
				if (this.deps.isPhone()) this.deps.toastError(message);
				return;
			}
			this.deps.clearBanner();
			const answer = await this.deps.answerQuestion(
				provider,
				{
					quote: ann.quote,
					question: ann.comment,
					context: this.deps.answerContextFor(ann)
				},
				controller.signal
			);
			this.attachAnswer(chatId, ann.id, answer);
			// Story notes have no badge to turn orange: an answered
			// one opens its card while the story is still on screen
			// (resume scans for long-closed panels attach silently).
			if (
				!ann.messageId &&
				ann.story &&
				answer.trim() &&
				this.deps.isNewsStoryOpen(ann.story.link)
			)
				this.deps.openBadge(ann.id);
		} catch (error) {
			lostToBackground = this.interrupted.has(ann.id);
			if (!lostToBackground) {
				this.failed.add(ann.id);
				const message = error instanceof Error ? error.message : String(error);
				this.deps.notifyBanner(message);
				if (this.deps.isPhone()) this.deps.toastError(message);
			}
		} finally {
			this.asking.delete(ann.id);
			this.controllers.delete(ann.id);
			this.interrupted.delete(ann.id);
		}
		if (lostToBackground) this.reaskLost(ann.id);
	}

	/** A request the background killed: re-ask now when the app is
	back (the latest copy of the note, if it still exists), or on
	return while it's still away. */
	private reaskLost(id: string): void {
		if (this.away) {
			this.retryOnReturn.add(id);
			return;
		}
		const current = this.list.find((a) => a.id === id);
		if (current && current.answer === undefined) void this.ask(current);
	}

	/** The app left the foreground: everything in flight is at the
	OS's mercy until it comes back. */
	suspend(): void {
		this.away = true;
		for (const id of this.asking) this.interrupted.add(id);
	}

	/**
	 * The app came back: re-ask what died while away, and give what
	 * is still in flight a grace period before restarting it — a
	 * frozen socket can hang without ever failing, which left the
	 * badge breathing blue forever.
	 */
	resume(graceMs = RESUME_GRACE_MS): void {
		this.away = false;
		const lost = [...this.retryOnReturn];
		this.retryOnReturn.clear();
		for (const id of lost) this.reaskLost(id);
		for (const id of this.interrupted) {
			const controller = this.controllers.get(id);
			if (!controller) continue;
			setTimeout(() => {
				if (this.controllers.get(id) === controller && !this.away)
					controller.abort();
			}, graceMs);
		}
	}

	/**
	 * Land an answer on its chat: the live list while that chat is
	 * still open (and its stashed filed list mid-edit), else the
	 * chat's stored drafts — browsing away never loses a reply, and
	 * the next restore shows the badge orange. A chat dropped
	 * meanwhile keeps nothing (the save prunes unknown ids).
	 */
	private attachAnswer(chatId: ChatId, id: AnnotationId, answer: string): void {
		if (chatId === this.deps.getActiveChatId()) {
			this.list = attachAnnotationAnswer(this.list, id, answer);
			if (this.stash && this.stash.chatId === chatId)
				this.stash.list = attachAnnotationAnswer(this.stash.list, id, answer);
			return;
		}
		if (this.stash && this.stash.chatId === chatId)
			this.stash.list = attachAnnotationAnswer(this.stash.list, id, answer);
		const stored = loadDraftAnnotations(chatId);
		if (!stored.some((a) => a.id === id)) return;
		saveDraftAnnotations(
			chatId,
			attachAnnotationAnswer(stored, id, answer),
			this.deps.getChatIds()
		);
	}

	/**
	 * Relaunch the current chat's answerless drafts: a restart takes
	 * filed requests off the wire (pending never reaches storage, so
	 * every persisted answerless draft is inflight work), and a chat
	 * switch heals answers lost crossing chats the same way. Silent
	 * without a key; answered drafts never refire.
	 */
	resumeUnanswered(): void {
		for (const ann of unansweredAnnotations(this.list)) {
			if (this.asking.has(ann.id)) continue;
			if (this.failed.has(ann.id)) continue;
			void this.ask(ann, { skipWhenKeyless: true });
		}
	}
}
