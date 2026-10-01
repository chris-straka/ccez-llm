<!-- Big-word reader (see reader.ts): the screen goes plain and shows
the phrase being spoken as large as fits, with its sentence faded
underneath. Tap pauses (or, in tap mode, reads the next phrase),
swipes or arrows step sentences, swipe down or the close button
leaves. The page owns the session and speech; this component owns
the overlay, the fit, and the gestures. -->
<script lang="ts">
	import { fade } from "svelte/transition";
	import {
		phraseFontPx,
		readerGesture,
		type ReaderEvent,
		type ReaderState
	} from "$lib/reader";

	interface Props {
		reader: ReaderState;
		onEvent: (event: Exclude<ReaderEvent, "spoken">) => void;
		onClose: () => void;
	}

	let { reader, onEvent, onClose }: Props = $props();

	let vw = $state(typeof window === "undefined" ? 1024 : window.innerWidth);
	let vh = $state(typeof window === "undefined" ? 768 : window.innerHeight);
	const phrase = $derived(reader.phrases[reader.index]);
	const fontPx = $derived(phrase ? phraseFontPx(phrase.text, vw, vh) : 32);
	/** The sentence split around the current phrase (first match). */
	const sentenceParts = $derived.by(() => {
		if (!phrase) return null;
		const at = phrase.sentence.startsWith(phrase.text, phrase.at)
			? phrase.at
			: phrase.sentence.indexOf(phrase.text);
		if (at === -1) return { before: phrase.sentence, now: "", after: "" };
		return {
			before: phrase.sentence.slice(0, at),
			now: phrase.text,
			after: phrase.sentence.slice(at + phrase.text.length)
		};
	});
	const reducedMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;

	let down: { x: number; y: number } | null = null;
	function onPointerDown(e: PointerEvent): void {
		down = { x: e.clientX, y: e.clientY };
	}
	function onPointerUp(e: PointerEvent): void {
		if (!down) return;
		const g = readerGesture(e.clientX - down.x, e.clientY - down.y);
		down = null;
		if (g === "close") onClose();
		else if (g !== "spoken") onEvent(g);
	}
</script>

<svelte:window
	onresize={() => {
		vw = window.innerWidth;
		vh = window.innerHeight;
	}}
/>

<div
	class="reader"
	role="dialog"
	aria-modal="true"
	aria-label="Reader"
	tabindex="-1"
	onpointerdown={onPointerDown}
	onpointerup={onPointerUp}
	transition:fade={{ duration: reducedMotion ? 0 : 200 }}
>
	<button
		type="button"
		class="reader-close"
		aria-label="Close reader"
		title="Close (Esc)"
		onpointerdown={(e) => e.stopPropagation()}
		onpointerup={(e) => e.stopPropagation()}
		onclick={onClose}>×</button
	>
	{#if phrase}
		{#key reader.index}
			<p
				class="reader-phrase"
				dir="auto"
				style="font-size: {fontPx}px"
				in:fade={{ duration: reducedMotion ? 0 : 180 }}
			>
				{phrase.text}
			</p>
		{/key}
		{#if sentenceParts}
			<p class="reader-sentence" dir="auto">
				{sentenceParts.before}<mark>{sentenceParts.now}</mark
				>{sentenceParts.after}
			</p>
		{/if}
	{/if}
	<p class="reader-state" aria-live="polite">
		{#if reader.done}
			Done · tap to close
		{:else if reader.paused}
			Paused · tap to continue
		{:else if reader.mode === "tap"}
			Tap for the next part
		{/if}
	</p>
</div>

<style>
	.reader {
		position: fixed;
		inset: 0;
		/* Above every surface (composer, toasts, modals): it owns the screen. */
		z-index: 1000;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		padding: 2rem 6vw;
		box-sizing: border-box;
		background: var(--bg);
		color: var(--ink);
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
		outline: none;
	}
	.reader-phrase {
		margin: 0;
		max-width: 100%;
		font-weight: 650;
		line-height: 1.1; /* LINE_HEIGHT in reader.ts */
		text-align: center;
		overflow-wrap: anywhere;
	}
	.reader-sentence {
		margin: 0;
		max-width: 46rem;
		color: var(--muted);
		font-size: clamp(1.1rem, 3vw, 1.8rem);
		line-height: 1.4;
		text-align: center;
	}
	.reader-sentence mark {
		background: none;
		color: var(--ink);
		font-weight: 600;
	}
	.reader-state {
		position: absolute;
		bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));
		margin: 0;
		color: var(--muted);
		font-size: clamp(1rem, 2.4vw, 1.4rem);
		min-height: 1.4em;
	}
	.reader-close {
		position: absolute;
		top: max(1rem, env(safe-area-inset-top, 0px));
		right: 1rem;
		width: 3.5rem;
		height: 3.5rem;
		border: none;
		border-radius: 999px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 2.6rem;
		line-height: 1;
		cursor: pointer;
	}
	.reader-close:hover {
		color: var(--ink);
	}
	.reader-close:focus-visible {
		outline: 2px solid var(--focus);
	}
</style>
