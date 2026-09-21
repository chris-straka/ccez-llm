<script lang="ts">
	import { fade } from "svelte/transition";
	import {
		clearNotice,
		errorToastTimeoutFor,
		flashNotice,
		toastLong,
		type NoticeState
	} from "$lib/notices";

	interface Props {
		/** Shared notice proxy (owned by the page): reads stay
		reactive, flashes go through `notices.ts` like the page. */
		notices: NoticeState;
		/** Tap action armed on the current toast generation
		(reply-ready navigation): tapping the toast runs it instead
		of copying. The generation pins the lifetime — an expired
		toast never fires a stale action. */
		toastAction: { seq: number; run: () => void } | null;
	}

	let { notices, toastAction = $bindable() }: Props = $props();

	/** Plain-toast copy: silent on success (the toast is the
	confirmation); a failed write says so, guarded against clobbering
	a newer toast that landed meanwhile. */
	function copyToast(): void {
		const text = notices.toast.message;
		if (!text) return;
		if (!navigator.clipboard) {
			flashCopyFailure();
			return;
		}
		void navigator.clipboard.writeText(text).catch(() => {
			if (notices.toast.message === text) flashCopyFailure();
		});
	}

	function flashCopyFailure(): void {
		const message = "Couldn't copy to the clipboard.";
		flashNotice(notices, "errorToast", message, errorToastTimeoutFor(message));
	}

	/** Toast tap: an armed action (same generation) navigates;
	otherwise the tap copies the toast text. */
	function toastTap(): void {
		if (toastAction && toastAction.seq === notices.toast.seq) {
			const run = toastAction.run;
			toastAction = null;
			dismissToast();
			run();
			return;
		}
		copyToast();
	}

	function dismissToast(): void {
		clearNotice(notices, "toast");
	}

	/** Error toast tap: copies the failure text (bug reports, keys
	from 401s), then dismisses. A failed copy re-flashes red. */
	function errorToastTap(): void {
		const text = notices.errorToast.message;
		dismissErrorToast();
		if (!text) return;
		if (!navigator.clipboard) {
			flashCopyFailure();
			return;
		}
		void navigator.clipboard.writeText(text).catch(() => {
			flashCopyFailure();
		});
	}

	function dismissErrorToast(): void {
		clearNotice(notices, "errorToast");
	}
</script>

{#if notices.errorToast.message}
	<button
		type="button"
		class={toastLong(notices.errorToast.message)
			? "toast error long"
			: "toast error"}
		title="Click to copy"
		aria-live="polite"
		transition:fade={{ duration: 160 }}
		onclick={errorToastTap}>{notices.errorToast.message}</button
	>
{:else if notices.toast.message}
	<button
		type="button"
		class={toastLong(notices.toast.message) ? "toast long" : "toast"}
		title={toastAction && toastAction.seq === notices.toast.seq
			? "Open"
			: "Click to copy"}
		aria-live="polite"
		transition:fade={{ duration: 160 }}
		onclick={toastTap}>{notices.toast.message}</button
	>
{/if}

<style>
	.toast {
		position: fixed;
		/* Clear of the camera hole even when the WebView reports no
		safe-area (env() = 0): 3.5rem sits below the island either way. */
		top: max(3.5rem, calc(0.5rem + env(safe-area-inset-top, 0px)));
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1c1c1e;
		color: #f2f2f7;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.55rem 1rem;
		/* Outlined: on the dark theme the fill sits almost on top of
		the app background, so the ring does the noticing. */
		border: 1px solid #8e8e93;
		border-color: var(--line-hover);
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		white-space: nowrap;
	}
	/* Light plain toast (dark-always above): white card, ink text,
	quiet border — the same surface as the light edit card. Raw
	values like that card, not tokens: there is no surface token. */
	:global(html[data-theme="light"]) .toast:not(.error) {
		background: #fff;
		color: #1c1c1e;
		border-color: #e5e5ea;
	}
	/* Error toasts pair red both ways (same pairings as the banner):
	the tokens already resolve per theme, so no dark override block. */
	.toast.error {
		background: #fdecea;
		background: var(--error-bg);
		color: #94250a;
		color: var(--error-ink);
		border-color: #e0a392;
		border-color: var(--error-line);
	}
	/* Android toasts read at default text size, wrap, and scroll: a
	long error on a phone column blew the nowrap pill full-width.
	Plain and error share the base size, matching the voice error.
	The .app ancestor stays global (it renders paged, unscopable). */
	:global(.app[data-android]) .toast {
		font-size: 0.95rem;
		white-space: normal;
		max-width: calc(100vw - 2rem);
		max-height: 30vh;
		overflow-y: auto;
	}
	/* Long copy wraps into a card: the 999px stadium radius reads
	broken past ~two lines, so toasts over TOAST_LONG_CHARS ride
	the same 12px card radius as the app's other surfaces. */
	.toast.long {
		border-radius: 12px;
	}
</style>
