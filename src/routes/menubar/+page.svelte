<!-- The menu bar Ask (macOS): the small window under ccez-llm's menu bar
icon, shaped like Spotlight. Empty, it is just the field; the window grows
with the thread (up to a cap, then the thread scrolls). A question goes to
the main window, which answers with the chosen provider and files the
thread (`$lib/menubarAsk`); this route only shows the thread and sends what
is typed. Enter asks, ⌘Enter carries on in Ccez LLM, ⌘N starts over, Escape
hides; a thread left five minutes starts over when the window opens again.
Outside the shell the route renders a note. -->
<script lang="ts">
	import "../../app.css";
	import { onMount, tick } from "svelte";
	import { tauriBackendAvailable } from "$lib/secrets";
	import {
		MENUBAR_ASK_EVENT,
		MENUBAR_DELTA_EVENT,
		MENUBAR_DONE_EVENT,
		MENUBAR_FAILED_EVENT,
		MENUBAR_OPEN_EVENT,
		MENUBAR_RESET_MS,
		MENUBAR_RETRACT_EVENT,
		newAskChatId,
		oneASite,
		siteName,
		threadFor
	} from "$lib/menubarAsk";

	interface Turn {
		id: number;
		q: string;
		a: string;
		cited: string[];
		failed: string;
		done: boolean;
	}

	/** The most the window grows to (its width is menubar.rs's). */
	const MAX_HEIGHT = 520;

	const inShell = tauriBackendAvailable();
	let turns = $state<Turn[]>([]);
	let text = $state("");
	let chat = newAskChatId();
	let lastActive = Date.now();
	let copied = $state<number | null>(null);
	let field: HTMLTextAreaElement | undefined = $state();
	let thread: HTMLElement | undefined = $state();
	let panel: HTMLElement | undefined = $state();
	const busy = $derived(turns.some((t) => !t.done));
	const mac =
		typeof navigator !== "undefined" && /Mac/.test(navigator.platform ?? "");

	function update(id: number, change: (t: Turn) => Turn): void {
		turns = turns.map((t) => (t.id === id ? change(t) : t));
		lastActive = Date.now();
		void tick().then(() => thread?.scrollTo({ top: thread.scrollHeight }));
	}

	async function ask(): Promise<void> {
		const q = text.trim();
		if (!q || busy || !inShell) return;
		const id = Date.now();
		turns = [...turns, { id, q, a: "", cited: [], failed: "", done: false }];
		text = "";
		lastActive = Date.now();
		const { emitTo } = await import("@tauri-apps/api/event");
		await emitTo("main", MENUBAR_ASK_EVENT, {
			id,
			chat,
			messages: threadFor(turns)
		}).catch(() =>
			update(id, (t) => ({
				...t,
				failed: "Ccez LLM isn't answering.",
				done: true
			}))
		);
		await tick();
		thread?.scrollTo({ top: thread.scrollHeight });
	}

	function retry(t: Turn): void {
		turns = turns.filter((x) => x.id !== t.id);
		text = t.q;
		void ask();
	}

	function startOver(): void {
		turns = [];
		chat = newAskChatId();
		text = "";
		field?.focus();
	}

	async function carryOn(): Promise<void> {
		if (turns.length === 0) return;
		const { emitTo } = await import("@tauri-apps/api/event");
		await emitTo("main", MENUBAR_OPEN_EVENT, { chat }).catch(() => undefined);
		startOver();
	}

	async function copy(t: Turn): Promise<void> {
		try {
			await navigator.clipboard.writeText(t.a);
			copied = t.id;
			setTimeout(() => {
				if (copied === t.id) copied = null;
			}, 1200);
		} catch {
			// No clipboard here: the text stays selectable.
		}
	}

	async function openLink(url: string): Promise<void> {
		try {
			// The opener plugin's own command, as the browser pane calls it.
			const { invoke } = await import("@tauri-apps/api/core");
			await invoke("plugin:opener|open_url", { url });
		} catch {
			// No opener: the address stays in the chat's sources.
		}
	}

	async function hide(): Promise<void> {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("menubar_hide").catch(() => undefined);
	}

	function onKey(event: KeyboardEvent): void {
		const cmd = event.metaKey || event.ctrlKey;
		if (event.key === "Escape") {
			event.preventDefault();
			void hide();
		} else if (event.key === "Enter" && cmd) {
			event.preventDefault();
			void carryOn();
		} else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void ask();
		} else if (cmd && event.key.toLowerCase() === "n") {
			event.preventDefault();
			startOver();
		}
	}

	/** The field grows with what's typed, up to four lines. */
	function fitField(): void {
		if (!field) return;
		field.style.height = "auto";
		field.style.height = `${Math.min(field.scrollHeight, 4 * 24)}px`;
	}
	$effect(() => {
		void text;
		void tick().then(fitField);
	});

	function applyTheme(): void {
		let mode = "system";
		try {
			const raw = localStorage.getItem("ccez-llm-settings-v1");
			const t = raw ? (JSON.parse(raw) as { theme?: unknown }).theme : null;
			if (t === "light" || t === "dark") mode = t;
		} catch {
			// Unreadable settings: the system's.
		}
		document.documentElement.dataset.theme =
			mode === "system"
				? matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: mode;
	}

	onMount(() => {
		applyTheme();
		if (!inShell) return;
		let alive = true;
		const stops: (() => void)[] = [];
		// The window takes the panel's height: just the field when empty.
		let sized = 0;
		const resize = new ResizeObserver(() => {
			if (!panel) return;
			const h = Math.min(
				MAX_HEIGHT,
				Math.ceil(panel.getBoundingClientRect().height)
			);
			if (h === sized) return;
			sized = h;
			// Through the shell, which keeps the top edge under the icon.
			void import("@tauri-apps/api/core").then(({ invoke }) =>
				invoke("menubar_fit", { height: h }).catch(() => undefined)
			);
		});
		if (panel) resize.observe(panel);
		stops.push(() => resize.disconnect());
		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			const { getCurrentWindow } = await import("@tauri-apps/api/window");
			type P = { id: number; text?: string; cited?: string[] };
			const on = async (name: string, fn: (p: P) => void): Promise<void> => {
				const stop = await listen<P>(name, (e) => {
					if (alive && e.payload && typeof e.payload.id === "number")
						fn(e.payload);
				});
				stops.push(stop);
			};
			await on(MENUBAR_DELTA_EVENT, (p) =>
				update(p.id, (t) => ({ ...t, a: t.a + (p.text ?? "") }))
			);
			await on(MENUBAR_RETRACT_EVENT, (p) =>
				update(p.id, (t) => ({ ...t, a: "" }))
			);
			await on(MENUBAR_DONE_EVENT, (p) =>
				update(p.id, (t) => ({
					...t,
					a: p.text ?? t.a,
					cited: Array.isArray(p.cited) ? oneASite(p.cited).slice(0, 4) : [],
					done: true
				}))
			);
			await on(MENUBAR_FAILED_EVENT, (p) =>
				update(p.id, (t) => ({
					...t,
					failed: p.text ?? "No answer came.",
					done: true
				}))
			);
			// Shown again: a thread left a while starts over; the field is ready.
			const stopFocus = await getCurrentWindow().onFocusChanged(
				({ payload }) => {
					if (!payload) return;
					applyTheme();
					if (
						!busy &&
						turns.length > 0 &&
						Date.now() - lastActive > MENUBAR_RESET_MS
					)
						startOver();
					void tick().then(() => field?.focus());
				}
			);
			stops.push(stopFocus);
			// Debug builds: scripts/drive.ts --window menubar runs JavaScript
			// here (release builds have no drive_ready, so no listener).
			const { invoke } = await import("@tauri-apps/api/core");
			const ready = await invoke("drive_ready").then(
				() => true,
				() => false
			);
			if (!ready || !alive) return;
			const stopDrive = await listen<{
				id: string;
				script: string;
				window?: string;
			}>("drive-js", ({ payload }) => {
				if (payload.window !== "menubar") return;
				void (async () => {
					let value: unknown;
					try {
						// Debug builds only: running the script is the point.
						// eslint-disable-next-line @typescript-eslint/no-implied-eval
						const run = new Function(
							`return (async () => { ${payload.script} })()`
						) as () => Promise<unknown>;
						value = { ok: true, data: (await run()) ?? null };
					} catch (error) {
						value = { ok: false, error: String(error) };
					}
					await invoke("drive_result", { id: payload.id, value }).catch(
						() => {}
					);
				})();
			});
			stops.push(stopDrive);
		})();
		field?.focus();
		return () => {
			alive = false;
			for (const stop of stops) stop();
		};
	});
