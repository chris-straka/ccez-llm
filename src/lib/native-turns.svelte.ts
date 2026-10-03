import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { Attachment } from "./attachments";
import {
	beginNativeResend,
	beginNativeSend,
	hasReplyStarted,
	isSending,
	markReplyStarted,
	settleNativeSend,
	unmarkReplyStarted,
	type Chat,
	type ChatId,
	type ChatMsgId,
	type ChatState,
	type PasteFold
} from "./chat";
import type { AppSettings } from "./settings";
import {
	applyTurnFile,
	dismissNativeTurn,
	errorTurnFile,
	markTurnInterrupted,
	nativeHistoryInput,
	nativeRouteFor,
	ownedNativeTurnIds,
	pollNativeTurn,
	releaseNativeTurn,
	resumableKilledTurn,
	scanNativeTurns,
	seenNativeTurn,
	startNativeTurn,
	stopNativeTurn,
	type NativeHistoryInput,
	type NativeTurnConfig,
	type NativeTurnFile,
	type NativeTurnOwnership,
	type TurnDoneEvent,
	type TurnFetchEvent,
	type TurnId,
	type TurnTokenEvent
} from "./turns";

/** The page facts the native route decision reads per send. */
export interface NativeRouteFacts {
	androidUI: boolean;
	shell: boolean;
	mock: boolean;
	onDevice: boolean;
}

/** Tauri's `listen`, narrowed to what the turn events need. */
export type TurnListen = <T>(
	event: string,
	handler: (event: { payload: T }) => void
) => Promise<() => void>;

/** Page-owned collaborators the native turns call back into. */
export interface NativeTurnsDeps {
	getChatState: () => ChatState;
	getSettings: () => AppSettings;
	routeFacts: () => NativeRouteFacts;
	/** System prompt for a resumed or resent turn on this chat. */
	systemFor: (chat: Chat | undefined) => string;
	isShell: () => boolean;
	isVisible: () => boolean;
	/** Snapshot before an append (see the page's stuckToBottom). */
	stuckToBottom: () => boolean;
	scrollAfterRender: () => void;
	/** The shared send tail (native completions). */
	afterSend: (chatId: ChatId) => void;
	/** Last-token stamp for the phase chip (shared with the TS engine). */
	markToken: (chatId: ChatId) => void;
	/** First-token haptic; `foreground` false stays silent. */
	buzzFirst: (foreground: boolean) => void;
	dismissReplyNotification: () => void;
}

/**
 * Native turns (Android shell): the runner streams a reply in Rust so
 * it survives the background. This owns the live-turn ownership maps,
 * the turn-event handlers, the send/resend/resume starts, and the
 * foreground/boot reconcile scan. Same shape as AnnotationDrafts: a
 * plain const holding the instance, never inside $state; the page
 * keeps the visibility and mount wiring.
 */
export class NativeTurns {
	private readonly deps: NativeTurnsDeps;

	/** Turn id → owning chat and the placeholder the runner fills.
	Survives nothing — a killed page rebuilds ownership from the turn
	files on boot instead. */
	readonly turns = new SvelteMap<TurnId, { chatId: ChatId; replyId: ChatMsgId }>();
	/** Streamed text per turn (a retry recompute clears its own). */
	readonly texts = new SvelteMap<TurnId, string>();
	/** Chats with a native page fetch in flight: the Fetching chip reads
	this alongside the TypeScript provider's flag, so both engines drive
	one indicator. */
	readonly fetching = new SvelteSet<ChatId>();
	/** Chats with a native turn in flight: the Thinking chip and the
	submit gate read this — native turns never raise the TypeScript
	sending flag, so without it a backgrounded-then-revisited reply
	would show neither dots nor a dead send button. */
	readonly live = new SvelteSet<ChatId>();
	/** Shared ownership bundle for releaseNativeTurn: same map
	identity, so the deletes stay reactive. */
	private readonly own: NativeTurnOwnership = {
		turns: this.turns,
		texts: this.texts,
		fetching: this.fetching,
		live: this.live
	};

	/** The scan in flight (see reconcile). */
	private reconciling: Promise<void> | null = null;
	private rescan = false;

	constructor(deps: NativeTurnsDeps) {
		this.deps = deps;
	}

