/**
 * Listening drills: the shapes the backend returns, what a drill chat
 * stores, the grading prompt, and the end-of-video summary. Pure.
 *
 * A drill is a chat. `Chat.listen` holds the video and its clips;
 * each clip is an assistant message whose `clip` field tracks the
 * guess. The message content stays empty until the guess goes in,
 * then holds the transcript, so every word is annotatable like any
 * reply. The translation and notes live on the clip and fold under it.
 */

import type { ClipSpan } from "./listenClips";
import { diffGuess, heardShare, type DiffOp } from "./listenDiff";

/** `VideoInfo` from the backend (`ccez-listen`, snake_case wire). */
export interface ListenVideo {
	id: string;
	title: string;
	channel: string;
	channel_url: string;
	duration: number;
	thumbnail: string;
	original_lang: string | null;
	audio: {
		kind: "native" | "dub";
		lang: string;
		itag: number;
		track: string | null;
		mime: string;
		auto: boolean;
	} | null;
	captions: { key: string; kind: "asr" | "uploaded" } | null;
}

/** A search or channel-page row. */
export interface ListenEntry {
	kind: "video" | "channel";
	/** Video id, or the channel URL. */
	id: string;
	title: string;
	channel: string;
	channel_url: string;
	duration: number;
	thumbnail: string;
}

export interface ListenChannelPage {
	name: string;
	url: string;
	videos: ListenEntry[];
}

/** YouTube's storyboard: sprite sheets of `rows` x `columns` frames,
 * one every `1 / fps` seconds. */
export interface ListenStoryboard {
	width: number;
	height: number;
	rows: number;
	columns: number;
	fps: number;
	sheets: { url: string; duration: number }[];
}

/** A fetched track: the json3 captions document plus the info. */
export interface ListenFetched {
	info: ListenVideo;
	audio_mime: string;
	captions: string;
	caption_kind: "asr" | "uploaded";
	storyboard?: ListenStoryboard | null;
}

/** One storyboard frame: its sheet and cell. */
export interface StoryboardFrame {
	url: string;
	col: number;
	row: number;
}

/** The storyboard frame showing at `t` seconds (the last one past the end). */
export function storyboardFrame(board: ListenStoryboard, t: number): StoryboardFrame | null {
	const perSheet = board.rows * board.columns;
	if (perSheet <= 0 || board.fps <= 0 || board.sheets.length === 0) return null;
	const total = board.sheets.length * perSheet;
	const n = Math.min(total - 1, Math.max(0, Math.floor(t * board.fps)));
	const sheet = board.sheets[Math.floor(n / perSheet)];
	if (!sheet) return null;
	const cell = n % perSheet;
	return { url: sheet.url, col: cell % board.columns, row: Math.floor(cell / board.columns) };
}

/** A channel on the learner's own list (settings; never built in). */
export interface ListenChannel {
	url: string;
	name: string;
	/** Its recent videos are folded away on the browse screen. */
	folded?: boolean;
}

/** What a drill chat stores about its video. */
export interface ListenSession {
	videoId: string;
	/** App language code the drill follows ("fr"). */
	lang: string;
	title: string;
	channel: string;
	channelUrl: string;
	thumbnail: string;
	audio: "native" | "dub";
	clips: ClipSpan[];
	/** Still frames, when YouTube has them. */
	storyboard?: ListenStoryboard | null;
}

export interface ClipNote {
	expr: string;
	meaning: string;
}

/** One clip message's drill state. */
export interface ClipState {
	i: number;
	/** What was typed; absent until answered. */
	guess?: string;
	/** "?" revealed it without a guess. */
	skipped?: boolean;
	/** Share of transcript words heard, 0..1. */
	heard?: number;
	ops?: DiffOp[];
	translation?: string;
	notes?: ClipNote[];
	/** Translation + notes: in flight, landed, or failed. */
	grade?: "pending" | "done" | "error";
}

