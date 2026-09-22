<!-- Annotation pill: cursor-anchored create pill plus the edit card,
fresh (Annotate) or filed (badge edit). The page owns the pop state
(position, fresh flag, open/close timing) and the draft save paths;
this component owns the pill markup, the field, the mic/save/delete
buttons, the grow action, and their surfaces (Svelte scoping binds
the CSS to this markup). Draft and field element ride bindables so
the page's save/focus paths keep working. -->
<script lang="ts">
	import ActionIcon from "./ActionIcon.svelte";

	/** Open pill state (rendered fields only). */
	export interface AnnPopState {
		id: string;
		x: number;
		y: number;
		fresh: boolean;
	}

	/** Page-owned pill behaviors. */
	export interface AnnPopActions {
		key: (event: KeyboardEvent) => void;
		blur: () => void;
		save: () => void;
		cancel: () => void;
		remove: (id: string) => void;
		mic: () => void;
	}

	interface Props {
		pop: AnnPopState;
		/** Draft text (the page seeds it on open/edit). */
		draft?: string;
		/** Field element (the page focuses it on open/edit). */
		box?: HTMLTextAreaElement | undefined;
		/** Fade-out in flight (unmounts when the ramp ends). */
		closing: boolean;
		android: boolean;
		micEnabled: boolean;
		dictating: boolean;
		/** Scroll container pinned during the mount focus. */
		scrollBox?: HTMLElement | undefined;
		actions: AnnPopActions;
	}

	let {
		pop,
		draft = $bindable(""),
		box = $bindable(undefined),
		closing,
		android,
		micEnabled,
		dictating,
		scrollBox,
		actions
	}: Props = $props();

	function growPill(node: HTMLTextAreaElement): { destroy(): void } {
		// The insert cursor must never yank the messages list. Phones
		// re-pin behind the mount focus too: the create/edit paths
		// focus again on tick, and a WebView pan here would snap first.
		if (android) {
			const sx = window.scrollX;
			const sy = window.scrollY;
			const st = scrollBox?.scrollTop ?? 0;
			node.focus({ preventScroll: true });
			window.scrollTo(sx, sy);
			if (scrollBox) scrollBox.scrollTop = st;
		} else {
			node.focus({ preventScroll: true });
		}
		// field-sizing: content sizes the pill in CSS (capped at 168px
		// there); only measure by hand where it is unsupported.
		const cssOwnsHeight =
			typeof CSS !== "undefined" && CSS.supports("field-sizing: content");
		const fit = () => {
			if (cssOwnsHeight) return;
			node.style.height = "auto";
			node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
		};
		node.addEventListener("input", fit);
		fit();
		// A grown box drops its corner radius (see .ann-pop.tall): the
		// full pill radius reads over-rounded once the field is tall.
		// Measured on the field itself: the card chrome differs
		// between the fresh pill and the edit card, but both fields
		// start at the same 3rem floor, so one threshold splits short
		// from tall for both — at three lines, not five (the old
		// 4.5rem floor plus 100px gate kept the capsule too long).
		// clientHeight counts CSS-owned growth too, not just the
		// hand-measured fallback.
		const card = node.closest(".ann-pop");
		const TALL_PX = 64;
		const mark = () => {
			const h = node.clientHeight ?? 0;
			card?.classList.toggle("tall", h > TALL_PX);
		};
		mark();
		const ro =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
		if (card && ro) ro.observe(node);
		return {
			destroy: () => {
				node.removeEventListener("input", fit);
				ro?.disconnect();
			}
		};
	}

	function fieldBlur(event: FocusEvent): void {
		// Tabbing between the card's own buttons is not
		// leaving: only a departure blur-saves (clicking
		// away saves, Escape cancels). Tab reports its
		// destination reliably in every engine, unlike a
		// WebKit button press (see onFocusOutIdle).
		const next = event.relatedTarget;
		if (next instanceof Element && next.closest(".ann-pop")) return;
		actions.blur();
	}
</script>

<!-- Mousedown on the buttons keeps textarea focus: without it the
blur-save fires first and Cancel/Delete can never win the race. -->
<div
	class="ann-pop"
	class:fresh={pop.fresh}
	class:closing
	style="left: {pop.x}px; top: {pop.y}px"
	role="dialog"
	aria-label={pop.fresh ? "Annotate" : "Edit annotation"}
