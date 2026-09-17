/**
 * EditContext support for CJK composition in the composer.
 *
 * The half-sent CJK problem: Enter during IME composition (notably pinyin)
 * confirms the composition AND submits the message halfway. The composer
 * guards `event.isComposing`; where the browser exposes the EditContext
 * API, we additionally attach it to the textarea so composition events
 * carry precise ranges instead of the legacy `isComposing` fallback.
 *
 * Pure decision helpers live here for Vitest; DOM attachment is a thin,
 * never-throwing wrapper. Fallback is always the current path.
 *
 * NOTE: EditContext has no TS lib types on all targets, so the global is
 * reached via globalThis indexing — never a bare name reference.
 */

/** Structural minimum of the EditContext instance we attach. */
export interface EditContextLike {
	updateText?(start: number, end: number, text: string): void;
}

/** True when the EditContext constructor exists in this runtime. */
export function editContextSupported(): boolean {
	try {
		return typeof (globalThis as Record<string, unknown>).EditContext === "function";
	} catch {
		return false;
	}
}

/**
 * Whether an Enter keydown must be ignored because an IME composition is
 * in flight. Either signal defers the submit.
 */
export function shouldDeferForComposition(input: {
	isComposing?: boolean;
	viewComposing?: boolean;
}): boolean {
	return input.isComposing === true || input.viewComposing === true;
}

/**
 * Attach an EditContext to a textarea where supported so CJK composition
 * updates arrive with exact ranges. Returns the context, or null when
 * unsupported — the caller keeps the current `isComposing` path.
 * Never throws (WebView API shapes disagree; composition must survive).
 */
export function attachEditContext(target: HTMLTextAreaElement): EditContextLike | null {
	try {
		if (!editContextSupported()) return null;
		const Ctor = (globalThis as Record<string, unknown>).EditContext as new () => EditContextLike;
		const ctx = new Ctor();
		// EditContext couples to the element via the `editContext` IDL
		// attribute where the browser implements it; where the setter is
		// absent the context is still returned for range reads.
		const el = target as HTMLTextAreaElement & { editContext?: EditContextLike | null };
		if ("editContext" in el) el.editContext = ctx;
		return ctx;
	} catch {
		return null;
	}
}