	private get state(): ChatState {
		return this.deps.getChatState();
	}

	private chatById(id: ChatId): Chat | undefined {
		return this.state.chats.find((c) => c.id === id);
	}

	/** Native route decision (network text turns). Returns the provider
	config for the native runner, or null when the TypeScript engine
	stays on (including keyless: the provider resolution raises
	missing-key with the draft intact, same as any TypeScript send). */
	route(outgoing: Attachment[]): NativeTurnConfig | null {
		return nativeRouteFor(
			this.deps.routeFacts(),
			outgoing,
			this.deps.getSettings()
		);
	}

	/** Start one native turn for an already-opened placeholder. */
	private async start(
		chatId: ChatId,
		replyId: ChatMsgId,
		config: NativeTurnConfig,
		system: string,
		history: NativeHistoryInput
	): Promise<void> {
		const turnId = crypto.randomUUID() as TurnId;
		this.turns.set(turnId, { chatId, replyId });
		this.texts.set(turnId, "");
		this.live.add(chatId);
		try {
			await startNativeTurn({
				turn_id: turnId,
				chat_id: chatId,
				message_id: replyId,
				baseUrl: config.baseUrl,
				apiKey: config.apiKey,
				model: config.model,
				extraBody: config.extraBody,
				system,
				messages: history.messages,
				priorSummary: history.priorSummary,
				foldText: history.foldText,
				foldThrough: history.foldThrough
			});
		} catch {
			// The spawn itself failed: settle locally as a failed turn
			// so the existing Retry UI applies (same shape as any
			// provider error, never a wedged send).
			releaseNativeTurn(this.own, turnId, chatId);
			applyTurnFile(this.state, {
				turn_id: turnId,
				chat_id: chatId,
				message_id: replyId,
				status: "error",
				content: "",
				error: "Couldn't start the reply.",
				finished_at: Math.floor(Date.now() / 1000)
			});
			settleNativeSend(this.state, chatId);
			this.deps.afterSend(chatId);
		}
	}

	/** Fresh send: same preamble contract as the TypeScript path —
	baked text, kept attachments, folds — then the turn detaches and
	this returns. Tokens, fetch phase, retries, and completion land via
	the turn listeners. */
	async send(opts: {
		baked: string;
		kept: Attachment[];
		pasteFolds: PasteFold[];
		config: NativeTurnConfig;
		system: string;
	}): Promise<void> {
		// Before the append below (see stuckToBottom).
		const stuck = this.deps.stuckToBottom();
		const opened = beginNativeSend(this.state, opts.baked, {
			attachments: opts.kept,
			pasteFolds: opts.pasteFolds
		});
		// A duplicate send racing in: the first one owns the chat.
		if (!opened) return;
		const history = nativeHistoryInput(
			this.chatById(opened.chatId),
			opened.replyId
		);
		if (stuck) this.deps.scrollAfterRender();
		await this.start(
			opened.chatId,
			opened.replyId,
			opts.config,
			opts.system,
			history
		);
	}

	/** Resend (Retry after the failed reply was dismissed): the retried
	turn survives the background exactly like a fresh one.
	Non-user-last (or a racing send) no-ops, same as resendLast. */
	async resend(config: NativeTurnConfig): Promise<void> {
		// Before the append below (see stuckToBottom).
		const stuck = this.deps.stuckToBottom();
		const reopened = beginNativeResend(this.state);
		if (!reopened) return;
		const target = this.chatById(reopened.chatId);
		const history = nativeHistoryInput(target, reopened.replyId);
		if (stuck) this.deps.scrollAfterRender();
		await this.start(
			reopened.chatId,
			reopened.replyId,
			config,
			this.deps.systemFor(target),
			history
		);
	}

	/**
	 * Stop one chat's live turns: the runners settle each stopped turn,
	 * releasing its service claim so the shade notice dismisses with
	 * the chat instead of orphaning. Local ownership releases up front,
	 * so late completions find nothing and only dismiss their files.
	 * Best-effort per turn, never throws.
	 */
	async stopChat(chatId: ChatId): Promise<void> {
		const owned = ownedNativeTurnIds(this.turns, chatId);
		for (const turnId of owned) {
			try {
				await stopNativeTurn(turnId);
			} catch {
				// Settling releases locally either way below.
			}
			releaseNativeTurn(this.own, turnId, chatId);
		}
		if (owned.length > 0) settleNativeSend(this.state, chatId);
	}

