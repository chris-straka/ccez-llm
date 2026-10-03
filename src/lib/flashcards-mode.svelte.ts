import type { Annotation } from "./annotations";
import type { ChatId } from "./chat";
import {
	ankiExport,
	ankiFilename,
	currentCard,
	deckKeyAction,
	dueCards,
	harvestCards,
	isFlashcardsChord,
	loadReviewSchedule,
	nextDueAt,
	saveReviewSchedule,
	startSession,
	stepSession,
	type DeckAction,
	type DeckKeyFacts,
	type DeckSession,
	type HarvestChat,
	type ReviewCard,
	type ReviewSchedule,
	type ScheduleStore
} from "./flashcards";

/** Page-owned collaborators the deck calls back into. */
export interface FlashcardsModeDeps {
	getChats: () => readonly HarvestChat[];
	draftsFor: (chatId: ChatId) => readonly Annotation[];
	/** The settings toggle (off: no due count, no chord). */
	isEnabled: () => boolean;
	/** The active chat has no messages (the due entry only shows there). */
	isChatEmpty: () => boolean;
	/** True inside the native shell (the chord, and the phone export). */
	isShell: () => boolean;
	isPhone: () => boolean;
	focusComposer: () => void;
	speakQuote: (quote: string, id: string, context: string) => void;
	getSpeakingSelection: () => string | null;
	stopVoice: () => void;
	/** Native save dialog; null outside the shell. */
	saveText: (
		filename: string,
		text: string
	) => Promise<"saved" | "dismissed" | null>;
	copyText: (text: string) => Promise<void>;
	downloadText: (text: string, filename: string) => void;
	isDismissal: (error: unknown) => boolean;
	toast: (message: string) => void;
	toastError: (message: string) => void;
	/** Schedule storage (tests inject; the page uses the default). */
	store?: ScheduleStore | null;
}

const SPEAK_PREFIX = "flashcard:";

/**
 * Flashcards (see flashcards.ts): the open sitting (null closed),
 * the persisted schedule, and the cards harvested at open time.
 * Same shape as AnnotationDrafts: a plain const holding the
 * instance, never inside $state; the page keeps its effects.
 */
export class FlashcardsMode {
	private readonly deps: FlashcardsModeDeps;

	session = $state<DeckSession | null>(null);
	schedule = $state<ReviewSchedule>({});
	cards = $state<ReviewCard[]>([]);
	now = $state(Date.now());

	/** Due count for the empty-chat entry, recounted when a chat empties. */
	readonly due = $derived.by(() => {
		if (!this.deps.isEnabled()) return 0;
		if (!this.deps.isChatEmpty()) return 0;
		return dueCards(this.harvest(), this.schedule, Date.now()).length;
	});
	/** Live cards in the sitting's harvest (dismissed ones drop out). */
	readonly total = $derived(
		this.cards.filter((c) => !this.schedule[c.key]?.dismissed).length
	);
	readonly nextDue = $derived(nextDueAt(this.cards, this.schedule, this.now));
	/** The current card's quote is the one being read aloud. */
	readonly speaking = $derived.by(() => {
		if (!this.session) return false;
		const key = currentCard(this.session)?.key ?? "";
		return this.deps.getSpeakingSelection() === `${SPEAK_PREFIX}${key}`;
	});

	constructor(deps: FlashcardsModeDeps) {
		this.deps = deps;
		this.schedule = loadReviewSchedule(deps.store);
	}

	get isOpen(): boolean {
		return this.session !== null;
	}

	/** Every chat's answered annotations; the active chat reads live. */
	private harvest(): ReviewCard[] {
		return harvestCards(this.deps.getChats(), this.deps.draftsFor);
	}

	open(): void {
		this.now = Date.now();
		this.cards = this.harvest();
		this.session = startSession(this.cards, this.schedule, this.now);
	}

	close(): void {
		if (this.deps.getSpeakingSelection()?.startsWith(SPEAK_PREFIX))
			this.deps.stopVoice();
		this.session = null;
		if (!this.deps.isPhone()) this.deps.focusComposer();
	}

	/** Read the current card's quote in its own language; the context
	 * sentence routes the voice (see the page's speakQuote). */
	speak(): void {
		const card = this.session ? currentCard(this.session) : null;
		if (!card) return;
		this.deps.speakQuote(
			card.quote,
			`${SPEAK_PREFIX}${card.key}`,
			card.context || card.quote
		);
	}

	step(action: DeckAction): void {
		if (!this.session) return;
		this.now = Date.now();
		const next = stepSession(this.session, this.schedule, action, this.now);
		this.session = next.session;
		if (next.schedule !== this.schedule) {
			this.schedule = next.schedule;
			saveReviewSchedule(next.schedule, this.deps.store);
		}
	}

	/**
	 * Keyboard. An open deck owns it: deck keys act, other bare keys
	 * stop here so the chat behind stays put. Closed, the shell chord
	 * opens it. True when the key was consumed.
	 */
	key(facts: DeckKeyFacts): boolean {
		if (this.session) {
			const action = deckKeyAction(facts);
			if (action === "pass") return false;
			if (action === "close") this.close();
			else if (action === "speak") this.speak();
			else if (action !== "swallow") this.step(action);
			return true;
		}
		if (
			this.deps.isEnabled() &&
			this.deps.isShell() &&
			isFlashcardsChord(facts)
		) {
			this.open();
			return true;
		}
		return false;
	}

	/** Anki file: native save in the shell, download in a browser,
	 * clipboard on the shell phone (its webview drops downloads). */
	async exportAnki(): Promise<void> {
		const text = ankiExport(this.cards, this.schedule);
		const filename = ankiFilename();
		const shellPhone = this.deps.isPhone() && this.deps.isShell();
		try {
			const native = await this.deps.saveText(filename, text);
			if (native === "dismissed") return;
			if (native === "saved") {
				this.deps.toast("Flashcards saved");
				return;
			}
			if (shellPhone) {
				await this.deps.copyText(text);
				this.deps.toast("Flashcards copied to clipboard");
				return;
			}
			this.deps.downloadText(text, filename);
			this.deps.toast("Flashcards downloaded");
		} catch (error) {
			if (!this.deps.isDismissal(error))
				this.deps.toastError("Could not export flashcards");
		}
	}
}
