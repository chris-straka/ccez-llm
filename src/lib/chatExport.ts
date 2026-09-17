/**
 * Chat export: one chat as a Markdown file.
 *
 * Split out of `intake.ts` (REFACTOR §6): `exportChatMarkdown` uses
 * the File System Access picker where available with an injected
 * download fallback (unit-tested in node); only
 * `downloadMarkdownFile` needs a live browser. User aborts propagate
 * — callers stay silent via `isPermissionDismissal` from `./intake`.
 */
import { stripAttachmentMarkers } from "./attachments";

/** Chat narrowed to what the exporter reads. */
export interface ExportableMessage {
	role: string;
	content: string;
	attachments?: { name: string }[] | undefined;
}

/** Chat narrowed to what the exporter reads. */
export interface ExportableChat {
	messages: ExportableMessage[];
}

/**
 * One chat as Markdown: `## You` / `## Assistant` sections with
 * attachments listed under their message. Pure and deterministic
 * for tests; the filename comes from `exportFilename`.
 */
export function chatToMarkdown(chat: ExportableChat): string {
	const lines = ["# Chat export", ""];
	if (chat.messages.length === 0) {
		lines.push("(empty chat)", "");
		return lines.join("\n");
	}
	chat.messages.forEach((message, index) => {
		if (index > 0) lines.push("---", "");
		lines.push(message.role === "assistant" ? "## Assistant" : "## You", "");
		// Stored image literals are display tags; the attachment list
		// below names the files, so the prose exports clean.
		const text = stripAttachmentMarkers(message.content).replace(/\s+$/, "");
		lines.push(text ? text : "(no text)", "");
		for (const attachment of message.attachments ?? []) {
			lines.push(`- Attachment: ${attachment.name}`);
		}
		if ((message.attachments ?? []).length > 0) lines.push("");
	});
	return lines.join("\n");
}

/** Suggested export name: `chat-YYYY-MM-DD.md`. */
export function exportFilename(at: number = Date.now()): string {
	const date = new Date(at).toISOString().slice(0, 10);
	return `chat-${date}.md`;
}

/** True when the File System Access save picker can work here. */
export function fileSaveAccessAvailable(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			typeof window.showSaveFilePicker === "function"
		);
	} catch {
		return false;
	}
}

/** showSaveFilePicker options narrowed to what we pass. */
export interface SavePickerOptions {
	suggestedName?: string;
	types?: { description?: string; accept: Record<string, string[]> }[];
}

/** FileSystemFileHandle narrowed to what we call. */
export interface SaveHandleLike {
	createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/**
 * Export one chat as Markdown. Uses the File System Access picker
 * where available, then the injected native save (Tauri shell), then
 * the injected download fallback (an anchor + blob URL in the real
 * UI). Resolves `"picker"`, `"native"`, or `"download"` so callers
 * can toast what happened. User aborts propagate — callers stay
 * silent via `isPermissionDismissal`.
 */
export async function exportChatMarkdown(
	chat: ExportableChat,
	deps: {
		picker?: ((options: SavePickerOptions) => Promise<SaveHandleLike>) | null | undefined;
		native?: ((filename: string, text: string) => Promise<"saved" | "dismissed" | null>) | null | undefined;
		download?: ((text: string, filename: string) => void | Promise<void>) | undefined;
	} = {}
): Promise<"picker" | "native" | "download"> {
	const text = chatToMarkdown(chat);
	const filename = exportFilename();
	const pick = deps.picker;
	if (pick) {
		const handle = await pick({
			suggestedName: filename,
			types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }]
		});
		const writable = await handle.createWritable();
		await writable.write(text);
		await writable.close();
		return "picker";
	}
	if (deps.native) {
		const outcome = await deps.native(filename, text);
		if (outcome === "saved") return "native";
		// A dismissal stays silent like a picker abort: the AbortError
		// below rides the caller's `isPermissionDismissal` path, and a
		// missing native bridge falls through to the download.
		if (outcome === "dismissed") throw new DOMException("Export dismissed.", "AbortError");
	}
	const download = deps.download;
	if (!download) throw new Error("No export path available.");
	// Awaited: async fallbacks (clipboard) must finish — or throw
	// into the caller's failure toast — before resolving.
	await download(text, filename);
	return "download";
}

/**
 * Clipboard fallback for runtimes where a blob download goes nowhere
 * (the Android shell webview has no download manager: the anchor
 * click silently dies, or worse the webview tries to navigate). The
 * caller toasts "copied" so the tap always lands somewhere visible.
 * Throws like the download path when no clipboard exists, so the
 * caller still toasts the failure honestly.
 */
export interface ClipboardLike {
	writeText(text: string): Promise<void>;
}

export async function copyExportText(text: string, clipboard?: ClipboardLike | null): Promise<void> {
	const target =
		clipboard ?? (typeof navigator !== "undefined" ? (navigator.clipboard ?? null) : null);
	if (!target) throw new Error("No export path available.");
	await target.writeText(text);
}

/**
 * Real download fallback: blob URL behind an anchor click.
 * Browser-only (needs document + URL.createObjectURL).
 */
export function downloadMarkdownFile(text: string, filename: string): void {
	const blob = new Blob([text], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
