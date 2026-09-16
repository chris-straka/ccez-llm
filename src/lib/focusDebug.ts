/**
 * Temporary focus-drop instrumentation (see issue-focus.md).
 *
 * Everything here is read-only observability: no behavior changes, no
 * state writes. All logging is gated on {@link focusDebugEnabled} so
 * normal sessions stay silent.
 *
 * Enable in the failing browser with one line in DevTools:
 *   localStorage.setItem("focusdebug", "1")
 * (or add `?focusdebug` to the URL), then reproduce and paste the
 * `[focusdbg]` lines back into the issue.
 */

let cachedQueryFlag: boolean | null = null;

/** True when focus-drop logging is wanted in this browser. */
export function focusDebugEnabled(): boolean {
	if (typeof window === "undefined") return false;
	try {
		if (window.localStorage?.getItem("focusdebug") === "1") return true;
	} catch {
		// Private-mode storage denial: fall through to the query flag.
	}
	if (cachedQueryFlag !== null) return cachedQueryFlag;
	try {
		cachedQueryFlag = new URLSearchParams(window.location.search).has("focusdebug");
	} catch {
		cachedQueryFlag = false;
	}
	return cachedQueryFlag;
}

/**
 * One-line label for an event target: `TEXTAREA.settings-base-url#id
 * [detached]` — enough to tell a node swap (detached, or two live
 * textareas) from a keystroke-eating fork (attached-and-1).
 */
export function describeFocusTarget(target: EventTarget | null | undefined): string {
	if (target === null || target === undefined) return String(target);
	if (typeof Element !== "undefined" && target instanceof Element) {
		const tag = target.tagName;
		const id = target.id !== "" ? `#${target.id}` : "";
		const cls =
			typeof target.className === "string" && target.className !== ""
				? `.${target.className.trim().split(/\s+/).slice(0, 3).join(".")}`
				: "";
		const connected = target.isConnected ? "" : " [detached]";
		return `${tag}${id}${cls}${connected}`;
	}
	if (typeof Node !== "undefined" && target instanceof Node) {
		return `#${target.nodeName}`;
	}
	return Object.prototype.toString.call(target);
}

/** Active-element snapshot in the same vocabulary as targets. */
export function describeActiveElement(): string {
	if (typeof document === "undefined") return "<no-document>";
	return describeFocusTarget(document.activeElement);
}

/** Gated log: silent unless {@link focusDebugEnabled}. */
export function focusLog(tag: string, details?: Record<string, unknown>): void {
	if (!focusDebugEnabled()) return;
	console.log(`[focusdbg] ${tag}`, details ?? "");
}
