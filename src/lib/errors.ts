/**
 * Human text for anything a promise or platform call can reject with.
 * Tauri IPC denials and plugin errors often arrive as plain objects
 * or strings, never Error instances — String() on those prints
 * "[object Object]" into toasts, which is how "Window drag failed:
 * [object Object]" escaped. Pure so Vitest pins every shape.
 */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message || String(error);
	if (typeof error === "string") return error;
	if (error !== null && typeof error === "object") {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string" && message.length > 0) return message;
		try {
			const json = JSON.stringify(error);
			if (json !== undefined && json.length > 0) return json;
		} catch {
			/* Unstringifiable (circular): fall through to String(). */
		}
	}
	return String(error);
}
