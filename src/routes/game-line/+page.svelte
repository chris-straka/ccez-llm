<!-- Game-line overlay (the Ace Attorney window): a small always-on-top
panel showing the last captured game line with furigana, its one-line
translation, and a speak button. The main window owns lines,
translations, and filing — this route only renders pushes over the
`game-line` event and reports selections back for the Game chat.
Selecting line text offers Annotate; filing sends quote + comment to
the main window, never a model call from here. Outside the shell the
route renders a note (same three-runtime degrade as area-pick). -->
<script lang="ts">
	import "../../app.css";
	import { onMount } from "svelte";
	import { emit, listen } from "@tauri-apps/api/event";
	import { furiganaHtml } from "$lib/furigana";
	import { speakNative, stopNative } from "$lib/nativeTts";
	import { tauriBackendAvailable } from "$lib/secrets";
	import {
		GAME_LINE_EVENT,
		GAME_LINE_FILE_EVENT,
		GAME_LINE_OPEN_EVENT,
		type GameLinePayload
	} from "$lib/gameLine";

	let line = $state<string | null>(null);
	let translation = $state<string | null>(null);
	let lineHtml = $state("");
	let speaking = $state(false);
	let speakError = $state<string | null>(null);
	let sel = $state<{ quote: string; x: number; y: number } | null>(null);
	let commenting = $state(false);
	let comment = $state("");
	let filed = $state(false);
	let boxEl: HTMLTextAreaElement | undefined = $state();
	let textEl: HTMLElement | undefined = $state();

	const inShell = tauriBackendAvailable();

	/** Furigana the pushed line (races resolve in push order). */
	let furiRun = 0;
	$effect(() => {
		const current = line;
		const run = ++furiRun;
		if (!current) {
			lineHtml = "";
			return;
		}
		void furiganaHtml(current).then((html) => {
			if (run === furiRun) lineHtml = html;
		});
	});

	onMount(() => {
		if (!inShell) return;
		let alive = true;
		void listen<GameLinePayload>(GAME_LINE_EVENT, (event) => {
			if (!alive) return;
			const payload = event.payload;
			if (!payload || typeof payload.line !== "string") return;
			line = payload.line;
			translation = payload.translation;
			sel = null;
			commenting = false;
			if (payload.theme === "dark" || payload.theme === "light") {
				document.documentElement.dataset.theme = payload.theme;
			}
		}).catch(() => {});
		void emit(GAME_LINE_OPEN_EVENT).catch(() => {});
		return () => {
			alive = false;
			stopNative();
		};
	});

	function toggleSpeak(): void {
		if (!line) return;
		if (speaking) {
			stopNative();
			speaking = false;
			return;
		}
		speakError = null;
		speaking = speakNative(line, "ja-JP", {
			onEnd: () => {
				speaking = false;
			},
			onError: (message) => {
				speaking = false;
				speakError = message;
			}
		});
	}

	function onTextMouseUp(): void {
		const selection = window.getSelection();
		const anchor = selection?.anchorNode;
		const el = anchor instanceof Element ? anchor : anchor?.parentElement;
		if (!selection || selection.isCollapsed || !el || !textEl?.contains(el)) {
			sel = null;
			return;
		}
		const quote = selection.toString().trim();
		if (!quote) {
			sel = null;
			return;
		}
		const rect = selection.getRangeAt(0).getBoundingClientRect();
		sel = { quote, x: rect.left + rect.width / 2, y: rect.bottom };
	}

	function onAnnotate(): void {
		commenting = true;
		comment = "";
		filed = false;
		requestAnimationFrame(() => boxEl?.focus());
	}

	async function onFile(): Promise<void> {
		if (!sel) return;
		try {
			await emit(GAME_LINE_FILE_EVENT, {
				quote: sel.quote,
				comment: comment.trim()
			});
		} catch {
			// Main window unreachable: keep the draft open.
			return;
		}
		window.getSelection()?.removeAllRanges();
		sel = null;
		commenting = false;
		filed = true;
	}
</script>

<main class="game-line">
	{#if !inShell}
		<p class="note">The game line needs the desktop app.</p>
	{:else if !line}
		<p class="note">Capture a game line — it shows up here.</p>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="game-text"
			bind:this={textEl}
			lang="ja"
			onmouseup={onTextMouseUp}
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- furiganaHtml is sanitized in furigana.ts -->
			{@html lineHtml}
		</div>
		{#if translation}
			<p class="game-translation">{translation}</p>
		{/if}
		<div class="game-row">
			<button type="button" onclick={toggleSpeak}>
				{speaking ? "Stop" : "Speak"}
			</button>
			{#if sel && !commenting}
				<button
					type="button"
					class="annotate-at"
					style="left: {sel.x}px; top: {sel.y}px;"
					onclick={onAnnotate}
				>
					Annotate
				</button>
			{/if}
			{#if filed}
				<span class="filed" role="status">Filed to Game chat.</span>
			{/if}
			{#if speakError}
				<span class="speak-error" role="alert">{speakError}</span>
			{/if}
		</div>
		{#if commenting && sel}
			<div class="game-comment">
				<textarea
					bind:this={boxEl}
					bind:value={comment}
					rows="2"
					placeholder="What does it mean?"
					aria-label="Annotation comment"></textarea>
				<div class="game-row">
					<button type="button" onclick={() => void onFile()}>File</button>
					<button
						type="button"
						onclick={() => {
							commenting = false;
						}}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}
	{/if}
</main>

<style>
	.game-line {
		margin: 0;
		padding: 0.8rem 0.9rem;
		/* Same stack as the main .app root (this route has no .app). */
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		font-size: 1rem;
		line-height: 1.5;
		background: #fff;
		background: var(--bg);
		color: #1c1c1e;
		color: var(--ink);
		min-height: 100vh;
		box-sizing: border-box;
	}
	.note {
		margin: 0;
		color: #6e6e73;
		color: var(--muted);
	}
	.game-text {
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	.game-text :global(p) {
		margin: 0 0 0.4rem;
	}
	.game-text :global(p:last-child) {
		margin-bottom: 0;
	}
	.game-translation {
		margin: 0.45rem 0 0;
		padding-top: 0.4rem;
		border-top: 1px solid #e5e5ea;
		border-top: 1px solid var(--line);
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.9em;
	}
	.game-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.game-row button {
		font: inherit;
		font-size: 0.85rem;
		padding: 0.25rem 0.7rem;
		border-radius: 8px;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		background: #fff;
		background: var(--bg-raised);
		color: inherit;
		cursor: pointer;
	}
	.annotate-at {
		position: fixed;
		transform: translate(-50%, 0.3rem);
		z-index: 10;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
	}
	.filed {
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
	}
	.speak-error {
		font-size: 0.85rem;
		color: #94250a;
		color: var(--error-ink);
	}
	.game-comment {
		margin-top: 0.6rem;
	}
	.game-comment textarea {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		font-size: 0.9rem;
		padding: 0.4rem 0.5rem;
		border-radius: 8px;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		background: #fff;
		background: var(--bg);
		color: inherit;
		resize: vertical;
	}
</style>
