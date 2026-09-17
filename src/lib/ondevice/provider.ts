import {
	generateOnDevice,
	ONDEVICE_PROVIDER_ID,
	onDeviceErrorCopy,
	type OnDeviceDeps
} from "./bridge";
import { fetchPageText } from "../fetchPage";
import {
	messageText,
	type ChatMessage,
	type ChatOptions,
	type ChatProvider,
	type ChatResult,
	type StreamCallbacks
} from "../providers/types";

/**
 * On-device ChatProvider behind the `local-gemma` pill: Gemini Nano
 * takes one text prompt (no roles, no images, no token counts), so
 * the turn history flattens to labeled lines and streaming resolves
 * the whole completion through a single `onToken` call. Errors arrive
 * as the seam's one-sentence copies — the send path toasts
 * `error.message` straight into its error slot, never a reroute.
 *
 * Stop is best-effort: an already-aborted signal rejects before (and
 * right after) the native call, but a mid-flight generation cannot be
 * cancelled — the model finishes unseen and the reply reports stopped.
 */
/** First http(s) URL in a text, if any. Pure. */
export function firstUrl(text: string): string | null {
	const match = /https?:\/\/[^\s)]+/.exec(text);
	return match ? match[0] : null;
}

export interface OnDeviceFetchDeps {
	fetchPage?: (url: string, signal?: AbortSignal) => Promise<string>;
}

export class OnDeviceChatProvider implements ChatProvider {
	readonly id = ONDEVICE_PROVIDER_ID;

	constructor(private readonly deps?: OnDeviceDeps & OnDeviceFetchDeps) {}

	async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
		throwIfAborted(opts.signal);
		const content = await generateOnDevice(
			formatOnDevicePrompt(await this.maybeEnrich(messages, opts.signal)),
			undefined,
			this.deps
		);
		throwIfAborted(opts.signal);
		return { content, usage: null };
	}

	/**
	 * The tool-less fallback: Gemini Nano can't call fetch_url, but
	 * when the user's own message carries a URL the app fetches it
	 * into context anyway. Fetch failures (offline especially) fall
	 * back to the plain history — never an error turn.
	 */
	private async maybeEnrich(
		messages: ChatMessage[],
		signal: AbortSignal | undefined
	): Promise<ChatMessage[]> {
		const last = messages[messages.length - 1];
		if (!last || last.role !== "user") return messages;
		const url = firstUrl(messageText(last.content));
		if (!url) return messages;
		try {
			const run = this.deps?.fetchPage ?? fetchPageText;
			const text = await run(url, signal);
			return [...messages, { role: "user", content: `Fetched page text for ${url}:\n${text}` }];
		} catch {
			return messages;
		}
	}

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts: ChatOptions = {}
	): Promise<ChatResult> {
		const result = await this.chat(messages, opts);
		if (result.content) callbacks.onToken(result.content);
		return result;
	}
}

/**
 * Flatten system + turns into one text prompt. System leads bare,
 * turns ride `role: text` lines, empties drop, image parts read as
 * their text siblings (see `messageText`). Pure.
 */
export function formatOnDevicePrompt(messages: ChatMessage[]): string {
	const lines: string[] = [];
	for (const message of messages) {
		const text = messageText(message.content).trim();
		if (!text) continue;
		lines.push(message.role === "system" ? text : `${message.role}: ${text}`);
	}
	return lines.join("\n\n");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error(onDeviceErrorCopy("cancelled"));
}
