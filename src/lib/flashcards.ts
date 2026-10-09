/**
 * Flashcards: spaced-repetition cards harvested from answered
 * annotations across every chat, plus an Anki export.
 *
 * Cards are derived, never stored: the annotations stay the source of
 * truth (drafts in localStorage, baked "Annotated selections:" blocks
 * in sent messages), and only the per-card schedule persists, keyed by
 * the normalized quote. Deleting a card writes a
 * `dismissed` entry and leaves the annotation alone, so the chat keeps
 * its badge and the card stays gone.
 *
 * English quotes are skipped: annotating an English phrase is a
 * question about the conversation, not vocabulary. Only the quote's
 * own language decides (via `identifyLangShort`); an unknown single
 * word stays in, and the delete button covers the misses.
 *
 * Pure apart from the two storage helpers (which take an injectable
 * store) and unit-tested in `flashcards.test.ts`.
 */
import type { Annotation } from "./annotations";
import { findQuotedMessage, paragraphForQuote } from "./quote-match";
import { annRefsFor } from "./annotation-block";
import type { ChatId, ChatMsgId } from "./chat";
import { identifyLangShort } from "./langId";

export interface ReviewCard {
	/** Normalized quote: one card per phrase however often it was annotated. */
	key: string;
	quote: string;
	/** Sentence around the quote in its source message ("" when none). */
	context: string;
	answer: string;
	/** The question asked when annotating ("" when none). */
	note: string;
	/** BCP-47 tag of the quote, null when it can't be told. */
	lang: string | null;
	chatId: ChatId;
}

/** One card's schedule. Absent from the map means new (due now). */
export interface CardSchedule {
	/** Epoch ms the card is next due. */
	due: number;
	/** Current interval in days (0 while relearning). */
	interval: number;
	/** Consecutive "Got it" grades. */
	reps: number;
	/** Deleted from the deck: never due, never exported. */
	dismissed?: true;
}

export type ReviewSchedule = Record<string, CardSchedule>;

export type ReviewGrade = "again" | "good";

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Again" brings the card back within the session, then in 10 minutes. */
export const RELEARN_MS = 10 * 60 * 1000;
/** Cards per sitting: a first open over 200 annotations stays short. */
export const SESSION_LIMIT = 20;
/** Context sentence cap: the card front stays a glance, not a page. */
const CONTEXT_MAX = 240;