/** Error codes from the backend into one sentence each. */
export function listenErrorCopy(error: unknown, langName: string): string {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("listen-needs-app")) return "Listening runs in the app, on your Mac or phone.";
	if (message.includes("listen-no-track")) return `That video has no ${langName} audio.`;
	if (message.includes("listen-no-captions"))
		return `That video's ${langName} audio has no transcript to check against.`;
	if (message.includes("listen-timeout")) return "YouTube took too long. Try again.";
	if (message.includes("listen-network")) return "Can't reach YouTube. Check the connection.";
	if (message.includes("listen-bot-check")) return "YouTube is asking for a check right now. Try again in a minute.";
	if (message.includes("listen-unavailable")) return "That video can't be played here.";
	if (message.includes("listen-no-videos")) return "No videos to drill on this channel.";
	if (message.includes("listen-bad-channel")) return "That doesn't look like a YouTube channel.";
	return "That didn't load. Try again.";
}

/** "French dub" / "French audio" / "no French audio yet". */
export function availabilityLabel(video: ListenVideo | undefined, langName: string): string {
	if (!video) return "";
	if (!video.audio) return `no ${langName} audio yet`;
	if (!video.captions) return `${langName} audio, no transcript`;
	if (video.audio.kind === "native") return `${langName} audio`;
	return video.audio.auto ? `${langName} auto-dub` : `${langName} dub`;
}

/** A video can be drilled: audio in the language plus its transcript. */
export function drillable(video: ListenVideo | undefined): boolean {
	return Boolean(video?.audio && video.captions);
}

/** A channel's status from its probed recent videos. */
export function channelLabel(videos: ListenVideo[], langName: string): string {
	if (videos.length === 0) return "";
	if (videos.some((v) => v.audio?.kind === "native" && v.captions)) return `${langName} audio`;
	if (videos.some((v) => drillable(v))) return `${langName} dubs`;
	return `no ${langName} audio yet`;
}

/** Native audio first, then dubs; within each, the list's order. */
export function rankVideos<T extends { id: string }>(
	rows: T[],
	info: Record<string, ListenVideo | undefined>
): T[] {
	const rank = (r: T): number => {
		const v = info[r.id];
		if (!v) return 2;
		if (!drillable(v)) return 3;
		return v.audio?.kind === "native" ? 0 : 1;
	};
	return rows
		.map((r, k) => ({ r, k }))
		.sort((a, b) => rank(a.r) - rank(b.r) || a.k - b.k)
		.map(({ r }) => r);
}

/** "8:41", "1:02:03". */
export function formatDuration(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * The grading request: translation plus short notes on what a
 * learner might not catch or know. It never sees the guess (the
 * diff is local and instant), so it can run before the learner
 * answers and be waiting when they do.
 */
export function gradePrompt(text: string, langName: string, before: string | null): string {
	const context = before ? `The line just before it (context only): «${before}»\n` : "";
	return (
		`A learner of ${langName} is listening to a video, one short clip at a time. ` +
		`This clip says:\n«${text}»\n${context}\n` +
		`Reply with JSON only, no fence: {"translation": "...", "notes": [{"expr": "...", "meaning": "..."}]}\n` +
		`- translation: natural English for the clip.\n` +
		`- notes: 0 to 3 items, only for what an intermediate learner could miss by ear or not know: ` +
		`idioms, verbs with their particles or prepositions, slang, false friends, contractions or ` +
		`liaisons that blur words. "expr" is the expression exactly as said in ${langName} ` +
		`(the whole unit, e.g. "déboucher sur"); "meaning" is 2 to 6 English words. ` +
		`No notes for plain words, names, or the sentence as a whole.`
	);
}

/** Parse the grading reply; null when it isn't the JSON asked for. */
export function parseGrade(reply: string): { translation: string; notes: ClipNote[] } | null {
	const body = reply
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.slice(start, end + 1));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const { translation, notes } = parsed as { translation?: unknown; notes?: unknown };
	if (typeof translation !== "string" || !translation.trim()) return null;
	const list = Array.isArray(notes) ? notes : [];
	return {
		translation: translation.trim(),
		notes: list
			.filter(
				(n): n is { expr: string; meaning: string } =>
					!!n &&
					typeof (n as { expr?: unknown }).expr === "string" &&
					typeof (n as { meaning?: unknown }).meaning === "string"
			)
			.map((n) => ({ expr: n.expr.trim(), meaning: n.meaning.trim() }))
			.filter((n) => n.expr && n.meaning)
			.slice(0, 3)
	};
}