>
	<textarea
		rows={1}
		bind:this={box}
		bind:value={draft}
		placeholder="Add an annotation"
		aria-label="Annotation text. Enter or clicking away saves, Escape cancels."
		use:growPill
		onkeydown={actions.key}
		onblur={fieldBlur}
	></textarea>
	{#if pop.fresh}
		{#if micEnabled}
			<button
				type="button"
				class="ann-tool"
				class:recording={dictating}
				class:gone={!(dictating || draft.trim().length === 0)}
				aria-label={dictating ? "Stop dictation" : "Dictate annotation"}
				aria-pressed={dictating}
				aria-hidden={!(dictating || draft.trim().length === 0)}
				tabindex={dictating || draft.trim().length === 0 ? 0 : -1}
				title="Dictate annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.mic}
			>
				<ActionIcon kind="mic" />
			</button>
		{/if}
		{#if android}
			<!-- Phones get a submit button at the pill's end: the
			software keyboard's enter key is unreliable for filing
			(desktop keeps Enter-only and the compact pill). Same
			up-arrow face as the composer's send button. -->
			<button
				type="button"
				class="ann-save ann-pill-save"
				aria-label="Save annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.save}>↑</button
			>
		{/if}
	{:else}
		<div class="ann-pop-row">
			<button
				type="button"
				class="ann-tool"
				aria-label="Delete annotation"
				title="Delete annotation"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => actions.remove(pop.id)}
			>
				<ActionIcon kind="delete" />
			</button>
			<span class="ann-pop-spacer"></span>
			{#if micEnabled}
				<button
					type="button"
					class="ann-tool"
					class:recording={dictating}
					aria-label={dictating ? "Stop dictation" : "Dictate annotation"}
					aria-pressed={dictating}
					title="Dictate annotation"
					onmousedown={(e) => e.preventDefault()}
					onclick={actions.mic}
				>
					<ActionIcon kind="mic" />
				</button>
			{/if}
			<button
				type="button"
				class="ann-cancel"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.cancel}>Cancel</button
			>
			<button
				type="button"
				class="ann-save"
				onmousedown={(e) => e.preventDefault()}
				onclick={actions.save}>Save</button
			>
		</div>
	{/if}
</div>

<style>
	/* Cursor-anchored annotation pill (ChatGPT-style): a rounded bar that
	starts as a single-line prompt and grows as you type. Enter saves,
	Shift+Enter adds a line, Escape cancels. Beats the centered-column
	group rule. */
	/* Annotation edit card: dark in both themes (same call as the
	toast) so the quoted-text mockup holds everywhere. */
	/* The pill fades in on mount and back out on close (the closing
	class waits out the ramp before the {#if} unmounts it). */
	@keyframes ann-pop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.ann-pop {
		position: fixed;
		z-index: 60;
		/* Clip: without it, selection wash and focus paint square past
		the rounded corners on phones. Shadows paint outside, so they
		are unaffected. */
		overflow: hidden;
		/* Font-scaled, capped: roomier text at large sizes, never past
		32rem (popWidth mirrors this math for centering). */
		width: min(32rem, calc(24rem * var(--font-scale, 1)));
		/* Border-box: without it the padding and border stack outside
		the rem width and the vw clamp (content-box), spilling past
		the viewport edge on phones. The responsive units only
		contain the card on every OS with this set. */
		box-sizing: border-box;
		max-width: calc(100vw - 1rem);
		padding: 1rem 1.1rem 0.9rem;
		border: 1px solid #38383a;
		border-radius: 20px;
		/* Tall boxes read over-rounded at a full pill radius, so a
		grown box (see growPill's tall flag) drops to a smaller one. */
		background: #1c1c1e;
		color: #f2f2f7;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
		animation: ann-pop-in 0.16s ease;
	}
	.ann-pop.closing {
		animation: none;
		opacity: 0;
		transition: opacity 0.16s ease;
		/* A fading card must not stay hit-testable: a badge click
		inside the 160ms window would land on the dying textarea
		instead of the badge, so the open never runs and the timer
		unmounts the focused node from under the caret. Clicks pass
		through to the badge and the normal press path morphs back. */
		pointer-events: none;
	}
	/* :global — toggled from growPill via classList (see the tall
	flag there), so the compiler can't see the use site. Covers the
	edit card and the fresh pill alike: a grown create-box drops
	out of its 999px capsule to the same smaller radius. */
	.ann-pop:global(.tall),
	.ann-pop.fresh:global(.tall) {
		border-radius: 12px;
	}
	.ann-pop textarea {
		display: block;
		width: 100%;
		/* Flooded unbroken text (pasted URLs, romaji runs) must wrap
		inside the box instead of spilling past its edge: break
		anywhere only when nothing else fits, so normal words wrap
		as before. */
		overflow-wrap: anywhere;
		/* Border-box: growPill sizes height from scrollHeight (which already
		includes padding). Content-box would double-count it and push the
		text to the top with dead space below. */
		box-sizing: border-box;
		border: 0;
		background: none;
		resize: none;
		overflow-y: auto;
		font: inherit;
		font-size: 1.05rem;
		line-height: 1.4;
		color: #f2f2f7;
		padding: 0.15rem 0;
		/* Two-line floor: the pill reads as a prompt, and the tall
		gate below trips at three lines instead of five. */
		min-height: 3rem;
		/* Cap mirrors growPill's 168px: with field-sizing the CSS owns
		the height and the JS stands down (see guard there). */
		max-height: 168px;
		field-sizing: content;
	}
	.ann-pop textarea:focus {
		outline: none;
	}
	.ann-pop textarea::placeholder {
		color: #8e8e93;
	}
	.ann-pop-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.8rem;
	}
	.ann-pop-spacer {
		flex: 1;
	}
	.ann-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
	}
	.ann-tool:hover {
		color: #fff;
	}
	.ann-tool.recording {
		color: #ff6b62;
		color: var(--alarm);
	}
	.ann-tool :global(.action-glyph) {
		height: 1.25rem;
	}
	.ann-cancel {
		flex: none;
		border: 1px solid #6e6e73;
		border-radius: 999px;
		background: none;
		color: #f2f2f7;
		font: inherit;
		padding: 0.5rem 1.25rem;
		cursor: pointer;
	}
	.ann-cancel:hover {
		border-color: #aeaeb2;
	}
	.ann-save {
		flex: none;
		border: 1px solid #f2f2f7;
		border-radius: 999px;
		background: #f2f2f7;
		color: #1c1c1e;
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 1.4rem;
		cursor: pointer;
		/* On the base (not :hover) so the hover animates symmetrically
		in and back out, instead of snapping one way. */
		transition:
			filter 0.15s ease,
			transform 0.15s ease;
	}
	.ann-save:hover {
		filter: brightness(1.08);
		transform: scale(1.03);
	}
	.ann-save:active {
		transform: scale(1);
	}
	/* Light theme edit card (dark-always above): white card, ink
	text, quiet tools, and the same system-blue primary as the send
	button. Fresh pill included — it is the same surface. */
	:global(html[data-theme="light"]) .ann-pop {
		background: #fff;
		color: #1c1c1e;
		border-color: #e5e5ea;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
	}
	:global(html[data-theme="light"]) .ann-pop textarea {
		color: #1c1c1e;
	}
	:global(html[data-theme="light"]) .ann-pop textarea::placeholder {
		color: #6e6e73;
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool {
		color: #6e6e73;
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool:hover {
		color: #1c1c1e;
	}
	:global(html[data-theme="light"]) .ann-pop .ann-tool.recording {
		color: #ff3b30;
		color: var(--alarm);
	}
	:global(html[data-theme="light"]) .ann-pop .ann-cancel {
		border-color: #c7c7cc;
		color: #1c1c1e;
	}
	:global(html[data-theme="light"]) .ann-pop .ann-cancel:hover {
		border-color: #1c1c1e;
	}
	:global(html[data-theme="light"]) .ann-pop .ann-save {
		border-color: #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
	}
	/* Fresh pill keeps the mic mounted and cross-fades it, so the
	textarea never reflows when typing starts. Faded buttons are out of
	the pointer and tab order. */
	.ann-pop .ann-tool {
		transition: opacity 0.2s ease;
	}
	.ann-pop .gone {
		opacity: 0;
		pointer-events: none;
	}
	/* Fresh annotation: the compact pill (textarea + mic) rather than
	the edit card. Enter files it; clicking off cancels an empty draft. */
	.ann-pop.fresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		/* The creation pill scales with the text size like the edit
		card's width does (a fixed 19rem pill next to 370% type is a
		toy): the save arrow rides along via font inheritance.
		popWidth mirrors this math for centering. */
		width: min(32rem, calc(19rem * var(--font-scale, 1)));
		padding: 0.55rem 0.6rem 0.55rem 1rem;
		border-radius: 999px;
		font-size: calc(1rem * var(--font-scale, 1));
	}
	.ann-pop.fresh textarea {
		flex: 1;
		min-width: 0;
		min-height: 0;
		font-size: 1em;
		padding: 0.15rem 0;
	}
	/* Thumb-sized Cancel targets on phones (the .app ancestor stays
	global — it renders paged, unscopable). */
	:global(.app[data-android]) .ann-cancel,
	:global(.app[data-android]) .ann-save {
		min-height: 2.75rem;
	}
	/* Annotation boxes read at the screen's message size on phones:
	a fixed 1rem box next to 800% message type strands the eyes.
	The desktop edit card keeps its fixed overlay type; only the
	creation pill scales there (see .ann-pop.fresh above). */
	:global(.app[data-android]) .ann-pop textarea {
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	/* The create pill's arrow rides round like the composer's send:
	compact pill, compact button. */
	:global(.app[data-android]) .ann-pop.fresh .ann-pill-save {
		min-height: 0;
		height: 2.2rem;
		width: 2.2rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.1rem;
		line-height: 1;
	}
</style>