	/** Subscribe the turn events (shell only). Suspension-safe by
	design — anything missed lands through the return/boot scan. The
	returned teardown is best-effort and never throws. */
	listen(listen: TurnListen): () => void {
		const offs: Array<() => void> = [];
		if (this.deps.isShell()) {
			const add = (p: Promise<() => void>): void => {
				void p.then((off) => offs.push(off));
			};
			add(listen<TurnTokenEvent>("turn-token", (e) => this.onToken(e.payload)));
			add(listen<TurnFetchEvent>("turn-fetch", (e) => this.onFetch(e.payload)));
			add(listen<TurnTokenEvent>("turn-retry", (e) => this.onRetry(e.payload)));
			add(
				listen<TurnDoneEvent>("turn-done", (e) => {
					void this.onDone(e.payload);
				})
			);
		}
		return () => {
			for (const off of offs.splice(0)) {
				try {
					off();
				} catch {
					// Already unlistened; shutdown is best-effort.
				}
			}
		};
	}

	/** Live-token event: accumulate per turn and swap the placeholder
	content wholesale (never mutate in place — same discipline as the
	TypeScript stream). Unknown turns (settled by a scan while
	suspended) are ignored. */
	onToken({ turn_id, token }: TurnTokenEvent): void {
		const owned = this.turns.get(turn_id);
		if (!owned) return;
		const target = this.chatById(owned.chatId);
		if (!target) return;
		const full = (this.texts.get(turn_id) ?? "") + token;
		this.texts.set(turn_id, full);
		this.deps.markToken(owned.chatId);
		if (!hasReplyStarted(this.state, owned.chatId)) {
			markReplyStarted(this.state, owned.chatId);
			// Foreground only: backgrounded, the reply-ready ping owns
			// the moment — a start rumble would buzz before the reply
			// has been received.
			this.deps.buzzFirst(
				this.state.activeChatId === owned.chatId && this.deps.isVisible()
			);
		}
		target.messages = target.messages.map((m) =>
			m.id === owned.replyId ? { ...m, content: full } : m
		);
	}

	/** Fetch-phase event (see `fetching`). */
	onFetch({ turn_id, phase }: TurnFetchEvent): void {
		const owned = this.turns.get(turn_id);
		if (!owned) return;
		if (phase === "start") this.fetching.add(owned.chatId);
		else this.fetching.delete(owned.chatId);
	}

	/** Retry event: the runner recomputes from scratch, so the
	accumulator (and its placeholder) clears — the final content still
	heals everything at completion. */
	onRetry({ turn_id }: TurnTokenEvent): void {
		const owned = this.turns.get(turn_id);
		if (!owned) return;
		this.texts.set(turn_id, "");
		// A cleared reply goes back to thinking dots — for transport
		// retries and tool-round retracts alike (same wire event).
		unmarkReplyStarted(this.state, owned.chatId);
		const target = this.chatById(owned.chatId);
		if (!target) return;
		target.messages = target.messages.map((m) =>
			m.id === owned.replyId ? { ...m, content: "" } : m
		);
	}

	/** Completion event: poll the file, render, settle, and run the
	shared tail — but only while the turn still owns its chat. A scan
	that settled first releases ownership, so a late event only
	dismisses the file instead of double-rendering. */
	async onDone({ turn_id }: TurnDoneEvent): Promise<void> {
		const owned = this.turns.get(turn_id);
		if (!owned) {
			try {
				await dismissNativeTurn(turn_id);
			} catch {
				// Already gone: scans dismiss what they settle.
			}
			return;
		}
		releaseNativeTurn(this.own, turn_id, owned.chatId);
		let file: NativeTurnFile;
		try {
			file = await pollNativeTurn(turn_id);
		} catch {
			file = errorTurnFile(turn_id, owned.chatId, owned.replyId);
		}
		const outcome = applyTurnFile(this.state, file);
		settleNativeSend(this.state, owned.chatId);
		// A visible page marks the turn seen, which stands down the
		// runner's background ping; backgrounded pages never call it.
		// Either way a ping for a reply rendering in front of the user
		// is always wrong (grace-expiry races), so it dies here too.
		if (this.deps.isVisible()) {
			try {
				await seenNativeTurn(turn_id);
			} catch {
				// A stray ping beats a lost reply.
			}
			this.deps.dismissReplyNotification();
		}
		try {
			await dismissNativeTurn(turn_id);
		} catch {
			// Scans dismiss what they settle; late events find nothing.
		}
		if (outcome === "applied") this.deps.afterSend(owned.chatId);
	}

