<!-- Thread column: the scrollable message list. The page owns chat
state, focus, speech, aids, refs, popovers, and every behavior behind
the rows; this component owns the per-row derivations, the MessageArticle
wiring, the empty hero, and the sending indicator (Svelte scoping binds
the CSS to this markup). Row actions arrive as page callbacks and are
bound to (msg, i) here, exactly like the paged actions object was. -->
<script lang="ts">
	import type { ChatMsg, ChatMsgId, ChatId } from "$lib/chat";
	import type {
		Attachment,
		AttachTagModel,
		SentTagAction
	} from "$lib/attachments";
	import type { AnnotationId, AnnotationMark } from "$lib/annotations";
	import {
		annRefsFor,
		REFS_ONLY_BODY
	} from "$lib/annotations";
	import {
		detectScript,
		offeredLocalAids,
		MODEL_AID_FOR_SCRIPT,
		type LocalAid
	} from "$lib/reading";
	import type { LanguageMenu, ReplyLanguage } from "$lib/languages";
	import MessageArticle from "./MessageArticle.svelte";
	import EmptyHero from "./EmptyHero.svelte";
	import LangMenus from "./LangMenus.svelte";
	import SendingIndicator from "./SendingIndicator.svelte";

	/** Page-owned behaviors the thread drives (row binding happens here). */
	export interface ThreadViewActions {
		noteScrolling: () => void;
		freezeScroll: () => void;
		releaseScroll: () => void;
		clearStepDir: () => void;
		hoverRow: (index: number) => void;
		sentTagModels: (msg: ChatMsg, base: string) => AttachTagModel[];
		marksFor: (messageId: ChatMsgId) => AnnotationMark[];
		aidedTextFor: (msg: ChatMsg) => string | null;
		localAidsOverrideFor: (msg: ChatMsg) => LocalAid[];
		pinnedKinds: (id: string) => LocalAid[];
		messageSpeaking: (msg: ChatMsg) => boolean;
		messageSpeakable: (msg: ChatMsg) => boolean;
		speakTitle: (msg: ChatMsg) => string;
		toggleFold: (id: ChatMsgId) => void;
		toggleMessageActions: (id: ChatMsgId, event: MouseEvent) => void;
		articleLeave: (event: MouseEvent, msg: ChatMsg, index: number) => void;
		editFocusOut: (event: FocusEvent) => void;
		editAction: (node: HTMLElement) => { destroy(): void };
		toggleSentTag: (msg: ChatMsg, attId: string) => void;
		copyAttachment: (att: Attachment) => void;
		recognizeAttachment: (att: Attachment) => void;
		clearSentRefs: (messageId: ChatMsgId) => void;
		refsQuoteClick: (messageId: ChatMsgId, quote: string, n: number) => void;
		copyAnnotation: (quote: string, comment: string) => void;
		startRefsEdit: (
			messageId: ChatMsgId,
			ref: { n: number; comment: string }
		) => void;
		saveRefsEdit: () => void;
		cancelRefsEdit: () => void;
		setHoverBadge: (id: string | null) => void;
		badgeClick: (id: AnnotationId, anchor: { x: number; y: number }) => void;
		attachAction: (action: SentTagAction, id: string) => void;
		toast: (message: string) => void;
		togglePasteFold: (msg: ChatMsg, index: number) => void;
		setAidBusy: (id: ChatMsgId, loading: boolean) => void;
		aidFailed: (id: ChatMsgId, reason?: string) => void;
		copyText: (content: string, role: string) => void;
		branchHere: (index: number) => void;
		dropMessage: (index: number) => void;
		stopVoice: () => void;
		speakReply: (msg: ChatMsg) => void;
		unpinModelAid: (msg: ChatMsg) => void;
		runModelAidFor: (msg: ChatMsg, aidId: string, pin: boolean) => void;
		unpinLocalAid: (msg: ChatMsg, kind: LocalAid) => void;
		pinLocalAid: (msg: ChatMsg, kind: LocalAid) => void;
		peekAid: (msg: ChatMsg, kind?: LocalAid) => void;
		unpeekAid: (msg: ChatMsg) => void;
		commitMessageEdit: () => boolean;
		editMessage: (index: number) => void;
		rerunFrom: (index: number) => void;
		retryFailed: () => void;
		releaseRowFocus: (event: MouseEvent) => void;
		holdActionsOpen: () => void;
		releaseActionsHold: () => void;
	}

	interface Props {
		messages: ChatMsg[];
		chatId: string;
		focusMode: "edit" | "scroll";
		selectedIdx: number;
		speakingId: string | null;
		speakingSelection: string | null;
		aidBusy: Set<string>;
		vocalizing: Set<string>;
		aidPin: Set<string>;
		aidModelPin: Set<string>;
		foldedIds: Set<string>;
		aidPeek: { id: string; kind?: LocalAid } | null;
		shownActionsId: ChatMsgId | null;
		editingMsgId: ChatMsgId | null;
		ocrBusyId: string | null;
		android: boolean;
		showButtons: boolean;
		refsEditing: { messageId: ChatMsgId; n: number } | null;
		refsBlink: { messageId: ChatMsgId; n: number } | null;
		sourcesWanted: boolean;
		expandedTags: string[];
		previewing: boolean;
		activeReplyCode: string | null;
		foldTitle: string;
		deleteTitle: string;
		aidPreferred: LocalAid | null;
		washId: string | null | undefined;
		sending: boolean;
		sendingChatId: ChatId | null;
		sendingPhase: "fetch" | "waiting" | null;
		sendElapsed: number;
		waitingLabel: string;
		chatStepDir: 1 | -1 | null;
		useMock: boolean;
		openLangMenu: LanguageMenu["id"] | null;
		langMenuAnchor: {
			left: number;
			maxH: number;
			mode: "drop" | "center";
			top: number;
		} | null;
		// Mirrors LangMenusActions (kept structural: type imports from
		// .svelte files trip the unsafe-assignment rule here).
		langMenusActions: {
			toggle: (id: LanguageMenu["id"], el: HTMLElement) => void;
			pick: (lang: ReplyLanguage) => void;
		};
		scrollBox?: HTMLElement | undefined;
		popOpen?: ChatMsgId | null;
		refsDraft?: string;
		refsBox?: HTMLInputElement | null;
		actions: ThreadViewActions;
	}

	let {
		messages,
		chatId,
		focusMode,
		selectedIdx,
		speakingId,
		speakingSelection,
		aidBusy,
		vocalizing,
		aidPin,
		aidModelPin,
		foldedIds,
		aidPeek,
		shownActionsId,
		editingMsgId,
		ocrBusyId,
		android,
		showButtons,
		refsEditing,
		refsBlink,
		sourcesWanted,
		expandedTags,
		previewing,
		activeReplyCode,
		foldTitle,
		deleteTitle,
		aidPreferred,
		washId,
		sending,
		sendingChatId,
		sendingPhase,
		sendElapsed,
		waitingLabel,
		chatStepDir,
		useMock,
		openLangMenu,
		langMenuAnchor,
		langMenusActions,
		scrollBox = $bindable<HTMLElement | undefined>(undefined),
		popOpen = $bindable(null),
		refsDraft = $bindable(""),
		refsBox = $bindable(null),
		actions
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="messages"
	class:step-newer={android && chatStepDir === 1}
	class:step-older={android && chatStepDir === -1}
	bind:this={scrollBox}
	onscroll={() => actions.noteScrolling()}
	ontouchstart={() => actions.freezeScroll()}
	ontouchend={() => actions.releaseScroll()}
	ontouchcancel={() => actions.releaseScroll()}
	onanimationend={(e) => {
		if (e.target === e.currentTarget) actions.clearStepDir();
	}}
>
	{#if messages.length === 0}
		<!-- Empty hero through `EmptyHero.svelte` (the pills slot under
		the welcome text on every platform); the page keeps emptiness
		and the pill state. -->
		<EmptyHero mock={useMock}>
			<LangMenus
				openId={openLangMenu}
				anchor={langMenuAnchor}
				activeCode={activeReplyCode}
				{previewing}
				actions={langMenusActions}
			/>
		</EmptyHero>
	{/if}
	{#each messages as msg, i (msg.id)}
		{@const sentRefs = annRefsFor(msg.content)}
		{@const refsOnly = sentRefs ? sentRefs.text.trim() === "" : false}
		{@const isFolded = foldedIds.has(msg.id)}
		{@const script = detectScript(sentRefs ? sentRefs.text : msg.content)}
		{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
		{@const localKinds = offeredLocalAids(
			sentRefs ? sentRefs.text : msg.content,
			activeReplyCode
		)}
		{@const streamingThis =
			sending &&
			chatId === sendingChatId &&
			msg.role === "assistant" &&
			i === messages.length - 1}
		{@const tagBase =
			(sentRefs
				? refsOnly && !isFolded
					? REFS_ONLY_BODY
					: sentRefs.text
				: null) ?? msg.content}
		<!-- Message row renders in `MessageArticle.svelte`; the thread
		keeps the lists, all row state, and every behavior behind
		computed props and action groups. -->
		<MessageArticle
			{msg}
			index={i}
			selected={focusMode === "scroll" && selectedIdx === i}
			folded={isFolded}
			speakingNow={speakingId === msg.id}
			speakingSel={speakingSelection === msg.id}
			aidLoading={aidBusy.has(msg.id) || vocalizing.has(msg.id)}
			actionsOpen={shownActionsId === msg.id}
			editing={editingMsgId === msg.id}
			{sentRefs}
			textModels={actions.sentTagModels(msg, tagBase).filter((m) => m.kind === "text")}
			imageModels={actions.sentTagModels(msg, tagBase).filter((m) => m.kind === "image")}
			{ocrBusyId}
			{android}
			showButtons={showButtons}
			{refsEditing}
			{refsBlink}
			bind:popOpen
			bind:refsDraft
			bind:refsBox
			streaming={streamingThis}
			{sourcesWanted}
			foldPreview={refsOnly && sentRefs
				? sentRefs.refs.map((r) => `"${r.quote}"`).join(" ")
				: null}
			marks={actions.marksFor(msg.id)}
			{washId}
			{expandedTags}
			textOverride={actions.aidedTextFor(msg)}
			contentOverride={sentRefs
				? refsOnly && !isFolded
					? REFS_ONLY_BODY
					: sentRefs.text
				: null}
			aidPreview={aidPeek?.id === msg.id && !aidPin.has(msg.id)}
			{previewing}
			aidKinds={actions.localAidsOverrideFor(msg)}
			{aidPreferred}
			{foldTitle}
			{deleteTitle}
			speaking={actions.messageSpeaking(msg)}
			speakable={actions.messageSpeakable(msg)}
			speakLabel={actions.speakTitle(msg)}
			{aidId}
			aidModelPinned={aidModelPin.has(msg.id)}
			aidVocalizing={vocalizing.has(msg.id)}
			{localKinds}
			pinnedKinds={actions.pinnedKinds(msg.id)}
			aidBusy={aidBusy.has(msg.id)}
			actions={{
				articleClick: (event: MouseEvent) => {
					if (
						event.target instanceof Element &&
						event.target.closest(".sent-fold,.sent-open")
					)
						return;
					if (event.altKey) actions.toggleFold(msg.id);
					actions.toggleMessageActions(msg.id, event);
				},
				articleEnter: () => actions.hoverRow(i),
				articleLeave: (event: MouseEvent) =>
					actions.articleLeave(event, msg, i),
				editFocusOut: (event: FocusEvent) => actions.editFocusOut(event),
				editAction: (node: HTMLElement) => actions.editAction(node),
				tags: {
					toggle: (id: string) => actions.toggleSentTag(msg, id),
					copy: (att: Attachment) => actions.copyAttachment(att),
					recognize: (att: Attachment) => void actions.recognizeAttachment(att)
				},
				refs: {
					clearAll: () => actions.clearSentRefs(msg.id),
					quoteClick: (quote: string, n: number) =>
						actions.refsQuoteClick(msg.id, quote, n),
					copy: (quote: string, comment: string) =>
						actions.copyAnnotation(quote, comment),
					startEdit: (ref: { n: number; comment: string }) =>
						actions.startRefsEdit(msg.id, ref),
					saveEdit: () => actions.saveRefsEdit(),
					cancelEdit: () => actions.cancelRefsEdit()
				},
				setHoverBadge: (id: string | null) => actions.setHoverBadge(id),
				badgeClick: (id: AnnotationId, anchor: { x: number; y: number }) =>
					actions.badgeClick(id, anchor),
				attachAction: (action: SentTagAction, id: string) =>
					actions.attachAction(action, id),
				tagToggle: (id: string) => actions.toggleSentTag(msg, id),
				toast: (message: string) => actions.toast(message),
				foldToggle: (index: number) => actions.togglePasteFold(msg, index),
				unfold: () => actions.toggleFold(msg.id),
				aidLoadingChange: (loading: boolean) =>
					actions.setAidBusy(msg.id, loading),
				aidError: (_id: ChatMsgId, reason?: string) =>
					actions.aidFailed(msg.id, reason),
				ma: {
					toggleFold: () => actions.toggleFold(msg.id),
					copy: () => actions.copyText(msg.content, msg.role),
					branch: () => actions.branchHere(i),
					drop: () => actions.dropMessage(i),
					stopVoice: () => actions.stopVoice(),
					speak: () => void actions.speakReply(msg),
					unpinModelAid: () => actions.unpinModelAid(msg),
					runModelAid: (modelId: string) =>
						void actions.runModelAidFor(msg, modelId, true),
					unpinLocalAid: (kind: LocalAid) => actions.unpinLocalAid(msg, kind),
					pinLocalAid: (kind: LocalAid) => actions.pinLocalAid(msg, kind),
					peekAid: (kind: LocalAid) => actions.peekAid(msg, kind),
					unpeekAid: () => actions.unpeekAid(msg),
					commitEdit: () => void actions.commitMessageEdit(),
					edit: () => void actions.editMessage(i),
					rerun: () => actions.rerunFrom(i),
					retry: () => void actions.retryFailed(),
					releaseRowFocus: (event: MouseEvent) =>
						actions.releaseRowFocus(event),
					holdOpen: () => actions.holdActionsOpen(),
					releaseHold: () => actions.releaseActionsHold()
				}
			}}
		/>
	{/each}
	<!-- Sending status renders in `SendingIndicator.svelte`; the page
	keeps send/fetch state and labels. -->
	<SendingIndicator
		phase={sendingPhase}
		elapsed={sendElapsed}
		waitingLabel={waitingLabel}
	/>
</div>

<style>
	/* Original spacing stands: the header strip plus the list's own
	inset keep the first message clear of the island. Trimming it
	(any of three tries) slid text under the clock — the first-message
	gap was never worth chasing. */
	:global(.app[data-android]) .messages {
		padding-top: calc(1rem + env(safe-area-inset-top, 0px));
		/* Assistant articles carry no side padding, so the thread
		gutter is the only thing between AI text and the screen
		edge: a rem floor keeps a real gutter on narrow phones. */
		padding-left: max(0.5%, 1rem);
		padding-right: max(0.5%, 1rem);
	}

	/* Full-bleed trades the gutter back for reading room: at huge
	type the thread runs ~99% wide so giant glyphs keep context. */
	:global(.app[data-android][data-fullbleed]) .messages {
		padding-left: 0.5%;
		padding-right: 0.5%;
	}

	.messages {
		flex: 1;
		/* Flex items default to min-height: auto, which lets growing
		content stretch this pane and squeeze the composer instead of
		scrolling inside it — the prompt shrank and juddered with
		every streamed chunk. Zero lets it scroll like it should. */
		min-height: 0;
		overflow-y: auto;
		/* Jumped-to rows never park under the invisible drag strip
		(jumpTo, double-tap, scroll-into-view): its pixels show text
		but don't take clicks, so programmatic scrolls clear the
		strip's 1.75rem plus the old breathing room. */
		scroll-padding-top: calc(1.75rem + 1rem);
		/* Bottom clearance for the floating card is measured, not static
		(see the ResizeObserver below): in-scroller padding physically
		keeps the tail above the card while the thread runs full-height
		behind it (bleed-through); the in-flow attachment strip keeps
		its own main-level lift, since padding inside the scroller
		would leave the strip parked under the card eating its taps. */
	}
	.messages {
		/* Selection starts at message text only: dragging empty space
		between messages is a plain pointer drag (arrow, no I-beam, no
		stray selection). .rendered re-enables both; buttons keep
		their own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
		/* Fast wheel, eased programmatic jumps. The scrollbar snaps in
		(the .scrolling override below shortens the transition while
		scroll events land) and drifts out quickly once they stop. */
		scroll-behavior: smooth;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		/* Classic scrollbars never shove the column when they appear. */
		scrollbar-gutter: stable;
		transition: scrollbar-color 0.3s ease;
		/* Full bleed under the invisible drag strip: content starts at
		the window's own top edge and stays visible behind the bar.
		The strip's pixels don't take clicks, so scroll-padding-top
		(not this padding) keeps jumped-to targets clickable. */
		padding: 0 1.2rem 1rem;
		display: flex;
		flex-direction: column;
		/* Pairs hug: a message sits close to its reply; the wider
		separation lands between pairs (see article.user below). The
		base gap rides the Gap size slider — the text-size growth
		below belongs to the button-scaling opt-in, so huge type
		with the opt-in off keeps tight gaps (the buttons stay
		small too). */
		gap: var(--msg-gap, 0.35rem);
	}
	/* Button-scaling opt-in: roomy type keeps airy gaps. */
	:global(main.scale-actions) .messages {
		gap: calc(var(--msg-gap, 0.35rem) * var(--font-scale, 1));
	}

	/* Overscroll past the tail: the last message lifts a touch above
	the composer instead of docking hard at the column's end. Fixed
	unless the opt-in below says otherwise (capped like the bubble,
	so huge type doesn't drown in spacer). Non-empty only: the empty
	hero centers in its zone and must not drift. */
	:global(main:not(.empty)) .messages::after {
		content: "";
		display: block;
		flex: none;
		height: 2rem;
	}
	/* Same opt-in as the list gap: the tail spacer grows with the
	text size only when message-button scaling is on. */
	:global(main.scale-actions:not(.empty)) .messages::after {
		height: calc(2rem * min(var(--font-scale, 1), 2));
	}

	/* The chat scrollbar stays out of the way: invisible until a scroll
	is in flight (JS toggles .scrolling while scroll events land). */
	.messages::-webkit-scrollbar {
		width: 8px;
	}
	.messages::-webkit-scrollbar-track {
		background: transparent;
	}
	.messages::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.3s ease;
	}
	.messages:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	.messages:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}

	:global(main.empty) .messages {
		justify-content: center;
		/* Roomy hero zone: on the empty screen the prompt and pills sit
		below the fold of the hero, neither middle nor bottom. */
		max-height: 60%;
	}

	/* Message text never spills sideways off a phone: inner scrollers
	(code blocks, aid-label rows) keep their own axes. */
	:global(.app[data-android]) .messages {
		overflow-x: clip;
	}

	/* CJK wraps at the column edge on phones, like desktop: the shared
	body rule uses word-break: break-word (legacy anywhere semantics),
	which lets shrink-wrapped rows size to a narrow min-content and
	wraps Chinese far too early at huge text sizes. Phones keep normal
	character breaking with kinsoku (strict) while long Latin strings
	still break via overflow-wrap — desktop keeps its own rule. */
	:global(.app[data-android]) .messages :global(.rendered) {
		line-break: strict;
		word-break: normal;
		overflow-wrap: break-word;
	}

	/* Chat-step slide: the incoming chat glides in from the swipe
	side (newer from the right, older from the left). Phone-only;
	reduced-motion keeps the instant switch. */
	@keyframes step-in-right {
		from {
			transform: translateX(2.5rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes step-in-left {
		from {
			transform: translateX(-2.5rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	:global(.app[data-android]) .messages.step-newer {
		animation: step-in-right 0.18s ease-out;
	}
	:global(.app[data-android]) .messages.step-older {
		animation: step-in-left 0.18s ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.app[data-android]) .messages.step-newer,
		:global(.app[data-android]) .messages.step-older {
			animation: none;
		}
	}
</style>