export function cardKey(quote: string): string {
	return quote.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when the quote reads as English (any `en-*` tag). */
export function isEnglishQuote(quote: string): boolean {
	return identifyLangShort(quote)?.startsWith("en") ?? false;
}

/**
 * Sentence holding the quote inside its paragraph, clipped to
 * CONTEXT_MAX around the quote. Empty when the context would only
 * repeat the quote.
 */
export function contextSentence(paragraph: string, quote: string): string {
	const para = paragraph.replace(/\s+/g, " ").trim();
	const q = quote.replace(/\s+/g, " ").trim();
	if (!para || !q) return "";
	let sentence = para;
	const at = para.indexOf(q);
	if (at !== -1 && typeof Intl !== "undefined" && "Segmenter" in Intl) {
		const segmenter = new Intl.Segmenter(undefined, {
			granularity: "sentence"
		});
		for (const seg of segmenter.segment(para)) {
			const end = seg.index + seg.segment.length;
			if (seg.index <= at && at < end) {
				// A quote running past one sentence keeps the whole run.
				sentence = para.slice(seg.index, Math.max(end, at + q.length)).trim();
				break;
			}
		}
	}
	if (sentence.length > CONTEXT_MAX) {
		const mid = Math.max(0, sentence.indexOf(q));
		const start = Math.max(
			0,
			Math.min(mid - 80, sentence.length - CONTEXT_MAX)
		);
		sentence =
			(start > 0 ? "…" : "") +
			sentence.slice(start, start + CONTEXT_MAX).trim() +
			(start + CONTEXT_MAX < sentence.length ? "…" : "");
	}
	return cardKey(sentence) === cardKey(q) ? "" : sentence;
}

/** Chat slice the harvest reads. */
export interface HarvestChat {
	id: ChatId;
	messages: { id: ChatMsgId; role: "user" | "assistant"; content: string }[];
}

/**
 * Every reviewable card: answered annotations, baked refs first and then
 * drafts (the newer copy), newest chats last. A repeated quote keeps its latest
 * answer. English quotes never become cards.
 */
export function harvestCards(
	chats: readonly HarvestChat[],
	drafts: (chatId: ChatId) => readonly Annotation[]
): ReviewCard[] {
	const byKey = new Map<string, ReviewCard>();
	const add = (
		chatId: ChatId,
		quote: string,
		answer: string | undefined,
		note: string,
		paragraph: string
	): void => {
		const q = quote.trim();
		const a = answer?.trim() ?? "";
		if (!q || !a) return;
		if (isEnglishQuote(q)) return;
		const key = cardKey(q);
		if (!key) return;
		byKey.delete(key);
		byKey.set(key, {
			key,
			quote: q,
			context: contextSentence(paragraph, q),
			answer: a,
			// Baked blocks file an empty question as "?".
			note: note.trim() === "?" ? "" : note.trim(),
			lang: identifyLangShort(q),
			chatId
		});
	};
	for (const chat of chats) {
		for (const msg of chat.messages) {
			if (msg.role !== "user") continue;
			const split = annRefsFor(msg.content);
			if (!split) continue;
			for (const ref of split.refs) {
				const owner = findQuotedMessage(chat.messages, msg.id, ref.quote);
				const source = chat.messages.find((m) => m.id === owner)?.content ?? "";
				add(
					chat.id,
					ref.quote,
					ref.answer,
					ref.comment,
					paragraphForQuote(source, ref.quote)
				);
			}
		}
		for (const ann of drafts(chat.id)) {
			const source = ann.story
				? ann.story.title
				: (chat.messages.find((m) => m.id === ann.messageId)?.content ?? "");
			add(
				chat.id,
				ann.quote,
				ann.answer,
				ann.comment,
				paragraphForQuote(source, ann.quote, ann.at ?? 0)
			);
		}
	}
	return [...byKey.values()];
}

/** Due now: new cards (no schedule) and reviews whose time came. */
export function isDue(
	schedule: CardSchedule | undefined,
	now: number
): boolean {
	if (!schedule) return true;
	return !schedule.dismissed && schedule.due <= now;
}

/** Cards due right now, not dismissed. */
export function dueCards(
	cards: readonly ReviewCard[],
	schedule: ReviewSchedule,
	now: number
): ReviewCard[] {
	return cards.filter((c) => isDue(schedule[c.key], now));
}

/**
 * One sitting's queue: overdue reviews first (oldest due first), then
 * new cards in harvest order, capped at `limit`.
 */
export function sessionQueue(
	cards: readonly ReviewCard[],
	schedule: ReviewSchedule,
	now: number,
	limit = SESSION_LIMIT
): ReviewCard[] {
	const due = dueCards(cards, schedule, now);
	const reviews = due
		.filter((c) => schedule[c.key])
		.sort((a, b) => (schedule[a.key]?.due ?? 0) - (schedule[b.key]?.due ?? 0));
	const fresh = due.filter((c) => !schedule[c.key]);
	return [...reviews, ...fresh].slice(0, limit);
}

/**
 * Next schedule after a grade. "Got it" climbs 1 → 3 → ×2.5 days;
 * "Again" resets to relearning and returns in RELEARN_MS.
 */
export function gradeCard(
	prev: CardSchedule | undefined,
	grade: ReviewGrade,
	now: number
): CardSchedule {
	if (grade === "again") return { due: now + RELEARN_MS, interval: 0, reps: 0 };
	const reps = (prev?.reps ?? 0) + 1;
	const interval =
		reps === 1
			? 1
			: reps === 2
				? 3
				: Math.round(Math.max(3, prev?.interval ?? 3) * 2.5);
	return { due: now + interval * DAY_MS, interval, reps };
}

export function dismissCard(
	prev: CardSchedule | undefined,
	now: number
): CardSchedule {
	return { ...(prev ?? { due: now, interval: 0, reps: 0 }), dismissed: true };
}

/** Rough "next in" copy for the grade buttons' titles. */
export function intervalLabel(ms: number): string {
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return `${minutes} min`;
	const days = Math.round(ms / DAY_MS);
	if (days < 1) return `${Math.round(minutes / 60)} h`;
	if (days < 30) return days === 1 ? "1 day" : `${days} days`;
	const months = Math.round(days / 30);
	return months === 1 ? "1 month" : `${months} months`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** One TSV field: HTML-escaped, newlines as <br>, tabs flattened. */
function ankiField(text: string): string {
	return escapeHtml(text).replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
}

/**
 * Anki import file (File → Import, tab-separated, HTML on). Front is
 * the quote over its context sentence, back the answer over the
 * question asked. Dismissed cards stay out.
 */
export function ankiExport(
	cards: readonly ReviewCard[],
	schedule: ReviewSchedule
): string {
	const lines = ["#separator:tab", "#html:true", "#columns:Front\tBack"];
	for (const c of cards) {
		if (schedule[c.key]?.dismissed) continue;
		const front =
			`<b>${ankiField(c.quote)}</b>` +
			(c.context ? `<br><small>${ankiField(c.context)}</small>` : "");
		const back =
			ankiField(c.answer) +
			(c.note ? `<br><small>${ankiField(c.note)}</small>` : "");
		lines.push(`${front}\t${back}`);
	}
	return lines.join("\n") + "\n";
}

export function ankiFilename(now: Date = new Date()): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `ccez-flashcards-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.txt`;
}

const SCHEDULE_KEY = "ccez-llm-flashcards-v1";

export interface ScheduleStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function defaultStore(): ScheduleStore | null {
	return typeof localStorage === "undefined" ? null : localStorage;
}

function cleanSchedule(raw: unknown): CardSchedule | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.due !== "number" || !Number.isFinite(r.due)) return null;
	const interval =
		typeof r.interval === "number" && r.interval >= 0 ? r.interval : 0;
	const reps =
		typeof r.reps === "number" && r.reps >= 0 ? Math.floor(r.reps) : 0;
	return {
		due: r.due,
		interval,
		reps,
		...(r.dismissed === true ? { dismissed: true } : {})
	};
}

