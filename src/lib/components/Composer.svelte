<!-- Composer: prompt card, tools cluster, send button, banners. The
page owns the editor instance, all composer state (text, idle, mic,
voice, review drafts, waypoints), and every behavior; this component
owns the card markup, the tool buttons, and their surfaces (Svelte
scoping binds the CSS to this markup). Element refs the page drives
(prompt mount node, send-button geometry) cross as $bindable, exactly
like Sidebar's search/searchEl. The file input lives here too (the
page never touches it); the inline attach error stays paged in the
shared `.error` look. -->
<script lang="ts">
	import { fade } from "svelte/transition";
	import { dropFilesFromDataTransfer } from "$lib/intake";
	import { shouldShowInspect } from "$lib/inspect";
	import type { Annotation, AnnotationId } from "$lib/annotations";
	import type { ReplyLanguage } from "$lib/languages";
	import ActionIcon from "./ActionIcon.svelte";
	import ReviewDock, { type ReviewDockActions } from "./ReviewDock.svelte";

	/** Page-owned composer behaviors. */
	export interface ComposerActions {
		floorClick: (event: MouseEvent) => void;
		holdStart: (x: number, y: number) => void;
		holdEnd: () => void;
		intakeFiles: (files: File[]) => void;
		mic: () => void;
		voice: () => void;
		wpToggle: () => void;
		submit: (alt: boolean) => void;
		menuPress: () => void;
		menuTouch: (event: TouchEvent) => void;
		annotateTouch: (event: TouchEvent) => void;
		speakTouch: (event: TouchEvent) => void;
		inspectTouch: (event: TouchEvent) => void;
		annotate: () => void;
		speak: () => void;
		inspect: () => void;
		review: ReviewDockActions;
	}

	interface Props {
		/** Fully hidden (annotation box owns the keyboard). */
		hidden: boolean;
		/** Idle-parked (timeout, settings, or sidebar). */
		parked: boolean;
		/** Empty-chat hover preview (inert, shows although parked). */
		preview: boolean;
		hasText: boolean;
		android: boolean;
		ios: boolean;
		hasSelMenu: boolean;
		inspectQuote: string;
		inspectEnabled: boolean;
		annotations: Annotation[];
		reviewOpen: boolean;
		editingId?: AnnotationId | null;
		draft?: string;
		box?: HTMLTextAreaElement | null;
		highlightId?: AnnotationId | null;
		pillEl?: HTMLButtonElement | null;
		attachBusy: number;
		canMic: boolean;
		micEnabled: boolean;
		dictating: boolean;
		voiceOn: boolean;
		speaking: boolean;
		altKey: string;
		replyLang: ReplyLanguage | null;
		altHeld: boolean;
		canSubmit: boolean;
		hasAnnEdit: boolean;
		banner: string | null;
		waypointCount: number;
		wpOpen: boolean;
		/** Editor mount node (the page creates the editor from it). */
		promptEl?: HTMLElement | undefined;
		/** Send-button node (the page reads its rect for the hold zone). */
		sendBtnEl?: HTMLElement | null;
		actions: ComposerActions;
	}

	let {
		hidden,
		parked,
		preview,
		hasText,
		android,
		ios,
		hasSelMenu,
		inspectQuote,
		inspectEnabled,
		annotations,
		reviewOpen,
		editingId = $bindable(null),
		draft = $bindable(""),
		box = $bindable(null),
		highlightId = $bindable(null),
		pillEl = $bindable(null),
		attachBusy,
		canMic,
		micEnabled,
		dictating,
		voiceOn,
		speaking,
		altKey,
		replyLang,
		altHeld,
		canSubmit,
		hasAnnEdit,
		banner,
		waypointCount,
		wpOpen,
		promptEl = $bindable(),
		sendBtnEl = $bindable(null),
		actions
	}: Props = $props();

	let attachInput: HTMLInputElement | undefined = $state();
