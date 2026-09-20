export interface TextPart {
	type: "text";
	text: string;
}

export interface ImagePart {
	type: "image_url";
	image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string | ContentPart[];
}

/** Plain-text view of a message, skipping image parts. */
export function messageText(content: string | ContentPart[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((p): p is TextPart => p.type === "text")
		.map((p) => p.text)
		.join("\n");
}

export interface TokenUsage {
	prompt: number;
	completion: number;
	total: number;
	/** Reasoning/thinking tokens, when the API reports them. */
	reasoning?: number | undefined;
}

export interface ChatResult {
	content: string;
	usage: TokenUsage | null;
}

export interface StreamCallbacks {
	onToken: (text: string) => void;
	/** Tool-fetch phase: fired around each page fetch so the UI can
	 * show Fetching instead of going silent mid-turn. Optional —
	 * providers without tools never fire them. */
	onFetchStart?: ((url: string) => void) | undefined;
	onFetchEnd?: (() => void) | undefined;
}

export interface ChatOptions {
	// Explicitly undefined-accepting: callers thread through an optional
	// controller, and providers tolerate its absence.
	signal?: AbortSignal | undefined;
	/** Native thinking option id (see providers/thinking.ts); providers
	 * without a knob for it send nothing. */
	thinking?: string | undefined;
}

export interface ChatProvider {
	readonly id: string;
	chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
	stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts?: ChatOptions
	): Promise<ChatResult>;
}

export class ProviderError extends Error {
	readonly status?: number | undefined;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
	}
}
