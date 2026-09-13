/**
 * Bucket intake: getting content IN and OUT of a chat.
 *
 * Four permission-gated, offline-first paths (free forever, no paid
 * accounts, no backend):
 *
 * 1. Screenshot-to-chat: `getDisplayMedia` captures one screen frame
 *    straight into the existing attachments pipeline.
 * 2. Drag-and-drop: `DataTransfer` files land in the same `addFiles`
 *    path the attach button and paste already use.
 * 3. File Handling: `launchQueue` opens `.md` files into the composer.
 * 4. Export: File System Access saves the chat as `.md`, falling back
 *    to a download blob where the picker is unavailable.
 *
 * Everything the DOM can't provide is injected, so the orchestration
 * unit-tests in node without permissions, windows, or a screen. The
 * two real DOM bridges (`grabVideoFrame`, `downloadMarkdownFile`)
 * need a live browser and are NOT covered here.
 */

/** Minimal stream shape: only the tracks we must stop after capture. */
export interface ScreenStreamLike {
	getVideoTracks(): { stop(): void }[];
}

/** True when screen capture can work in this runtime. */
export function screenshotCaptureAvailable(): boolean {
	try {
		const media = (navigator as Navigator & {
			mediaDevices?: { getDisplayMedia?: unknown };
		}).mediaDevices;
		return typeof media?.getDisplayMedia === "function";
	} catch {
		return false;
	}
}

/**
 * Capture one screen frame into a PNG File for the attachments path.
 * Tracks stop in `finally`, so a grab failure never leaves the
 * OS capture indicator on. Platform dismissals (Abort/NotAllowed)
 * propagate — callers stay silent via `isPermissionDismissal`.
 */
export async function captureScreenToFile<S extends ScreenStreamLike>(
	getDisplayMedia: (constraints: { video: boolean; audio: boolean }) => Promise<S>,
	grabFrame: (stream: S) => Promise<Blob>
): Promise<File> {
	const stream = await getDisplayMedia({ video: true, audio: false });
	try {
		const blob = await grabFrame(stream);
		return new File([blob], "screenshot.png", { type: blob.type || "image/png" });
	} finally {
		for (const track of stream.getVideoTracks()) {
			try {
				track.stop();
			} catch {
				// One stuck track must not break cleanup of the rest.
			}
		}
	}
}

/**
 * Real frame grabber: draws the live capture stream's first frame to
 * a canvas and resolves a PNG blob. Browser-only (needs video +
 * canvas); rejected grabs propagate to the caller.
 */
export function grabVideoFrame(stream: MediaStream): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.muted = true;
		const done = (error?: unknown): void => {
			video.srcObject = null;
			video.remove();
			if (error !== undefined) {
				reject(
					error instanceof Error ? error : new Error("Couldn't capture that frame.")
				);
			}
		};
		video.onloadeddata = () => {
			video.play().catch((error: unknown) => done(error));
		};
		video.onplaying = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, video.videoWidth);
				canvas.height = Math.max(1, video.videoHeight);
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					done(new Error("Canvas 2D unavailable"));
					return;
				}
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
				video.pause();
				canvas.toBlob((blob) => {
					if (blob) resolve(blob);
					else done(new Error("Couldn't capture that frame."));
				}, "image/png");
			} catch (error) {
				done(error);
			}
		};
		video.onerror = () => done(new Error("Couldn't read the capture stream."));
		video.srcObject = stream;
	});
}

/** True for Abort/permission dismissals the UI should swallow silently. */
export function isPermissionDismissal(error: unknown): boolean {
	return (
		(error instanceof DOMException &&
			(error.name === "AbortError" || error.name === "NotAllowedError")) ||
		(error instanceof Error &&
			(error.name === "AbortError" || error.name === "NotAllowedError"))
	);
}

/**
 * Files dropped onto the composer. Null entries and a missing
 * DataTransfer both mean "no files" — never a throw into the drop
 * handler.
 */
export function dropFilesFromDataTransfer(
	dataTransfer: { readonly files?: ArrayLike<File | null> | null } | null | undefined
): File[] {
	if (!dataTransfer?.files) return [];
	const out: File[] = [];
	for (const file of Array.from(dataTransfer.files)) {
		if (file) out.push(file);
	}
	return out;
}

/** A FileSystemFileHandle narrowed to the one method we call. */
export interface LaunchFileHandleLike {
	getFile(): Promise<File>;
}

/** launchQueue consumer params narrowed to the files we read. */
export interface LaunchParamsLike {
	files: LaunchFileHandleLike[];
}

/** launchQueue narrowed to the one method we call. */
export interface LaunchQueueLike {
	setConsumer(callback: (params: LaunchParamsLike) => void): void;
}

/** True when File Handling launches can arrive in this runtime. */
export function launchHandlingAvailable(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			typeof window.launchQueue?.setConsumer === "function"
		);
	} catch {
		return false;
	}
}

/**
 * Route File Handling launches into `onFiles`. Returns false (and
 * calls nothing) where launchQueue is missing. Unreadable handles
 * are skipped; an empty launch never calls back.
 */
export function consumeLaunchFiles(
	queue: LaunchQueueLike | null | undefined,
	onFiles: (files: File[]) => void | Promise<void>
): boolean {
	if (!queue || typeof queue.setConsumer !== "function") return false;
	queue.setConsumer((params) => {
		void (async () => {
			const files: File[] = [];
			for (const handle of params.files ?? []) {
				try {
					files.push(await handle.getFile());
				} catch {
					// One unreadable handle must not drop the readable rest.
				}
			}
			if (files.length > 0) await onFiles(files);
		})();
	});
	return true;
}

/** True for `.md` / `.markdown` files (case-insensitive). */
export function isMarkdownFilename(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.endsWith(".md") || lower.endsWith(".markdown");
}

/** Split launched files: markdown opens into the composer, the rest attach. */
export function splitLaunchFiles(files: File[]): { markdown: File[]; rest: File[] } {
	const markdown: File[] = [];
	const rest: File[] = [];
	for (const file of files) {
		if (isMarkdownFilename(file.name)) markdown.push(file);
		else rest.push(file);
	}
	return { markdown, rest };
}

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