</script>

<input
	type="file"
	class="hidden-input"
	bind:this={attachInput}
	multiple
	accept="image/*,.txt,.md,.markdown,.json,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.swift,.kt,.php,.sh,.yaml,.yml,.toml,.xml,.html,.css,.sql,.csv,.log"
	onchange={(e) => {
		const files = [...(e.currentTarget.files ?? [])];
		e.currentTarget.value = "";
		if (files.length > 0) actions.intakeFiles(files);
	}}
/>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="prompt"
	class:prompt-hidden={hidden}
	class:prompt-idle={parked}
	class:prompt-preview={preview}
	data-empty={!hasText}
	inert={preview}
	bind:this={promptEl}
	onclick={actions.floorClick}
	ontouchstart={(e) => {
		// Hold zone for the send swap (see holdStart):
		// arms on press, cancels on lift or slide-away.
		const t = e.changedTouches[0];
		if (t) actions.holdStart(t.clientX, t.clientY);
	}}
	ontouchend={actions.holdEnd}
	ontouchmove={actions.holdEnd}
	ontouchcancel={actions.holdEnd}
	onmousedown={(e) => {
		// Desktop mirrors the touch swap (primary button over
		// send only); the post-swap click lands on an empty
		// composer, so it stays silent like touch.
		if (!android && e.button === 0) actions.holdStart(e.clientX, e.clientY);
	}}
	onmouseup={actions.holdEnd}
	onmouseleave={actions.holdEnd}
	ondragover={(e) => e.preventDefault()}
	ondrop={(e) => {
		e.preventDefault();
		const files = dropFilesFromDataTransfer(e.dataTransfer);
		if (files.length > 0) {
			actions.intakeFiles(files);
		}
	}}
