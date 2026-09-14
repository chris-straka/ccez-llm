/**
 * Intake kernel: the two helpers every content path shares.
 *
 * Split down in REFACTOR §6 — the three intakes live beside it:
 * screen capture (`screenCapture.ts`), File Handling launches
 * (`launchFiles.ts`), and chat export (`chatExport.ts`). Drag-and-drop
 * files land in the same `addFiles` path the attach button and paste
 * already use; permission dismissals stay silent everywhere via
 * `isPermissionDismissal`.
 */
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
