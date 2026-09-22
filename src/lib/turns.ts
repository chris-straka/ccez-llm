import { invoke } from "@tauri-apps/api/core";
import {
	apiContent,
	persistChats,
	type ChatId,
	type ChatMsgId,
	type ChatMsg,
	type ChatState
} from "./chat";
import { messageText } from "./providers/types";
import type { Attachment } from "./attachments";
import {
	activeThinkingId,
	type AppSettings,
	type KeyValueStore
} from "./settings";
import { getProviderDef } from "./providers/registry";
import {
	resolveThinkingId,
	thinkingFor
} from "./providers/thinking";

/**
 * Native-turn bridge: the TypeScript side of the Rust turn runner
 * (`src-tauri/src/turn.rs`). The page owns placeholders, flags, and
 * reconciliation; Rust owns bytes, backoff, and files. Every invoke
 * below is promise-typed so tests mock one seam
 * (`@tauri-apps/api/core`).
 */

export interface NativeTurnUsage {
	prompt: number;
	completion: number;
	total: number;
}

/** Branded turn id: a chat id must never pass as a turn id. */
export type TurnId = string & { readonly kind: "turn" };

/** Finished (or streaming) turn file: mirrors the Rust `TurnFile`. */
export interface NativeTurnFile {
	turn_id: TurnId;
	chat_id: ChatId;
	message_id: ChatMsgId;
	status: string;
	content: string;
	error?: string | undefined;
	usage?: NativeTurnUsage | undefined;
	finished_at: number;
}

/** Event payloads from the runner (`turn-token`, `turn-fetch`, `turn-done`). */
export interface TurnTokenEvent {
	turn_id: TurnId;
	token: string;
}

export interface TurnFetchEvent {
	turn_id: TurnId;
	phase: string;
	url: string;
}

export interface TurnDoneEvent {
	turn_id: TurnId;
	chat_id: ChatId;
	status: string;
}

/**
 * Route a send to the native runner: Android shell, network provider
 * (on-device stays TypeScript — Nano has no HTTP turn to own), and
 * text-only history (image parts stay on the multimodal TypeScript
 * path). Everything else keeps today's engine.
 */
export function nativeTurnAvailable(opts: {
	androidUI: boolean;
	shell: boolean;
	mock: boolean;
	onDevice: boolean;
	hasImages: boolean;
}): boolean {
	return (
		opts.androidUI &&
		opts.shell &&
		!opts.mock &&
		!opts.onDevice &&
		!opts.hasImages
	);
}

/** Provider half of one native turn (system+history join at send time). */
export interface NativeTurnConfig {
	baseUrl: string;
	apiKey: string;
	model: string;
	extraBody: unknown;
}

/**
 * Provider config for one native turn, or null when there is no key
 * (the page raises its missing-key banner instead). Mirrors the
 * `resolveProvider` guards; thinking fields come from the same tables
 * the TypeScript engine sends, so both engines offer identical levels.
 */
export function nativeTurnConfig(
	settings: AppSettings
): NativeTurnConfig | null {
	const conf = settings.providers[settings.activeProviderId];
	if (!conf) return null;
	// Unknown ids (typos, retired customs) throw in the registry — a
	// native turn for one could never run, so refuse it like a blank key.
	let keyless: boolean;
	try {
		keyless =
			getProviderDef(settings.activeProviderId, settings.customProviders)
				?.keyless === true;
	} catch {
		return null;
	}
	if (!keyless && !conf.apiKey.trim()) return null;
	const support = thinkingFor(settings.activeProviderId, conf.model);
	return {
		baseUrl: conf.baseUrl,
		apiKey: conf.apiKey,
		model: conf.model,
		extraBody: support.wireFields(
			resolveThinkingId(support, activeThinkingId(settings))
		)
	};
}

/**
 * Text-only history for the runner, minus failed replies (same shape
 * as `buildApiMessages` without the system lead — Rust adds that).
 * Image parts flatten to their text siblings; true multimodal turns
 * never reach here (see `nativeTurnAvailable`).
 */
export function turnHistory(
	messages: ChatMsg[]
): Array<{ role: string; content: string }> {
	const out: Array<{ role: string; content: string }> = [];
	for (const message of messages) {
		if (message.role === "assistant" && message.error) continue;
		out.push({
			role: message.role,
			content: messageText(apiContent(message))
		});
	}
	return out;
}

/** Copy for turns a dead process left behind (boot/return scan). */
export const INTERRUPTED_COPY =
	"Reply interrupted — the app closed before it finished.";

/**
 * Render one scanned turn file onto its placeholder. Done fills
 * content+usage, error fills the error (existing Retry UI applies),
 * streaming files mean a live turn elsewhere — hands off. Returns
 * what happened so the page can settle, toast, or dismiss.
 */