</script>

<main class="menubar-ask" bind:this={panel}>
	{#if !inShell}
		<p class="note">The menu bar Ask needs the Mac app.</p>
	{:else}
		<div class="ask-row">
			<svg class="glyph" viewBox="0 0 36 36" aria-hidden="true">
				<path
					d="M9 6h18a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-6 5v-5H9a5 5 0 0 1-5-5V11a5 5 0 0 1 5-5z"
				/>
			</svg>
			<textarea
				bind:this={field}
				bind:value={text}
				class="field"
				rows="1"
				placeholder={turns.length ? "Ask a follow-up" : "Ask anything"}
				aria-label="Ask"
				onkeydown={onKey}></textarea>
		</div>
		<div class="progress" class:on={busy} aria-hidden="true"></div>
		{#if turns.length > 0}
			<section class="thread" bind:this={thread} aria-live="polite">
				{#each turns as t (t.id)}
					<article class="turn">
						<h2 class="q">{t.q}</h2>
						{#if t.failed}
							<p class="failed">
								{t.failed}
								<button type="button" class="chip" onclick={() => retry(t)}
									>Retry</button
								>
							</p>
						{:else if t.a}
							<p class="a">{t.a}</p>
							{#if t.done}
								<button
									type="button"
									class="copy"
									title="Copy the answer"
									aria-label="Copy the answer"
									onclick={() => void copy(t)}
									>{copied === t.id ? "Copied" : "Copy"}</button
								>
							{/if}
						{:else}
							<p class="a waiting">Thinking…</p>
						{/if}
						{#if t.cited.length > 0}
							<div class="sources">
								{#each t.cited as u (u)}
									<button
										type="button"
										class="chip"
										title={u}
										onclick={() => void openLink(u)}>{siteName(u)}</button
									>
								{/each}
							</div>
						{/if}
					</article>
				{/each}
			</section>
			<footer>
				<button type="button" class="key" onclick={() => void carryOn()}
					><kbd>{mac ? "⌘" : "Ctrl"}↵</kbd> Open in Ccez LLM</button
				>
				<button type="button" class="key" onclick={startOver}
					><kbd>{mac ? "⌘" : "Ctrl"}N</kbd> New</button
				>
				<button type="button" class="key" onclick={() => void hide()}
					><kbd>esc</kbd> Close</button
				>
			</footer>
		{/if}
	{/if}
</main>

<style>
	/* The window is clear: the panel (and the Mac's frosted glass under
	it, menubar.rs) is all there is. */
	:global(html),
	:global(body) {
		background: transparent;
		margin: 0;
		overflow: hidden;
	}
	.menubar-ask {
		--glass: color-mix(in srgb, var(--bg-raised) 78%, transparent);
		box-sizing: border-box;
		max-height: 520px;
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		border: 0.5px solid color-mix(in srgb, var(--ink) 18%, transparent);
		background: var(--glass);
		color: var(--ink);
		/* Same stack as the main .app root (this route has no .app). */
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		-webkit-font-smoothing: antialiased;
		overflow: hidden;
	}
	.ask-row {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
	}
	.glyph {
		flex: none;
		width: 20px;
		height: 20px;
		margin-top: 2px;
		fill: none;
		stroke: var(--muted);
		stroke-width: 2.6;
		stroke-linejoin: round;
	}
	.field {
		flex: 1;
		resize: none;
		border: 0;
		outline: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 1.15rem;
		line-height: 24px;
		height: 24px;
		padding: 0;
		overflow-y: auto;
	}
	.field::placeholder {
		color: var(--muted);
		opacity: 0.8;
	}
	/* Working: a thin light running along the field's foot. */
	.progress {
		height: 1.5px;
		background: color-mix(in srgb, var(--ink) 10%, transparent);
	}
	.progress.on {
		background:
			linear-gradient(
					90deg,
					transparent 0%,
					var(--accent) 50%,
					transparent 100%
				)
				0 0 / 40% 100% no-repeat,
			color-mix(in srgb, var(--ink) 10%, transparent);
		animation: run 1.1s ease-in-out infinite;
	}
	@keyframes run {
		from {
			background-position: -40% 0;
		}
		to {
			background-position: 140% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.progress.on {
			animation: none;
			background: var(--accent);
			opacity: 0.6;
		}
	}
	.thread {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 0.25rem 1rem 0.5rem;
	}
	.turn {
		position: relative;
		padding: 0.75rem 0;
	}
	.turn + .turn {
		border-top: 0.5px solid color-mix(in srgb, var(--ink) 14%, transparent);
	}
	.q {
		margin: 0 0 0.3rem;
		/* Room for the Copy button that shows on hover. */
		padding-right: 3.5rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.a {
		margin: 0;
		font-size: 0.95rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		user-select: text;
		-webkit-user-select: text;
	}
	.waiting {
		color: var(--muted);
	}
	.failed {
		margin: 0;
		color: var(--muted);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.copy {
		position: absolute;
		top: 0.6rem;
		right: 0;
		border: 0;
		background: color-mix(in srgb, var(--ink) 8%, transparent);
		color: var(--muted);
		font: inherit;
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: 5px;
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.turn:hover .copy,
	.copy:focus-visible {
		opacity: 1;
	}
	.sources {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.55rem;
	}
	.chip {
		border: 0.5px solid color-mix(in srgb, var(--ink) 18%, transparent);
		background: color-mix(in srgb, var(--ink) 5%, transparent);
		color: var(--ink);
		font: inherit;
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		cursor: pointer;
	}
	.chip:hover {
		background: color-mix(in srgb, var(--ink) 10%, transparent);
	}
	footer {
		display: flex;
		gap: 1rem;
		padding: 0.5rem 1rem;
		border-top: 0.5px solid color-mix(in srgb, var(--ink) 14%, transparent);
	}
	.key {
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 0.72rem;
		color: var(--muted);
		cursor: pointer;
	}
	.key:last-child {
		margin-left: auto;
	}
	.key:hover {
		color: var(--ink);
	}
	kbd {
		font: inherit;
		font-size: 0.68rem;
		padding: 0.05rem 0.3rem;
		margin-right: 0.15rem;
		border-radius: 4px;
		background: color-mix(in srgb, var(--ink) 9%, transparent);
	}
	.note {
		color: var(--muted);
		margin: 1rem;
	}
</style>
