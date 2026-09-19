/**
 * Anti-feedback helpers for the message render effect.
 *
 * The render effect reports furigana load state up to the parent, and the
 * parent re-renders on every load-state change. If the effect reported
 * unconditionally (or re-started conversion on every re-run), completion's
 * `false` would trigger a re-render that re-runs the effect and restarts
 * the conversion: an infinite busy-toggle loop that pegs the CPU and
 * starves Svelte's flush so no click ever lands. These pure helpers pin
 * down the two contracts that break the loop; the component wires them in.
 */

/** Notify the parent of load-state changes, but never twice in a row. */
export function createAidLoadingReporter(
	notify: (loading: boolean) => void
): (loading: boolean) => void {
	let reported: boolean | null = null;
	return (loading: boolean) => {
		if (reported === loading) return;
		reported = loading;
		notify(loading);
	};
}

/**
 * Identity of one furigana conversion request: the raw text plus its
 * paste-fold layout. Re-runs with the same key (new marks array, new
 * callback identity from the parent) must re-stamp, never reconvert.
 */
export function furiganaRequestKey(
	content: string,
	pasteFolds: unknown
): string {
	return `${content}\n${JSON.stringify(pasteFolds ?? null)}`;
}

/**
 * Stable-reference memo for per-message arrays (annotation badges). The
 * render effect subscribes to the array identity, so a freshly built
 * array per parent render would re-run every message body on any change.
 * Same content returns the same reference; the cache is bounded and
 * content-keyed, so eviction only costs a rebuild, never correctness.
 */
export function createRefMemo<T>(
	keyOf: (item: T) => string
): (id: string, next: T[]) => T[] {
	const cache = new Map<string, { key: string; items: T[] }>();
	return (id: string, next: T[]) => {
		const key = next.map(keyOf).join("\n");
		const prev = cache.get(id);
		if (prev && prev.key === key) return prev.items;
		if (cache.size > 512) cache.clear();
		cache.set(id, { key, items: next });
		return next;
	};
}