export function loadReviewSchedule(
	store: ScheduleStore | null = defaultStore()
): ReviewSchedule {
	try {
		const raw = store?.getItem(SCHEDULE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		const out: ReviewSchedule = {};
		for (const [key, value] of Object.entries(
			parsed as Record<string, unknown>
		)) {
			const clean = cleanSchedule(value);
			if (clean) out[key] = clean;
		}
		return out;
	} catch {
		return {};
	}
}

export function saveReviewSchedule(
	schedule: ReviewSchedule,
	store: ScheduleStore | null = defaultStore()
): void {
	try {
		store?.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
	} catch {
		// Storage full or blocked: the schedule stays memory-only.
	}
}

/**
 * One sitting. The page holds it in `$state` (plain object, replaced
 * on every step) next to the persisted schedule; the deck component
 * only renders it.
 */
export interface DeckSession {
	queue: ReviewCard[];
	index: number;
	flipped: boolean;
	/** Grades given this sitting (the done screen's count). */
	reviewed: number;
}

export function startSession(
	cards: readonly ReviewCard[],
	schedule: ReviewSchedule,
	now: number
): DeckSession {
	return {
		queue: sessionQueue(cards, schedule, now),
		index: 0,
		flipped: false,
		reviewed: 0
	};
}

export function currentCard(session: DeckSession): ReviewCard | null {
	return session.queue[session.index] ?? null;
}

export type DeckAction = "flip" | "again" | "good" | "dismiss";

/**
 * Advance a sitting. Grading an unflipped card flips it instead (the
 * answer always shows before a grade lands). "Again" re-queues the
 * card at the end of this sitting; "dismiss" drops it for good.
 */
export function stepSession(
	session: DeckSession,
	schedule: ReviewSchedule,
	action: DeckAction,
	now: number
): { session: DeckSession; schedule: ReviewSchedule } {
	const card = currentCard(session);
	if (!card) return { session, schedule };
	if (
		action === "flip" ||
		((action === "again" || action === "good") && !session.flipped)
	)
		return { session: { ...session, flipped: !session.flipped }, schedule };
	if (action === "dismiss") {
		const queue = session.queue.filter((_, i) => i !== session.index);
		return {
			session: { ...session, queue, flipped: false },
			schedule: {
				...schedule,
				[card.key]: dismissCard(schedule[card.key], now)
			}
		};
	}
	const queue = action === "again" ? [...session.queue, card] : session.queue;
	return {
		session: {
			queue,
			index: session.index + 1,
			flipped: false,
			reviewed: session.reviewed + 1
		},
		schedule: {
			...schedule,
			[card.key]: gradeCard(schedule[card.key], action, now)
		}
	};
}

/** Soonest upcoming due time among live cards, null when none. */
export function nextDueAt(
	cards: readonly ReviewCard[],
	schedule: ReviewSchedule,
	now: number
): number | null {
	let soonest: number | null = null;
	for (const c of cards) {
		const s = schedule[c.key];
		if (!s || s.dismissed || s.due <= now) continue;
		if (soonest === null || s.due < soonest) soonest = s.due;
	}
	return soonest;
}

/** Facts the open deck's key handler reads. */
export interface DeckKeyFacts {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	repeat: boolean;
	/** Focus sits on one of the deck's buttons (grades, Done, export). */
	onButton?: boolean;
}

/**
 * Keys while the deck is open. Space/Enter flip, 1/2 grade, S reads the
 * quote aloud, Delete or Backspace drops the card, Esc or the toggle
 * chord closes. Tab moves focus, and Space/Enter on a focused button
 * press that button (the done screen's Export and Done have no key of
 * their own). Other bare keys are swallowed so j/k/a never reach the
 * chat behind the veil; other modified chords pass through ("pass").
 */
export function deckKeyAction(
	facts: DeckKeyFacts
): DeckAction | "speak" | "close" | "swallow" | "pass" {
	if (facts.key === "Escape") return "close";
	if (isFlashcardsChord(facts)) return "close";
	if (facts.metaKey || facts.ctrlKey || facts.altKey) return "pass";
	if (facts.key === "Tab") return "pass";
	if (facts.repeat) return "swallow";
	if (facts.code === "Space" || facts.key === "Enter")
		return facts.onButton ? "pass" : "flip";
	if (facts.key === "1") return "again";
	if (facts.key === "2") return "good";
	if (facts.key === "Delete" || facts.key === "Backspace") return "dismiss";
	if (facts.code === "KeyS") return "speak";
	return "swallow";
}

/** ⇧⌘R / Ctrl+Shift+R (shell only: the browser hard-reloads on it). */
export function isFlashcardsChord(
	facts: Omit<DeckKeyFacts, "key" | "repeat">
): boolean {
	return (
		(facts.metaKey || facts.ctrlKey) &&
		facts.shiftKey &&
		!facts.altKey &&
		facts.code === "KeyR"
	);
}
