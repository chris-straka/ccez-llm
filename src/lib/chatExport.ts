/**
 * Chat export: one chat as a Markdown file.
 *
 * Split out of `intake.ts` (REFACTOR §6): `exportChatMarkdown` uses
 * the File System Access picker where available with an injected
 * download fallback (unit-tested in node); only
 * `downloadMarkdownFile` needs a live browser. User aborts propagate
 * — callers stay silent via `isPermissionDismissal` from `./intake`.
 */
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
		const text = message.content.replace(/\s+$/, "");
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
 * where available, otherwise the injected download fallback (an
 * anchor + blob URL in the real UI). Resolves `"picker"` or
 * `"download"` so callers can toast what happened. User aborts
 * propagate — callers stay silent via `isPermissionDismissal`.
 */
export async function exportChatMarkdown(
	chat: ExportableChat,
	deps: {
		picker?: ((options: SavePickerOptions) => Promise<SaveHandleLike>) | null | undefined;
		download?: ((text: string, filename: string) => void) | undefined;
	} = {}
): Promise<"picker" | "download"> {
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
	const download = deps.download;
	if (!download) throw new Error("No export path available.");
	download(text, filename);
	return "download";
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
