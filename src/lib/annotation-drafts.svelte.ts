import { SvelteSet } from "svelte/reactivity";
import {
	annotationsAfterEdit,
	attachAnnotationAnswer,
	clearPromptPinned,
	deleteAnnotation,
	filePendingAnnotation,
	promptInclusions,
	setPromptPinned,
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

/** Page-owned collaborators the drafts controller calls back into. */
export interface AnnotationDraftsDeps {
	getActiveChatId: () => ChatId;
	getChatIds: () => ChatId[];
	resolveProvider: () => Promise<ChatProvider | null>;
	answerQuestion: (
		provider: ChatProvider,
		q: AnnotationQuestion
	) => Promise<string>;
	answerContextFor: (ann: Annotation) => string;
	notifyBanner: (message: string) => void;
	clearBanner: () => void;
	toastError: (message: string) => void;
	isPhone: () => boolean;
	isNewsStoryOpen: (link: string) => boolean;
	openBadge: (id: AnnotationId) => void;
}

/**
 * Draft annotation state for the active chat (filed list, edit stash,
 * per-chat load/save, pins, filing, and the ask flow). Moved out of
 * +page.svelte verbatim (B); the page wires the deps and keeps DOM,
 * focus, and toasts. Same shape as AnnotateMode/NewsMode: a plain
 * const holding the instance, never inside $state.
 */
export class AnnotationDrafts {
	private readonly deps: AnnotationDraftsDeps;

	/**
	 * Draft annotations for the active chat, restored from storage on
	 * launch: unsent quotes survive a restart (sending still bakes and
	 * clears, switching chats still starts clean — the save below
	 * records the empty list either way).
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

	constructor(deps: AnnotationDraftsDeps) {
		this.deps = deps;
		this.list = loadDraftAnnotations(deps.getActiveChatId());
	}

	/** The active chat's annotations as storage should see them: mid-edit
	 * the live list holds the edited message's seeds, not the drafts. */
	filed(): Annotation[] {
		const stash = this.stash;
		if (!stash) return this.list;
		return annotationsAfterEdit(stash.list, this.list, stash.seedIds, false);
	}

	/** Raw list replace: the annotate-mode seam (badge pin/unpin,
	delete) and nothing else — named verbs below cover the rest. */
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
	filed during the edit that the save didn't bake (null stash — an
	edit opened in another chat — keeps the live extras only). */
	endOwnEdit(activeChatId: ChatId, saved: boolean): void {
		const stash = this.stash;
		this.stash = null;
		this.list = annotationsAfterEdit(
			stash && stash.chatId === activeChatId ? stash.list : null,
			this.list,
			stash?.seedIds ?? new SvelteSet(),
			saved
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
			const edited = { ...target, comment: draft };
			this.list = this.list.map((a) => (a.id === id ? edited : a));
			void this.ask(edited);
			return true;
		}
		return false;
	}

	/** Delete one filed note by id (pill-cancel fresh path). */
	deleteById(id: string): void {
		this.list = deleteAnnotation(this.list, id);
	}

	/** Clear-all: drop every prompt-pinned note; filed-but-unpinned
	badges survive. */
	clearPromptPins(): void {
		this.list = clearPromptPinned(this.list);
	}

	/** Send bake: pinned annotations go out as context (quote,
	question, answer each) and consume (the baked message carries
	them now, so the next send starts unpinned); everything else
	filed stays filed — badges outlive the send. */
	consumePromptPins(): Annotation[] {
		const included = promptInclusions(this.list);
		this.list = this.list.map((a) => {
			if (a.pinnedToPrompt !== true) return a;
			const next = { ...a };
			delete next.pinnedToPrompt;
			return next;
		});
		return included;
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
			const answer = await this.deps.answerQuestion(provider, {
				quote: ann.quote,
				question: ann.comment,
				context: this.deps.answerContextFor(ann),
				...(ann.brief ? { brief: true } : {})
			});
			this.list = attachAnnotationAnswer(this.list, ann.id, answer);
			// Story notes have no badge to turn orange or pin from:
			// an answered one joins the review dock directly (and
			// rides the launched session as context), and its card
			// opens while the story is still on screen (resume
			// scans for long-closed panels attach silently).
			if (!ann.messageId && ann.story && answer.trim()) {
				this.list = setPromptPinned(this.list, ann.id, true);
				if (this.deps.isNewsStoryOpen(ann.story.link))
					this.deps.openBadge(ann.id);
			}
		} catch (error) {
			this.failed.add(ann.id);
			const message = error instanceof Error ? error.message : String(error);
			this.deps.notifyBanner(message);
			if (this.deps.isPhone()) this.deps.toastError(message);
		} finally {
			this.asking.delete(ann.id);
		}
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
