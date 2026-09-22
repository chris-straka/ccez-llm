<!-- Per-message action row: fold, copy, branch/delete, speak,
reading aids, edit/rerun/retry, and the speaking dot. The page owns
selection/focus/voice/aid state and every behavior; this component
owns the row markup and its surfaces. Computed labels and flags
cross as plain props (the page's tooltip gate and voice/aid
helpers stay paged); callbacks cross in one actions object. Row-reveal,
hover, speaking, aid-loading, and hide-messages seating move with
the row (paged main/article ancestors stay global); the shared
.error look and .tdots pulse stay paged as globals for their other
consumers (composer banner, sending indicator). -->
<script lang="ts">
	import type { ChatMsg } from "$lib/chat";
	import type { LocalAid } from "$lib/reading";
	import {
		LOCAL_AID_ADD_TITLE,
		LOCAL_AID_BUTTON,
		LOCAL_AID_SHOW_ORIGINAL,
		MODEL_AIDS
	} from "$lib/reading";
	import ActionIcon from "./ActionIcon.svelte";

	/** Page-owned row behaviors (state and effects stay in the page). */
	export interface MessageActionsActions {
		toggleFold: () => void;
		copy: () => void;
		branch: () => void;
		drop: () => void;
		stopVoice: () => void;
		speak: () => void;
		unpinModelAid: () => void;
		runModelAid: (aidId: string) => void;
		unpinLocalAid: (kind: LocalAid) => void;
		pinLocalAid: (kind: LocalAid) => void;
		peekAid: (kind: LocalAid) => void;
		unpeekAid: () => void;
		commitEdit: () => void;
		edit: () => void;
		rerun: () => void;
		retry: () => void;
		releaseRowFocus: (event: MouseEvent) => void;
		holdOpen: () => void;
		releaseHold: () => void;
	}

	interface Props {
		msg: ChatMsg;
		previewing: boolean;
		folded: boolean;
		streamingThis: boolean;
		editing: boolean;
		android: boolean;
		/** tip() titles (page applies the tooltip gate). */
		foldTitle: string;
		deleteTitle: string;
		speaking: boolean;
		speakable: boolean;
		speakLabel: string;
		aidId: string | null;
		aidModelPinned: boolean;
		aidVocalizing: boolean;
		localKinds: LocalAid[];
		pinnedKinds: LocalAid[];
		aidBusy: boolean;
		actions: MessageActionsActions;
	}

	let {
		msg,
		previewing,
		folded,
		streamingThis,
		editing,
		android,
		foldTitle,
		deleteTitle,
		speaking,
		speakable,
		speakLabel,
		aidId,
		aidModelPinned,
		aidVocalizing,
		localKinds,
		pinnedKinds,
		aidBusy,
		actions
	}: Props = $props();
</script>

<!-- Preview renders the same row inert: the peek reserves the row's
space (opening the chat moves nothing) while honoring the
hover-only rhythm, so no peek button is ever visible or firing. The
desktop Messages toggle removes the row outright (its shortcuts
keep working); phones always render it — no shortcuts exist to
cover an off state. -->
<div
	class="actions"
	role="group"
	aria-label="Message actions"
	inert={previewing}
	onmouseleave={actions.releaseRowFocus}
	onpointerdown={actions.holdOpen}
	onpointerup={actions.releaseHold}
	onpointercancel={actions.releaseHold}