/** Answer a clip: the diff, instantly. `guess` null is a "?" skip. */
export function answerClip(text: string, state: ClipState, guess: string | null, lang: string): ClipState {
	const typed = guess?.trim() ?? "";
	const diff = diffGuess(text, typed, lang);
	return {
		...state,
		guess: typed,
		skipped: guess === null,
		heard: heardShare(diff),
		ops: diff.ops
	};
}

export interface DrillSummary {
	answered: number;
	/** Transcript words heard across answered clips. */
	got: number;
	total: number;
	/** Fully heard clips. */
	perfect: number;
	/** Clip numbers heard worst (below 80%), worst first, at most 5. */
	missed: number[];
}

/** End-of-video tally from the clip states. */
export function summarizeDrill(states: ClipState[]): DrillSummary {
	let got = 0;
	let total = 0;
	let perfect = 0;
	const answered = states.filter((s) => s.heard !== undefined);
	for (const s of answered) {
		const ops = s.ops ?? [];
		const refs = ops.filter((o) => o.kind !== "extra").length;
		got += ops.filter((o) => o.kind === "ok" || o.kind === "near").length;
		total += refs;
		if ((s.heard ?? 0) >= 1) perfect++;
	}
	const missed = answered
		.filter((s) => (s.heard ?? 0) < 0.8)
		.sort((a, b) => (a.heard ?? 0) - (b.heard ?? 0) || a.i - b.i)
		.slice(0, 5)
		.map((s) => s.i);
	return { answered: answered.length, got, total, perfect, missed };
}

export interface ListenKeyFacts {
	key: string;
	code: string;
	alt: boolean;
	meta: boolean;
	ctrl: boolean;
	/** The active chat is a drill with a clip to play. */
	inDrill: boolean;
	/** The composer holds no text. */
	composerEmpty: boolean;
	/** Focus is in the composer. */
	inComposer: boolean;
	/** Focus is in some other text field (search, settings…). */
	inOtherField: boolean;
	/** The pointer rests on a message (its own keys win: A annotates). */
	hovered: boolean;
	/** Text is selected (Select + A annotates it). */
	selection: boolean;
}

export type ListenKeyAction = "play" | "slow" | "reveal" | "pass";

/**
 * Drill keys. ⌘Enter / Ctrl+Enter reveals, typed or not (a partial
 * guess is dropped). Space replays and "?" reveals while nothing is
 * typed (no guess starts with either; "?" is the phone's reveal). S
 * replays slowly and A reveals only outside the composer (guesses
 * start with either letter); A also yields to a hovered message or a
 * selection, where it annotates. The page aims S at a hovered clip.
 * ⌥Space / ⌥S work mid-guess. Matched on `code` where ⌥ rewrites the
 * character (⌥S types ß).
 */
export function listenKeyAction(f: ListenKeyFacts): ListenKeyAction {
	if (!f.inDrill || f.inOtherField) return "pass";
	if (f.meta || f.ctrl) return f.key === "Enter" && !f.alt ? "reveal" : "pass";
	if (f.alt) {
		if (f.code === "Space") return "play";
		if (f.code === "KeyS") return "slow";
		return "pass";
	}
	if (f.code === "Space" && f.composerEmpty) return "play";
	if (f.key === "?" && f.composerEmpty) return "reveal";
	if ((f.key === "s" || f.key === "S") && !f.inComposer) return "slow";
	if ((f.key === "a" || f.key === "A") && !f.inComposer && !f.hovered && !f.selection) return "reveal";
	return "pass";
}
