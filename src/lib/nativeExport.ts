/**
 * Native chat-export save (Tauri `dialog` + `fs` plugins, PLUGIN.md #1).
 *
 * The File System Access picker exists in no webview, so the desktop
 * shell fell back to blob-download. This bridge offers the native
 * save dialog instead: `save()` picks the path (the dialog grants it
 * to the fs scope at runtime, so no static path scope), then
 * `writeTextFile` writes it. Browser preview keeps the picker path;
 * jsdom/node never touch the plugins (dynamic imports, like
 * `nativeHaptics` / `nativeNotifier` in `studyMedia.ts`). The dialog
 * and fs handles inject for tests. Never throws for absence or
 * abort — those resolve `null` / `"dismissed"`; a failed write
 * propagates like the picker path's so the caller still toasts the
 * failure.
 */
import { tauriBackendAvailable } from "./secrets";

/** Structural slice of the Tauri dialog plugin (dynamic import). */
export interface NativeSaveDialog {
	save(options?: {
		defaultPath?: string;
		filters?: { name: string; extensions: string[] }[];
	}): Promise<string | null>;
}

/** Structural slice of the Tauri fs plugin (dynamic import). */
export interface NativeSaveFs {
	writeTextFile(path: string, contents: string): Promise<void>;
}

export interface NativeSaveDeps {
	/** Shell detection override (tests); defaults to `tauriBackendAvailable()`. */
	shell?: boolean;
	dialog?: NativeSaveDialog | null | undefined;
	fs?: NativeSaveFs | null | undefined;
}

/**
 * Lazily load the dialog plugin. Dynamic so node/jsdom imports of
 * this module never touch Tauri; null when the plugin is missing.
 * Never throws.
 */
async function nativeDialog(): Promise<NativeSaveDialog | null> {
	try {
		const mod =
			(await import("@tauri-apps/plugin-dialog")) as unknown as Partial<NativeSaveDialog>;
		return typeof mod.save === "function" ? (mod as NativeSaveDialog) : null;
	} catch {
		return null;
	}
}

/**
 * Lazily load the fs plugin. Dynamic so node/jsdom imports of this
 * module never touch Tauri; null when the plugin is missing. Never
 * throws.
 */
async function nativeFs(): Promise<NativeSaveFs | null> {
	try {
		const mod =
			(await import("@tauri-apps/plugin-fs")) as unknown as Partial<NativeSaveFs>;
		return typeof mod.writeTextFile === "function"
			? (mod as NativeSaveFs)
			: null;
	} catch {
		return null;
	}
}

/**
 * Save Markdown through the native dialog. Resolves `"saved"` on a
 * completed write, `"dismissed"` on user cancel, `null` outside the
 * shell or when a plugin is missing (the caller falls through to
 * its download fallback). Never throws for those three; write
 * errors propagate.
 */
export async function nativeSaveMarkdown(
	filename: string,
	text: string,
	deps: NativeSaveDeps = {}
): Promise<"saved" | "dismissed" | null> {
	if (!(deps.shell ?? tauriBackendAvailable())) return null;
	// Explicit null injects absence (tests); undefined lazy-loads.
	const dialog = deps.dialog !== undefined ? deps.dialog : await nativeDialog();
	const fs = deps.fs !== undefined ? deps.fs : await nativeFs();
	if (!dialog || !fs) return null;
	const path = await dialog.save({
		defaultPath: filename,
		filters: [{ name: "Markdown", extensions: ["md"] }]
	});
	if (!path) return "dismissed";
	await fs.writeTextFile(path, text);
	return "saved";
}
