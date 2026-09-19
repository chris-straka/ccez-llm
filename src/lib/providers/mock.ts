import type {
	ChatMessage,
	ChatOptions,
	ChatProvider,
	ChatResult,
	StreamCallbacks
} from "./types";
import { messageText } from "./types";

/**
 * Dev/test-only provider: streams a canned reply so the chat UI (streaming
 * display, token meter, retry) can be exercised in a browser without API keys.
 * Enabled in the UI only when localStorage `ccez-mock-provider` is "1" and
 * the page is not inside the Tauri shell (see mockProviderEnabled).
 */
export class MockProvider implements ChatProvider {
	readonly id = "mock";

	chat(messages: ChatMessage[]): Promise<ChatResult> {
		// Promise interface (not async): the reply is canned, but the
		// provider contract is async so the signature stays put.
		return Promise.resolve({
			content: canned(messages),
			usage: { prompt: 10, completion: 12, total: 22 }
		});
	}

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts?: ChatOptions
	): Promise<ChatResult> {
		const full = canned(messages);
		// Test hook: slow the word cadence (ms) so specs can act
		// mid-stream (new-chat-while-thinking). Dev/test-only provider;
		// unset or invalid keeps the 15ms default.
		let wordMs = 15;
		try {
			const raw = typeof localStorage === "undefined" ? null : localStorage.getItem("ccez-mock-word-ms");
			const n = raw === null ? NaN : Number(raw);
			if (Number.isFinite(n) && n >= 0) wordMs = n;
		} catch {
			/* storage unavailable: default cadence */
		}
		for (const word of full.split(/(?<=\s)/)) {
			await new Promise((r) => setTimeout(r, wordMs));
			opts?.signal?.throwIfAborted();
			callbacks.onToken(word);
		}
		return { content: full, usage: { prompt: 10, completion: 12, total: 22 } };
	}
}

function canned(messages: ChatMessage[]): string {
	const last = [...messages].reverse().find((m) => m.role === "user");
	const excerpt = messageText(last?.content ?? "").slice(0, 60);
	return `Mock reply to: ${excerpt || "(empty)"}`;
}

export function mockProviderEnabled(): boolean {
	try {
		// Dev/test-only affordance: never inside the Tauri shell, where
		// a stray persisted flag would stick the real app (phone or
		// desktop) on canned replies under a "Mock provider active"
		// note. Same probe as tauriBackendAvailable in secrets.ts, kept
		// local so this module stays Tauri-import-free; the browser
		// preview and specs keep working.
		if (
			typeof window !== "undefined" &&
			(window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined)
		) {
			return false;
		}
		return localStorage.getItem("ccez-mock-provider") === "1";
	} catch {
		return false;
	}
}
