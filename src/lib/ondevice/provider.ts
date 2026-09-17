import {
	generateOnDevice,
	ONDEVICE_PROVIDER_ID,
	onDeviceErrorCopy,
	type OnDeviceDeps
} from "./bridge";
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
export class OnDeviceChatProvider implements ChatProvider {
	readonly id = ONDEVICE_PROVIDER_ID;

	constructor(private readonly deps?: OnDeviceDeps) {}

	async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
		throwIfAborted(opts.signal);
		const content = await generateOnDevice(
			formatOnDevicePrompt(messages),
			undefined,
			this.deps
		);
		throwIfAborted(opts.signal);
		return { content, usage: null };
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