	/** Restart a turn whose process died mid-flight: the request the
	provider API never held gets re-sent onto its own placeholder, so
	the user returns to thinking dots and a completed reply — never
	Retry. Strict shape (clean assistant placeholder still last,
	chat idle, key resolves), otherwise false and the caller falls
	back to interrupted. A resumed-then-killed turn resumes again on
	the next return; each restart owns a fresh turn id, so nothing
	loops inside one session. */
	private async resumeKilled(file: NativeTurnFile): Promise<boolean> {
		if (!resumableKilledTurn(this.state, file)) return false;
		const target = this.chatById(file.chat_id);
		const last = target?.messages[target.messages.length - 1];
		const prev = target?.messages[(target?.messages.length ?? 0) - 2];
		if (!target || !last || !prev || prev.role !== "user") return false;
		// Same route as a manual Retry (last user message's own
		// attachments decide images); a missing key keeps the draft
		// instead of erroring.
		const config = this.route(prev.attachments ?? []);
		if (!config) return false;
		const history = nativeHistoryInput(target, last.id);
		const state = this.state;
		state.sendingChatIds = [...state.sendingChatIds, target.id];
		state.sending = true;
		state.sendingChatId = target.id;
		if (this.deps.stuckToBottom()) this.deps.scrollAfterRender();
		await this.start(
			target.id,
			last.id,
			config,
			this.deps.systemFor(target),
			history
		);
		return true;
	}

	/** Foreground-return and boot reconciliation: every turn file the
	live listeners don't own gets rendered (finished), resumed
	(streaming with no live owner — a dead process — restarts, so the
	user returns to dots, never Retry), or dismissed (placeholder
	gone). Resume can fail (no key, chat busy): only then does the
	interrupted copy apply. Tail effects run only for chats that were
	actually waiting, so a boot scan never thumps for old news.
	Scans never overlap: a second one would see the first's resume as
	a busy chat and stamp its live placeholder interrupted. A call
	during a scan queues one rescan after it instead. */
	reconcile(): Promise<void> {
		if (!this.deps.isShell()) return Promise.resolve();
		if (this.reconciling) {
			this.rescan = true;
			return this.reconciling;
		}
		this.reconciling = (async () => {
			try {
				do {
					this.rescan = false;
					await this.scanOnce();
				} while (this.rescan);
			} finally {
				this.reconciling = null;
			}
		})();
		return this.reconciling;
	}

	private async scanOnce(): Promise<void> {
		let files: NativeTurnFile[];
		try {
			files = await scanNativeTurns();
		} catch {
			return;
		}
		for (const file of files) {
			// Live turns stream through their listeners; the scan only
			// covers what suspension (or death) took off the event path.
			if (file.status === "streaming" && this.turns.has(file.turn_id)) {
				continue;
			}
			releaseNativeTurn(this.own, file.turn_id, file.chat_id);
			const wasLive = isSending(this.state, file.chat_id);
			if (file.status === "streaming") {
				// A dead process never strands the user on Retry: the
				// turn restarts onto its own placeholder (dots again),
				// and a late completion heals everything. Only a
				// resume the page cannot rebuild falls back to
				// interrupted.
				if (await this.resumeKilled(file)) {
					// Ownership moved to the new turn; the stale file
					// still dismisses below.
				} else if (markTurnInterrupted(this.state, file)) {
					settleNativeSend(this.state, file.chat_id);
					if (wasLive) this.deps.afterSend(file.chat_id);
				}
			} else {
				if (applyTurnFile(this.state, file) === "applied") {
					settleNativeSend(this.state, file.chat_id);
					if (wasLive) this.deps.afterSend(file.chat_id);
				}
			}
			try {
				await dismissNativeTurn(file.turn_id);
			} catch {
				// A done event settling the same file first already did.
			}
		}
	}
}