>
	<div class="prompt-tools">
		{#if android && hasSelMenu && !preview}
			<!-- Phone action dock: Speak and Inspect (Annotate
			and Copy live in the floating selection menu).
			iOS keeps Annotate docked instead of floating:
			Apple's callout can't be suppressed, so a floating
			menu would double it. Same handlers and the same
			click-away exemption in onMouseUp, or the tap
			collapses the highlight and clears the menu before
			onclick fires. The wrapper overlays the whole card
			(see CSS) without resizing anything. -->
			{#if ios}
				<div class="ann-dock-wrap">
					<button
						type="button"
						class="ann-dock"
						aria-label="Annotate selection"
						transition:fade={{ duration: 150 }}
						onmousedown={actions.menuPress}
						ontouchstart={actions.menuTouch}
						ontouchend={actions.annotateTouch}
						onclick={actions.annotate}>Annotate</button
					>
				</div>
			{:else}
				<!-- Phone action dock: Speak, and (for a single
				Han character with the setting on) Inspect, in
				that order. Annotate and Copy live in the
				floating selection menu instead — never here.
				Same handlers and the same click-away
				exemption. -->
				<div class="ann-dock-wrap">
					<button
						type="button"
						class="ann-dock"
						aria-label="Speak selection"
						transition:fade={{ duration: 150 }}
						onmousedown={actions.menuPress}
						ontouchstart={actions.menuTouch}
						ontouchend={actions.speakTouch}
						onclick={actions.speak}>Speak</button
					>
					{#if shouldShowInspect(inspectQuote, inspectEnabled)}
						<button
							type="button"
							class="ann-dock"
							aria-label="Inspect character"
							transition:fade={{ duration: 150 }}
							onmousedown={actions.menuPress}
							ontouchstart={actions.menuTouch}
							ontouchend={actions.inspectTouch}
							onclick={actions.inspect}>Inspect</button
						>
					{/if}
				</div>
			{/if}
		{/if}
		{#if annotations.length > 0}
			<!-- New-annotations dock through ReviewDock: the page
			keeps the array, ids, draft, and behaviors; the component
			owns the dock, the inline editor, and their surfaces. -->
			<ReviewDock
				items={annotations}
				open={reviewOpen}
				bind:editingId
				bind:draft
				bind:box
				bind:highlightId
				bind:pillEl
				actions={actions.review}
			/>
		{/if}
		<button
			type="button"
			class="attach-btn"
			class:busy={attachBusy > 0}
			title="Attach images or text files"
			aria-label="Attach images or text files"
			aria-busy={attachBusy > 0}
			onclick={() => attachInput?.click()}
		>
			<ActionIcon kind="attach" />
		</button>

		{#if canMic && micEnabled}
			<button
				type="button"
				class="mic-btn"
				class:recording={dictating}
				title={dictating ? "Stop dictation" : "Dictate into the prompt"}
				aria-label={dictating
					? "Stop dictation"
					: "Dictate into the prompt"}
				aria-pressed={dictating}
				onclick={actions.mic}
			>
				<ActionIcon kind="mic" />
			</button>
		{/if}
		<button
			type="button"
			class="voice-float"
			class:on={voiceOn}
			title={speaking
				? "Stop reading aloud"
				: android
					? "Toggle voice readback"
					: `Toggle voice readback (Ctrl+${altKey}+S)`}
			aria-label={speaking ? "Stop reading aloud" : "Toggle voice readback"}
			aria-pressed={voiceOn}
			onclick={actions.voice}
		>
			<ActionIcon kind="speak" />
		</button>
		{#if android && waypointCount > 3 && !hasSelMenu}
			<!-- Touch-only jump-to-message trigger, right of the
			audio button like the other tools: DOM order matches the
			visual row (attach, audio, jump). Desktop and web keep
			the far-right tick control instead — one owner for
			jumps. On phones the selection dock takes this slot
			instead — both side by side crowd the placeholder. -->
			<button
				type="button"
				class="wp-jump"
				title="Jump to a message"
				aria-label="Jump to a message"
				aria-haspopup="true"
				aria-expanded={wpOpen}
				onclick={actions.wpToggle}
			>
				<ActionIcon kind="jump" />
			</button>
		{/if}
	</div>
	<span class="send-hold"><button
			type="button"
			bind:this={sendBtnEl}
			class="send-btn"
			class:wide={altHeld}
			disabled={!canSubmit && !hasAnnEdit}
			title={altHeld
				? android
					? "Stage"
					: `Stage (${altKey}+Enter)`
				: replyLang
					? android
						? `Send in ${replyLang.name} — repeat its number key to clear`
						: `Send in ${replyLang.name} (Enter) — repeat its number key to clear`
					: android
						? "Send"
						: "Send (Enter)"}
			aria-label={altHeld
				? "Stage"
				: replyLang
					? `Send in ${replyLang.name}`
					: "Send"}
			onclick={(event) => actions.submit(altHeld || event.altKey)}
		>
			{altHeld ? "Add +" : replyLang ? replyLang.badge : "↑"}
		</button></span
	>
</div>
{#if banner && !android}
	<p class="error-banner" role="alert">{banner}</p>
{/if}

<style>
	/* Chats with messages lift the composer off the bottom and give
	it more rows: the empty state's hero layout keeps its own rhythm. */
	/* iOS zooms into any text field under 16px on focus (and the
	zoom is what unlocks sideways panning): phone fields floor at
	16px. Desktop keeps its optical sizes. */
	:global(.app[data-android]) .prompt :global(.ta-input) {
		font-size: 16px;
	}
	:global(.app[data-android]) :global(main:not(.empty)) .prompt {
		/* Hug the keyboard: the old 1.8rem margin plus the 1.1rem base
		offset stranded the composer ~3rem above it. No min-height
		floor: an emptied composer returns to its fresh-chat size,
		and only text grows it (the old 7.25rem floor stranded
		~35px of dead space after every send). */
		margin-bottom: 0.6rem;
		bottom: 0.6rem;
		min-height: 0;
	}
	/* Phone composer: text on top, buttons below (other chat apps'
	rhythm). The card becomes a plain column: the field grows to its
	cap then scrolls, the tools row sits static underneath with the
	send button pinned at its right end. Desktop keeps the overlaid
	tools cluster and its measured reservations. */
	:global(.app[data-android]) .prompt {
		display: flex;
		flex-direction: column;
		/* One geometry, every state: no gap, no min-height floor, so
		focus, first character, and send all hold the fresh-chat size
		and only text lines grow the card. (The old focus/empty-scoped
		gap and the desktop 6.4rem floor each moved the card under the
		glide: ~6px and ~21px.) Separation between the bars rides the
		existing paddings, not the gap. */
		gap: 0;
		min-height: 0;
		padding: 0.85rem 0.8rem 0.75rem;
	}
	:global(.app[data-android]) .prompt :global(.ta-input) {
		/* Top bar is text-only: the tools live in the row below, so no
		right-side reservation (desktop keeps its overlaid cluster). */
		--tools-pad: 0rem;
		--tools-extra: 0rem;
		padding: 0 0 0.1rem;
		/* Small single line (~26px): the old 2rem floor read 60/40
		against the button bar. The field owns its height where
		supported, JS stands down. Floor and cap stay focus-independent:
		a rest-only clamp clipped scaled text and released it on focus,
		growing the card under the placeholder on every tap. */
		min-height: 1.5rem;
		max-height: 7.5rem;
	}
	:global(.app[data-android]) .prompt-tools {
		position: static;
		order: 5;
		width: auto;
		margin-top: auto;
		padding-right: 2.6rem;
		/* Bottom bar: one even row under the text, no divider. */
		align-items: center;
		padding-top: 0.35rem;
	}
	:global(.app[data-android]) .send-btn {
		bottom: 0.6rem;
		right: 0.7rem;
		/* Outranks the tools row: as a flex item it keeps the base
		z-index 5, which creates a stacking context even with
		position static — without this the row eats the send button's
		taps where they overlap at the card's right end. */
		z-index: 6;
		transition:
			opacity 0.18s ease,
			visibility 0s;
	}
	/* Phone composer: one line at rest, two on focus. Unfocused the
	field clamps to a single line and the tools row + send button park
	invisible; focusing (tap or keyboard) grows the field to two lines
	and slides the buttons into their second line. Live annotation UI
	(the selection dock, the pill/review wrap) holds the row open —
	parking it would strand the dock the tap just summoned. */
	:global(.app[data-android]) .prompt :global(.ta-input) {
		transition:
			max-height 0.22s ease,
			min-height 0.22s ease;
	}
	/* Sidebar parking parks and restores instantly on phones: the
	0.35s slide plus a chat-switch re-render threw the card
	mid-screen for a frame. Phones never idle-hide (migrated to
	never), so the ramp serves nothing there; desktop keeps it. */
	:global(.app[data-android]) .prompt {
		transition:
			border-color 0.18s ease,
			visibility 0s;
	}
	:global(.app[data-android]) .prompt:not(.prompt-idle) {
		transition:
			border-color 0.18s ease,
			visibility 0s;
	}
	/* (No focus/empty-scoped prompt sizing: the base rule above holds
	one geometry for every state.) */
	/* The row snaps (no height ramp): ramping its height would slide
	its buttons under tapping fingers mid-flight. The field above may
	ramp freely — the row is bottom-anchored, so field growth never
	moves it. */
	/* The tools bar is always up on phones — idle single-bar mode is
	gone, so the row never collapses, fades, or hides its buttons.
	Highlight mode still stands the other tools down (see the
	:has(.ann-dock) rules below). */
	:global(.app[data-android]) .prompt-tools {
		max-height: 3rem;
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.app[data-android]) .prompt :global(.ta-input),
		:global(.app[data-android]) .prompt-tools,
		:global(.app[data-android]) .send-btn {
			transition: none;
		}
	}
	/* The composer stands down while the annotation box owns the
	keyboard — but holds its space: unmounting the card collapses
	the tail clearance and snaps the thread on focus. */
	:global(.app[data-android]) .prompt.prompt-hidden {
		visibility: hidden;
		pointer-events: none;
	}
	/* Phone thumb row: attach, dictation, voice, and the jump
	trigger match the send button's seat — one even row, no small
	outlier. Desktop keeps its optical sizes. */
	:global(.app[data-android]) .attach-btn,
	:global(.app[data-android]) .mic-btn,
	:global(.app[data-android]) .voice-float,
	:global(.app[data-android]) .wp-jump {
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		/* Same box as its siblings: the touch rule pads the jump icon
		fat and pulls it back with negative margins, which eats the row
		gap unevenly (jump crowds attach). DOM order is now attach,
		audio, jump, so the flex gap spaces all three evenly. */
		margin: 0;
		font-size: 1.15rem;
	}
	:global(.app[data-android]) .attach-btn :global(.action-glyph),
	:global(.app[data-android]) .mic-btn :global(.action-glyph),
	:global(.app[data-android]) .voice-float :global(.action-glyph),
	:global(.app[data-android]) .wp-jump :global(.action-glyph) {
		height: 1.15em;
	}
	/* Highlight up: the dock wrapper overlays the whole card, so
	Annotate/Inspect cover both bars at exactly 50/50 without
	resizing anything (the card keeps its idle geometry to the
	pixel). Every other tool stands down beneath the overlay;
	visibility (not display) keeps their boxes, so the row holds
	its height. Phones only; desktop keeps the floating menu. */
	:global(.app[data-android]) .prompt:has(.ann-dock) .ann-dock-wrap {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		gap: 0.5rem;
		padding: 0.5rem;
		border-radius: 12px;
		background: #fff;
		background: var(--bg-raised);
	}
	:global(.app[data-android]) .prompt:has(.ann-dock) .ann-dock {
		flex: 1 1 0;
		min-height: 0;
		height: 100%;
		font-size: 1.3rem;
		padding: 0.55rem 0.6rem;
	}
	/* The overlay escapes the row: its 3rem overflow cap would clip
	the card-sized wrapper to a strip. */
	:global(.app[data-android]) .prompt:has(.ann-dock) .prompt-tools {
		overflow: visible;
	}
	:global(.app[data-android]) .prompt:has(.ann-dock) .attach-btn,
	:global(.app[data-android]) .prompt:has(.ann-dock) .mic-btn,
	:global(.app[data-android]) .prompt:has(.ann-dock) .voice-float,
	:global(.app[data-android]) .prompt:has(.ann-dock) .wp-jump,
	:global(.app[data-android]) .prompt:has(.ann-dock) .send-btn {
		visibility: hidden;
		pointer-events: none;
	}
	/* The dock's own half of the rule above renders in
	`ReviewDock.svelte` (the wrap moved with the dock). */
	:global(.app[data-android]) .prompt:has(.ann-dock) :global(.ta-input::placeholder) {
		color: transparent;
	}
	.hidden-input {
		display: none;
	}
	.error-banner {
		margin: 0 1.2rem;
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #fdecea;
		background: var(--error-bg);
		color: #94250a;
		color: var(--error-ink);
	}
	.prompt.prompt-hidden {
		/* Annotating on Android: the comment box owns the keyboard,
		so the composer gets out of the way entirely (messages gain
		the room). Restores the moment the box closes. */
		display: none;
	}
	/* Idle-hide: with no input for the configured timeout the prompt
	settles down a touch and fades in place. The card floats above
	the column in both states, so hiding and restoring never move
	the messages and no position flip can flash or snap. Visibility
	flips at the end of the ramp so the slide reads, then the box
	stops taking pointer hits. */
	.prompt.prompt-idle {
		transform: translateY(0.75rem);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	/* The idle slide carries the whole card — the desktop tools
	cluster counter-slides so attach/voice hold their screen seat
	while the card settles (the fade still reads; the buttons never
	twitch). Scoped off phones: their idle has no slide to cancel.
	The empty-chat preview cancels the card slide, so it cancels
	the counter-slide too. */
	/* The tools ride the card rigidly: the old idle slide moved the
	attach/voice pair on every focus change (always-hide parks on
	blur), reading as wandering buttons. The card fade below is the
	whole idle signal now. */
	:global(.app:not([data-android])) .prompt-tools {
		transform: none;
	}
	.prompt {
		/* Floating card, always: same geometry hidden or shown, so the
		messages run full-bleed underneath and text is cut only by the
		window edges. */
		position: absolute;
		left: 1.2rem;
		right: 1.2rem;
		bottom: 1.1rem;
		z-index: 30;
		margin: 0;
		/* First-line reservation for the absolute tools cluster:
		measured in-page (attach+voice ≈ 3.3rem, +mic ≈ 5.1rem), so
		the base covers the mic-less row and the mic tier below covers
		the rest, each with margin. Combos below only widen it;
		.wp-jump adds via --tools-extra so every combo composes. */
		--tools-pad: 4.2rem;
		--tools-extra: 0rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 12px;
		padding: 0 0.8rem 2.3rem;
		background: #fff;
		/* Raised, not flat: dark keeps the #1c1c1e card on the #17171a page. */
		background: var(--bg-raised);
		/* Fixed floor so mounting the editor never shifts layout:
		about three text lines plus the tools row. */
		min-height: 6.4rem;
		box-sizing: border-box;
		/* Ease the outline both in and out of hover, plus the
		idle-hide slide (visibility flips delayed on hide so the
		ramp reads, instant on restore). */
		transition:
			border-color 0.18s ease,
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s linear 0.25s;
	}
	/* Restoring from idle drops the class on the input event itself:
	visibility must flip at once (no delay), while the slide and
	fade still ramp back in. */
	.prompt:not(.prompt-idle) {
		transition:
			border-color 0.18s ease,
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s;
	}
	/* Empty-chat hover preview: the prompt shows although the open
	sidebar parks it, inert (see the markup) so every tap and key
	still belongs to the active chat. Triple class outranks the
	idle hide above regardless of rule order, with the same instant
	visibility timing as a restore. */
	.prompt.prompt-idle.prompt-preview {
		transform: none;
		opacity: 1;
		visibility: visible;
		pointer-events: none;
		transition:
			border-color 0.18s ease,
			transform 0.35s ease,
			opacity 0.35s ease,
			visibility 0s;
	}
	/* Idle-hide covers the inline attach error too (the strip rides
	with the prompt from `Attachments.svelte`): same slide/fade so no
	image bubble lingers over the chat, restored with the next input. */
	/* (attach-error in `+page.svelte`: the inline error stays paged
	in the shared `.error` look.) */
	/* Reduced motion settles the summon instantly: no slide, no fade
	ramp on the card or its error — what lands is the final frame.
	After every ramp above (equal specificity, later wins), so the
	desktop rise honors the OS setting like the drawers already do. */
	@media (prefers-reduced-motion: reduce) {
		.prompt,
		.prompt:not(.prompt-idle),
		.prompt.prompt-idle.prompt-preview,
		:global(.app:not([data-android])) .prompt-tools {
			transition: none;
		}
	}
	/* No entrance animation on the composer: it used to glide down on the
	first message, exactly while the first tokens streamed in — on a slow
	phone GPU the overlap reads as flicker. The composer just stays put. */
	/* Hold wrapper: layout-transparent so the button keeps its
	seat; touch press/release still bubble through it (a disabled
	button swallows its own taps). */
	.send-hold {
		display: contents;
	}
	.send-btn {
		position: absolute;
		/* The glyph (arrow, flag, "Add +") is chrome, never content:
		long-pressing it must not start a text pick. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		right: 0.6rem;
		bottom: 0.65rem;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		border: 1px solid #1c1c1e;
		border-color: var(--invert);
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		/* Emoji bearings differ from the old arrow's: flex centers the
		glyph both ways instead of the arrow's padding walk. */
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}
	.send-btn:hover:not(:disabled) {
		opacity: 0.8;
	}
	/* Light theme submit: the accent fill instead of the pitch-black
	inversion (dark keeps the inverted fill). */
	:global(html[data-theme="light"]) .send-btn {
		border-color: #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
	}
	.send-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
		/* Hits fall through to the .send-hold span: disabled buttons
		eat mouse/touch events, which would disarm the empty-composer
		language hold (touch and desktop alike). */
		pointer-events: none;
	}
	.send-btn.wide {
		width: auto;
		height: auto;
		border-radius: 999px;
		font-size: 0.78rem;
		padding: 0.3rem 0.9rem;
	}
	/* Voice readback toggle: the same borderless icon treatment as the
	attach button. On state reads green like a playing message row. */
	/* Attach + Voice ride top-right of the prompt as one cluster, so the
	icon never drifts from the pill at any text size. */
	.prompt-tools {
		position: absolute;
		top: 0.45rem;
		right: 0.6rem;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	/* The editor mounts one frame after first paint (effect, not
	markup): until its node lands, the tools and send button stay
	hidden so they never flash ahead of the editable text. No layout
	risk — both are absolutely positioned. */
	.prompt:not(:has(.ta-input)) .prompt-tools,
	.prompt:not(:has(.ta-input)) .send-btn {
		visibility: hidden;
	}
	.attach-btn,
	.voice-float,
	.mic-btn,
	.wp-jump {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		color: #6e6e73;
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.2rem;
		/* Pinned seat so the glyph em below resolves against the
		tools row, not whatever font lands on the button. */
		font-size: 1rem;
		transition: color 0.18s ease;
	}
	/* While files read in, the paperclip dims and reports progress
	instead of sitting silent: no spinner glyph, no motion, just the
	waiting state (motion would fight the composer's own ramps). */
	.attach-btn.busy {
		cursor: progress;
		opacity: 0.55;
	}
	/* Tool glyphs ride the row's font size (em, not the component's
	fixed rem): paperclip, mic, voice, and jump icons scale with the
	composer instead of staying tiny at large text. */
	.prompt-tools :global(.action-glyph) {
		height: 1.05em;
	}

	/* iOS selection dock: the Annotate control lives in the composer
	tools while a highlight is up (a floating menu fights the native
	callout). Text treatment in the row's rhythm, action green so it
	reads as live, never chrome. */
	.ann-dock {
		border: 0;
		background: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		color: #1f7a4d;
		color: var(--ok);
		padding: 0.2rem 0.35rem;
		white-space: nowrap;
	}
	.attach-btn:hover,
	.voice-float:hover,
	.wp-jump:hover,
	.mic-btn:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	@media (hover: none) {
		/* Touch has no hover: a tap leaves :hover stuck, so the
		last-tapped tool would keep its hover color while its
		siblings don't. State colors still win. */
		.attach-btn:hover,
		.voice-float:hover,
		.wp-jump:hover,
		.mic-btn:hover {
			color: #6e6e73;
			color: var(--muted);
		}
		.voice-float.on:hover {
			color: #1f7a4d;
			color: var(--ok);
		}
		.mic-btn.recording:hover {
			color: #ff3b30;
			color: var(--alarm);
		}
		/* Jump icon joins the tools cluster like attach/mic, with a
		full-size touch target that keeps the cluster's footprint (the
		negative margin offsets the extra padding). */
		.wp-jump {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			line-height: 0;
			color: #6e6e73;
			border: 0;
			background: none;
			cursor: pointer;
			padding: 0.65rem;
			margin: -0.45rem;
			transition: color 0.18s ease;
			user-select: none;
			-webkit-user-select: none;
		}
	}
	.voice-float.on {
		color: #1f7a4d;
		color: var(--ok);
	}
	/* Dictation in progress reads alarm red, like the popover's
	recording dot. */
	.mic-btn.recording {
		color: #ff3b30;
		color: var(--alarm);
	}
	/* Emptied composer: no stray caret while UNFOCUSED. Clearing the
	draft (paste then delete-all, or a send) leaves focus in place —
	but a focused empty box keeps its blink: the cursor is the only
	focus signal, and hiding it strands the caret invisibly.
	(data-empty rides hasText, which onDocChange maintains.) */
	.prompt[data-empty="true"] :global(.ta-input:not(:focus)) {
		caret-color: transparent;
	}
	/* Jump trigger joins the cluster in long threads: reserve its seat
	on top of whichever combo is live (var composition, not ×4 rules). */
	.prompt:has(.wp-jump) {
		--tools-extra: 1.8rem;
	}
	/* Textarea composer: the typed text tracks the text-size setting
	like message text (a fixed 0.95rem box next to huge type strands
	the eyes). Phones keep the 16px floor below: iOS zooms smaller
	fields on focus. */
	.prompt :global(.ta-input) {
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		font-size: calc(0.95rem * var(--font-scale, 1));
		/* Pinned (not normal): the placeholder resolves its own
		metrics in some engines and rides above the caret otherwise —
		both share this exact box. */
		line-height: 1.5;
		padding: 0.6rem calc(var(--tools-pad) + var(--tools-extra)) 0.6rem 0;
		caret-color: #1c1c1e;
		/* Mechanical twin of the cm rules: same pairs, Android-only node. */
		caret-color: var(--ink);
		width: 100%;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: inherit;
		resize: none;
		/* Where supported the CSS owns the height (JS stands down —
		see autogrow in textarea-editor.ts) up to the same cap. */
		field-sizing: content;
		overflow-y: auto;
		max-height: 40vh;
		outline: none;
	}
	.prompt :global(.ta-input::placeholder) {
		color: #8e8e93;
		color: var(--line-hover);
		/* Same box as the text (see the textarea rule): never the
		engine's own placeholder metrics. */
		line-height: 1.5;
	}
	/* The placeholder hint is chrome, never content: while it shows
	(the box is empty) the field takes no pick, so a long-press on
	the empty composer selects nothing. Typing flips
	:placeholder-shown off and selection works again. */
	.prompt :global(.ta-input:placeholder-shown) {
		user-select: none;
		-webkit-user-select: none;
	}
	/* Tool seating rides the DOM, not JS classes: .mic-btn renders
	exactly when dictation is available and .ann-wrap exactly when
	drafts exist, so :has() below is the single source of truth. */
	.prompt:has(.mic-btn) :global(.ta-input) {
		--tools-pad: 8.6rem;
	}
	/* Tool seating for the dock's presence rides with the dock
	(`ReviewDock.svelte`): :has() matches the dock in the DOM at
	runtime, whichever component renders it. */
	.prompt {
		/* Own width track (--prompt-width): the composer never grows
		with the chat slider, but still shrinks on narrow columns and
		widens with huge type past 200%. The column caps it, and --sbw
		(set from JS: messages' scrollbar gutter, 0 with overlay bars)
		keeps the card centered on the article column instead of the
		full width, so text never sticks out on the right side only. */
		width: calc(100% - 2.4rem - var(--sbw, 0px));
		max-width: min(
			calc(var(--chat-width, 36) * 1rem),
			calc(var(--prompt-width, 36) * 1rem)
		);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
		right: calc(1.2rem + var(--sbw, 0px));
	}
	.error-banner {
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.prompt:focus-within {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	.prompt:hover {
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	.prompt:focus-within:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
</style>