>
	<!-- Fold chevron on every message, phones included: phones fold
	by swipe too, but the button is the discoverable path (and the
	only one when fold on swipe is off); folded rows unfold by
	tapping the folded body. -->
	<button
		type="button"
		class="icon-btn"
		class:folded
		data-tip={foldTitle}
		aria-label={folded ? "Unfold this message" : "Fold this message"}
		onclick={() => actions.toggleFold()}
	>
		<ActionIcon kind="fold" />
	</button>
	<button
		type="button"
		class="icon-btn"
		data-tip="Copy as plain text"
		aria-label="Copy as plain text"
		onclick={() => actions.copy()}
	>
		<ActionIcon kind="copy" />
	</button>
	{#if msg.role !== "user"}
		<!-- Assistant rows keep branch before audio. -->
		<button
			type="button"
			class="icon-btn"
			data-tip="Branch from here"
			aria-label="Branch from here"
			onclick={() => actions.branch()}
		>
			<ActionIcon kind="branch" />
		</button>
	{/if}
	{#if msg.role !== "user"}
		<button
			type="button"
			class="icon-btn"
			data-tip={deleteTitle}
			aria-label={deleteTitle}
			onclick={() => actions.drop()}
		>
			<ActionIcon kind="delete" />
		</button>
	{/if}
	<button
		type="button"
		class="icon-btn"
		class:active={speaking}
		data-tip={speakable ? speakLabel : "No voice for this language"}
		aria-label={speakable ? speakLabel : "No voice for this language"}
		aria-pressed={speaking}
		disabled={!speaking && !speakable}
		onclick={() => {
			if (speaking) actions.stopVoice();
			else actions.speak();
		}}
	>
		<ActionIcon kind="speak" />
	</button>
	{#if msg.role === "user"}
		<!-- Own messages: audio before branch before delete (assistant
		rows keep branch, delete, then audio). -->
		<button
			type="button"
			class="icon-btn"
			data-tip="Branch from here"
			aria-label="Branch from here"
			onclick={() => actions.branch()}
		>
			<ActionIcon kind="branch" />
		</button>
		<button
			type="button"
			class="icon-btn"
			data-tip={deleteTitle}
			aria-label={deleteTitle}
			onclick={() => actions.drop()}
		>
			<ActionIcon kind="delete" />
		</button>
	{/if}
	{#if msg.role === "assistant" && !streamingThis}
		<!-- Reading aids live here, right of speak: hover previews,
		click pins (show original unpins). Model and local aids sit
		side by side on mixed messages; a model pin composes with
		local pins (the model revert drops only the vocalized text),
		while furigana and pinyin pin independently. -->
		{#if aidId || localKinds.length > 0}
			{#if aidId}
				{#if aidModelPinned}
					<button
						type="button"
						class="aid-btn"
						data-tip={MODEL_AIDS[aidId]?.revertTip ?? "Show original"}
						onclick={() => actions.unpinModelAid()}
					>
						{MODEL_AIDS[aidId]?.revert ?? "show original"}
					</button>
				{:else}
					{@const aid = MODEL_AIDS[aidId]}
					{#if aid}
						<button
							type="button"
							class="aid-btn"
							data-tip={aid.title}
							disabled={aidVocalizing}
							aria-busy={aidVocalizing}
							onclick={() => actions.runModelAid(aidId)}
						>
							{#if aidVocalizing}
								{aid.button}<span class="tdots" aria-hidden="true"
									><span>.</span><span>.</span><span>.</span></span
								>
							{:else}
								{aid.button}
							{/if}
						</button>
					{/if}
				{/if}
			{/if}
			{#if localKinds.length > 0}
				<!-- One button per aid, pinned independently: each swaps
				in place to its own show-original, so the row never
				shuffles when the other pins. -->
				{#each localKinds as localKind (localKind)}
					{@const showOriginal = LOCAL_AID_SHOW_ORIGINAL[localKind]}
					{#if pinnedKinds.includes(localKind)}
						{@const furiganaBusy =
							localKind === "furigana" && aidBusy}
						<button
							type="button"
							class="aid-btn"
							data-tip={furiganaBusy
								? `${LOCAL_AID_BUTTON[localKind]}...`
								: showOriginal}
							onclick={() => actions.unpinLocalAid(localKind)}
						>
							{showOriginal}{#if furiganaBusy}<span
									class="tdots"
									aria-hidden="true"
									><span>.</span><span>.</span><span>.</span></span
								>{/if}
						</button>
					{:else}
						<button
							type="button"
							class="aid-btn"
							data-tip={LOCAL_AID_ADD_TITLE[localKind]}
							onmouseenter={() => actions.peekAid(localKind)}
							onmouseleave={() => actions.unpeekAid()}
							onclick={() => actions.pinLocalAid(localKind)}
						>
							{LOCAL_AID_BUTTON[localKind]}{#if localKind === "furigana" &&
							aidBusy}<span
									class="tdots"
									aria-hidden="true"
									><span>.</span><span>.</span><span>.</span></span
								>{/if}
						</button>
					{/if}
				{/each}
			{/if}
		{/if}
	{/if}
	{#if msg.role === "user"}
		{#if editing}
			<!-- While editing, the pencil seat commits: checkmark in
			the same style, Enter works too. -->
			<button
				type="button"
				class="icon-btn"
				data-tip="Save edit"
				aria-label="Save edit"
				data-commit-edit
				onclick={() => actions.commitEdit()}
			>
				<ActionIcon kind="check" />
			</button>
		{:else}
			<button
				type="button"
				class="icon-btn"
				data-tip="Edit"
				aria-label="Edit this message"
				onclick={() => actions.edit()}
			>
				<ActionIcon kind="pencil" />
			</button>
		{/if}
		<button
			type="button"
			class="icon-btn"
			data-tip="Rerun"
			aria-label="Rerun"
			onclick={() => actions.rerun()}
		>
			<ActionIcon kind="rerun" />
		</button>
	{/if}
	{#if msg.error}
		<button
			type="button"
			class="icon-btn"
			data-tip="Retry"
			aria-label="Retry"
			onclick={() => actions.retry()}
		>
			<ActionIcon kind="rerun" />
		</button>
	{/if}
	{#if msg.error && !android}
		<span class="error">{msg.error}</span>
	{/if}
	<!-- Last in the row, always mounted (hidden when idle) so it
	never shoves the buttons around. -->
	<span
		class="speaking-dot"
		class:on={speaking}
		role="status"
		aria-label="Speaking this message"
	></span>
</div>

<style>
	.speaking-dot {
		width: 0.55rem;
		height: 0.55rem;
		flex-shrink: 0;
		align-self: center;
		border-radius: 50%;
		background: #30a46c;
		visibility: hidden;
	}
	.speaking-dot.on {
		visibility: visible;
		animation: voice-pulse 1.2s ease-in-out infinite;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
		transition: opacity 0.18s ease;
	}
	/* Desktop rows scroll sideways inside themselves instead of
	wrapping: aid labels (show original) can outgrow the message at
	large text sizes, and a wrapped second line reads as a second
	row. Matches the touch treatment below. */
	:global(.app:not([data-android])) .actions {
		flex-wrap: nowrap;
		max-width: 100%;
		overflow-x: auto;
		/* Tooltips below the row must never make it scrollable
		up and down: clip the axis (never scrolls) while the paint
		margin lets them show anyway. Horizontal only, at any size. */
		overflow-y: clip;
		overflow-clip-margin: 4rem;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
	}
	:global(.app:not([data-android])) .actions::-webkit-scrollbar {
		display: none;
	}
	@media (hover: none) {
		/* Aid labels (show original) can outgrow the message: the row
		scrolls sideways inside itself instead of spilling out and
		dragging the whole chat along. Vertical drags still reach the
		chat; the bar stays clean with no scrollbar of its own. */
		.actions {
			max-width: 100%;
			overflow-x: auto;
			overflow-y: clip;
			overflow-clip-margin: 4rem;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}
		.actions::-webkit-scrollbar {
			display: none;
		}
	}
	/* Touch has no hover: tooltips only ever appear as a clipped
	flash on long-press (the fold button's runs off-screen). The
	.app ancestor renders paged, unscopable. */
	:global(.app[data-android]) .actions [data-tip]::after {
		display: none;
	}
	/* Hover-only actions, per side: the row fades in when the pointer
	is over the message or the row itself (or keyboard focus lands
	inside either). Opacity only — the buttons never move. Touch
	always shows it — there is no hover to wait for. The main/article
	ancestors render paged, unscopable. */
	:global(main.hover-user) :global(article.user) .actions,
	:global(main.hover-assistant) :global(article.assistant) .actions {
		opacity: 0;
		/* Pre-create the compositor layer so the fade blends an
		already-rasterized row: without this the row is re-rasterized
		when the fade starts and the icons visibly shimmer mid-fade
		(worst at fractional offsets, e.g. with the settings panel
		narrowing the column). Applies shown or hidden — the layer
		must exist in both states or the switch still happens. */
		will-change: opacity;
	}
	:global(main.hover-user) :global(article.user:hover) .actions,
	:global(main.hover-user) :global(article.user:focus-within) .actions,
	:global(main.hover-user) :global(article.user) .actions:hover,
	:global(main.hover-user) :global(article.user) .actions:focus-within,
	:global(main.hover-assistant) :global(article.assistant:hover) .actions,
	:global(main.hover-assistant) :global(article.assistant:focus-within) .actions,
	:global(main.hover-assistant) :global(article.assistant) .actions:hover,
	:global(main.hover-assistant) :global(article.assistant) .actions:focus-within {
		opacity: 1;
	}
	/* Hovering the refs count never summons the row: the pill is the
	article's child, so without this the row would rise under it. */
	:global(main.hover-user) :global(article.user):has(:global(.ann-refs-pill):hover) .actions,
	:global(main.hover-assistant) :global(article.assistant):has(:global(.ann-refs-pill):hover) .actions {
		opacity: 0;
	}
	/* A message being read aloud keeps its row up while the audio
	runs: the green stop button must stay clickable after the pointer
	leaves. */
	:global(main.hover-user) :global(article.user.speaking) .actions,
	:global(main.hover-assistant) :global(article.assistant.speaking) .actions {
		opacity: 1;
	}
	/* Same while an aid loads (tashkeel run, furigana conversion):
	the row summoned the work, so it stays until the work lands. */
	:global(main.hover-user) :global(article.user.aid-loading) .actions,
	:global(main.hover-assistant) :global(article.assistant.aid-loading) .actions {
		opacity: 1;
	}
	@media (hover: none) {
		:global(main.hover-user) :global(article.user) .actions,
		:global(main.hover-assistant) :global(article.assistant) .actions {
			opacity: 1;
		}
	}
	/* Hide-messages mode (touch option): the open row shows text and
	buttons for 3s. Later than the hover rules so it wins ties; the
	open-row attr outranks them outright. */
	:global(main.hide-messages) :global(article) .actions {
		opacity: 0;
	}
	:global(main.hide-messages) :global(article[data-actions-open="true"]) .actions {
		opacity: 1;
	}
	/* Touch default: action rows hide until their message is tapped
	open (the open row shows for 3s). Later than the hover rules and
	outranking them, so it wins ties. */
	:global(.app[data-android]) :global(main.hide-buttons) :global(article) .actions {
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
	}
	:global(.app[data-android])
		:global(main.hide-buttons)
		:global(article[data-actions-open="true"])
		.actions {
		opacity: 1;
		pointer-events: auto;
	}
	/* Folded messages show no row: the pill would float over the next
	message's text. Tapping the folded body unfolds (see
	toggleMessageActions) — the only press path, since the fold button
	lives in the hidden row. */
	:global(.app[data-android]) :global(article.folded-msg) .actions {
		display: none;
	}
	/* Phones sit the row tighter under the text. */
	:global(.app[data-android]) .actions {
		margin-top: 0.2rem;
	}
	/* The row scales with the text-size opt-in; phones keep the 2x
	cap while desktop glyphs track to 4x — huge type never strands
	tiny buttons on either. */
	:global(.app[data-android]) :global(main.hide-buttons.scale-actions) .actions button {
		font-size: calc(0.75rem * min(var(--font-scale, 1), 2));
	}
	:global(.app[data-android])
		:global(main.hide-buttons.scale-actions)
		.actions
		.icon-btn
		:global(.action-glyph) {
		height: calc(1.05rem * min(var(--font-scale, 1), 2));
	}
	.actions button[data-tip] {
		position: relative;
	}
	.actions [data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 50%;
		translate: -50% 0;
		z-index: 60;
		background: #1c1c1e;
		color: #f2f2f7;
		font-size: 0.75rem;
		line-height: 1.4;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
	}
	.actions [data-tip]:hover::after,
	.actions [data-tip]:focus-visible::after {
		animation: tip-rise 0.15s ease-out 2s backwards;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.actions [data-tip]:hover::after,
		.actions [data-tip]:focus-visible::after {
			animation: none;
			transition: opacity 0.12s ease 2s;
		}
	}
	/* Text and icon buttons share one stable box: padding makes a real
	hit area, hover is a color shift only (no underline, no
	background), and no box property changes between states —
	hovering can't nudge the row. */
	.actions button {
		/* 85% of the message size (see .rendered's 0.92rem): the row
		reads quieter than the text it acts on, tracking text-size
		growth instead of holding a fixed size. Button labels never
		join a text pick (and long-pressing one never starts one). */
		user-select: none;
		-webkit-user-select: none;
		font-size: calc(0.92rem * var(--font-scale, 1) * 0.85);
		line-height: 1.5;
		color: #6e6e73;
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.5rem;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.actions button:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: none;
	}
	/* Reading-aid labels hold the row's resting size unless the
	text-size opt-in is on: like the fixed icon glyphs they must not
	track message growth, so large type never domes them. */
	.actions button.aid-btn {
		font-size: calc(0.92rem * 0.85);
	}
	:global(main.scale-actions) .actions button.aid-btn {
		font-size: calc(0.92rem * var(--font-scale, 1) * 0.85);
	}
	/* Opt-in (Settings): the logo icons grow with the text-size
	setting (text buttons track at 85% by default now, so only the
	fixed-size glyphs need the opt-in) — capped at 4x, so huge type
	doesn't dome them into towers. Growth is damped a fifth: full
	tracking overshoots the text beside it. */
	/* Same opt-in for the logo icons: the glyph holds its fixed
	1.05rem height otherwise, so larger text leaves tiny icons. */
	:global(main.scale-actions) .actions .icon-btn :global(.action-glyph) {
		height: calc(1.05rem * (1 + (min(var(--font-scale, 1), 4) - 1) * 0.8));
	}
	/* Loading buttons hold their look while the dots pulse. */
	.actions button:disabled {
		cursor: default;
		opacity: 0.8;
	}
	/* A speak button with no voice for the language dims further: it
	is off, not busy (vocalizing aids keep the rule above). */
	.actions .icon-btn:disabled {
		opacity: 0.35;
	}
	.actions .icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		padding: 0.2rem;
		color: #6e6e73;
		color: var(--muted);
		text-decoration: none;
	}
	.actions .icon-btn:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: none;
	}
	/* The message being read aloud: its speak button reads as "stop". */
	.actions .icon-btn.active {
		color: #1f7a4d;
	}
	/* Dark theme: green stop button, held on hover (the
	equal-specificity hover above would otherwise strip it). */
	:global(html[data-theme="dark"]) .actions .icon-btn.active,
	:global(html[data-theme="dark"]) .actions .icon-btn.active:hover {
		color: #7cc3a3;
	}
	/* Fold chevron points right while collapsed. Glyph-only transform,
	so no box moves (the row-reveal stylesheet test forbids motion on
	that row's selectors — keep its selector text out of these rules). */
	button.icon-btn :global(svg) {
		transition: transform 0.18s ease;
	}
	button.icon-btn.folded :global(svg) {
		transform: rotate(-90deg);
	}
	/* Own messages pack to the right edge: block, text column, and
	row. The article renders paged, unscopable. */
	:global(article.user) .actions {
		justify-content: flex-end;
	}
	/* The always-mounted speaking slot reserves room on the far left
	of own rows, mirroring the far-right slot on assistant rows. */
	:global(article.user) .speaking-dot {
		order: -1;
	}
	/* Audio before copy on own rows (phones): the mic-side thumb hits
	play first. DOM order stays copy-first for keyboard and readers;
	the audio button keeps the default seat (right after the speaking
	slot) while everything else files behind it by hook. */
	:global(.app[data-android])
		:global(article.user)
		.actions
		button[data-tip="Copy as plain text"] {
		order: 2;
	}
	:global(.app[data-android]) :global(article.user) .actions button[data-tip="Branch from here"] {
		order: 3;
	}
	:global(.app[data-android])
		:global(article.user)
		.actions
		button[data-tip^="Delete this message"] {
		order: 4;
	}
	:global(.app[data-android]) :global(article.user) .actions button[data-tip="Edit"] {
		order: 5;
	}
	:global(.app[data-android]) :global(article.user) .actions button[data-tip="Save edit"] {
		order: 5;
	}
	:global(.app[data-android]) :global(article.user) .actions button[data-tip="Rerun"] {
		order: 6;
	}
</style>
