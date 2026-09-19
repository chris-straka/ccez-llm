/**
 * View Transitions for chat switching.
 *
 * Wraps the chat-switch state mutation in `document.startViewTransition`
 * where supported so the outgoing/incoming chat cross-fade instead of
 * cutting. Where unsupported the mutation runs synchronously (instant
 * cut) — identical end state, no animation.
 */

/** True when the View Transitions API is available. */
export function viewTransitionsSupported(): boolean {
	try {
		return (
			typeof document !== "undefined" &&
			typeof (document as Document & { startViewTransition?: unknown })
				.startViewTransition === "function"
		);
	} catch {
		return false;
	}
}

/**
 * Scope the chat-switch snapshot to one element (the messages list) for
 * the duration of the transition, then release it. A standing
 * `view-transition-name` makes its element a stacking context, which
 * would trap overlay descendants (annotation badges) under the app
 * chrome forever — so the name lives only around the snapshot. The
 * forced reflow flushes the style before the snapshot is taken.
 * Returns the cleanup (idempotent).
 */
export function scopeMessagesTransition(box: HTMLElement | null): () => void {
	if (!box) return () => {};
	box.style.setProperty("view-transition-name", "messages");
	void box.offsetWidth;
	let done = false;
	return () => {
		if (done) return;
		done = true;
		box.style.removeProperty("view-transition-name");
	};
}

interface SwitchTransition {
	finished: Promise<unknown>;
	ready?: Promise<unknown>;
}

/**
 * Run a chat-switch mutation inside a view transition where supported,
 * otherwise synchronously. Resolves after the transition's update
 * callback has run. Never rejects: a failing transition falls back to
 * running the mutation directly.
 *
 * `onSnapshot` releases snapshot-only state (like the scoped
 * `messages` name): it fires at `ready` — both snapshots captured —
 * not at `finished`, whose animation phase can stall for seconds on
 * slow frames while the name keeps trapping overlay hit-testing. It
 * fires again after `finished` as a guarantee (idempotent callbacks
 * only), and immediately on the sync/fallback paths.
 */
export async function switchChatWithTransition(
	mutate: () => void,
	onSnapshot?: () => void
): Promise<void> {
	const doc = (typeof document !== "undefined" ? document : undefined) as
		| (Document & {
				startViewTransition?: (opts: {
					update: () => void;
				}) => SwitchTransition;
		  })
		| undefined;
	if (doc && typeof doc.startViewTransition === "function") {
		try {
			const transition = doc.startViewTransition({ update: mutate });
			if (onSnapshot && transition.ready instanceof Promise) {
				// Snapshot-only release rides `ready` (both snapshots
				// captured); rejections fall through to the post-finished
				// guarantee below.
				void transition.ready.then(onSnapshot, () => {});
			}
			await transition.finished.catch(() => {});
			onSnapshot?.();
			return;
		} catch {
			// Fall through to the instant cut below.
		}
	}
	mutate();
	onSnapshot?.();
}
