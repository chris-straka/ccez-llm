<!-- Weak-capture overlay: a low-confidence read stages here instead of
auto-sending (see runCaptureFlow in +page.svelte). The page owns the
staged text and both behaviors; this component owns the card markup.
Enter sends (IME composition excluded — learners type CJK here), Esc
dismisses through the page ladder, which also returns focus. -->
<script lang="ts">
	/** Page-owned overlay behaviors. */
	export interface CaptureOverlayActions {
		confirm: (text: string) => void;
		dismiss: () => void;
	}

	interface Props {
		text: string;
		confidence: number;
		actions: CaptureOverlayActions;
	}

	let { text, confidence, actions }: Props = $props();
	// Filled on mount (not a $state initializer): the card mounts
	// fresh per staging, so one fill is the whole lifetime.
	let draft = $state("");
	let input: HTMLInputElement | undefined = $state();
	$effect(() => {
		draft = text;
		input?.focus();
	});
</script>

<div class="capture-overlay" role="dialog" aria-label="Weak capture">
	<p class="capture-note">
		Weak capture ({Math.round(confidence * 100)}%) — check the text, then
		send.
	</p>
	<input
		class="capture-edit"
		bind:this={input}
		bind:value={draft}
		aria-label="Recognized text"
		autocomplete="off"
		spellcheck="false"
		onkeydown={(event) => {
			if (event.key === "Enter" && !event.isComposing)
				actions.confirm(draft);
		}}
	/>
	<div class="capture-row">
		<button
			type="button"
			class="capture-send"
			onclick={() => actions.confirm(draft)}>Send</button
		>
		<button
			type="button"
			class="capture-cancel"
			onclick={() => actions.dismiss()}>Cancel</button
		>
	</div>
</div>

<style>
	.capture-overlay {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: 8.5rem;
		z-index: 60;
		width: min(34rem, calc(100vw - 3rem));
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.7rem 0.9rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 12px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
	}
	.capture-note {
		margin: 0;
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
	}
	.capture-edit {
		font: inherit;
		font-size: 0.95rem;
		color: inherit;
		background: transparent;
		border: 0;
		outline: none;
		padding: 0;
		width: 100%;
		box-sizing: border-box;
	}
	.capture-row {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.capture-send,
	.capture-cancel {
		font: inherit;
		font-size: 0.85rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: none;
		color: inherit;
		padding: 0.3rem 0.9rem;
		cursor: pointer;
	}
	.capture-send {
		font-weight: 600;
	}
</style>
