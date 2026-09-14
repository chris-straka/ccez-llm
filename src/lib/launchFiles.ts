/**
 * File Handling launch intake: OS-opened files into composer/attachments.
 *
 * Split out of `intake.ts` (REFACTOR §6): `consumeLaunchFiles` routes
 * `launchQueue` handles with everything injected (unit-tested in
 * node), and `splitLaunchFiles` sends markdown to the composer and
 * the rest to attachments.
 */
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