export function applyTurnFile(
	state: ChatState,
	file: NativeTurnFile,
	store?: KeyValueStore
): "applied" | "missing" | "streaming" {
	if (file.status === "streaming") return "streaming";
	const chat = state.chats.find((c) => c.id === file.chat_id);
	const message = chat?.messages.find((m) => m.id === file.message_id);
	if (!chat || !message) return "missing";
	if (file.status === "done") {
		chat.messages = chat.messages.map((m) =>
			m.id === file.message_id
				? {
						...m,
						content: file.content,
						usage: file.usage
							? {
									prompt: file.usage.prompt,
									completion: file.usage.completion,
									total: file.usage.total
								}
							: null,
						error: null
					}
				: m
		);
	} else {
		chat.messages = chat.messages.map((m) =>
			m.id === file.message_id
				? { ...m, error: file.error ?? "Reply failed." }
				: m
		);
	}
	persistChats(state, store);
	return "applied";
}

/**
 * Mark one scanned turn interrupted: the placeholder fills with the
 * interrupted copy (Retry UI applies, like any failed turn). False
 * when the placeholder is gone (deleted mid-flight) — the page then
 * just dismisses the file.
 */
export function markTurnInterrupted(
	state: ChatState,
	file: NativeTurnFile,
	store?: KeyValueStore
): boolean {
	const chat = state.chats.find((c) => c.id === file.chat_id);
	const message = chat?.messages.find((m) => m.id === file.message_id);
	if (!chat || !message) return false;
	chat.messages = chat.messages.map((m) =>
		m.id === file.message_id ? { ...m, error: INTERRUPTED_COPY } : m
	);
	persistChats(state, store);
	return true;
}

/**
 * Resume shape for a turn whose process died mid-flight: the file's
 * chat exists and is idle, and the placeholder is still the last
 * message — a clean assistant message with no error (an errored one
 * belongs to an explicit Retry the user already owns). True means
 * the page may re-send onto that placeholder; anything else falls
 * back to the interrupted copy. Pure.
 */
export function resumableKilledTurn(
	state: ChatState,
	file: NativeTurnFile
): boolean {
	const chat = state.chats.find((c) => c.id === file.chat_id);
	if (!chat) return false;
	if (state.sendingChatIds.includes(chat.id)) return false;
	const last = chat.messages[chat.messages.length - 1];
	if (
		!last ||
		last.id !== file.message_id ||
		last.role !== "assistant" ||
		last.error
	)
		return false;
	const prev = chat.messages[chat.messages.length - 2];
	return !!prev && prev.role === "user";
}

export async function startNativeTurn(req: {
	turn_id: TurnId;
	chat_id: ChatId;
	message_id: ChatMsgId;
	baseUrl: string;
	apiKey: string;
	model: string;
	extraBody: unknown;
	system: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<string> {
	return invoke<string>("turn_start", {
		req: {
			turn_id: req.turn_id,
			chat_id: req.chat_id,
			message_id: req.message_id,
			base_url: req.baseUrl,
			api_key: req.apiKey,
			model: req.model,
			extra_body: req.extraBody,
			system: req.system,
			messages: req.messages
		}
	});
}

export async function pollNativeTurn(turnId: TurnId): Promise<NativeTurnFile> {
	return invoke<NativeTurnFile>("turn_poll", { turnId });
}

export async function scanNativeTurns(): Promise<NativeTurnFile[]> {
	return invoke<NativeTurnFile[]>("turn_scan");
}

export async function stopNativeTurn(turnId: TurnId): Promise<boolean> {
	return invoke<boolean>("turn_stop", { turnId });
}

export async function seenNativeTurn(turnId: TurnId): Promise<boolean> {
	return invoke<boolean>("turn_seen", { turnId });
}

export async function dismissNativeTurn(turnId: TurnId): Promise<boolean> {
	return invoke<boolean>("turn_dismiss", { turnId });
}

/**
 * Native route decision (REFACTOR §6): the provider config for the
 * native runner, or null when the TypeScript engine stays on
 * (including keyless: the provider resolution raises missing-key
 * with the draft intact, same as any TypeScript send).
 */
export function nativeRouteFor(
	facts: {
		androidUI: boolean;
		shell: boolean;
		mock: boolean;
		onDevice: boolean;
	},
	outgoing: Attachment[],
	settings: AppSettings
): NativeTurnConfig | null {
	const available = nativeTurnAvailable({
		...facts,
		hasImages: outgoing.some((a) => a.kind === "image")
	});
	if (!available) return null;
	return nativeTurnConfig(settings);
}

/**
 * Error file for an unpollable turn (REFACTOR §6): a completion
 * whose file never materialized still settles as a failed reply —
 * the shared tail raises Retry on the chat instead of hanging.
 */
export function errorTurnFile(
	turnId: TurnId,
	chatId: ChatId,
	replyId: ChatMsgId
): NativeTurnFile {
	return {
		turn_id: turnId,
		chat_id: chatId,
		message_id: replyId,
		status: "error",
		content: "",
		error: "Reply failed.",
		finished_at: Math.floor(Date.now() / 1000)
	};
}
