<script lang="ts">
	import { flushSync, onMount, tick } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { fade } from "svelte/transition";
	// Document theme tokens + print sheet (REFACTOR §6): global CSS
	// lives in src/app.css, imported here (single route).
	import "../app.css";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		setChatReplyLang,
		chatVoiceReadback,
		setChatVoice,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		editMessageContent,
		resendLast,
		tokenTotal,
		tokenSplit,
		waypoints,
		waypointLabel,
		sendMessage,
		setPasteFold,
		isSending,
		resolveSendCompletion,
		type Chat,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		activeThinkingSupport,
		activeThinkingId,
		resolveTheme,
		systemLocale,
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MIN,
		CHAT_WIDTH_MAX,
		MESSAGE_GAP_DEFAULT,
		effectiveChatWidth,
		FONT_SCALE_MIN,
		FONT_SCALE_MAX,
		PROMPT_IDLE_ALWAYS,
		PROMPT_IDLE_NEVER,
		type AppSettings
	} from "$lib/settings";
	import { cycleThinkingId } from "$lib/providers/thinking";
	import {
		LANGUAGE_MENUS,
		QUICK_LANG_CODES,
		quickKeyFor,
		replyLanguageFor,
		type LanguageMenu
	} from "$lib/languages";
	import {
		listProviders,
		createProvider,
		getProviderDef,
		type ProviderId
	} from "$lib/providers/registry";
	import { offlineTarget, onlineRestore } from "$lib/offline";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import {
		createPromptEditor,
		PROMPT_PLACEHOLDER,
		SCROLL_PLACEHOLDER,
		ANDROID_PROMPT_PLACEHOLDER,
		ANDROID_SCROLL_PLACEHOLDER,
		sendPasteFolds,
		type PromptEditor,
		type PromptEditorOptions,
		type SubmitKind
	} from "$lib/editor";
	import { createTextareaEditor } from "$lib/textarea-editor";
	import {
		SCROLLKEY_LINE_PX,
		SCROLLKEY_SKIP_PX,
		ggArmed,
		halfPageDy,
		holdIsTap,
		indexAtViewportLine,
		isEscapeHold,
		keyFocusesEmptyPrompt,
		messageEdgeScrollTop,
		nearBottom,
		resolveSidebarSpaceEnter,
		scrollHoldVelocity,
		stepScrollTop,
		unselectedScrollIntent
	} from "$lib/scrollkeys";
	import { hydrateSecrets, persistSecrets, tauriBackendAvailable, withBlankedKeys } from "$lib/secrets";
	import { canEditMessage, toggleAidKinds, toggleSingleAid } from "$lib/message-actions";
	import type { ChatProvider } from "$lib/providers/types";
	import MessageBody from "$lib/components/MessageBody.svelte";
	import { paintJumpWash, clearJumpWash } from "$lib/annHighlights";
	import ActionIcon from "$lib/components/ActionIcon.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";
	import { plainBody, sourcesAsked } from "$lib/render";
import {
	clearNotice,
	emptyNotices,
	flashNotice,
	showNotice,
	TOAST_TIMEOUT_MS,
	ERROR_TOAST_TIMEOUT_MS,
	VOICE_TIMEOUT_MS
} from "$lib/notices";
	import {
		FILE_MARKER,
		IMAGE_MARKER,
		fileExcerpt,
		fileMarkerInsert,
		fileToAttachment,
		formatTokenCount,
		stripAttachmentMarkers,
		imageMarkerInsert,
		attachmentImageBlobs,
		clipboardPngBlob,
		countMarkers,
		leftoverAttachments,
		type Attachment,
		type AttachmentKind,
		type AttachTagModel,
		type SentTagAction
	} from "$lib/attachments";
		import {
		duplicateAnnotationId,
		editAnnotationComment,
		deleteAnnotation,
		clearAnnotations,
		annotationNumber,
		annotationCountLabel,
		withAnnotations,
		quoteFragmentText,
		equationBodyOf,
		equationBodyRange,
		trimParagraphTerminator,
		redactedCopyText,
		newAnnotationId,
		rewriteAnnotationComment,
		quoteRange,
		wrapRangeInMark,
		unwrapMark,
		findQuotedMessage,
		annRefsFor,
		lockSelectionToMessage,
		quoteTextNodes,
		occurrenceAtPosition,
		snapSelectionToWordEdges,
		selMenuPlacement,
		placeAnnPopX,
		REFS_ONLY_BODY,
		lineStartOffset,
		clampDragAnchorToFocusLine,
		reviewEditKey,
		loadDraftAnnotations,
		saveDraftAnnotations,
		type Annotation,
		type AnnotationId,
		type AnnotationMark
	} from "$lib/annotations";
	import { createRefMemo } from "$lib/aidLoading";
	import { scopeMessagesTransition, switchChatWithTransition } from "$lib/viewTransitions";
	import {
		decomposeTree,
		getInspectData,
		inspectLangFor,
		isHanChar,
		onKunLine,
		shouldShowInspect
	} from "$lib/inspect";
	import { pinyinRuby } from "$lib/pinyin";
	import { furiganaHtml } from "$lib/furigana";
	import { fetchStrokePaths } from "$lib/kanjivg";
	import {
	isAndroidUserAgent,
	isIOSUserAgent,
	isCoarsePointer,
	isTouchTablet,
	currentPlatform,
	altKeyLabel,
	edgeSwipeTarget,
	contentSwipeTarget,
	pinchZoomStep,
	twoFingerSwipeDir,
	twoFingerSlideDir,
	threeFingerSwipeDir,
	isThreeFingerTap,
	type FlickZone,
	type EdgePanel,
	type FingerTrack
} from "$lib/platform";
import { desktopShortcuts, filteredShortcuts, touchShortcuts } from "$lib/shortcuts";
	import {
		chromeChord,
		commandChord,
		deleteChatScope,
		inspectStepAction,
		keyFacts,
		messageKeyAction,
		modalScrollAction,
		promptIdleKeyAction,
		quickLangIndexForKey,
		scrollEnterAction,
		scrollModeAction,
		unselectedScrollAction,
		shortcutsFilterBlocksKey,
		sidebarListAction,
		spaceKeyAction
	} from "$lib/keybindings";
import { describeActiveElement, describeFocusTarget, focusLog } from "$lib/focusDebug";
import {
		closestFromTarget,
		consumeEvent,
		isClickControlTarget,
		isEditableTarget,
		isFieldTarget,
		isFilterTarget,
		isFindBarTarget,
		isIdleOwnedTarget,
		isInspectFieldTarget,
		isInteractiveTarget,
		isMathTarget,
		isPromptEditorTarget,
		isPromptTarget,
		isScrollEnterOwnedTarget,
		isSidebarTarget,
		isSpaceInteractiveTarget,
		isTapOverlayTarget,
		mouseupKeepsSelection,
		isAnnotationUiTarget
	} from "$lib/events";
	import {
		aidDisplayText,
		detectScript,
		offeredLocalAids,
		preferredLocalAid,
		LOCAL_AID_BUTTON,
		LOCAL_AID_SHOW_ORIGINAL,
		LOCAL_AID_ADD_TITLE,
		MODEL_AIDS,
		MODEL_AID_FOR_SCRIPT,
		extractWordAt,
		hanOverlayLangFor,
		isHanOverlayLangUncertain,
		HAN_OVERLAY_LANG_TAG,
		runModelAid,
		aidTargetLines,
		spliceAidResult,
		resolveAidKinds,
		readingsOnly,
		type LocalAid,
		type HanOverlayLang
	} from "$lib/reading";
	import { isFuriganaCached } from "$lib/furigana";
	import { buildSearchDocs, chatMatchesQuery, findMessageIndices, type SearchHit } from "$lib/chatSearch";
	import { emptyFind, stepFindCursor, type FindState } from "$lib/find";
	import { emptyPalette, type PaletteState } from "$lib/palette";
	import { annPopBlurAction, annPopCancelKind, annPopSaveKind } from "$lib/annPop";
	import { idleTapAction, shouldHideForAlways, shouldIdleHide } from "$lib/idle";
	import {
		submitAction,
		sendAction,
		editMessageAction,
		commitEditTarget
	} from "$lib/submit";
	import { emptyViewport, type ViewportState } from "$lib/viewport";
	import { ChatSearchStore, createSearchWorker } from "$lib/chatSearchStore";

	import { dropFilesFromDataTransfer, isPermissionDismissal } from "$lib/intake";
	import { consumeLaunchFiles, splitLaunchFiles } from "$lib/launchFiles";
	import { copyExportText, downloadMarkdownFile, exportChatMarkdown, fileSaveAccessAvailable } from "$lib/chatExport";
	import { nativeSaveMarkdown } from "$lib/nativeExport";
	import { isKeyboardOpen, keyboardOverlapPx } from "$lib/viewportReflow";
import { isPromptIdle, stageOwnedByOverlay } from "$lib/chrome";
	import {
		speakText,
		speakMultilingual,
		speechText,
		latinFallback,
		messageSpeechLang,
		speechAttemptable,
		startSpeechError,
		effectiveSpeechLang,
		stopSpeaking,
		micAvailable,
		dictateOnce,
		type SpeakCallbacks
	} from "$lib/voice";
	import {
		speakNative,
		speakNativeMulti,
		stopNative,
		friendlyNativeError,
		nativeTtsSupported,
		quoteLangFor,
		quoteLangForContext,
		sentenceForQuote,
		sentenceLangsFor,
		currentKeyboardInputSource
	} from "$lib/nativeTts";
	import { startNativeDictation } from "$lib/nativeDictate";
	import {
		acquireStudyWakeLock,
		clearStudyBadge,
		ensureReplyNotificationPermissionAsync,
		hapticBeatAsync,
		notifyReplyDoneAsync,
		releaseStudyWakeLock,
		setStudyBadge,
		vibrateTick,
		type WakeLockRelease
	} from "$lib/studyMedia";
	import {
		recognizeImageText,
		recognizeFallbackText,
		ocrFallbackLangs,
		friendlyOcrError,
		friendlyFallbackError,
		ocrSupported
	} from "$lib/nativeOcr";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";
	import { joinExternalDraft, routeExternalText } from "$lib/externalText";
	import {
		listenDeepLinks,
		isSummonHotkey,
		studySheetMarkdown,
		sheetTitle,
		shareStudySheet,
		printStudySheet,
		desktopSleepBlock,
		desktopSleepUnblock,
		exportStudySheet
	} from "$lib/desktop";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());
	// The chat list always starts closed — a persisted open state never
	// survives a start or refresh.
	settings.sidebarCollapsed = true;
	// Voice readback always starts off for the same reason: every launch
	// begins quiet, no matter what it was left on.
	settings.voice = false;

	// Settings save themselves: every change persists (debounced), with
	// secrets mirrored to the Keychain in the Tauri shell. No Save button.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let skipFirstSave = true;
	$effect(() => {
		const snapshot = $state.snapshot(settings);
		if (skipFirstSave) {
			skipFirstSave = false;
			return;
		}
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			// The top-of-effect snapshot (a synchronous settings read, so
			// the effect subscribes) freezes the debounced save.
			saveSettingsNow(snapshot);
		}, 400);
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	if (tauriBackendAvailable()) {
		// Pull Keychain keys into memory before the first send; no-op in browsers.
		void hydrateSecrets(settings);
	}
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	/** App root (pinned to the visual height while the phone keyboard is up). */
	let appEl: HTMLElement | undefined = $state();
	/** Scroll/viewport values (REFACTOR §6): one grouped object, so
	scroll effects stop sharing subscription accidents with unrelated
	domains. The element and the wiring stay here. */
	let viewport = $state<ViewportState>(emptyViewport());
	/** Scrollbar thumb shows while a scroll is in flight, then fades.
	The stop hold is short (120ms): momentum scrolls land events in
	tight bursts, so anything longer just delays the fadeout. */
	/** Filed scroll positions, one per chat: switching back lands
	where you left instead of at the top. Session memory only —
	never persisted (reloads boot at the fresh-box top like today).
	Previews never file: mid-peek the box shows another chat. */
	const chatScrollTops = new SvelteMap<ChatId, number>();
	/** File the active chat's scroll position (see chatScrollTops). */
	function saveChatScroll(): void {
		if (previewChatId !== null || !scrollBox) return;
		chatScrollTops.set(chatState.activeChatId, scrollBox.scrollTop);
	}
	function noteScrolling(): void {
		// Desktop keeps its menu: trackSelMenu repositions it over the
		// highlight instead. Phones dismiss the docked menu here.
		if (androidUI) selMenu = null;
		saveChatScroll();
		if (scrollBox) viewport.stick = nearBottom(scrollBox);
		scrollBox?.classList.add("scrolling");
		window.clearTimeout(viewport.idleTimer);
		viewport.idleTimer = window.setTimeout(() => {
			scrollBox?.classList.remove("scrolling");
			updateWpPos();
		}, 120);
	}
	let focusMode: "edit" | "scroll" = $state("edit");
	/**
	 * Whether scroll mode started in the prompt: only then does Ctrl+G
	 * hop back to a focused, type-ready composer. Entering from a
	 * deactivated prompt (Ctrl+G at the view, search/find landings)
	 * stays out — there is nothing to hop back to.
	 */
	let scrollFromPrompt = false;
	let selectedIdx = $state(-1);
	let hoveredIdx = $state(-1);
	/**
	 * Last hover-index change: hovering another message empties a live
	 * selection on WebKit (engine, no press), so a selectionchange that
	 * lands right after a hover change restores instead of dismissing
	 * (see the dismiss below). Programmatic clears arrive with a stale
	 * hover and keep dismissing.
	 */
	let lastHoverChangeAt = 0;
	let missingKey = $state(false);
	/** Provider id already toasted for a missing key (one toast per episode). */
	let keyToastFor: string | null = null;
	/** Message ids already toasted for send errors (Android shows no inline error). */
	const errorToasted = new SvelteSet<ChatMsgId>();
	/**
	 * Android reports errors as toasts, never inline chrome: a phone
	 * column has no room for a persistent banner, and a font-scaled
	 * error span blows the action row apart. Toasts auto-dismiss, so
	 * the "set an API key" notice goes away on its own too.
	 */
	$effect(() => {
		if (!androidUI) return;
		if (!missingKey) {
			keyToastFor = null;
			return;
		}
		const id = settings.activeProviderId;
		if (keyToastFor === id) return;
		keyToastFor = id;
		flashErrorToast("No API key — open Settings to add one");
	});
	$effect(() => {
		if (!androidUI) return;
		const live = new Set(viewChat.messages.map((m) => m.id));
		for (const id of errorToasted) if (!live.has(id)) errorToasted.delete(id);
		for (const m of viewChat.messages) {
			if (m.error && !errorToasted.has(m.id)) {
				errorToasted.add(m.id);
				flashErrorToast(m.error);
			}
		}
	});
	let attachments = $state<Attachment[]>([]);
	/** In-flight attachment reads (counter: multi-file drops overlap).
	While nonzero the paperclip dims and reports progress. */
	let attachBusy = $state(0);
	let attachInput: HTMLInputElement | undefined = $state();
	let foldedIds = new SvelteSet<string>();
	/**
	 * Draft annotations for the active chat, restored from storage on
	 * launch: unsent quotes survive a restart (sending still bakes and
	 * clears, switching chats still starts clean — the save below
	 * records the empty list either way).
	 */
	let annotations = $state<Annotation[]>(loadDraftAnnotations(chatState.activeChatId));
	$effect(() => {
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
	});
	/**
	 * Search index stays fresh: any chat/message/draft change re-indexes
	 * (debounced) into the Worker + IndexedDB snapshot. The synchronous
	 * reads subscribe the effect; the schedule call is the debounced
	 * side effect.
	 */
	$effect(() => {
		const fingerprint = chatState.chats
			.map((c) => `${c.id}:${c.messages.length}:${c.messages.map((m) => m.content.length).join(",")}`)
			.join("|");
		const draftCount = annotations.length;
		void fingerprint;
		void draftCount;
		scheduleSearchIndex();
	});
	/**
	 * Annotation being composed (comment pill open, not yet submitted):
	 * held out of `annotations` so no badge stamps and no count moves
	 * until submit. The id is minted up front so the wash and the pill
	 * already address the annotation it will become.
	 */
	let pendingAnn = $state<Annotation | null>(null);
	let reviewOpen = $state(false);
	/** Focus refs: after a control unmounts mid-touch, focus must
	land on a live node inside .ann-wrap — never on a dying button
	(focus drops to <body> and strands the keyboard). */
	let annPill: HTMLButtonElement | null = $state(null);
	let editBox: HTMLTextAreaElement | null = $state(null);
	function focusPill(): void {
		annPill?.focus({ preventScroll: true });
	}
	/** Waypoint menu pinned open (hover/focus reveal it without pinning). */
	let wpOpen = $state(false);
	let wpWrap: HTMLElement | undefined = $state();
	/** 1-based position of the nearest waypoint at/above the viewport top
	(feeds the touch pill and the sheet's current-item highlight). */
	let wpPos = $state(1);
	/** Touch Y at swipe start for the sheet's pull-down-to-dismiss. */
	let wpTouchY: number | null = null;
	function updateWpPos(): void {
		const box = scrollBox;
		if (!box || points.length === 0) {
			wpPos = 1;
			return;
		}
		const top = box.scrollTop;
		let n = 0;
		for (let k = 0; k < points.length; k++) {
			const el = box.querySelector<HTMLElement>(`#msg-${points[k]}`);
			if (el && el.offsetTop - top <= 120) n = k + 1;
			else break;
		}
		wpPos = Math.max(1, n);
	}
	/** Pinned menu dismisses on outside press: the trigger hides while
	the panel is up, so there is nothing left to toggle it shut. */
	$effect(() => {
		if (!wpOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element) || !e.target.closest(".wp-wrap")) {
				wpOpen = false;
			}
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	});
	// The settings panel owns the pointer while open: unmounting the
	// rail above drops hover, and this closes a pinned menu with it.
	$effect(() => {
		if (settingsOpen) wpOpen = false;
	});
	// The menu opens at the middle option, not the top: it scrolls
	// into view without stealing focus (keyboard users tab in from
	// the top as before; a focus move would also pin the menu
	// against hover-outside dismissal).
	$effect(() => {
		if (!wpOpen) return;
		void tick().then(() => {
			if (!wpOpen) return;
			const items = wpWrap?.querySelectorAll('.wp-menu button[role="menuitem"]');
			const mid = items?.item(Math.floor(((items.length ?? 1) - 1) / 2));
			if (!(mid instanceof HTMLElement)) return;
			mid.scrollIntoView({ block: "nearest" });
		});
	});
	// The pill's position tracks the chat itself (new messages, chat
	// switches), not just scrolls: the synchronous reads subscribe the
	// effect, and the DOM re-read settles after paint, when article
	// boxes are final.
	$effect(() => {
		const total = points.length + viewChat.messages.length;
		requestAnimationFrame(() => {
			if (total === 0) wpPos = 1;
			else updateWpPos();
		});
	});
	/**
	 * Ticks stay invisible until the pointer comes near the stack (64px):
	 * cheap window mousemove, rAF-throttled, class toggled outside
	 * reactivity so chat never re-renders for pointer travel.
	 */
	$effect(() => {
		const el = wpWrap;
		if (!el || typeof window.matchMedia !== "function") return;
		if (window.matchMedia("(hover: none)").matches) return;
		const R = 64;
		let raf = 0;
		let near = false;
		const set = (v: boolean) => {
			if (v === near) return;
			near = v;
			el.classList.toggle("wp-near", v);
		};
		const onMove = (e: MouseEvent) => {
			if (raf) return;
			const x = e.clientX;
			const y = e.clientY;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				const r = el.getBoundingClientRect();
				set(x >= r.left - R && x <= r.right + R && y >= r.top - R && y <= r.bottom + R);
			});
		};
		const onLeave = () => {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			set(false);
		};
		// Hover-reveal also opens mid-list (the pinned-open effect only
		// covers wpOpen): a fresh hover lands on the middle option, while
		// a user-placed scroll and keyboard browsing are left alone.
		const midOnEnter = () => {
			const menuEl = el.querySelector(".wp-menu");
			if (!(menuEl instanceof HTMLElement) || menuEl.scrollTop > 0) return;
			if (menuEl.contains(document.activeElement)) return;
			const items = menuEl.querySelectorAll('button[role="menuitem"]');
			const mid = items.item(Math.floor((items.length - 1) / 2));
			if (mid instanceof HTMLElement) mid.scrollIntoView({ block: "nearest" });
		};
		el.addEventListener("mouseenter", midOnEnter);
		window.addEventListener("mousemove", onMove, { passive: true });
		document.documentElement.addEventListener("mouseleave", onLeave);
		return () => {
			el.removeEventListener("mouseenter", midOnEnter);
			window.removeEventListener("mousemove", onMove);
			document.documentElement.removeEventListener("mouseleave", onLeave);
			if (raf) window.cancelAnimationFrame(raf);
		};
	});
	/** Keyboard cursor over the sidebar chat list (-1 = follow mouse). */
	let sideIdx = -1;
	/** Sidebar chat-list filter text (mobile swipe opens the list on it). */
	let sideSearch = $state("");
	/** Sidebar search input (tapping it focuses with the keyboard up). */
	let sideSearchEl: HTMLInputElement | undefined = $state();
	/** Last lone "g" timestamp (gg hops to the top of history). */
	let lastGAt = 0;
	/**
	 * Escape keydown timestamp for the exit-fullscreen chord: F while
	 * Escape is held exits fullscreen (Escape alone never does). 0
	 * when no press is held.
	 */
	let escDownAt = 0;
	/**
	 * Command palette (Ctrl+P / Cmd+P): full-text search across chats
	 * and annotations. Null when closed.
	 */
	let palette = $state<PaletteState>(emptyPalette());
	let searchInputEl: HTMLInputElement | undefined = $state();
	let searchResultsEl: HTMLElement | undefined = $state();
	/** Search documents snapshot (Worker + IndexedDB, in-memory fallback). */
	let searchStore: ChatSearchStore | null = null;
	let searchIndexTimer: ReturnType<typeof setTimeout> | null = null;
	let searchQueryTimer: ReturnType<typeof setTimeout> | null = null;
	let editingId: AnnotationId | null = $state(null);
	let editDraft = $state("");
	/**
	 * Mobile in-prompt annotation edit: the composer holds the comment
	 * (the transplanted popover textbox can't reliably summon the
	 * phone keyboard), the send arrow files it, tapping out cancels.
	 * Desktop never sets this — popover and review textarea stay. The
	 * stash restores the drafted chat text on file and on cancel.
	 */
	let promptAnnEdit: { id: string } | { pending: true } | null = $state(null);
	let promptAnnStash = $state("");
	/**
	 * Click-toggled overlays (desktop has no hover-open anywhere):
	 * the sent-refs card opens per message (one at a time), the
	 * composer review rides reviewOpen. Pills are plain disclosure
	 * buttons — Enter/Space toggle like a click.
	 */
	let refsPopOpen: ChatMsgId | null = $state(null);
	/**
	 * Previous-menu row under note edit (desktop only — phones have no
	 * row pencil): message plus ref number, null when browsing. One
	 * card opens at a time (see refsPopOpen), so one edit slots in.
	 */
	let refsEditing: { messageId: ChatMsgId; n: number } | null = $state(null);
	let refsEditDraft = $state("");
	let refsEditBox: HTMLInputElement | null = $state(null);
	/** Jump-blink target: the wash shows while set (two slow blinks,
	then cleared — hover previews own the wash again after). */
	let annBlink: AnnotationId | null = $state(null);
	let annBlinkTimer: ReturnType<typeof setTimeout> | null = null;
	/** Sent-jump flash timer: re-jumps restart it, expiry releases the
	highlight (self-clearing — no chat-switch hook to forget). */
	let jumpBlinkTimer: ReturnType<typeof setTimeout> | null = null;
	/** Destination mark-flash timer: same schedule, DOM-backed twin. */
	let jumpMarkTimer: ReturnType<typeof setTimeout> | null = null;
	/** Sent-row blink: the pressed row flashes like a draft row (same
	phases), so the press reads even where the highlight wash can't
	paint. Keyed by message + number, not id — baked refs have none. */
	let refsBlink: { messageId: ChatMsgId; n: number } | null = $state(null);
	let refsBlinkTimer: ReturnType<typeof setTimeout> | null = null;
	/** Own message under in-place edit (null when no edit is open).
	Enter saves + resends; Alt+Enter saves without resending; Esc cancels. */
	let editingMsgId: ChatMsgId | null = $state(null);
	/** In-place editor handle (null unless an own-message edit is mounted). */
	let msgEditor: PromptEditor | null = null;
	/** Seed text for the in-place editor (prose plus image-marker lines). */
	let editingSeed = $state("");
	/** Attachments of the message under edit (the composer's own stay untouched). */
	let editingAttachments = $state<Attachment[]>([]);
	/** Last reconciled marker counts inside the in-place editor (images, files). */
	let editingPrevMarkers = 0;
	let editingPrevFileMarkers = 0;
	/** Programmatic inline edits must not reconcile against themselves. */
	let editingMarkerMuted = false;
	let highlightAnnId: AnnotationId | null = $state(null);
	/** Badge currently hovered (paints its quote wash as a preview). */
	let hoverBadgeId: string | null = $state(null);
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{ id: string; x: number; y: number; fresh: boolean } | null>(null);
	/** Last badge a mousedown press opened (or toggled): its trailing
	click re-fire is the same gesture, never a new one. Plain field —
	only the handlers below touch it, never the template. */
	let lastBadgePress: { id: AnnotationId; at: number } | null = null;
	/** Pill fade-out in flight (unmounts when the ramp ends). */
	let annPopClosing = $state(false);
	let annPopTimer: ReturnType<typeof setTimeout> | null = null;
	let annDraft = $state("");
	let annPopBox: HTMLTextAreaElement | undefined = $state();
	/**
	 * The Enter that saves an annotation must never double as a send.
	 * Any pointer press in between proves a distinct gesture, so it
	 * clears the window (see the pointerdown listener below): without
	 * this, a fast file-then-send (or its e2e) lands inside the 500ms
	 * window and the send is silently eaten.
	 */
	let sendGuardUntil = 0;
	/**
	 * Last pointerdown inside the composer (any button, field, or floor),
	 * as a timestamp. WebKit (the Tauri shell) doesn't move focus to
	 * buttons on press, so the editor blurs to nowhere (relatedTarget
	 * null) instead of onto the button — see onFocusOutIdle, which
	 * reads this to tell a still-in-flight control press from a real
	 * departure. Plain timestamp, never state: no render may hinge on it.
	 */
	let promptPressAt = 0;
	let selMenu = $state<{
		x: number;
		y: number;
		/** Highlight rect (viewport px): centers the create box when narrow. */
		left: number;
		w: number;
		quote: string;
		/** Containing paragraph text: the single-char guess reads it for kana. */
		context: string;
		messageId: ChatMsgId;
		/** Live range at summon time: menu hover puts the highlight
		back when WebKit empties it (no DOM change, so still valid). */
		range: Range | null;
	} | null>(null);
	/**
	 * Selection readings overlay: right-clicking a Han character with
	 * a live highlight shows just the readings (pinyin/furigana, never
	 * the characters again — they're right there). Read-only and
	 * pointer-transparent, so it can't disturb the highlight — and
	 * the highlight clearing dismisses it at once via
	 * selectionchange below.
	 */
	let selPinyin = $state<{
		x: number;
		y: number;
		above: boolean;
		quote: string;
		messageId: ChatMsgId;
		html: string;
	} | null>(null);
	/**
	 * An unanswered selection menu never lingers (clicking away still
	 * dismisses instantly). Desktop gives a 6s idle window, and any
	 * pointer activity inside it re-arms: an aimer steering toward
	 * Annotate must never race the dismiss. Touch holds it while the
	 * highlight is live instead (no hover there): a thumb takes
	 * longer to reach than a cursor.
	 */
	const SEL_MENU_IDLE_MS = 6000;
	let selMenuTimer: ReturnType<typeof setTimeout> | null = null;
	/**
	 * True while the pointer hovers the selection menu: the auto-dismiss
	 * timer stands down, so moving the mouse from the highlight to the
	 * Annotate button never cancels it. Leaving re-arms the timer.
	 */
	let selMenuHover = $state(false);
	$effect(() => {
		if (!selMenu) {
			selMenuHover = false;
			return;
		}
		if (selMenuHover) return;
		if (selMenuTimer) clearTimeout(selMenuTimer);
		// Phones: the dock tracks the native bubble — while a highlight
		// is live the bubble is up, so hold the dock past the timer
		// (like a held press holds the action row). Collapsing the
		// selection still clears it at once via selectionchange below.
		const arm = (): void => {
			selMenuTimer = setTimeout(
				() => {
					selMenuTimer = null;
					if (androidUI && (window.getSelection()?.toString() ?? "") !== "") {
						arm();
						return;
					}
					// Engaged hands hold the menu: pointer activity (stamped
					// by the shared activity listener) inside the window
					// re-arms instead of dismissing.
					if (!androidUI && !selMenuHover && Date.now() - lastInputAt < SEL_MENU_IDLE_MS) {
						arm();
						return;
					}
					selMenu = null;
				},
				androidUI ? 4500 : SEL_MENU_IDLE_MS
			);
		};
		arm();
		return () => {
			if (selMenuTimer) {
				clearTimeout(selMenuTimer);
				selMenuTimer = null;
			}
		};
	});
	/**
	 * Right-edge truth: the placement estimate can't know the real
	 * button widths (fonts, zoom), so after paint pull the menu back
	 * on screen by its measured width. One-shot per placement — the
	 * corrected x never re-triggers it.
	 */
	$effect(() => {
		const menu = selMenu;
		const el = selMenuEl;
		if (!menu || !el) return;
		const over = menu.x + el.offsetWidth + 8 - window.innerWidth;
		if (over > 0) selMenu = { ...menu, x: Math.max(8, menu.x - over) };
	});
	/**
	 * Last press that began inside the selection menu: whatever
	 * selection churn follows belongs to the menu (button taps collapse
	 * the highlight on release), so the selectionchange auto-dismiss
	 * below stands down for it. Annotate runs off the stored quote.
	 */
	let menuPressAt = 0;
	function noteMenuPress(): void {
		menuPressAt = Date.now();
	}
	/**
	 * Selection-menu open stamp: the rescue in the selectionchange
	 * auto-dismiss below puts the stored range back while NEITHER a
	 * press/key NOR a programmatic clear landed since the menu
	 * opened. lastPressAt covers pointerdown AND keydown, and the
	 * summoning drag's own press predates the open — so the rescue
	 * fires exactly for press-less engine clears (the pointer
	 * cruising other messages, the menu's own shadow), while
	 * click-away, new drags, arrow-collapses, and Escape all stamp
	 * newer and keep dismissing. Same-millisecond ties read as the
	 * summoning gesture, never as a newer press.
	 */
	let selMenuOpenedAt = 0;
	/** Last clearSelection() call: programmatic clears dismiss, engine
	hover-clears rescue (see above). Every caller also drops the menu,
	so this is belt-and-braces for future paths. */
	let lastProgrammaticClearAt = 0;
	/**
	 * Width estimate (px) for the selection menu's right-edge clamp:
	 * one padded button, two when Inspect joins Annotate. The
	 * measured effect on the menu div corrects font/zoom variance.
	 */
	function selMenuWidthEstimate(quote: string): number {
		return shouldShowInspect(quote, settings.inspectEnabled) ? 220 : 120;
	}
	/** The floating menu element: its measured width pulls the
	estimated x back on screen (see the effect below). */
	let selMenuEl: HTMLElement | null = $state(null);
	/**
	 * Swap-vs-press discrimination for the selectionchange
	 * auto-dismiss below. Message bodies swap their HTML under a live
	 * highlight (Shiki late-enhance, aid rebuilds, stream chunks):
	 * WebKit fires selectionchange for the collapse this causes
	 * (Chromium stays silent), and the collapsed-attached shape reads
	 * exactly like a genuine clear. A MutationObserver stamps every
	 * structural/text swap; presses stamp separately. A collapse newer
	 * than the last press is the swap's, so the menu stands on its
	 * stored quote — genuine clears always arrive on a press (pointer
	 * travel and hovers stamp nothing) and still dismiss.
	 */
	let lastBodySwapAt = 0;
	let lastPressAt = 0;
	let swapObserverOn = false;
	function ensureSwapObserver(): void {
		if (swapObserverOn) return;
		const root = document.querySelector(".messages");
		if (!root) return;
		swapObserverOn = true;
		const observer = new MutationObserver(() => {
			lastBodySwapAt = Date.now();
		});
		observer.observe(root, { childList: true, subtree: true, characterData: true });
	}
	$effect(() => {
		ensureSwapObserver();
		const stampPress = (): void => {
			lastPressAt = Date.now();
		};
		window.addEventListener("pointerdown", stampPress, { passive: true });
		window.addEventListener("keydown", stampPress);
		return () => {
			window.removeEventListener("pointerdown", stampPress);
			window.removeEventListener("keydown", stampPress);
		};
	});
	let menuBtnTouchStart: { x: number; y: number } | null = null;
	function noteMenuBtnTouch(event: TouchEvent): void {
		const t = event.changedTouches[0];
		menuBtnTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
		menuPressAt = Date.now();
	}
	/**
	 * Touch activation for menu buttons: a tap that starts near a
	 * selection handle is swallowed as a handle nudge (the handle
	 * blinks, no click ever arrives), so waiting for onclick strands
	 * the button. Run off touchend instead; preventDefault eats the
	 * compat mouse sequence. Mouse and keyboard keep onclick.
	 */
	function menuBtnTouch(event: TouchEvent, run: () => void): void {
		const t = event.changedTouches[0];
		const start = menuBtnTouchStart;
		menuBtnTouchStart = null;
		menuPressAt = Date.now();
		if (!t || !start) return;
		if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 14) return;
		event.preventDefault();
		run();
	}
	function annotateTouch(event: TouchEvent): void {
		menuBtnTouch(event, annotate);
	}
	function speakTouch(event: TouchEvent): void {
		menuBtnTouch(event, speakDockSelection);
	}
	/** Mobile dock Speak: read the highlight aloud, dock stays put
	so Annotate (and Inspect) stay one tap away after listening. */
	function speakDockSelection(): void {
		if (!selMenu) return;
		// Phones get no readings popup (the native callout owns the
		// text space): a CJK highlight toasts its readings at the top
		// instead — pinyin in Chinese text, furigana in Japanese —
		// mirroring the desktop right-click panel. Speech always runs;
		// the toast is a silent extra.
		if (androidUI) void toastSelectionReadings(selMenu.quote, selMenu.context);
		void speakQuote(selMenu.quote, selMenu.messageId, true, selMenu.context);
	}
	/**
	 * Readings for a highlight as top-toast text (see
	 * speakDockSelection): sync pinyin, worker furigana. Long
	 * readings stay off the toast (the pill is single-line); a
	 * moved-on highlight drops the async result instead of showing it.
	 */
	async function toastSelectionReadings(quote: string, context: string): Promise<void> {
		const probe = sentenceForQuote(context, quote) ?? context;
		if (hanOverlayLangFor(probe) !== "ja") {
			if (!offeredLocalAids(quote, activeReplyCode).includes("pinyin")) return;
			const readings = readingsOnly(pinyinRuby(quote), " ", "rt");
			if (readings && readings.length <= 140) flashToast(readings);
			return;
		}
		let html: string;
		try {
			html = await furiganaHtml(quote, "furigana");
		} catch {
			return;
		}
		const now = currentQuote();
		if (!now || now.quote !== quote) return;
		const readings = readingsOnly(html, "", ".frt");
		if (readings && readings.length <= 140) flashToast(readings);
	}
	function inspectTouch(event: TouchEvent): void {
		menuBtnTouch(event, openInspect);
	}
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	/** Aid runs clicked mid-flight that must pin on completion. */
	let pendingPin = new SvelteSet<string>();
	/** Messages whose aid is pinned on (model-aid text or local ruby). */
	let aidPin = new SvelteSet<string>();
	/**
	 * Local aids pinned per message (model pins set no kinds). Each kind
	 * renders only its own lines, so furigana and pinyin pin
	 * independently and both stay up together on mixed messages. Model
	 * aids (tashkeel) compose with them instead of replacing them.
	 */
	let aidKindPin = new SvelteMap<string, LocalAid[]>();
	/** Messages with the model aid (tashkeel) pinned: its vocalized
	text shows while pinned local kinds render onto it. */
	let aidModelPin = new SvelteSet<string>();
	/** Pinned local kinds for a message (never a live reference). */
	function pinnedKinds(id: string): LocalAid[] {
		return aidKindPin.get(id) ?? [];
	}
	/** Messages whose local aid (furigana dictionary) is loading right now. */
	let aidBusy = new SvelteSet<string>();
	/** Message currently hover-previewing its aid (null when none). */
	let aidPeek = $state<{ id: string; kind?: LocalAid } | null>(null);
	/**
	 * Peek lock: clicking swaps the button under a stationary cursor, and the
	 * browser re-fires mouseenter for the swap — without this, unpinning
	 * would instantly re-preview. Cleared by a genuine mouse leave, so the
	 * next enter is a real hover and may peek a loaded aid.
	 */
	let aidNoPeek = new SvelteSet<string>();
	/**
	 * Local aids clicked at least once, per message and kind. The first
	 * hover of an aid button is color-only; only after that kind was
	 * clicked (pinned) may its hovers preview the readings — pinning
	 * furigana must never unlock pinyin's hover.
	 */
	let aidSeen = new SvelteSet<string>();
	/** Preview-unlock key for one message's local-aid kind. */
	function aidSeenKey(id: string, kind: LocalAid): string {
		return `${id}:${kind}`;
	}
	/** Unified notice queue: inline/banner/voice/toast replace the five one-off flags. */
	let notices = $state(emptyNotices());
	let speakingId: string | null = $state(null);
	/** Message a speak-aloud selection came from (tints its selection). */
	let speakingSelection: string | null = $state(null);
	/** Screen wake lock held while read-aloud/TTS plays (study sessions). */
	let studyWakeLock: WakeLockRelease | null = null;
	/** Release the read-aloud wake lock (stop, natural end, teardown). */
	function releaseStudyWake(): void {
		releaseStudyWakeLock(studyWakeLock);
		studyWakeLock = null;
	}
	let canMic = $state(false);
	let dictating = $state(false);
	/** Transient top toast (copy confirmations, readings, saved notes). */
	function flashToast(message: string): void {
		flashNotice(notices, "toast", message, TOAST_TIMEOUT_MS);
	}
	function dismissToast(): void {
		clearNotice(notices, "toast");
	}
	/** Transient top error toast: action failures (send errors, export,
	attach, mic) render in the red pairing, themed both ways. */
	function flashErrorToast(message: string): void {
		flashNotice(notices, "errorToast", message, ERROR_TOAST_TIMEOUT_MS);
	}
	function dismissErrorToast(): void {
		clearNotice(notices, "errorToast");
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	const activeReplyCode = $derived(
		chatState.chats.find((c) => c.id === chatState.activeChatId)?.replyLang ?? null
	);
	const activeReplyLang = $derived(
		activeReplyCode ? replyLanguageFor(activeReplyCode) : null
	);
	let settingsOpen = $state(false);
	/**
	 * Opening/closing settings shifts layout under a stationary cursor,
	 * leaving a stale pointer behind (browsers refresh the cursor on
	 * mousemove, not on our width transition). A one-frame
	 * pointer-events pulse forces a re-hit-test so the cursor matches
	 * whatever is actually underneath now.
	 */
	function pulseCursor(): void {
		const root = document.documentElement;
		root.style.pointerEvents = "none";
		let restored = false;
		const restore = (): void => {
			if (restored) return;
			restored = true;
			root.style.pointerEvents = "";
		};
		// rAF owns the restore (one painted frame); the timeout is a
		// backstop for surfaces that never produce one (headless test
		// shells), where a stuck none would eat every later click.
		requestAnimationFrame(() => restore());
		setTimeout(restore, 100);
	}
	let shortcutsOpen = $state(false);
	/** Filter text for the shortcuts modal (⌘F focuses it while open). */
	let shortcutQuery = $state("");
	let shortcutInputEl: HTMLInputElement | null = $state(null);

	/** Open the shortcuts modal with a fresh filter. */
	function openShortcuts(): void {
		shortcutQuery = "";
		shortcutsOpen = true;
	}
	/**
	 * Inspect overlay: the single Han character under review, or null
	 * when closed. Same modal-veil/modal pattern as the shortcuts
	 * overlay. Set from openInspect (selection menu), cleared by Esc,
	 * backdrop click, or the × button.
	 */
	let inspectChar = $state<string | null>(null);
	/**
	 * Reading locale for the Inspect overlay: kana present reads as
	 * Japanese, else Chinese — the same rule as `ttsLangFor`.
	 * Han-only text is genuinely ambiguous, so the overlay offers a
	 * small JP/中文 toggle that writes this state.
	 */
	let inspectLang = $state<HanOverlayLang>("zh");
	/** Current stroke step (1-based, manual only — never autoplay). */
	let inspectStroke = $state(1);
	const inspectData = $derived(inspectChar ? getInspectData(inspectChar) : null);
	/** KanjiVG stroke paths for the open character (null until loaded). */
	let inspectStrokes = $state<string[] | null>(null);
	$effect(() => {
		const ch = inspectChar;
		inspectStroke = 1;
		inspectStrokes = null;
		if (!ch) return;
		let live = true;
		void fetchStrokePaths(ch).then((paths) => {
			if (!live || inspectChar !== ch) return;
			if (paths && paths.length > 0) inspectStrokes = paths;
		});
		return () => {
			live = false;
		};
	});
	/** Step the stroke preview, clamped to 1..total (never wraps). */
	function stepInspect(delta: number): void {
		const total = inspectStrokes?.length ?? inspectData?.strokeCount ?? 1;
		const top = Math.max(total, 1);
		inspectStroke = Math.min(Math.max(inspectStroke + delta, 1), top);
	}
	/**
	 * Hold-to-repeat on the stepper arrows: a tap steps once via
	 * click, holding past the beat keeps stepping every tick (brisk:
	 * strokes are many, taps are for singles). The release click
	 * after a hold is swallowed so it never double-steps; a close
	 * mid-hold stops the chain.
	 */
	let strokeHoldTimer: ReturnType<typeof setTimeout> | null = null;
	let strokeHeld = false;
	const STROKE_HOLD_BEAT_MS = 280;
	const STROKE_HOLD_TICK_MS = 85;
	function startStrokeHold(delta: 1 | -1): void {
		strokeHeld = false;
		stopStrokeHold();
		const tick = (): void => {
			if (!inspectChar || !inspectStrokes?.length) {
				strokeHoldTimer = null;
				return;
			}
			strokeHeld = true;
			stepInspect(delta);
			strokeHoldTimer = setTimeout(tick, STROKE_HOLD_TICK_MS);
		};
		strokeHoldTimer = setTimeout(tick, STROKE_HOLD_BEAT_MS);
	}
	function stopStrokeHold(): void {
		if (strokeHoldTimer) {
			clearTimeout(strokeHoldTimer);
			strokeHoldTimer = null;
		}
	}
	function strokeStep(delta: 1 | -1): void {
		if (strokeHeld) {
			strokeHeld = false;
			return;
		}
		stepInspect(delta);
	}
	/** Open the Inspect overlay for the live selection (single Han char only). */
	function openInspect(): void {
		if (!selMenu) return;
		const quote = selMenu.quote.trim();
		if (!shouldShowInspect(quote, settings.inspectEnabled)) return;
		inspectChar = quote;
		inspectLang = inspectLangFor(quote, selMenu.context);
		clearSelection();
		selMenu = null;
	}
	/**
	 * Android (phone) UI: the shortcuts modal shows touch gestures
	 * instead of key chords, and edge swipes open the chats list
	 * (settings opens from the sidebar button or a two-finger swipe
	 * left). Set once on mount from the user agent — never reactive,
	 * never persisted.
	 */
	let androidUI = $state(false);
	/**
	 * iOS subset of the phone UI: Apple gives apps no way to add items
	 * to the system selection menu (Android's floating toolbar API has
	 * no iOS equivalent), so our Annotate button floats above the
	 * highlight while Apple's own bubble keeps its below slot.
	 */
	let iosUI = $state(false);

	/**
	 * Touch copy drops key-chord parentheticals: no Option key, no
	 * hover, no right-click on a phone (it backs out of the app).
	 */
	function tip(desktop: string, mobile: string): string {
		return androidUI ? mobile : desktop;
	}
	/**
	 * Modifier labels for the shortcuts modal and tooltips: macOS shows
	 * the ⌘/⌥/⇧ glyphs, Windows/Linux show Ctrl/Alt/Shift. The key
	 * handlers accept both metaKey and ctrlKey (altKey either way), so
	 * whichever label shows names a combo the handler takes. Mac-first
	 * default: set properly on mount from navigator (see below).
	 */
	let isMac = $state(true);
	const altm = $derived(altKeyLabel(isMac));
	/** Composer hints: touch wording on phones, shortcut wording elsewhere. */
	function promptPlaceholder(): string {
		return androidUI ? ANDROID_PROMPT_PLACEHOLDER : PROMPT_PLACEHOLDER;
	}
	function scrollPlaceholder(): string {
		return androidUI ? ANDROID_SCROLL_PLACEHOLDER : SCROLL_PLACEHOLDER;
	}
	let hasText = $state(false);
	let altHeld = $state(false);
	// Quiet to send: while a reply streams, the lib drops every send
	// and stage — but only after doSend/stage already emptied the
	// composer. Gating here keeps the button dead AND the draft intact,
	// so Enter during Thinking is a no-op instead of a lost message.
	// Per-chat lock: a reply streaming in another chat never deadens
	// this composer's send — only this chat's own stream gates it.
	const canSubmit = $derived(
		!isSending(chatState) && (hasText || attachments.length > 0 || annotations.length > 0)
	);

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		// One overlay at a time: the switcher yields to the list.
		if (!settings.sidebarCollapsed) chatSwitcherOpen = false;
		persistSettings();
		// Touch draws one sidebar at a time: an opening chats list
		// dismisses the settings panel (and vice versa below).
		if (!settings.sidebarCollapsed && androidUI && settingsOpen) settingsOpen = false;
	}

	/**
	 * Sidebar chat list filtered by the sidebar search box. Matches the
	 * chat label plus every message body (substring per token), so a
	 * swipe-opened list narrows as you type.
	 */
	function sideVisibleChats(): (typeof chatState.chats)[number][] {
		const query = sideSearch.trim();
		if (!query) return chatState.chats;
		return chatState.chats.filter((item) =>
			chatMatchesQuery(chatLabel(item.createdAt), item.messages.map((m) => m.content), query)
		);
	}

	/** Focus the sidebar search box (tap path: keyboard comes up). */
	function focusSideSearch(): void {
		sideSearchEl?.focus();
	}

	/**
	 * Full-text search palette (Ctrl+P / Cmd+P): ranks chats, messages,
	 * and annotation drafts through the index Worker (IndexedDB
	 * snapshot, in-memory fallback where either is unavailable).
	 */
	function ensureSearchStore(): ChatSearchStore {
		if (!searchStore) {
			let factory: (() => Worker) | undefined;
			try {
				factory = createSearchWorker;
				// Probe first: constructing here throws in runtimes
				// without Workers, and the store falls back silently.
				const probe = factory();
				probe.terminate();
			} catch {
				factory = undefined;
			}
			searchStore = new ChatSearchStore(factory);
			void searchStore.restore();
		}
		return searchStore;
	}

	function currentSearchDocs(): Parameters<typeof buildSearchDocs>[0] {
		return chatState.chats.map((c) => ({
			id: c.id,
			createdAt: c.createdAt,
			messages: c.messages.map((m) => ({ id: m.id, content: m.content }))
		}));
	}

	function scheduleSearchIndex(): void {
		if (searchIndexTimer) clearTimeout(searchIndexTimer);
		searchIndexTimer = setTimeout(() => {
			searchIndexTimer = null;
			try {
				const seen: string[] = [];
				const anns: Parameters<typeof buildSearchDocs>[1] = [];
				for (const chat of chatState.chats) {
					let drafts: Annotation[] = [];
					try {
						drafts =
							chat.id === chatState.activeChatId
								? annotations
								: loadDraftAnnotations(chat.id);
					} catch {
						drafts = [];
					}
					for (const ann of drafts) {
						const key = `${chat.id}:${ann.id}`;
						if (seen.includes(key)) continue;
						seen.push(key);
						anns.push({
							chatId: chat.id,
							messageId: ann.messageId,
							quote: ann.quote,
							comment: ann.comment
						});
					}
				}
				void ensureSearchStore()
				.index(buildSearchDocs(currentSearchDocs(), anns))
				.then(() => {
					// The palette may have queried before this snapshot
					// landed (fast typists beat the 500ms debounce): an
					// open query re-runs against the fresh snapshot.
					if (palette.open && palette.query.trim()) runSearchQuery();
				});
			} catch {
				// Search never breaks the chat: stale snapshot stays live.
			}
		}, 500);
	}

	function openSearch(): void {
		palette.open = true;
		palette.cursor = 0;
		scheduleSearchIndex();
		requestAnimationFrame(() => searchInputEl?.focus());
	}

	function closeSearch(): void {
		// Field-by-field on purpose: closing preserves the cursor
		// (reopen resets it), exactly like the scattered `$state` did.
		palette.open = false;
		palette.query = "";
		palette.hits = [];
		palette.busy = false;
		if (searchQueryTimer) {
			clearTimeout(searchQueryTimer);
			searchQueryTimer = null;
		}
		editor?.focus();
	}

	$effect(() => {
		// Desktop Cmd+scroll rides the app's text size in 0.1 steps
		// (the browser's own page zoom would blur the shell and fight
		// the layout; phones pinch instead, so this stays desktop).
		// Non-passive: swallowing the gesture must also swallow the
		// browser zoom it would otherwise trigger.
		const onZoomWheel = (event: WheelEvent): void => {
			if (androidUI || !event.metaKey) return;
			event.preventDefault();
			const delta = event.deltaY < 0 ? 0.1 : -0.1;
			const next = Math.min(
				FONT_SCALE_MAX,
				Math.max(FONT_SCALE_MIN, Math.round((settings.fontScale + delta) * 100) / 100)
			);
			if (next !== settings.fontScale) {
				settings.fontScale = next;
				persistSettings();
			}
		};
		window.addEventListener("wheel", onZoomWheel, { passive: false });
		return () => {
			window.removeEventListener("wheel", onZoomWheel);
		};
	});

	function runSearchQuery(): void {
		if (searchQueryTimer) clearTimeout(searchQueryTimer);
		const query = palette.query;
		if (!query.trim()) {
			palette.hits = [];
			palette.busy = false;
			return;
		}
		palette.busy = true;
		searchQueryTimer = setTimeout(() => {
			searchQueryTimer = null;
			void ensureSearchStore()
				.query(query, 30)
				.then((hits) => {
					palette.hits = hits;
					palette.cursor = 0;
					palette.busy = false;
				})
				.catch(() => {
					palette.hits = [];
					palette.busy = false;
				});
		}, 120);
	}

	/** Chat switching wrapped in a View Transition where supported
	 * (instant cut elsewhere) — identical end state either way. */
	function transitionToChat(id: Parameters<typeof selectChat>[1]): void {
		const from = chatState.activeChatId;
		selPinyin = null;
		const mutate = (): void => {
			// File the leaving chat's scroll first (a no-op mid-peek,
			// where the box shows another chat), then clear the hover
			// preview inside the transition, never before it: clearing
			// first renders the old chat for a frame (and the
			// view-transition snapshot catches it), so picking a
			// previewed row flashes back before landing.
			saveChatScroll();
			previewChatId = null;
			// Draft annotations belong to one chat: file the leaving
			// chat's away, then restore the entering chat's. Doing both
			// inside the transition keeps the autosave effect (which
			// also keys on activeChatId) from ever filing one chat's
			// drafts under another's id.
			saveDraftAnnotations(from, annotations, chatState.chats.map((c) => c.id));
			selectChat(chatState, id);
			annotations = loadDraftAnnotations(id);
			restoreChatScroll(id);
		};
		// Re-entering the live chat (preview-as-you-go already landed
		// here, or Enter on the active row): identical end state, so
		// skip the crossfade — it only flashes settled content.
		// Cycling inside the open phone switcher cuts the same way:
		// the crossfade paints above the dimming veil, so the new
		// text would flash bright before dimming back down.
		if (id === from || chatSwitcherOpen) {
			mutate();
			return;
		}
		// Leaving for another chat stops the voice: the readout
		// belongs to the old chat, and a new chat never inherits it.
		stopVoice();
		// The snapshot scope lives only around the transition (see
		// scopeMessagesTransition): a standing name would trap the
		// annotation badges under the header strip's hit-testing. The
		// release rides `ready`, not `finished` — the animation phase
		// can stall on slow frames while the trap stays live.
		const unscope = scopeMessagesTransition(scrollBox ?? null);
		void switchChatWithTransition(mutate, unscope);
	}

	// Every chat switch lands the box: chats with a filed scroll
	// position (see saveChatScroll) return where you left, and chats
	// with nothing filed start at the top like today. Streaming chats
	// always follow the reply bottom. Search-hit jumps register their
	// own scroll after this, so they still win. Runs inside the
	// switch mutation (flushed first): a frame callback lands too
	// late — the transition swaps content after it.
	function restoreChatScroll(id: ChatId): void {
		if (isSending(chatState, id)) return;
		const saved = chatScrollTops.get(id);
		flushSync();
		if (!scrollBox || chatState.activeChatId !== id) return;
		// Instant: the column eases programmatic jumps, and a smooth
		// restore retargets (or dies) across the switch transition.
		scrollBox.scrollTo({ top: saved ?? 0, behavior: "instant" });
	}

	/** Jump to a palette hit: its chat, scrolled to its message. */
	function enterSearchHit(hit: SearchHit): void {
		const chat = chatState.chats.find((c) => c.id === hit.doc.chatId);
		if (!chat) return;
		transitionToChat(chat.id);
		palette.open = false;
		palette.query = "";
		palette.hits = [];
		if (hit.doc.msgId) {
			const index = chat.messages.findIndex((m) => m.id === hit.doc.msgId);
			if (index >= 0) {
				// The jump lands silently: the message scrolls into view
				// and takes DOM focus (Tab still walks message order),
				// but nothing is selected — edit mode owns j/k from here
				// so they glide instead of walking from a cursor. (No
				// enterEditMode: focus stays on the message, not the
				// composer.)
				focusMode = "edit";
				selectedIdx = -1;
				requestAnimationFrame(() => {
					const el = document.getElementById(`msg-${index}`);
					el?.scrollIntoView({ block: "center", behavior: "smooth" });
					el?.focus({ preventScroll: true });
				});
				return;
			}
		}
		editor?.focus();
	}

	function moveSearchCursor(delta: 1 | -1): void {
		if (palette.hits.length === 0) return;
		palette.cursor =
			((palette.cursor + delta) % palette.hits.length + palette.hits.length) %
			palette.hits.length;
	}

	/**
	 * DOM focus follows the palette highlight: the highlighted option
	 * becomes the focused element, so Tab/Shift-Tab continue from the
	 * highlighted result and screen readers track the cursor.
	 */
	function focusSearchHit(cursor: number): void {
		searchResultsEl
			?.querySelectorAll<HTMLButtonElement>(".search-hit")
			[cursor]?.focus();
	}

	/**
	 * In-chat find (Cmd/Ctrl+F): message-level cycling browser-style.
	 * Matches come from findMessageIndices over the visible chat's
	 * plain text; each stop selects + centers its message. DOM focus
	 * stays in the find field while cycling (the scroll-mode arrow
	 * branch stands down inside .find-bar — see inFind below).
	 */
	let find = $state<FindState>(emptyFind());
	let findInputEl: HTMLInputElement | undefined = $state();
	function currentFindHits(): number[] {
		return find.open ? findMessageIndices(viewChat.messages.map((m) => m.content), find.query) : [];
	}
	function landFindHit(): void {
		const index = currentFindHits()[find.cursor];
		if (index === undefined) return;
		enterScrollMode();
		selectedIdx = index;
		requestAnimationFrame(() => {
			document
				.getElementById(`msg-${index}`)
				?.scrollIntoView({ block: "center", behavior: "smooth" });
		});
	}
	function stepFind(delta: 1 | -1): void {
		const hits = currentFindHits();
		if (hits.length === 0) return;
		find.cursor = stepFindCursor(hits.length, find.cursor, delta);
		landFindHit();
	}
	function openFind(): void {
		find.open = true;
		find.cursor = 0;
		requestAnimationFrame(() => {
			findInputEl?.focus();
			findInputEl?.select();
		});
	}
	function closeFind(): void {
		find = emptyFind();
		// The bar's cursor dies with it. landFindHit parked scroll mode
		// on a hit, but composer focus flips mode to edit on the way in
		// (see onFocusIn), so a stale selectedIdx would only strand the
		// next scroll entry on a ghost message. Clear it outright —
		// single hit or several, Enter, Esc, or repeat Cmd+F.
		focusMode = "edit";
		selectedIdx = -1;
		editor?.focus();
	}



	/**
	 * Export one sidebar chat as Markdown: File System Access picker
	 * where available, native save dialog in the shell, download blob
	 * fallback otherwise. A dismissed picker stays silent.
	 */
	async function exportOneChat(target: Chat): Promise<void> {
		// The Android shell webview sinkholes blob downloads, so its
		// fallback copies the markdown instead of dead-clicking an
		// anchor. Browsers keep the file download (verified on the
		// mobile emulation path).
		const shellPhone = androidUI && tauriBackendAvailable();
		try {
			const picker = fileSaveAccessAvailable()
				? (window.showSaveFilePicker?.bind(window) ?? null)
				: null;
			const how = await exportChatMarkdown(target, {
				picker,
				native: (filename, text) => nativeSaveMarkdown(filename, text),
				download: shellPhone ? (text) => copyExportText(text) : downloadMarkdownFile
			});
			flashToast(
				how === "download" ? (shellPhone ? "Chat copied to clipboard" : "Chat downloaded") : "Chat saved"
			);
		} catch (error) {
			// A clipboard denial on the shell phone arrives as
			// NotAllowedError: unlike a dismissed save picker, a dead
			// copy button must say so instead of staying silent.
			if (isPermissionDismissal(error)) {
				if (shellPhone)
					flashErrorToast("Couldn't copy this chat: clipboard unavailable on this device.");
				return;
			}
			flashErrorToast("Couldn't export this chat.");
		}
	}



	/**
	 * Open the settings panel, dismissing the chats list on touch.
	 * Swipe openers pass silent: the stroke itself is the feedback,
	 * so only button/menu/keyboard openings tick.
	 */
	function openSettingsPanel(silent = false): void {
		// Openings tick medium (first): distinct from the light ticks
		// of folds and steps and the triple thump of deletes.
		if (androidUI && !silent) {
			void hapticBeatAsync("first", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		// One overlay at a time: the switcher yields to settings.
		chatSwitcherOpen = false;
		settingsOpen = true;
		if (androidUI && !settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/** Toggle the settings panel with the same one-sidebar rule. */
	function toggleSettingsPanel(): void {
		if (settingsOpen) settingsOpen = false;
		else openSettingsPanel();
	}

	/**
	 * Whether the user picked their own idle timeout: captured once at
	 * startup, before the autosave effect can backfill defaults into
	 * storage (any settings change persists the whole object, so a
	 * later read cannot tell default from deliberate). Phones default
	 * to never hiding until the user chooses a timeout.
	 * (Mirrors the private storage key in settings.ts.)
	 */
	const idleTimeoutCustomized: boolean = (() => {
		try {
			const raw =
				window.localStorage.getItem("ccez-llm-settings-v1") ??
				window.localStorage.getItem("ccez-studio-settings-v1");
			if (!raw) return false;
			return typeof (JSON.parse(raw) as { promptIdleSec?: unknown }).promptIdleSec === "number";
		} catch {
			return false;
		}
	})();
	/**
	 * Idle-hide for the main prompt: any mouse, keyboard, touch, or
	 * wheel input stamps lastInputAt (delaying the hide); a 500ms
	 * ticker hides it (a short settle-down plus fade) once the
	 * effective timeout elapses with no input. The prompt is a
	 * floating card over a full-bleed column, so hiding and restoring
	 * move no messages and clip no text.
	 * Restoring is keys-only on desktop: only the i / Enter / Space
	 * keys (see promptIdleKeyAction, wired at the top of onKey) bring the
	 * prompt back — clicks never summon it, so selecting,
	 * double-clicking, and dismissing highlights leave it hidden.
	 * Phones keep tap-to-summon (no keyboard for i). Pointer travel,
	 * wheel, control clicks, and other keys merely re-arm the timer.
	 * The timeout and mobile reads subscribe the effect, so a
	 * settings change or the phone detection landing re-arms the
	 * ticker. An empty chat never hides; every other thread obeys
	 * the timeout however short (summoning stays one keypress away).
	 */
	let lastInputAt = $state(Date.now());
	/**
	 * Boot parks hidden under always-hide when the synchronously loaded
	 * chat already has messages: starting visible would flash the
	 * composer for a frame before the late-seed effect hides it
	 * (async loads keep today's hide-on-arrival).
	 */
	let bootParked =
		settings.promptIdleSec === PROMPT_IDLE_ALWAYS &&
		(activeChat(chatState)?.messages.length ?? 0) > 0;
	let promptIdle = $state(bootParked);
	/** Any activity delays the hide; restoring is allowlisted below. */
	function stampInput(): void {
		lastInputAt = Date.now();
	}
	/** Allowlisted restore: show the hidden prompt again. */
	function restorePrompt(): void {
		focusLog("restore-prompt", { active: describeActiveElement(), wasIdle: promptIdle });
		stampInput();
		promptIdle = false;
	}
	/**
	 * Parked composer: idle-hidden OR a sidebar owns the stage (chats
	 * list or settings). Parking is visual only — promptIdle keeps its
	 * own state, so closing the sidebar returns exactly the prior
	 * idle state instead of summoning a hidden prompt.
	 */
	function promptParked(): boolean {
		// Phones never park for drawers: the chats list and settings
		// are overlays above the composer (z 55+ over 30), so hiding
		// it under them only slid the thread and flickered the card.
		// Only a real idle timeout parks. Desktop keeps drawer parking.
		if (androidUI) return promptIdle;
		return promptIdle || settingsOpen || !settings.sidebarCollapsed;
	}
	/**
	 * Always-hide park: hide unless focus is (or is heading) inside
	 * the composer, with the same empty-chat guard as the timed path.
	 * Takes the focus destination explicitly because during focusout
	 * the active element is already gone (relatedTarget reads where
	 * focus is heading; null when it leaves the window).
	 */
	function hideForAlways(next: EventTarget | null): void {
		if (
			!shouldHideForAlways({
				alwaysMode: settings.promptIdleSec === PROMPT_IDLE_ALWAYS,
				inPrompt: isPromptTarget(next),
				emptyChat: viewChat.messages.length === 0
			})
		)
			return;
		promptIdle = true;
		focusLog("hide-for-always", {
			next: describeFocusTarget(next),
			active: describeActiveElement()
		});
	}
	/**
	 * Idle-prompt key decisions live in `promptIdleKeyAction`
	 * (`src/lib/keybindings.ts`): bare i / Enter / Space restore the
	 * hidden prompt, blind keystrokes into the hidden composer die
	 * silently (typing blind would strand text in an invisible box
	 * and drop focus when the hidden subtree restyles). Anything with
	 * a modifier (copy/paste/undo chords), IME, and control keys
	 * (Tab, arrows, Escape) keeps its behavior; other keys merely
	 * re-arm the hide timer via the stamp listener.
	 */
	$effect(() => {
		const setting = settings.promptIdleSec;
		// Phones never idle-hide (see the mount migration above): the
		// prompt is a permanent fixture, like other chat apps.
		const idleSec = !androidUI ? setting : 0;
		const on = (): void => stampInput();
		// A pointer press is a distinct gesture from the filing Enter,
		// so it ends the anti-double-send window (see sendGuardUntil).
		const onDown = (): void => {
			sendGuardUntil = 0;
		};
		// Press point for the drag-vs-click read in onIdleClick: a
		// press that traveled is a selection drag, never a restore.
		// idleDownControl remembers a press that STARTED on a control:
		// a mid-press re-render (toast, Shiki) can swap the node under
		// the cursor, retargeting the click to an ancestor — the press
		// is still a control press, never a restore.
		let idleDown: { x: number; y: number } | null = null;
		let idleDownControl = false;
		// Whether the prompt was visible when the press started: a press
		// that begins visible is the dismissing gesture (its blur hides),
		// so its click must not restore — only a press that starts
		// hidden summons.
		let idleDownVisible = false;
		let idleDownHadSel = false;
		const onIdleDown = (event: PointerEvent): void => {
			const downTarget = event.target instanceof Element ? event.target : null;
			if (event.button === 0) {
				// Stamp composer presses for onFocusOutIdle's WebKit
				// guard (see promptPressAt): a press inside the composer
				// whose focusout lands nowhere is still in flight.
				if (downTarget?.closest(".prompt")) promptPressAt = Date.now();
			}
			idleDown = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
			// Summonable only from a fully shown prompt: a press that
			// starts idle-hidden OR sidebar-parked (e.g. the click that
			// dismisses a sidebar) never restores on its click.
			idleDownVisible = event.button === 0 && !promptParked();
			// A press that starts on a live highlight is its dismissal —
			// the click that clears it must not summon the prompt.
			idleDownHadSel = event.button === 0 && (window.getSelection()?.toString() ?? "") !== "";
			idleDownControl = event.button === 0 && isClickControlTarget(downTarget);
		};
		/**
		 * Desktop clicks never restore the hidden prompt — summoning
		 * is keys-only (bare i / Enter / Space) — so selecting,
		 * double-clicking, and dismissing text never flash it. iOS
		 * keeps tap-to-summon (no keyboard to press i on, no swipe
		 * gestures there); Android summons with swipe-up instead, so
		 * taps keep native behavior and buttons never fire behind a
		 * summoned prompt. The visible floor tap stays for all: with
		 * the prompt already up, tapping its floor lands the caret.
		 */
		const onIdleClick = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			if (!promptIdle) {
				// Visible already: a tap on the prompt floor itself still
				// lands the caret (an unfocused-but-visible composer is
				// routine in always-hide mode). Controls keep their guard
				// inside focusPromptFloor; everywhere else ignores clicks.
				if (target?.closest(".prompt")) focusPromptFloor(event);
				return;
			}
			// Hidden on desktop: no click summons, full stop. Hidden on
			// Android: swipe up summons, taps stay native.
			if (!androidUI || !iosUI) return;
			if (event.button !== 0) return;
			const down = idleDown;
			const downControl = idleDownControl;
			const downVisible = idleDownVisible;
			const downHadSel = idleDownHadSel;
			idleDown = null;
			idleDownControl = false;
			idleDownVisible = false;
			idleDownHadSel = false;
			// Press-guard order lives in idleTapAction: a press that
			// traveled is a selection drag; a press that started on a
			// control, a live highlight, or while visible is their
			// dismissal, never a summon.
			const tap = idleTapAction({
				downControl,
				downVisible,
				downHadSel,
				traveled:
					down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6,
				inMath: isMathTarget(target),
				inClickControl: isClickControlTarget(target),
				inOverlay: isTapOverlayTarget(target)
			});
			if (tap === null) return;
			restorePrompt();
			// Controls act where they land, never summon (see the
			// press guard above); an overlay owns focus, so a summon
			// behind one restores without landing.
			if (tap === "summon-quiet") return;
			// Same deferred landing as the key path: the composer is
			// only focusable once the visibility flip flushes.
			const floorEvent = event;
			void tick().then(() => focusPromptFloor(floorEvent));
		};
		/**
		 * Always-hide mode (slider bottom tick): the prompt is visible
		 * exactly while the composer holds focus. Focus landing in the
		 * composer restores; focus leaving it hides (see hideForAlways
		 * at component scope).
		 */
		const onFocusInIdle = (event: FocusEvent): void => {
			if (settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) return;
			if (!closestFromTarget(event.target, ".prompt .cm-content, .prompt .ta-input")) return;
			focusLog("focusin-idle", {
				target: describeFocusTarget(event.target),
				active: describeActiveElement()
			});
			restorePrompt();
		};
		const onFocusOutIdle = (event: FocusEvent): void => {
			// A press that started inside the composer is still in
			// flight when its focusout lands with nowhere to go
			// (null/body): WebKit never focuses the button being
			// pressed, so this fires where Chromium reports the button
			// itself. Parking here would hide the composer and eat the
			// press's click behind pointer-events:none — the button
			// (or pill review toggle) never runs. Skip the hide; the
			// idle ticker re-parks a genuinely unfocused composer
			// within half a second, so an over-skip self-heals.
			const next: EventTarget | null = event.relatedTarget ?? null;
			focusLog("focusout-idle", {
				target: describeFocusTarget(event.target),
				next: describeFocusTarget(next),
				active: describeActiveElement(),
				promptIdle,
				pressAgeMs: Date.now() - promptPressAt
			});
			if (
				(next === null || next === document.body) &&
				Date.now() - promptPressAt < 1500
			) {
				return;
			}
			hideForAlways(next);
		};
		window.addEventListener("pointermove", on, { passive: true });
		window.addEventListener("focusin", onFocusInIdle);
		window.addEventListener("focusout", onFocusOutIdle);
		window.addEventListener("pointerdown", on, { passive: true });
		window.addEventListener("pointerdown", onIdleDown, { passive: true });
		window.addEventListener("pointerdown", onDown);
		// Find-bar outside dismiss: any press outside the bar closes it.
		// Prompt-summon safety is structural on desktop (clicks never
		// summon — keys-only restore); the phone tap path keeps its
		// own press guards below.
		const onFindOutside = (event: PointerEvent): void => {
			if (!find.open) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".find-bar")) return;
			find.open = false;
		};
		window.addEventListener("pointerdown", onFindOutside, { passive: true });
		// Filed-annotations card dismiss: a press outside the card's
		// own wrap closes it (capture, so the press never also acts
		// behind the card). Presses on the pill or inside the card
		// are the toggle and its buttons — never a dismissal.
		const onRefsOutside = (event: PointerEvent): void => {
			if (!refsPopOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".ann-refs")) return;
			refsPopOpen = null;
		};
		window.addEventListener("pointerdown", onRefsOutside, { capture: true });
		// History tag popup dismiss: a press outside any tag wrap
		// closes every open popup (capture, so the press never also
		// acts behind the popup). Presses on a tag or inside its
		// popup are the toggle and its buttons — never a dismissal.
		const onSentTagOutside = (event: PointerEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".sent-wrap")) return;
			if (expandedTags.length > 0) expandedTags = [];
		};
		window.addEventListener("pointerdown", onSentTagOutside, { capture: true });
		window.addEventListener("keydown", on);
		window.addEventListener("wheel", on, { passive: true });
		window.addEventListener("touchstart", on, { passive: true });
		window.addEventListener("click", onIdleClick);
		window.addEventListener("offline", handleOffline);
		window.addEventListener("online", handleOnline);
		// Boot already offline (plane, dead wifi): park on Gemma now
		// instead of showing a dead cloud provider.
		if (typeof navigator !== "undefined" && !navigator.onLine) handleOffline();
		const timer = window.setInterval(() => {
			if (!isPromptIdle(lastInputAt, Date.now(), idleSec)) return;
			if (
				!shouldIdleHide({
					emptyChat: viewChat.messages.length === 0,
					alreadyIdle: promptIdle
				})
			)
				return;
			promptIdle = true;
		}, 500);
		return () => {
			window.removeEventListener("pointermove", on);
			window.removeEventListener("focusin", onFocusInIdle);
			window.removeEventListener("focusout", onFocusOutIdle);
			window.removeEventListener("pointerdown", on);
			window.removeEventListener("pointerdown", onIdleDown);
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointerdown", onFindOutside);
			window.removeEventListener("pointerdown", onRefsOutside, { capture: true });
			window.removeEventListener("pointerdown", onSentTagOutside, { capture: true });
			window.removeEventListener("keydown", on);
			window.removeEventListener("wheel", on);
			window.removeEventListener("touchstart", on);
			window.removeEventListener("click", onIdleClick);
			window.removeEventListener("offline", handleOffline);
			window.removeEventListener("online", handleOnline);
			window.clearInterval(timer);
		};
	});
	/**
	 * Late seeds re-evaluate the always-hide park: the mount pass can
	 * run before the chat loads (an empty guard skips the hide), so
	 * message arrival parks an unfocused composer instead of leaving
	 * it stranded visible. The mirror case: arriving at an empty
	 * chat with the flag set (parked on a previous thread) clears it,
	 * or the composer stays stranded hidden where it must compose.
	 */
	$effect(() => {
		void viewChat.messages.length;
		if (!previewing && viewChat.messages.length === 0) {
			promptIdle = false;
			return;
		}
		hideForAlways(document.activeElement);
	});
	/**
	 * Tail clearance for the floating composer: in-scroller padding
	 * keeps the last line above the card in every scroll position (a
	 * static guess can't track a growing draft, scroll-padding only
	 * steers programmatic scrolls), while the thread runs full-height
	 * behind the frosted card so mid-thread text bleeds through.
	 * Main-level padding covers only the in-flow attachment strip,
	 * preview, and error, which live outside the scroller. The extra
	 * 54px also clears short last messages' badges, which float
	 * above their quote and would otherwise park under the card,
	 * unclickable. The reserve NEVER collapses while parked:
	 * collapsing reclaimed the room but the summon then covered the
	 * tail (or yanked it upward on re-stick) — both read as the
	 * composer hiding text. Composes with the Android safe-area
	 * inset instead of clobbering it.
	 */
	// Last applied tail clearance in px (-1 until the first sync, and
	// component-scoped so effect re-runs never reset the edge: only
	// genuine GROWTH (a lengthening draft) re-sticks, so boot, park,
	// summon, and scroll restores keep whatever position they landed.
	let lastClearPx = -1;
	// Last written reserve values: the observer watches the card and
	// the box it writes to, so an unconditional write on every fire
	// feeds its own notifications (the "ResizeObserver loop" console
	// error). Identical values write nothing — the loop starves.
	let lastBoxPad = "";
	let lastMainPad = "";
	let lastSbw = "";
	let lastTrayBottom = "";
	$effect(() => {
		// Tracked so attaching/removing re-runs the reserve past the
		// ResizeObserver (the tray is absolute now: it resizes nothing,
		// so no notification would ever fire for it).
		void attachments.length;
		void notices.inline.message;
		const card = promptEl?.closest<HTMLElement>(".prompt") ?? null;
		const box = scrollBox;
		const mainEl = box?.closest<HTMLElement>("main") ?? null;
		if (!card || !box || !mainEl) return;
		const sync = (): void => {
			const cardH = Math.ceil(card.getBoundingClientRect().height);
			const cardBottom = Number.parseFloat(window.getComputedStyle(card).bottom) || 0;
			const clearPx = cardH + 54;
			// The tray floats over the thread (absolute, transparent),
			// so the thread runs full-height behind and beside it: the
			// tail clearance covers the tray too, and the tray docks a
			// fixed margin above the card (tracking draft growth via
			// the measured height) instead of riding the reserve high.
			const tray = mainEl.querySelector<HTMLElement>(":scope > .attachments");
			const trayH = tray ? Math.ceil(tray.getBoundingClientRect().height) : 0;
			const trayGap = trayH > 0 ? 8 : 0;
			// Thread clearance lives INSIDE the scroller: the thread
			// runs full-height behind the solid card, and the tail
			// still lands above it at the bottom. Empty chats keep
			// none: no tail to protect, hero owns the space.
			const emptyChat = viewChat.messages.length === 0;
			const boxPad = emptyChat ? "0px" : `${clearPx + trayH + trayGap}px`;
			if (boxPad !== lastBoxPad) {
				box.style.paddingBottom = boxPad;
				lastBoxPad = boxPad;
			}
			if (tray && trayH > 0) {
				const trayBottom = `${cardBottom + cardH + trayGap}px`;
				if (trayBottom !== lastTrayBottom) {
					tray.style.bottom = trayBottom;
					lastTrayBottom = trayBottom;
				}
			} else {
				// The tray remounts fresh on every attach cycle with no
				// inline bottom (the CSS carries none): forget the last
				// write while it is gone, or a remount at the same
				// composer height reads as "unchanged" and the tray
				// parks at the top.
				lastTrayBottom = "";
			}
			// The error stays in main flow after the scroller:
			// main-level padding lifts it above the card while
			// rendered (the absolute tray needs no lift).
			// Binary, so park/summon (transform-only, layout kept)
			// never move anything. Empty chats keep today's floor.
			const chromeOpen = mainEl.querySelector(":scope > .attach-error") !== null;
			const mainPad =
				emptyChat || chromeOpen
					? `calc(${clearPx}px + env(safe-area-inset-bottom, 0px))`
					: `env(safe-area-inset-bottom, 0px)`;
			if (mainPad !== lastMainPad) {
				mainEl.style.paddingBottom = mainPad;
				lastMainPad = mainPad;
			}
			// Scrollbar gutter the messages reserve (classic thin bar,
			// zero with overlay scrollbars): the floating card centers in
			// the full column, so it rides this much right of the
			// articles without compensation (see --sbw on .prompt).
			const sbw = `${Math.max(0, box.offsetWidth - box.clientWidth)}px`;
			if (sbw !== lastSbw) {
				card.style.setProperty("--sbw", sbw);
				lastSbw = sbw;
			}
			// A lengthening draft grows the reserve under the card:
			// when stuck to the bottom, re-stick past it or the tail
			// slides under the solid card as you type. Park, summon,
			// and restores never change the reserve, so they never
			// move the thread; mid-thread readers and touch holds
			// never move either; phones keep their bottom-anchored card.
			if (
				!androidUI &&
				lastClearPx >= 0 &&
				clearPx > lastClearPx &&
				viewport.stick &&
				!viewport.holding
			) {
				box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
			}
			lastClearPx = clearPx;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(card);
		ro.observe(box);
		return () => ro.disconnect();
	});
	/**
	 * Parking drops the caret: a sidebar opening with focus still
	 * in the composer would type behind the panel. Focus already in
	 * the sidebar (or anywhere outside the prompt) stays put, and
	 * closing returns the prior idle state untouched.
	 */
	$effect(() => {
		// Phones keep the composer mounted under open drawers, but an
		// open drawer still drops the caret (typing behind the panel,
		// keyboard over the drawer). Desktop blurs via promptParked.
		const drawerOpen = androidUI && (settingsOpen || !settings.sidebarCollapsed);
		if (!promptParked() && !drawerOpen) return;
		const active = document.activeElement;
		if (active instanceof HTMLElement && active.closest(".prompt")) editor?.blur();
	});
	/**
	 * Sleep prevention during speech/streaming (desktop shell only):
	 * one backend claim stays live while a voice reads
	 * (`speakingId`) or a reply streams (`chatState.sending`). The
	 * bridge refcounts, so overlap never unblocks early; a stale
	 * resolve after stop releases instead of holding. Outside the
	 * shell the call resolves null — never a toast, never a throw.
	 */
	let sleepClaim: number | null = null;
	let sleepWanted = false;
	$effect(() => {
		const active = speakingId !== null || chatState.sending;
		if (active) {
			sleepWanted = true;
			void desktopSleepBlock("Ccez Studio speech or reply streaming").then((id) => {
				if (id === null) return;
				if (sleepWanted) sleepClaim = id;
				else void desktopSleepUnblock(id);
			});
		} else {
			sleepWanted = false;
			if (sleepClaim !== null) {
				const id = sleepClaim;
				sleepClaim = null;
				void desktopSleepUnblock(id);
			}
		}
	});
	/** UI text scale in 10% steps (50–600% desktop, 50–800% phones). */
	function adjustFontScale(delta: number, quiet = false): void {
		const cap = androidUI ? 8 : 6;
		const next = Math.min(cap, Math.max(0.5, Math.round((settings.fontScale + delta) * 10) / 10));
		if (next === settings.fontScale) return;
		settings.fontScale = next;
		persistSettings();
		// Pinch zoom toasts once on release (see the touchend below),
		// not per step — a held pinch would strobe the toast.
		if (!quiet) flashToast(`Text size ${Math.round(next * 100)}%`);
	}
	/** Chat-column width in 2rem steps (desktop only — phones fix it
	at 46rem). Shift siblings of the text-size chords, above. */
	function adjustChatWidth(delta: number): void {
		if (androidUI) return;
		const current = settings.chatWidth ?? CHAT_WIDTH_DEFAULT;
		const next = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, current + delta));
		if (next === current) {
			flashToast(`Chat width ${current} rem (limit)`);
			return;
		}
		settings.chatWidth = next;
		persistSettings();
		flashToast(`Chat width ${next} rem`);
	}

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	function noteMainDown(event: PointerEvent): void {
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/**
	 * Clicking into the main chat closes the sidebars: the settings
	 * panel and the chats list both collapse, so the click lands on a
	 * full-width conversation. Controls tagged data-settings-toggle
	 * manage the panel themselves and are skipped; drags (text
	 * selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		if (!settingsOpen && settings.sidebarCollapsed) return;
		const down = mainDown;
		mainDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		if (settingsOpen) {
			if (event.target instanceof Element && event.target.closest("[data-settings-toggle]")) {
				return;
			}
			settingsOpen = false;
		}
		if (!settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
		// The dismissing click means "back to the chat": when the prompt
		// is already shown, land the caret in it — a visible-but-unfocused
		// composer strands keyboard users (Space/i/Enter restore a hidden
		// one, but nothing re-focuses a shown one). Focus only, never a
		// mode flip: scroll mode survives the round trip. Controls keep
		// their own clicks (same guard as the idle press path), drags
		// were filtered above, and a hidden prompt stays keys-only. The
		// unpark flushes async, so land after the tick — a sync focus
		// would hit the still-parked composer and no-op.
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest("button, a, input, textarea, select, summary, [contenteditable], .ccez-code"))
			return;
		if (promptIdle) return;
		// Phones never land the caret on dismiss: the tap means "back
		// to the chat", and focusing pops the keyboard over it. Desktop
		// keeps the caret landing for keyboard users.
		if (!androidUI) void tick().then(() => editor?.focus());
	}

	/**
	 * Resolved color scheme on <html>: "system" mirrors the OS live
	 * (the listener re-runs the effect's cleanup on mode change, so
	 * only system subscribes), pins hold regardless. The dark CSS
	 * gates on this attribute — never on media queries — so one rule
	 * set serves all three modes.
	 */
	$effect(() => {
		const mode = settings.theme;
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (): void => {
			document.documentElement.dataset.theme = resolveTheme(mode, query.matches);
		};
		apply();
		if (mode === "system") query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	});

	/**
	 * Hide-messages mode (touch): every body stays hidden until its
	 * message is tapped — the open one shows text and buttons, then
	 * closes itself after 3s. Tapping controls never toggles.
	 */
	let shownActionsId: ChatMsgId | null = $state(null);
	/** Phone only: the second tap of a message double-tap pins the just
	revealed row open — without this its click would toggle it shut
	while scrolling to the message end. Stamped in the touchend below,
	consumed by the click's toggle path. */
	let msgDoubleTapPin: { id: ChatMsgId; at: number } | null = null;
	/**
	 * Chat switcher overlay (phones): a two-finger hold on the main
	 * chat opens it; swipes inside cycle chats, tapping away closes.
	 */
	let chatSwitcherOpen = $state(false);
	/** Last open stamp: the opening tap's own compat click lands on
	the veil right after touchend and must not close it straight back. */
	let switcherOpenedAt = 0;
	function openChatSwitcher(): void {
		chatSwitcherOpen = true;
		switcherOpenedAt = Date.now();
		void hapticBeatAsync("first", {
			enabled: settings.vibration,
			shell: tauriBackendAvailable()
		});
	}
	function closeChatSwitcher(): void {
		if (!chatSwitcherOpen) return;
		chatSwitcherOpen = false;
		void hapticBeatAsync("send", {
			enabled: settings.vibration,
			shell: tauriBackendAvailable()
		});
	}
	/**
	 * Cycle from inside the switcher (stays open across steps) with
	 * wrap-around: past either end loops to the far chat instead of
	 * minting or sticking. A lone chat falls through to the plain
	 * step (past-newest still mints).
	 */
	function stepSwitcher(direction: 1 | -1): void {
		const ids = chatState.chats.map((c) => c.id);
		const at = ids.indexOf(chatState.activeChatId);
		const wrapped = at >= 0 && ids.length > 0 ? (ids[(at + direction + ids.length) % ids.length] ?? null) : null;
		if (wrapped !== null && wrapped !== chatState.activeChatId) transitionToChat(wrapped);
		else stepChat(direction, false);
		void hapticBeatAsync("send", {
			enabled: settings.vibration,
			shell: tauriBackendAvailable()
		});
	}
	let shownActionsTimer: ReturnType<typeof setTimeout> | null = null;
	/** (Re)arm the 3s auto-dismiss for one reveal. */
	function armActionsTimer(id: ChatMsgId): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = setTimeout(() => {
			if (shownActionsId !== id) {
				shownActionsTimer = null;
				return;
			}
			// A loading aid (tashkeel run, furigana conversion) or
			// running audio owns the row like a held press: closing
			// now would strand the spinner with no buttons, or the
			// stop button out of reach mid-utterance. Re-arm and let
			// a later tick close it after the work lands.
			if (aidBusy.has(id) || vocalizing.has(id) || speakingId === id || speakingSelection === id) {
				armActionsTimer(id);
				return;
			}
			shownActionsId = null;
			shownActionsTimer = null;
		}, 3000);
	}
	/** A press inside an open row owns it: tap-and-hold must not watch
	its button vanish on the usual timer. Release re-arms it. */
	function holdActionsOpen(): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
	}
	function releaseActionsHold(): void {
		if (shownActionsId === null) return;
		armActionsTimer(shownActionsId);
	}
	function toggleMessageActions(id: ChatMsgId, event: MouseEvent): void {
		if (!settings.showMessageButtons) return;
		if (!settings.hideMessages && !(androidUI && settings.hideButtons)) return;
		if (closestFromTarget(event.target, "button, a, input, textarea, select, summary")) return;
		// Tapping a folded message unfolds it: its row is hidden, so no
		// fold button exists to press. Android only — desktop hovers the
		// row back into view.
		if (androidUI && foldedIds.has(id)) {
			shownActionsId = null;
			toggleFold(id);
			return;
		}
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
		if (shownActionsId === id) {
			// The second tap of a message double-tap scrolls to the
			// message end instead of toggling shut (see the touchend
			// below): re-arm, never close. Desktop has no pin, so
			// its toggle rhythm is untouched.
			if (msgDoubleTapPin?.id === id && Date.now() - msgDoubleTapPin.at < 500) {
				armActionsTimer(id);
				return;
			}
			shownActionsId = null;
			return;
		}
		shownActionsId = id;
		// No haptic on a single reveal tap: a reveal is a quiet UI
		// affordance, not a sent action. Double-tap keeps its own
		// beat (the message-end jump); the send paths keep theirs.
		// The tap can land mid-frame with keyboard or viewport churn:
		// settle a re-measure after paint (same settle the send paths
		// use) so the composer can't strand at zero height, and the
		// extra paint invalidates a stale tile the fade left behind
		// on phone GPUs.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
		armActionsTimer(id);
	}
	/** Focus a sidebar chat button by list position (clamped). */
	function focusSideChat(index: number): void {
		const items = [...document.querySelectorAll<HTMLElement>("aside ul li button.side-chat")];
		if (items.length === 0) return;
		sideIdx = Math.min(Math.max(index, 0), items.length - 1);
		const el = items[sideIdx];
		if (!el) return;
		el.focus();
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	/**
	 * Opening lands keyboard users on the current chat (renders async),
	 * so j/k starts there instead of the top. Falls back to the top
	 * row when a search filter hides the active chat.
	 */
	function focusActiveSideChat(): void {
		const at = sideVisibleChats().findIndex((c) => c.id === chatState.activeChatId);
		requestAnimationFrame(() => focusSideChat(at < 0 ? 0 : at));
	}

	/**
	 * Step through chats with the sidebar closed: +1 goes down (newer,
	 * toward the bottom of the stack), -1 goes up (older). Past the
	 * newest end, a chat with messages mints one fresh chat below it —
	 * never a second while it is still empty, so repeats can't pile up
	 * blanks.
	 */
	function stepChat(direction: 1 | -1, focus = true): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.max(
			chats.findIndex((c) => c.id === chatState.activeChatId),
			0
		);
		const next = at + direction;
		if (next < 0) return;
		// Touch steps never take focus: landing in the prompt would pop
		// the keyboard on every swipe. Keyboard steps keep the old path.
		if (next >= chats.length) {
			if (chats[at]?.messages.length === 0) {
				if (focus) enterEditMode();
				return;
			}
			// File the leaving chat's drafts away first: resetDraftExtras
			// empties `annotations`, and the autosave effect would then
			// persist the empty list under the old id (draft restore
			// on return would come back blank).
			saveDraftAnnotations(chatState.activeChatId, annotations, chats.map((c) => c.id));
			resetDraftExtras();
			// Minting switches without a transition, so the preview
			// clears here (transitionToChat covers its own path).
			// File first: returning to the abandoned chat later must
			// still land where it was left.
			saveChatScroll();
			previewChatId = null;
			newChat(chatState);
			scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
			// Minting brings you home (see doNewChat): an open
			// sidebar would park the prompt we are landing in.
			settings.sidebarCollapsed = true;
			persistSettings();
			if (focus) enterEditMode();
			void hapticBeatAsync("send", { enabled: settings.vibration, shell: tauriBackendAvailable() });
			restartStepSlide(direction);
			return;
		}
		const target = chats[next];
		if (!target) return;
		sideIdx = next;
		void hapticBeatAsync("send", { enabled: settings.vibration, shell: tauriBackendAvailable() });
		transitionToChat(target.id);
		// Landing is the switch effect's job (filed position, else
		// top): a smooth top-scroll here would fight the restore.
		if (focus) enterEditMode();
		restartStepSlide(direction);
	}

	/**
	 * Chat-step slide (touch swipes): the incoming chat glides in from
	 * the swipe side instead of jumping. Null-then-frame restarts the
	 * keyframes even for same-direction repeats; the animationend
	 * handler clears the class. Phone-only via the classes below —
	 * desktop steps instant.
	 */
	let chatStepDir: 1 | -1 | null = $state(null);
	function restartStepSlide(direction: 1 | -1): void {
		chatStepDir = null;
		requestAnimationFrame(() => {
			chatStepDir = direction;
		});
	}

	/** Enter the cursor chat from the keyboard, close the list, and land in its prompt. */
	function enterSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const item = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
		if (!item) return;
		sideIdx = chats.indexOf(item);
		transitionToChat(item.id);
		settings.sidebarCollapsed = true;
		persistSettings();
		enterEditMode();
	}

	/**
	 * Delete key on a focused sidebar chat: drop it and land on the chat
	 * below (deleteChat slides there, or mints a blank when the list
	 * empties). The list re-renders async, so clamp the cursor now and
	 * focus the laid-out row on the next frame.
	 */
	function deleteSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.min(Math.max(sideIdx, 0), chats.length - 1);
		const item = chats[at];
		if (!item) return;
		dropChat(item.id);
		sideIdx = Math.min(Math.max(at, 0), chatState.chats.length - 1);
		requestAnimationFrame(() => focusSideChat(sideIdx));
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editingAttachments = [];
		editor?.setPlaceholder(promptPlaceholder());
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
		attachments = [];
		// Pills are gone: their tags go too, or a stale marker would
		// reconcile away the next chat's first image.
		markerSyncMuted = true;
		try {
			if (
				editor &&
				(countMarkers(editor.getText()) > 0 || countMarkers(editor.getText(), FILE_MARKER) > 0)
			) {
				editor.setText(stripAttachmentMarkers(editor.getText()));
			}
			prevMarkerCount = 0;
			prevFileMarkerCount = 0;
		} finally {
			markerSyncMuted = false;
		}
		selMenu = null;
	}

	function doNewChat(): void {
		// A fresh chat opens medium (first), like settings.
		if (androidUI) {
			void hapticBeatAsync("first", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		// File the abandoned chat's scroll before the fresh chat
		// resets the box: returning later lands where it was left.
		saveChatScroll();
		previewChatId = null;
		stopVoice();
		selPinyin = null;
		// File the leaving chat's drafts away before resetDraftExtras
		// empties them — otherwise the autosave effect files the empty
		// list under the old chat's id and return-restore comes back
		// blank (same ordering as transitionToChat's save-before-load).
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
		resetDraftExtras();
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		// A minted chat always shows its composer: focusing a hidden
		// bar focuses nothing (and the hidden restyle drops focus). An
		// open sidebar parks the prompt, so minting also brings you
		// home: the list closes like a row-pick.
		// Phones stay unfocused: auto-focus pops the keyboard over the
		// composer instead of pushing it up. Tap in when ready.
		settings.sidebarCollapsed = true;
		persistSettings();
		if (!androidUI) enterEditMode();
		else restorePrompt();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	/**
	 * Hover preview: the sidebar row under the cursor shows its chat in
	 * the main column until the hover leaves. The composer, annotations,
	 * and active chat never switch — the preview is read-only (its
	 * action row and selection menu stay off) so every hovered index
	 * still addresses the real chat.
	 */
	let previewChatId: ChatId | null = $state(null);
	/**
	 * Sidebar hover preview yields to a live highlight: swapping the
	 * main column to another chat would pull the selection's nodes out
	 * from under it (killing the highlight mid-drag) and unmount the
	 * summoned menu via the preview gate. A deliberate highlight beats
	 * a passing glance — the hover previews again once it clears.
	 */
	function previewHover(id: ChatId): void {
		if (selMenu) return;
		if ((window.getSelection()?.toString() ?? "") !== "") return;
		// The preview renders its own inert copy of the empty chrome
		// below, so a live-open language list must not linger over it.
		openLangMenu = null;
		// File first: the peek swaps the box (whose empty-container
		// transient clamps to the top), and the leaving position must
		// survive both the peek and picking the peeked row.
		saveChatScroll();
		previewChatId = id;
	}

	/** End a hover preview, putting the box back where the active chat
	was left: the swap transient clamps to the top, and that clamp
	must neither file as the chat's position nor strand the box. */
	function endPreview(): void {
		if (previewChatId === null) return;
		previewChatId = null;
		const saved = chatScrollTops.get(chatState.activeChatId);
		if (saved === undefined || !scrollBox) return;
		flushSync();
		if (previewChatId === null && scrollBox)
			scrollBox.scrollTo({ top: saved, behavior: "instant" });
	}
	const previewChat = $derived(
		previewChatId && previewChatId !== chatState.activeChatId
			? (chatState.chats.find((c) => c.id === previewChatId) ?? null)
			: null
	);
	const viewChat = $derived(previewChat ?? chat);
	const previewing = $derived(previewChat !== null);
	const total = $derived(tokenTotal(chatState));
	const split = $derived(tokenSplit(chatState));
	const points = $derived(waypoints(chatState));
	const sourcesWanted = $derived(
		sourcesAsked(chat.messages.filter((m) => m.role === "user").map((m) => m.content))
	);


	/** Prompt text minus pasted-image marker lines (images travel as attachments). */
	function composerText(): string {
		return stripAttachmentMarkers(editor?.getText() ?? "").trim();
	}

	/**
	 * Attachment/OCR failure: inline under the composer on desktop, a
	 * toast on Android (the composer sits behind the keyboard there, so
	 * inline errors go unseen).
	 */
	function failAttach(message: string): void {
		showNotice(notices, "inline", message);
		if (androidUI) flashErrorToast(message);
	}

	/**
	 * Intake for dropped/picked/pasted files: every file that survives
	 * becomes an attachment and earns its composer tag (`[Pasted
	 * image]` / `[Pasted Attachment]`, caret after each tag's space),
	 * mirroring the pill. Resolves with the added kinds in order for
	 * tag insertion.
	 */
	async function addFiles(files: File[]): Promise<AttachmentKind[]> {
		clearNotice(notices, "inline");
		const added: AttachmentKind[] = [];
		for (const file of files) {
			attachBusy += 1;
			try {
				const att = await fileToAttachment(file);
				attachments = [...attachments, att];
				added.push(att.kind);
			} catch (error) {
				failAttach(error instanceof Error ? error.message : String(error));
			} finally {
				attachBusy -= 1;
			}
		}
		return added;
	}

	function onImagePasted(file: File): void {
		void addFiles([file]).then((kinds) => insertAttachmentMarkers(kinds));
	}

	/** Drop the `n` newest attachments of one kind (tag → attachment reconciliation). */
	function dropNewestAttachments(list: Attachment[], kind: AttachmentKind, n: number): Attachment[] {
		const kept = [...list];
		for (let i = kept.length - 1; i >= 0 && n > 0; i--) {
			if (kept[i]?.kind === kind) {
				kept.splice(i, 1);
				n--;
			}
		}
		return kept;
	}

	/** One tag per fresh attachment, caret after each tag's space. */
	function insertAttachmentMarkers(kinds: AttachmentKind[]): void {
		if (!editor || kinds.length === 0) return;
		markerSyncMuted = true;
		try {
			for (const kind of kinds) {
				editor.insertText(
					kind === "image" ? imageMarkerInsert(editor.getText()) : fileMarkerInsert(editor.getText())
				);
			}
			prevMarkerCount = countMarkers(editor.getText());
			prevFileMarkerCount = countMarkers(editor.getText(), FILE_MARKER);
		} finally {
			markerSyncMuted = false;
		}
	}

	/**
	 * Attachment pill <-> tag two-way removal (images and files).
	 * Pill → tag: dropping the pill removes one marker tag from the
	 * draft (prose typed beside it survives). Tag → pill lives in
	 * `promptOptions().onDocChange`: when a kind's tag count falls,
	 * its newest attachments go with it. `markerSyncMuted` bridges
	 * the two (programmatic edits must not reconcile against
	 * themselves); the `prev*Count` pair is the last reconciled
	 * state.
	 */
	let markerSyncMuted = false;
	let prevMarkerCount = 0;
	let prevFileMarkerCount = 0;

	/**
	 * Clipboard supplier for composer tag copy/cut: the `count` newest
	 * image attachments as clipboard-safe PNG blobs (Chromium writes
	 * PNG only — see clipboardPngBlob). The list read runs synchronously
	 * at call time so a cut's own deletion can't race it.
	 */
	function copyImageTagBlobs(list: Attachment[], count: number): Promise<Blob[]> {
		return attachmentImageBlobs(list, count).then((blobs) =>
			Promise.all(blobs.map((blob) => clipboardPngBlob(blob)))
		);
	}

	/**
	 * Attachment-card copy (icon-only, reusing the message-button copy
	 * glyph): text attachments copy their inlined text; images copy the
	 * image bytes (ClipboardItem) so a paste lands the picture, not a
	 * data URL. Toasts read "Copied" like every other copy path.
	 */
	function copyAttachment(att: Attachment): void {
		if (att.kind === "text" && att.text !== null) {
			copyPlain(att.text, "Copied");
			return;
		}
		if (att.kind === "image" && att.dataUrl) {
			const failed = "Couldn't copy to the clipboard.";
			if (!navigator.clipboard?.write) {
				flashErrorToast(failed);
				return;
			}
			void (async () => {
				try {
					const blob = await (await fetch(att.dataUrl as string)).blob();
					await navigator.clipboard.write([
						new ClipboardItem({ [blob.type || "image/jpeg"]: blob })
					]);
					flashToast("Copied");
				} catch {
					flashErrorToast(failed);
				}
			})();
			return;
		}
		flashToast("Nothing to copy yet.");
	}

	/**
	 * Preview models for the leftovers strip: one per attachment with
	 * no literal left in the message text (literals rebuild inline
	 * instead, so each file shows exactly once).
	 */
	function sentTagModels(msg: ChatMsg, base: string): AttachTagModel[] {
		return leftoverAttachments(msg.attachments ?? [], base).map((att) => ({
			id: att.id,
			kind: att.kind,
			name: att.name,
			tokens: att.tokens,
			open: expandedTags.includes(`${msg.id}:${att.id}`),
			dataUrl: att.dataUrl,
			text: att.text
		}));
	}

	// Tray drag-to-scroll (mouse only; touch scrolls natively): with
	// many cards the strip overflows, so a press-drag pans it. Past a
	// small slop the gesture owns the click — the capture gate below
	// swallows it, so a drag ending on OCR or X never fires either.
	let stripDragX = 0;
	let stripDragLeft = 0;
	let stripDragArmed = false;
	let stripDragMoved = false;
	let stripDragging = $state(false);
	function stripDragStart(event: PointerEvent): void {
		if (!event.isPrimary || event.pointerType === "touch" || event.button !== 0) return;
		const ul = event.currentTarget;
		if (!(ul instanceof HTMLElement)) return;
		stripDragX = event.clientX;
		stripDragLeft = ul.scrollLeft;
		stripDragArmed = true;
		stripDragMoved = false;
		// Native image drag would fight the pan: claim the gesture.
		event.preventDefault();
	}
	function stripDragMove(event: PointerEvent): void {
		if (!stripDragArmed) return;
		const ul = event.currentTarget;
		if (!(ul instanceof HTMLElement)) return;
		const dx = event.clientX - stripDragX;
		if (!stripDragMoved && Math.abs(dx) < 6) return;
		stripDragMoved = true;
		stripDragging = true;
		// Capture only once the gesture is really a pan: capturing on
		// press would retarget pointerup to the row, and plain clicks
		// on the card buttons would never reach them.
		try {
			ul.setPointerCapture(event.pointerId);
		} catch {
			// Pointer already gone (cancel raced us): the pan still
			// applied above, and pointerup has nothing to retarget.
		}
		ul.scrollLeft = stripDragLeft - dx;
	}
	function stripDragEnd(event: Event): void {
		stripDragging = false;
		stripDragArmed = false;
		// A cancel fires no click, so only it resets here: pointerup
		// leaves the flag for the gate below (keyboard clicks need no
		// pointerdown, so a stale flag must never survive one).
		if (event.type === "pointercancel" || event.type === "cancel") stripDragMoved = false;
	}
	function stripClickGate(event: MouseEvent): void {
		if (!stripDragMoved) return;
		stripDragMoved = false;
		event.stopPropagation();
		event.preventDefault();
	}
	/**
	 * Pill X: drop the pill plus one of its tags, and any
	 * attachment-scoped error with it.
	 */
	function removeAttachment(id: string): void {
		const removed = attachments.find((a) => a.id === id);
		attachments = attachments.filter((a) => a.id !== id);
		clearNotice(notices, "inline");
		if (removed && editor) {
			markerSyncMuted = true;
			try {
				// Minimal cut, never a full rewrite: a rewrite drops the
				// paste-marker decorations and unfolds the draft's folds.
				editor.exciseMarker(removed.kind === "image" ? IMAGE_MARKER : FILE_MARKER);
				prevMarkerCount = countMarkers(editor.getText());
				prevFileMarkerCount = countMarkers(editor.getText(), FILE_MARKER);
			} finally {
				markerSyncMuted = false;
			}
		}
	}

	/**
	 * On-device OCR for one attached image (macOS Vision bridge): the
	 * recognized text is inserted into the composer as selectable text,
	 * so it flows into the existing pinyin/furigana pipeline when sent.
	 * Outside the Mac shell the bridge rejects and the friendly error
	 * lands in the notice queue's inline slot — never a throw into UI teardown.
	 */
	let ocrBusyId: string | null = $state(null);

	async function recognizeAttachment(att: Attachment): Promise<void> {
		if (ocrBusyId !== null || att.kind !== "image" || !att.dataUrl) return;
		// Native first (macOS Vision, Windows WinRT, Linux system
		// Tesseract); anywhere else the WASM fallback runs in-client
		// (one download, cached offline after).
		const native = await ocrSupported();
		const fallbackLangs = native ? null : ocrFallbackLangs(activeReplyCode);
		ocrBusyId = att.id;
		clearNotice(notices, "inline");
		try {
			// No language hint: the backend's learner default covers
			// English + CJK scripts. Passing the Latin TTS fallback
			// here restricted Vision to English, so Chinese paragraphs
			// missed entirely and surfaced as red errors. The WASM
			// fallback takes the reply's traineddata instead.
			const result = fallbackLangs
				? await recognizeFallbackText(att.dataUrl, fallbackLangs)
				: await recognizeImageText(att.dataUrl, null);
			const text = result.text.trim();
			if (!text) {
				// A miss is routine feedback (wrong crop, handwriting),
				// not a composer-blocking fault: toast, never the inline
				// slot, so nothing red lingers over the next draft.
				flashErrorToast("No text found in this image.");
			} else {
				// Same-line landing like the image tag: trailing space,
				// never a newline — the caret stays beside the text so
				// the next keystroke continues it instead of opening a
				// fresh line below.
				editor?.insertText(`${text} `);
				flashToast("Recognized text inserted");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failAttach(fallbackLangs ? friendlyFallbackError(message) : friendlyOcrError(message));
		} finally {
			ocrBusyId = null;
		}
	}

	/** Delegated history-tag popup action: the inline card's
	 * Copy/OCR buttons carry data attributes (raw `{@html}` holds no
	 * Svelte handlers). Missing attachments stay silent — a card can
	 * outlive its message's files across a restore.
	 */
	function sentTagAction(action: SentTagAction, id: string): void {
		const stored =
			activeChat(chatState)?.messages.flatMap((m) => m.attachments ?? []) ?? [];
		const att = stored.find((a) => a.id === id);
		if (!att) return;
		if (action === "ocr") void recognizeAttachment(att);
		else copyAttachment(att);
	}

	/** Expanded history attachment tags (fold-open), ephemeral UI state
	 * keyed `${message.id}:${attachment.id}` — collapsed by default on
	 * every mount, unlike paste folds which persist open on the message.
	 */
	let expandedTags = $state<string[]>([]);

	/** History tag fold toggle: replace the key list (never mutate).
	One preview per message — opening a tag closes its siblings, so
	popups never stack over each other. */
	function toggleSentTag(msg: ChatMsg, attId: string): void {
		const key = `${msg.id}:${attId}`;
		if (expandedTags.includes(key)) {
			expandedTags = expandedTags.filter((k) => k !== key);
			return;
		}
		const prefix = `${msg.id}:`;
		expandedTags = [...expandedTags.filter((k) => !k.startsWith(prefix)), key];
	}

	function toggleFold(id: ChatMsgId): void {
		// A message under in-place edit never folds: the edit box
		// lives where the text sat, and folding it away would strand
		// the draft (keyboard, alt-click, and button share this gate).
		if (editingMsgId === id) return;
		if (androidUI) {
			void hapticBeatAsync("send", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
	}

	function copyPlain(text: string, note: string): void {
		const failed = "Couldn't copy to the clipboard.";
		if (!navigator.clipboard) {
			flashErrorToast(failed);
			return;
		}
		void navigator.clipboard.writeText(text).then(
			() => flashToast(note),
			() => flashErrorToast(failed)
		);
	}

	function copyText(content: string, role: string): void {
		// Message copy excludes baked annotations (metadata, not prose);
		// refs-only messages fall back to their quotes, never "".
		copyPlain(redactedCopyText(plainBody(content, role, sourcesWanted)), "Copied");
	}

	/** Copy one annotation (either overlay): quote plus comment, no numbers. */
	function copyAnnotation(quote: string, comment: string): void {
		const text = comment.trim() ? `"${quote}" — ${comment.trim()}` : `"${quote}"`;
		copyPlain(text, "Copied");
	}

	/**
	 * Cut the hovered message: the clipboard write must land first —
	 * deleting up front would strand the text when copying fails.
	 */
	function cutHoverMessage(index: number): void {
		const target = chat.messages[index];
		if (!target) return;
		const text = plainBody(target.content, target.role, sourcesWanted);
		const done = navigator.clipboard?.writeText(text);
		if (done === undefined) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void done.then(
			() => {
				deleteMessage(chatState, index);
				flashToast("Cut to clipboard");
			},
			() => flashToast("Couldn't copy to the clipboard.")
		);
	}

	/** Clicking the toast copies its text. Success stays silent by
	design: flashing a confirmation would overwrite the very text being
	copied. Failure still says so (guarded against clobbering a newer
	toast that landed meanwhile). */
	function copyToast(): void {
		const text = notices.toast.message;
		if (!text) return;
		if (!navigator.clipboard) {
			flashErrorToast("Couldn't copy to the clipboard.");
			return;
		}
		void navigator.clipboard.writeText(text).catch(() => {
			if (notices.toast.message === text) flashToast("Couldn't copy to the clipboard.");
		});
	}



	/** Article element owning a DOM node, or null outside messages. */
	function articleOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('article[id^="msg-"]') ?? null;
	}

	/** Message id owning the selection anchor, or null outside messages. */
	function selectedMessageId(selection: Selection): ChatMsgId | null {
		const article = articleOf(selection.anchorNode);
		if (!article) return null;
		const index = Number(article.id.slice(4));
		return chat.messages[index]?.id ?? null;
	}

	function currentQuote(): { quote: string; context: string; messageId: ChatMsgId } | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered = selection.anchorNode instanceof Element
			? selection.anchorNode
			: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return null;
		// Math picks normalize to the whole equation: a partial glyph
		// pick quotes a shard that never re-matches, so when both ends
		// sit in one equation the range expands over its body first.
		const anchorBody = equationBodyOf(selection.anchorNode);
		if (anchorBody && equationBodyOf(selection.focusNode) === anchorBody) {
			try {
				const whole = equationBodyRange(anchorBody);
				if (!whole) return null;
				selection.removeAllRanges();
				selection.addRange(whole);
			} catch {
				// A disturbed range keeps the partial pick below.
			}
		}
		// Clone the range and drop badge buttons and ruby readings:
		// selecting across an existing annotation would otherwise bake
		// its number into the new quote ("Kyoto1 in two sentences"),
		// and ruby would bake its readings in with the base text.
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const messageId = selectedMessageId(selection);
		if (!messageId) return null;
		// The paragraph holding the highlight: a lone Han char can
		// never carry kana itself, so Inspect guesses its locale from
		// this text instead. Ruby readings ride along in textContent,
		// but furigana only annotates Japanese lines, so the guess
		// still points the right way.
		const anchorEl =
			selection.anchorNode instanceof Element
				? selection.anchorNode
				: selection.anchorNode?.parentElement;
		const context = (anchorEl?.closest("p, li")?.textContent ?? "").slice(0, 2000);
		return { quote, context, messageId };
	}

	function onSelectEnd(event: MouseEvent, cursorX?: number): void {
		if (event.altKey) return; // Option-click folds; never a menu.
		const live = window.getSelection();
		// Picks rooted in the annotation UI (review card, pill) are
		// never annotatable: skip the message locks and snaps so the
		// native pick stays exactly as drawn (stays copyable), and
		// summon nothing.
		const anchorEl =
			live?.anchorNode instanceof Element ? live.anchorNode : live?.anchorNode?.parentElement;
		if (anchorEl && isAnnotationUiTarget(anchorEl)) return;
		// Selections never span messages: a drag crossing into another
		// article trims back to the anchor message's edge first.
		if (live) lockSelectionToMessage(live, articleOf);
		// Multi-click picks grab the block terminator newline,
		// painting the line beneath the highlight (the quote trims it
		// anyway): drop it before the menu reads the quote. A word
		// pick with no trailing newline passes through untouched, so
		// double-click stays safe. Deliberate drags into the next
		// line keep theirs.
		if (event.detail >= 2 && live && live.rangeCount > 0) {
			try {
				trimParagraphTerminator(live.getRangeAt(0));
			} catch {
				// Cosmetic: the untrimmed pick still summons.
			}
		}
		// The create marker never splits a word in half: boundaries cut
		// mid-word snap out to the word's edges before the menu reads
		// the quote (CJK has no word characters, so it never snaps).
		if (live) snapSelectionToWordEdges(live);
		placeSelMenu(cursorX, event.clientY);
	}

	function placeSelMenu(cursorX?: number, cursorY?: number): void {
		ensureSwapObserver();
		// Never summon off preview content: the main column is showing
		// another chat, so the quote would pair with the active chat's
		// message id and Annotate would anchor garbage. The hover gate
		// (previewHover) normally prevents reaching here mid-preview.
		if (previewing) {
			selMenu = null;
			return;
		}
		const found = currentQuote();
		if (!found) {
			selMenu = null;
			return;
		}
		const live = window.getSelection();
		const rect = live?.rangeCount ? live.getRangeAt(0).getBoundingClientRect() : null;
		if (!rect) {
			selMenu = null;
			return;
		}
		// A release in another article than the highlight (the drag
		// crossed messages) would dock the menu to the stray cursor,
		// stranding Annotate on a message with no highlight: fall back
		// to the highlight's own rect so the menu stays on the quoted
		// message. Releases outside any article keep the cursor (the
		// gap below a message still docks near the pointer).
		let atX = cursorX;
		let atY = cursorY;
		if (atX !== undefined && atY !== undefined && live && live.rangeCount > 0) {
			const at = document.elementFromPoint(atX, atY);
			const quoteArticle = articleOf(live.anchorNode);
			if (quoteArticle && at && articleOf(at) && articleOf(at) !== quoteArticle) {
				atX = undefined;
				atY = undefined;
			}
		}
		// The live range, so menu hover can put the highlight back:
		// WebKit empties the document selection when the pointer moves
		// onto the floating menu (no DOM change, no press). Nothing
		// mutates in that path, so these nodes stay valid.
		const stored = live && live.rangeCount > 0 ? live.getRangeAt(0).cloneRange() : null;
		const { x, y } = selMenuPlacement({
			cursorX: atX,
			cursorY: atY,
			rectLeft: rect.left,
			rectTop: rect.top,
			rectBottom: rect.bottom,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			androidUI,
			iosUI,
			menuWidth: selMenuWidthEstimate(found.quote)
		});
		// The rescue in the selectionchange auto-dismiss restores the
		// stored range while nothing newer landed (see selMenuOpenedAt).
		selMenuOpenedAt = Date.now();
		selMenu = {
			x,
			y,
			left: rect.left,
			w: rect.width,
			quote: found.quote,
			context: found.context,
			messageId: found.messageId,
			range: stored
		};
		// Phones dock Annotate in the composer tools: a highlight with a
		// parked prompt would strand the menu off-screen, so summon the
		// prompt (shown, unfocused — the keyboard waits for the pill).
		// Desktop keeps keys-only restore; its menu floats already.
		if (androidUI) restorePrompt();
	}

	/**
	 * Menu hover enter: WebKit empties the document selection when the
	 * pointer moves onto the floating menu (no DOM change, no press —
	 * Chromium keeps it), so put the stored live range back and the
	 * highlight survives the trip to Annotate. Nothing mutated, so the
	 * stored nodes are still valid; never stomps a non-empty selection,
	 * and one restore per enter is enough (the engine clears once).
	 */
	function enterSelMenu(): void {
		selMenuHover = true;
		const range = selMenu?.range;
		if (!range) return;
		const live = window.getSelection();
		if (!live || live.toString() !== "") return;
		try {
			if (!document.contains(range.startContainer) || !document.contains(range.endContainer))
				return;
			live.removeAllRanges();
			live.addRange(range);
		} catch {
			// Cosmetic: the menu stands on its stored quote regardless.
		}
	}

	function clearSelection(): void {
		lastProgrammaticClearAt = Date.now();
		window.getSelection()?.removeAllRanges();
	}

	/**
	 * Which repeat of a quote the live selection starts in: resolves the
	 * range start against the message's rendered text nodes and counts
	 * the stripped occurrence holding it. Never throws — selection APIs
	 * disagree across engines, and anything odd keeps 0 (first match).
	 */
	function occurrenceFromSelection(messageId: ChatMsgId, quote: string): number {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return 0;
			const range = selection.getRangeAt(0);
			let node: Node | null = range.startContainer;
			let offset = range.startOffset;
			// Whole-node starts (triple-click paragraphs) resolve to
			// their first text: the occurrence holding the span's start.
			if (!(node instanceof Text)) {
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				const firstText = walker.nextNode();
				if (!(firstText instanceof Text)) return 0;
				node = firstText;
				offset = 0;
			}
			const index = chat.messages.findIndex((m) => m.id === messageId);
			if (index === -1) return 0;
			const root = document.querySelector(`article#msg-${index} .rendered`);
			if (!(root instanceof HTMLElement)) return 0;
			const nodes = quoteTextNodes(root);
			const nodeIndex = node instanceof Text ? nodes.indexOf(node) : -1;
			if (nodeIndex === -1) return 0;
			return occurrenceAtPosition(
				nodes.map((n) => n.textContent ?? ""),
				quote,
				nodeIndex,
				offset
			);
		} catch {
			return 0;
		}
	}

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. The
	annotation stays pending (no badge, no count) until submit. */
	function annotate(): void {
		if (!selMenu) return;
		if (!selMenu.quote.trim()) {
			clearSelection();
			selMenu = null;
			return;
		}
		// Starting over submits whatever is being composed first: typed
		// comments are never silently dropped.
		if (pendingAnn) commitPending();
		// An in-prompt note edit owns the composer: filing it first
		// hands the draft back before the new annotation takes over.
		if (promptAnnEdit) commitPromptAnnEdit();
		const quote = selMenu.quote.trim();
		// Repeats disambiguate here, from the live selection: the
		// last "c" in "ccc" records occurrence 2, so its badge
		// lands where the highlight was. Anything unresolvable
		// keeps 0 (first match, the old behavior).
		const at = occurrenceFromSelection(selMenu.messageId, quote);
		// Same span twice would stack two badges on one anchor (and
		// hovering them oscillates): open the review on the existing
		// one instead of filing a twin.
		const dupe = duplicateAnnotationId(annotations, selMenu.messageId, quote, at);
		if (dupe) {
			clearSelection();
			selMenu = null;
			highlightAnnId = dupe;
			reviewOpen = true;
			flashToast("Already annotated");
			return;
		}
		const pending: Annotation = {
			id: newAnnotationId(),
			messageId: selMenu.messageId,
			quote,
			comment: "",
			at
		};
		pendingAnn = pending;
		clearSelection();
		// Phones file the comment in the composer, never the
		// transplanted pill (its textbox can't reliably summon the
		// phone keyboard — see editAnnotationInPrompt). Desktop
		// falls through to the popover below.
		if (androidUI) {
			selMenu = null;
			highlightAnnId = pending.id;
			editAnnotationInPrompt({ pending: true }, "");
			if (settings.vibration) vibrateTick(6);
			return;
		}
		const width = popWidth(true);
		// The comment box sits a breath below the Annotate menu's
		// anchor: sharing selMenu.y leaves it floating high above tall
		// CJK lines. Narrow highlights center the box over themselves;
		// wide ones keep the end-of-selection placement. The Annotate
		// button itself never moves (stays at the cursor end).
		// Phone: the keyboard eats the lower screen, so the composer
		// pins high and centered instead of at the selection — it is
		// never covered, wherever the quote sits.
		const x = androidUI
			? Math.max(8, (window.innerWidth - width) / 2)
			: placeAnnPopX({
					cursorX: selMenu.x,
					highlightLeft: selMenu.left,
					highlightWidth: selMenu.w,
					popWidth: width,
					viewportWidth: window.innerWidth
				});
		let y = Math.min(Math.max(8, selMenu.y + 2), window.innerHeight - 72);
		if (androidUI) {
			y = Math.max(8, window.innerHeight * 0.12);
		}
		selMenu = null;
		highlightAnnId = pending.id;
		annDraft = "";
		settleAnnPop();
		annPop = { id: pending.id, x, y, fresh: true };
		// The pill mounts async: land the caret once it flushes, or
		// phone users get a comment box with no keyboard (and desktop
		// users an extra click). Focus-only — selection is already filed.
		// Phones re-pin the scroll behind the focus: some WebViews pan
		// on textbox focus despite preventScroll, snapping the thread.
		if (androidUI) {
			const sx = window.scrollX;
			const sy = window.scrollY;
			const box = scrollBox;
			const st = box?.scrollTop ?? 0;
			void tick().then(() => {
				annPopBox?.focus({ preventScroll: true });
				window.scrollTo(sx, sy);
				if (box) box.scrollTop = st;
			});
		} else {
			void tick().then(() => annPopBox?.focus({ preventScroll: true }));
		}
		if (settings.vibration) vibrateTick(6);
	}

	/** Submit the annotation being composed (Enter or Save). The id is
	kept from composition so wash, pill, and badge address one thing. */
	function commitPending(): void {
		const pending = pendingAnn;
		if (!pending) return;
		annotations = [...annotations, { ...pending, comment: annDraft }];
		pendingAnn = null;
	}

	/** Fade the pill out, then unmount it. Data writes stay synchronous
	in the caller — only the unmount (and its highlight) waits out the ramp. */
	function hideAnnPop(): void {
		if (!annPop || annPopClosing) return;
		annPopClosing = true;
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = setTimeout(() => {
			annPopTimer = null;
			annPop = null;
			annPopClosing = false;
			// The highlight lives only while a textbox is open.
			highlightAnnId = null;
		}, 160);
	}

	/** Opening (or teardown) cancels a fade-out in flight. */
	function settleAnnPop(): void {
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = null;
		annPopClosing = false;
	}

	function saveAnnPop(fromEnter = false): void {
		if (!annPop || annPopClosing) return;
		stopPillMic();
		// The pop id decides (see annPopSaveKind): a pop still
		// addressing its pending annotation commits it, otherwise the
		// saved comment of the existing one is edited.
		if (annPopSaveKind(annPop.id, pendingAnn?.id ?? null) === "commit-pending") commitPending();
		else annotations = editAnnotationComment(annotations, annPop.id, annDraft);
		hideAnnPop();
		// Only the Enter key needs the anti-double-send guard: a click-away
		// save involves no Enter that could leak into a send.
		if (fromEnter) sendGuardUntil = Date.now() + 500;
		editor?.focus();
	}

	/** Clicking off the pill: an empty draft cancels (no ghost empty
	annotations), a typed draft still saves — typed comments are never
	silently dropped. Enter with no text is the way to file an empty one. */
	function blurAnnPop(): void {
		if (!annPop || annPopClosing) return;
		if (annPopBlurAction(annDraft) === "cancel") cancelAnnPop();
		else saveAnnPop();
	}

	function cancelAnnPop(): void {
		if (!annPop || annPopClosing) return;
		const { id, fresh } = annPop;
		stopPillMic();
		hideAnnPop();
		// Cancel means "as it was" (see annPopCancelKind): a
		// never-submitted pending never existed; a fresh annotation
		// goes no matter what was typed; an existing one keeps its
		// saved comment (nothing is written until Save).
		const cancelKind = annPopCancelKind(id, fresh, pendingAnn?.id ?? null);
		if (cancelKind === "drop-pending") pendingAnn = null;
		else if (cancelKind === "delete-fresh") annotations = deleteAnnotation(annotations, id);
		editor?.focus();
	}

	function annPopKey(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			saveAnnPop(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancelAnnPop();
		}
	}

	/** Auto-grow action for the annotation pill. Focuses on open so Enter
	saves immediately without a click. */
	function growPill(node: HTMLTextAreaElement): { destroy(): void } {
		// The insert cursor must never yank the messages list. Phones
		// re-pin behind the mount focus too: the create/edit paths
		// focus again on tick, and a WebView pan here would snap first.
		if (androidUI) {
			const sx = window.scrollX;
			const sy = window.scrollY;
			const box = scrollBox;
			const st = box?.scrollTop ?? 0;
			node.focus({ preventScroll: true });
			window.scrollTo(sx, sy);
			if (box) box.scrollTop = st;
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
		// grow 1 line toward the same 168px cap, so one threshold
		// splits short from tall for both. clientHeight counts
		// CSS-owned growth too, not just the hand-measured fallback.
		const card = node.closest(".ann-pop");
		const TALL_PX = 100;
		const mark = () => {
			const h = node.clientHeight ?? 0;
			card?.classList.toggle("tall", h > TALL_PX);
		};
		mark();
		const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
		if (card && ro) ro.observe(node);
		return {
			destroy: () => {
				node.removeEventListener("input", fit);
				ro?.disconnect();
			}
		};
	}

	/** Annotation popover width: the desktop card, clamped to fit narrow
	phones — without the clamp x goes negative and it runs off-screen. */
	function popWidth(fresh: boolean): number {
		// CSS widths (16px root): .ann-pop is 24rem, .ann-pop.fresh is
		// 19rem. Measuring the nominal 384 for a fresh box centers on
		// the wrong middle (see annotations-ux centering spec).
		return Math.min(fresh ? 19 * 16 : 24 * 16, window.innerWidth - 16);
	}

	/**
	 * Badge click edits in the floating card on desktop, in the
	 * composer on phones (see editAnnotationInPrompt): the saved
	 * comment loads as the draft, Enter or the arrow files it back,
	 * tapping out cancels. Re-pressing the editing badge cancels too.
	 */
	function openBadge(id: AnnotationId, anchor?: { x: number; y: number }): void {
		// Re-pressing the open badge closes it, like cancel: the edit
		// menu toggles instead of reopening under the cursor.
		if (annPop && !annPopClosing && annPop.id === id) {
			cancelAnnPop();
			return;
		}
		const current = annotations.find((a) => a.id === id);
		if (!current) return;
		// Phones edit in the composer, never the card: the transplanted
		// textbox can't reliably summon the phone keyboard — see
		// editAnnotationInPrompt. Re-pressing the editing badge cancels
		// back out (toggle). Desktop keeps the floating edit menu.
		if (promptAnnEdit && !("pending" in promptAnnEdit) && promptAnnEdit.id === id) {
			cancelPromptAnnEdit();
			return;
		}
		stopPillMic();
		editingId = null;
		highlightAnnId = id;
		if (androidUI) {
			editAnnotationInPrompt({ id }, current.comment);
			return;
		}
		annDraft = current.comment;
		settleAnnPop();
		// Narrow viewports are narrower than the desktop card: clamp
		// first or x goes negative and the popover runs off-screen.
		const anchorAt = anchor ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
		const width = popWidth(false);
		const x = Math.min(Math.max(8, anchorAt.x - width / 2), window.innerWidth - width - 8);
		const height = 240;
		let y = anchorAt.y + 8;
		if (y + height > window.innerHeight - 8) y = Math.max(8, anchorAt.y - height - 8);
		annPop = { id, x, y, fresh: false };
		// The box can morph from a still-fading fresh pill (same
		// element, no remount, so growPill's mount focus never fires):
		// land the caret explicitly, like the create path does.
		void tick().then(() => annPopBox?.focus({ preventScroll: true }));
	}

	/**
	 * Delegated badge click (MessageBody): the keyboard path, plus the
	 * trailing click of a press gesture. A press's own click re-fire —
	 * same badge within the tap window — is the gesture just handled,
	 * not a re-press: running the toggle would shut the menu the press
	 * opened (the iOS tap bug). Anything else toggles as before.
	 */
	function openBadgeClick(id: AnnotationId, anchor: { x: number; y: number }): void {
		if (lastBadgePress && lastBadgePress.id === id && Date.now() - lastBadgePress.at < 800) return;
		openBadge(id, anchor);
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
		highlightAnnId = null;
		// The Save button unmounts with the edit box: park focus on the
		// pill or the overlay drops on touch (see focus refs above).
		focusPill();
	}

	function removeAnnotation(id: string): void {
		// Annotation deletes thump like message deletes (the shared
		// triple-beat contract: call sites carry no haptic of their own).
		if (androidUI) {
			void hapticBeatAsync("done", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		annotations = deleteAnnotation(annotations, id);
		if (editingId === id) editingId = null;
		if (highlightAnnId === id) highlightAnnId = null;
		if (annPop?.id === id) {
			settleAnnPop();
			annPop = null;
		}
		if (promptAnnEdit && !("pending" in promptAnnEdit) && promptAnnEdit.id === id) {
			exitPromptAnnEdit();
		}
	}

	/**
	 * Move an annotation comment into the composer (every phone edit —
	 * the transplanted textboxes can't reliably summon keyboards or
	 * hold focus; desktop edits at the mark instead, see
	 * editAnnotationAtMark): the pending annotation files
	 * on the arrow, a saved one's comment rewrites. The review
	 * closes so the composer owns the screen; the wash keeps the
	 * quote visible.
	 */
	function editAnnotationInPrompt(target: { id: string } | { pending: true }, comment: string): void {
		// A fresh popover open underneath files first: typed comments
		// are never silently dropped (same rule as annotate()).
		if (pendingAnn && !("pending" in target)) commitPending();
		settleAnnPop();
		annPop = null;
		promptAnnStash = editor?.getText() ?? "";
		promptAnnEdit = target;
		reviewOpen = false;
		editor?.setText(comment);
		editor?.setPlaceholder("Add a comment");
		editor?.caretToEnd();
		// Best-effort: the opening tap's canceled gesture can block
		// the summon on some WebViews, but a plain tap on the
		// composer always works — it summons for chat typing today.
		void tick().then(() => editor?.focus());
	}

	/** Send-arrow commit for an in-prompt note edit (see doSend). */
	function commitPromptAnnEdit(): void {
		const target = promptAnnEdit;
		if (!target) return;
		void hapticBeatAsync("send", { enabled: settings.vibration, shell: tauriBackendAvailable() });
		const comment = editor?.getText() ?? "";
		if ("pending" in target) {
			if (pendingAnn) annotations = [...annotations, { ...pendingAnn, comment }];
			pendingAnn = null;
		} else {
			annotations = editAnnotationComment(annotations, target.id, comment);
		}
		highlightAnnId = null;
		// Pending filings save for the first time; a saved draft's
		// comment rewrites — the toast names which happened (a bare
		// "Note saved" never said).
		const savedToast = "pending" in target ? "Draft annotation saved" : "Draft annotation edited";
		exitPromptAnnEdit();
		flashToast(savedToast);
		void tick().then(() => editor?.focus());
	}

	/** Tapping out drops an in-prompt note edit: a pending filing
	never existed, a saved note keeps its stored comment (typing only
	lived in the composer — nothing writes until the arrow). */
	function cancelPromptAnnEdit(): void {
		if (!promptAnnEdit) return;
		if ("pending" in promptAnnEdit) pendingAnn = null;
		highlightAnnId = null;
		exitPromptAnnEdit();
	}

	/** Leave in-prompt edit mode and give the composer back its
	drafted chat text and placeholder. Focus stays where it is (the
	commit path re-focuses explicitly; a tap-out cancel must not
	steal it back). */
	function exitPromptAnnEdit(): void {
		promptAnnEdit = null;
		editor?.setText(promptAnnStash);
		promptAnnStash = "";
		editor?.setPlaceholder(promptPlaceholder());
	}

	/**
	 * Quote tap lands on the annotation's marker: the message scrolls
	 * into view and its yellow wash blinks slowly twice, then clears
	 * (hover previews own the wash again after). Only quote taps
	 * navigate — notes, buttons, and fields never do.
	 */
	/**
	 * Quote-tap jumps to the mark — and only the quote taps: the note
	 * stays selectable text, buttons keep their clicks, and the row's
	 * dead space navigates nowhere. A drag-select ending here is a pick
	 * (the click still fires), so only collapsed selections navigate.
	 * The review closes so the landing clears the composer dock.
	 */
	function reviewQuoteClick(ann: { id: AnnotationId; messageId: ChatMsgId }): void {
		if (!window.getSelection()?.isCollapsed) return;
		reviewOpen = false;
		gotoAnnotation(ann);
	}

	function gotoAnnotation(ann: { id: AnnotationId; messageId: ChatMsgId }): void {
		const index = viewChat.messages.findIndex((m) => m.id === ann.messageId);
		if (index < 0) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		highlightAnnId = ann.id;
		// Scroll the mark itself, clear of the composer dock: an
		// already-clear mark never moves (like nearest), but a covered
		// one lands in the open instead of stranding behind the dock
		// (nearest's down-landing trap). Fall back to the message when
		// the badge is somehow missing.
		const badge = document.querySelector(`[data-ann-badge="${ann.id}"]`);
		if (badge instanceof HTMLElement) scrollRectIntoClear(badge.getBoundingClientRect());
		else {
			document.querySelector(`#msg-${index}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
		}
		blinkAnnotation(ann.id);
	}

	/**
	 * Land a located rect where it stays visible: inside the chat
	 * column, above the composer dock (prompt plus the open review).
	 * Already-clear rects never move; covered ones settle at a third
	 * of the clear height so the quote reads with context around it.
	 */
	function scrollRectIntoClear(rect: DOMRect): void {
		const scroller = document.querySelector(".messages");
		if (!(scroller instanceof HTMLElement)) return;
		const area = scroller.getBoundingClientRect();
		const prompt = document.querySelector(".prompt")?.getBoundingClientRect().height ?? 0;
		const review = reviewOpen
			? (document.querySelector(".ann-wrap .review")?.getBoundingClientRect().height ?? 0)
			: 0;
		const dock = prompt + review + 16;
		if (rect.top >= area.top && rect.bottom <= area.bottom - dock) return;
		const landing = area.top + Math.max(0, area.height - dock) * 0.3;
		scroller.scrollBy({ top: rect.top - landing, behavior: "smooth" });
	}

	/**
	 * Previous-annotations quote press: only the quote text navigates
	 * (see reviewQuoteClick) — the note stays selectable, buttons keep
	 * their clicks, dead space navigates nowhere. A drag-select ending
	 * here is a pick, so only collapsed selections navigate. The jump
	 * lands on the quoted message with a flash when it still holds the
	 * quote, or on the sending message when the quote is gone.
	 */
	function refsQuoteClick(messageId: ChatMsgId, quote: string, n: number): void {
		// A row edit owns its row: quote taps must not yank the chat
		// out from under the caret.
		if (refsEditing) return;
		if (!window.getSelection()?.isCollapsed) return;
		blinkRefsRow(messageId, n);
		gotoSentRef(messageId, quote);
	}

	/** Flash the pressed sent row twice, then release it (a re-press
	restarts the schedule; expiry clears itself). Same phases as the
	draft row blink — see blinkAnnotation. */
	function blinkRefsRow(messageId: ChatMsgId, n: number): void {
		if (refsBlinkTimer) clearTimeout(refsBlinkTimer);
		refsBlinkTimer = null;
		const key = { messageId, n };
		refsBlink = key;
		let phase = 0;
		const step = (): void => {
			phase += 1;
			if (phase >= 4) {
				refsBlink = null;
				refsBlinkTimer = null;
				return;
			}
			refsBlink = phase % 2 === 0 ? key : null;
			refsBlinkTimer = setTimeout(step, phase % 2 === 0 ? 700 : 350);
		};
		refsBlinkTimer = setTimeout(step, 700);
	}

	function gotoSentRef(messageId: ChatMsgId, quote: string): void {
		const live = annotations.find((a) => a.messageId === messageId && a.quote === quote);
		if (live) {
			gotoAnnotation({ id: live.id, messageId });
			return;
		}
		// The quote lives in the message it was taken from: jump there
		// with a flash, not to the message that sent it.
		const quotedId = findQuotedMessage(viewChat.messages, messageId, quote);
		if (quotedId) {
			jumpToQuotedText(quotedId, quote);
			return;
		}
		// Edited away everywhere: fall back to the sender, as before.
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		if (index < 0) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		document
			.querySelector(`#msg-${index}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	/**
	 * Sent-annotation landing: locate the quote in its owner's rendered
	 * text, land it clear of the dock, and flash it twice like a badge
	 * blink (same phases — see blinkAnnotation). A folded message hides
	 * its text from the locator: land on the message itself instead.
	 */
	function jumpToQuotedText(messageId: ChatMsgId, quote: string): void {
		const index = viewChat.messages.findIndex((m) => m.id === messageId);
		const locate = (): Range | null => {
			const article = index >= 0 ? document.querySelector(`#msg-${index}`) : null;
			const root = article?.querySelector(".rendered") ?? article;
			return root instanceof HTMLElement ? quoteRange(root, quote) : null;
		};
		const range = locate();
		if (range) {
			scrollRectIntoClear(range.getBoundingClientRect());
			flashJumpMark(locate);
			blinkJumpWash(locate);
		} else if (index >= 0) {
			const article = document.querySelector(`#msg-${index}`);
			if (article instanceof HTMLElement) {
				article.scrollIntoView({ block: "center", behavior: "smooth" });
			}
		}
	}

	/** Unwrap every destination flash mark (re-jump pre-clear and
	expiry share it; a re-render that already dropped them no-ops). */
	function clearJumpMarks(): void {
		try {
			document
				.querySelectorAll("mark.ccez-ann-flash")
				.forEach((m) => unwrapMark(m as HTMLElement));
		} catch {
			// Cosmetic: never break the jump.
		}
	}

	/** Flash the destination quote twice in draft yellow, then release
	it (a re-jump restarts the schedule; expiry clears itself). Plain
	DOM marks render in every engine — the guaranteed half of the
	signal, alongside the Highlight wash where supported. Every paint
	re-locates for the same re-render reason as the wash below. */
	function flashJumpMark(locate: () => Range | null): void {
		if (jumpMarkTimer) clearTimeout(jumpMarkTimer);
		jumpMarkTimer = null;
		clearJumpMarks();
		const paintFresh = (): boolean => {
			const range = locate();
			if (!range) return false;
			return wrapRangeInMark(range, "ccez-ann-flash") !== null;
		};
		if (!paintFresh()) return;
		let phase = 0;
		const step = (): void => {
			phase += 1;
			if (phase >= 4) {
				clearJumpMarks();
				jumpMarkTimer = null;
				return;
			}
			if (phase % 2 === 0) {
				if (!paintFresh()) {
					jumpMarkTimer = null;
					return;
				}
			} else clearJumpMarks();
			jumpMarkTimer = setTimeout(step, phase % 2 === 0 ? 700 : 350);
		};
		jumpMarkTimer = setTimeout(step, 700);
	}

	/** Flash a located quote twice, then release the highlight (a
	re-jump restarts the schedule; expiry clears itself). Every paint
	re-locates: a chat re-render mid-scroll (scroll-driven state swaps
	the text nodes) detaches the old range, and repainting the same
	dead range would blink nothing — the registry keeps it, so only a
	fresh range keeps the flash alive. */
	function blinkJumpWash(locate: () => Range | null): void {
		if (jumpBlinkTimer) clearTimeout(jumpBlinkTimer);
		jumpBlinkTimer = null;
		const paintFresh = (): boolean => {
			const range = locate();
			return range ? paintJumpWash(range) : false;
		};
		if (!paintFresh()) return;
		let phase = 0;
		const step = (): void => {
			phase += 1;
			if (phase >= 4) {
				clearJumpWash();
				jumpBlinkTimer = null;
				return;
			}
			if (phase % 2 === 0) {
				if (!paintFresh()) {
					jumpBlinkTimer = null;
					return;
				}
			} else clearJumpWash();
			jumpBlinkTimer = setTimeout(step, phase % 2 === 0 ? 700 : 350);
		};
		jumpBlinkTimer = setTimeout(step, 700);
	}

	/**
	 * Pencil edit at the mark (new-overlay rows, desktop): jump to the
	 * quote, then open the same floating edit card a badge tap summons
	 * — one edit UI on desktop. Phones keep the composer path (the
	 * transplanted textbox can't reliably summon the phone keyboard —
	 * see editAnnotationInPrompt).
	 */
	function editAnnotationAtMark(id: AnnotationId): void {
		const current = annotations.find((a) => a.id === id);
		if (!current) {
			flashErrorToast("Annotation no longer exists");
			return;
		}
		if (androidUI) {
			editAnnotationInPrompt({ id }, current.comment);
			return;
		}
		gotoAnnotation({ id, messageId: current.messageId });
		openEditCardAtSettledBadge(id);
	}

	/**
	 * Open the desktop edit card once the jump's scroll settles. The
	 * card is fixed-position, so anchoring mid-scroll strands it away
	 * from the quote: scroll events re-arm a short settle timer, and
	 * an already-visible mark (no scroll at all) opens on a near tick.
	 */
	function openEditCardAtSettledBadge(id: AnnotationId): void {
		let done = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const onScroll = (): void => {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(finish, 150);
		};
		const finish = (): void => {
			if (done) return;
			done = true;
			if (timer !== null) clearTimeout(timer);
			window.removeEventListener("scroll", onScroll, true);
			const badge = document.querySelector(`[data-ann-badge="${id}"]`);
			const rect = badge instanceof HTMLElement ? badge.getBoundingClientRect() : null;
			openBadge(id, rect ? { x: rect.left + rect.width / 2, y: rect.bottom } : undefined);
		};
		window.addEventListener("scroll", onScroll, true);
		timer = setTimeout(finish, 80);
	}

	/**
	 * Previous-menu pencil (desktop): the row swaps its note for a
	 * single-line field — the card's rows stay one line, so the editor
	 * is an <input>, never a textarea (Enter saves, Escape cancels via
	 * the global dismiss below; newlines would break the baked block
	 * shape the render parses back).
	 */
	function startRefsEdit(messageId: ChatMsgId, ref: { n: number; comment: string }): void {
		refsEditing = { messageId, n: ref.n };
		refsEditDraft = ref.comment;
		void tick().then(() => {
			refsEditBox?.focus();
			refsEditBox?.select();
		});
	}

	/**
	 * Focus back on a row's pencil after the edit unmounts: the save
	 * (and the cancel) re-renders the row, so the opening button is a
	 * fresh node — focusing it synchronously strands on the detached
	 * one. The data hook finds the remounted row.
	 */
	function parkRefsEditFocus(n: number): void {
		void tick().then(() => {
			const pencil = document.querySelector(`.ann-refs-pop [data-refs-pencil="${n}"]`);
			if (pencil instanceof HTMLElement) pencil.focus();
		});
	}

	/**
	 * Row-edit commit: rebake the message with the one comment swapped
	 * (see rewriteAnnotationComment) — history rewrites in place, like
	 * an own-message edit, with no resend. An unparseable block reads
	 * as gone; an untouched draft writes nothing.
	 */
	function saveRefsEdit(): void {
		const editing = refsEditing;
		refsEditing = null;
		if (!editing) return;
		const msg = viewChat.messages.find((m) => m.id === editing.messageId);
		const next = msg ? rewriteAnnotationComment(msg.content, editing.n, refsEditDraft) : null;
		if (next === null) flashErrorToast("Annotation no longer exists");
		else if (msg && next !== msg.content) editMessageContent(chatState, editing.messageId, next);
		refsEditDraft = "";
		parkRefsEditFocus(editing.n);
	}

	/** Row-edit cancel: the stored comment stands, focus parks back on
	the pencil that opened the field. */
	function cancelRefsEdit(): void {
		if (!refsEditing) return;
		const n = refsEditing.n;
		refsEditing = null;
		refsEditDraft = "";
		parkRefsEditFocus(n);
	}

	/** Blink a badge wash slowly twice, then hand the wash back. A
	re-jump restarts the sequence; each phase flips state so Svelte
	re-renders even for the same id twice running. */
	function blinkAnnotation(id: AnnotationId): void {
		if (annBlinkTimer) clearTimeout(annBlinkTimer);
		annBlinkTimer = null;
		annBlink = id;
		let phase = 0;
		const step = () => {
			phase += 1;
			if (phase >= 4) {
				annBlink = null;
				annBlinkTimer = null;
				return;
			}
			annBlink = phase % 2 === 0 ? id : null;
			annBlinkTimer = setTimeout(step, phase % 2 === 0 ? 700 : 350);
		};
		annBlinkTimer = setTimeout(step, 700);
	}

	function clearAllAnnotations(): void {
		annotations = clearAnnotations();
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		// An in-prompt edit dies with the list: hand the composer
		// back its drafted chat text instead of stranding the note.
		if (promptAnnEdit) exitPromptAnnEdit();
		// Clearing everything thumps like a delete (done): the same
		// unmistakable triple against single-tap ticks.
		void hapticBeatAsync("done", { enabled: settings.vibration, shell: tauriBackendAvailable() });
	}

	/**
	 * Badge arrays by message, memoized by content: the render effect
	 * subscribes to the array identity, so a freshly built array per
	 * render would re-run every message body on any parent change.
	 */
	const memoMarks = createRefMemo<AnnotationMark>(
		(m) => `${m.id}:${m.number}:${m.quote}:${m.at ?? 0}:${m.preview === true ? "preview" : "saved"}`
	);
	function marksFor(messageId: ChatMsgId): AnnotationMark[] {
		const saved: AnnotationMark[] = annotations
			.filter((a) => a.messageId === messageId)
			.map((a) => ({ id: a.id, number: annotationNumber(annotations, a.id), quote: a.quote, at: a.at ?? 0 }));
		// A composed-but-unsubmitted annotation washes while its pill is
		// open, but stamps no badge (badges appear on submit only).
		if (pendingAnn && pendingAnn.messageId === messageId) {
			saved.push({
				id: pendingAnn.id,
				number: annotations.length + 1,
				quote: pendingAnn.quote,
				at: pendingAnn.at ?? 0,
				preview: true
			});
		}
		return memoMarks(messageId, saved);
	}

	/** Pinned or hover-peeked model-aid text for a message (tashkeel). */
	function aidedTextFor(msg: ChatMsg): string | null {
		if (aidPeek?.id === msg.id) {
			const cached = vocalized[msg.id];
			if (cached !== undefined) return cached;
		}
		// Model and local aids compose: vocalized text shows whenever
		// the model pin is on, with pinned local kinds rendered onto it
		// (each on its own lines). The cache survives unpin for one
		// click back.
		if (aidModelPin.has(msg.id)) return vocalized[msg.id] ?? null;
		return null;
	}

	/**
	 * Local-aid overrides: pinned kinds render (each on its own lines),
	 * plus a hover-peeked kind previewed alongside them; empty renders
	 * the original (aids are per-message only). Kinds the message no
	 * longer offers (edited text) filter out instead of lingering.
	 * Offer computation lives in `offeredLocalAids` (`src/lib/reading.ts`,
	 * shared by hotkeys, render, and vocalize); the display-text rule in
	 * `aidDisplayText` beside it.
	 */
	/**
	 * Aid-kind arrays by message, memoized like the badge arrays: the
	 * body effect subscribes to the array identity, so a fresh array
	 * per parent render (any hover near an aid button) rebuilt every
	 * body and re-stamped its badges — flickering text with several
	 * marks mounted. Same content returns the same reference.
	 */
	const memoAids = createRefMemo<LocalAid>((kind) => kind);
	function localAidsOverrideFor(msg: ChatMsg): LocalAid[] {
		const kinds = offeredLocalAids(aidDisplayText(msg.content), activeReplyCode);
		const peek = aidPeek?.id === msg.id ? (aidPeek.kind ?? null) : null;
		return memoAids(msg.id, resolveAidKinds(kinds, pinnedKinds(msg.id), peek));
	}

	/**
	 * Hover in: preview the aid, but only when it is already here (cached
	 * model aid, cached furigana, kind clicked before). Pinyin never
	 * previews on hover — its swap looped show/hide forever, so it is
	 * click-to-show only. Fetching happens on click alone — hovering
	 * must never spend a model call or start furigana's dictionary load
	 * (that work now runs in a worker, but the rule stands: hover
	 * previews, click fetches). The swap lock wins over everything:
	 * right after a click the button under a stationary cursor
	 * is new, not hovered.
	 */
	function peekAid(msg: ChatMsg, aidId: string | null, kind?: LocalAid): void {
		// A live selection menu owns the highlight: hover previews swap
		// the body HTML, which collapses the selection (and strands the
		// menu) mid-slide toward Annotate. Previews resume on close.
		if (selMenu) return;
		if (aidNoPeek.has(msg.id)) return;
		if (aidId) {
			if (vocalized[msg.id] === undefined) return;
		} else {
			// Pinyin previews on click alone, never hover: after its
			// readings render, the button under a stationary cursor is
			// a new node, and hover-out/in around the swap looped
			// show/hide forever. Pinyin hovers stay color-only.
			if (kind === "pinyin") return;
			// First hover is color-only: previews start after that kind's
			// first click (pin), never a sibling kind's.
			if (kind === undefined || !aidSeen.has(aidSeenKey(msg.id, kind))) return;
			if (kind === "furigana" && !isFuriganaCached(aidDisplayText(msg.content))) {
				return;
			}
		}
		// Same preview already showing: re-assigning a fresh object
		// re-renders every body for nothing (hovering near the button
		// re-fires enter without leaving).
		const nextKind = kind ?? null;
		if (aidPeek?.id === msg.id && (aidPeek.kind ?? null) === nextKind) return;
		aidPeek = kind === undefined ? { id: msg.id } : { id: msg.id, kind };
	}

	/**
	 * Hover out: drop the preview and release the swap lock, so the next
	 * enter counts as a genuine hover.
	 */
	function unpeekAid(msg: ChatMsg): void {
		// Frozen with peek above: clearing mid-menu would swap the body
		// back and take the highlight with it.
		if (selMenu) return;
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.delete(msg.id);
	}

	/** Track a message's local-aid load without notifying on no-ops. */
	function setAidBusy(id: ChatMsgId, loading: boolean): void {
		if (loading) {
			if (!aidBusy.has(id)) aidBusy.add(id);
		} else if (aidBusy.has(id)) {
			aidBusy.delete(id);
		}
	}

	/** Click on a local-aid button: pin its kind (others stay as pinned). */
	function pinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id);
		if (!kinds.includes(kind)) aidKindPin.set(msg.id, [...kinds, kind]);
		aidPin.add(msg.id);
		// A model run still in flight must not steal the pin back when
		// it lands: the local click is the latest intent.
		pendingPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
		aidSeen.add(aidSeenKey(msg.id, kind));
	}

	/** Per-kind "show original": unpin one kind, keep the other pinned
	(and a pinned model aid showing). */
	function unpinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id).filter((pinned) => pinned !== kind);
		if (kinds.length === 0) {
			aidKindPin.delete(msg.id);
			if (!aidModelPin.has(msg.id)) aidPin.delete(msg.id);
		} else aidKindPin.set(msg.id, kinds);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Mouse users: leaving drops focus from the message's buttons, so a
	 * hover-only row hides instead of sticking on focus-within after a
	 * click. Keyboard focus never fires mouseleave, so tabbing through
	 * the row is unaffected.
	 */
	function releaseRowFocus(event: MouseEvent): void {
		const row = event.currentTarget;
		const active = document.activeElement;
		if (
			row instanceof HTMLElement &&
			active instanceof HTMLElement &&
			row.contains(active)
		) {
			active.blur();
		}
	}

	/**
	 * Pointer leaves the whole message: drop the hover index, any stale
	 * aid preview for it, and focus inside it. The aid swap remounts the
	 * body, which can move the actions row out from under a stationary
	 * cursor — then row-level mouseleave never fires, and without this
	 * the row stuck visible on :focus-within with a stale preview.
	 */
	function onArticleLeave(event: MouseEvent, msg: ChatMsg, i: number): void {
		if (hoveredIdx === i) {
			hoveredIdx = -1;
			lastHoverChangeAt = Date.now();
		}
		if (aidPeek?.id === msg.id) aidPeek = null;
		// The pointer genuinely left: release the swap lock with it.
		aidNoPeek.delete(msg.id);
		hoverBadgeId = null;
		releaseRowFocus(event);
	}

	/** Model "show original": drop the vocalized text, keep any pinned
	local kinds up on their own lines. */
	function unpinModelAid(msg: ChatMsg): void {
		aidModelPin.delete(msg.id);
		if (pinnedKinds(msg.id).length === 0) aidPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Aid load failed (furigana worker or dictionary): only the furigana
	 * conversion reports failure (pinyin renders synchronously), so drop
	 * just that kind — a pinned pinyin stays up. The last kind out
	 * releases the pin, falling back to the aid name instead of a "show
	 * original" with nothing applied. Only an explicit pin earns a toast.
	 */
	function aidFailed(id: ChatMsgId, reason?: string): void {
		const kinds = pinnedKinds(id);
		const had = kinds.includes("furigana");
		const kept = kinds.filter((kind) => kind !== "furigana");
		if (kept.length === 0) {
			aidKindPin.delete(id);
			if (!aidModelPin.has(id)) aidPin.delete(id);
		} else aidKindPin.set(id, kept);
		if (aidPeek?.id === id) aidPeek = null;
		// The reason ships in the toast: a bare failure gives nothing to
		// report back when it only reproduces on a phone.
		if (had)
			flashToast(
				reason
					? `Couldn't load the readings for this message (${reason}).`
					: "Couldn't load the readings for this message."
			);
	}

	async function runModelAidFor(msg: ChatMsg, aidId: string, pin: boolean): Promise<void> {
		if (vocalized[msg.id] !== undefined) {
			if (pin) {
				aidPin.add(msg.id);
				// Compose, never replace: pinned local kinds stay up
				// on their own lines.
				aidModelPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
			return;
		}
		if (vocalizing.has(msg.id)) {
			if (pin) pendingPin.add(msg.id);
			return;
		}
		const provider = resolveProvider();
		if (!provider) {
			const message = "Set an API key first — open Settings.";
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
			return;
		}
		clearNotice(notices, "banner");
		vocalizing.add(msg.id);
		try {
			// Multilingual messages vocalize Arabic lines only: the rest
			// never crosses to the model (faster, cheaper), and the
			// result splices back so other scripts stay byte-identical.
			// A shape mismatch falls back to the whole-text replace.
			const full = aidDisplayText(msg.content);
			const targets = aidTargetLines(full);
			const lines = full.split("\n");
			const partial = targets.length > 0 && targets.length < lines.length;
			const input = partial ? targets.map((i) => lines[i] ?? "").join("\n") : full;
			const text = await runModelAid(provider, aidId, input);
			const spliced = partial ? spliceAidResult(full, targets, text) : null;
			vocalized = { ...vocalized, [msg.id]: spliced ?? text };
			const wantPin = pin || pendingPin.has(msg.id);
			pendingPin.delete(msg.id);
			// Compose, never replace: a local pin placed mid-flight (or
			// before) keeps its kinds; the run still caches either way.
			if (wantPin) {
				aidPin.add(msg.id);
				aidModelPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showNotice(notices, "banner", message);
			if (androidUI) flashErrorToast(message);
		} finally {
			vocalizing.delete(msg.id);
		}
	}

	function resetVoice(): void {
		speakingId = null;
		speakingSelection = null;
		releaseStudyWake();
	}

	function stopVoice(): void {
		stopSpeaking();
		stopNative();
		resetVoice();
	}

	/** Paste-fold toggle: replace the message (never mutate in place). */
	function togglePasteFold(msg: ChatMsg, index: number): void {
		setPasteFold(chatState, msg.id, index, !(msg.pasteFolds?.[index]?.open ?? false));
	}

	/** The error banner clears itself like the toast: a failed read
	shouldn't lecture from the bottom of the screen forever. */
	function setVoiceError(message: string | null): void {
		if (message === null) {
			clearNotice(notices, "voice");
			return;
		}
		flashNotice(notices, "voice", message, VOICE_TIMEOUT_MS);
		if (androidUI) flashErrorToast(message);
	}

	/**
	 * Bumped when the voice inventory arrives: getVoices() returns []
	 * until the engine loads (notably slow in phone WebViews), and every
	 * speak gate reads through webVoices, so the bump re-renders them
	 * from disabled to live.
	 */
	let webVoiceVersion = $state(0);
	/** Installed web voices (best-effort: [] reads as "unknown"). */
	function webVoices(): Array<{ lang: string }> {
		// Reactive subscription to the inventory bump (never negative).
		if (webVoiceVersion < 0) return [];
		try {
			if (typeof speechSynthesis === "undefined") return [];
			return speechSynthesis.getVoices();
		} catch {
			return [];
		}
	}

	/** Speak-button state per message (a playing message always offers Stop). */
	function messageSpeakable(msg: ChatMsg): boolean {
		return speechAttemptable(
			settings.voiceEngine,
			messageSpeechLang(msg.content, latinFallback(settings.voiceLang), webVoices()),
			webVoices()
		);
	}

	function startSpeech(id: string, text: string, lang: string | ((sentence: string) => string), quiet = false): void {
		stopSpeaking();
		stopNative();
		setVoiceError(null);
		speakingId = id;
		// Study sessions: keep the screen on while the utterance plays.
		// A stale acquire resolving after stop/end releases immediately
		// instead of holding the lock (see resetVoice).
		void acquireStudyWakeLock().then((lock) => {
			if (!lock) return;
			if (speakingId === id) {
				releaseStudyWake();
				studyWakeLock = lock;
			} else {
				lock.release();
			}
		});
		const useNative = settings.voiceEngine === "native";
		const speakWeb = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function" ? speakMultilingual(text, lang, cb) : speakText(text, lang, cb);
		const speakNat = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function"
				? speakNativeMulti(text, lang, cb, settings.nativeVoiceId)
				: speakNative(text, lang, cb, settings.nativeVoiceId);
		let fellBack = false;
		const callbacks: SpeakCallbacks = {
			onEnd: resetVoice,
			onError: (message) => {
				if (useNative && !fellBack) {
					// The bridge failed: say why, then read this utterance
					// with web voices rather than leaving silence (quiet
					// background readbacks skip the notice, not the retry).
					fellBack = true;
					if (!quiet) setVoiceError(`${friendlyNativeError(message)} Falling back to web voices.`);
					const ok = speakWeb({
						onEnd: resetVoice,
						onError: (webMessage) => {
							if (!quiet) setVoiceError(webMessage);
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				if (!quiet) setVoiceError(useNative ? friendlyNativeError(message) : message);
				resetVoice();
			}
		};
		const ok = useNative ? speakNat(callbacks) : speakWeb(callbacks);
		if (!ok) {
			resetVoice();
			// An empty inventory means no TTS engine/data on the device
			// (check the OS text-to-speech settings); voices present but
			// throwing is a different fault. Say which (see
			// startSpeechError); quiet readbacks stay silent throughout.
			const banner = startSpeechError({
				quiet,
				useNative,
				inventoryEmpty: webVoices().length === 0
			});
			if (banner !== null) setVoiceError(banner);
		}
	}

	async function speakReply(msg: ChatMsg, quiet = false): Promise<void> {
		const text = speechText(msg.content);
		if (!text) return;
		const fallback = latinFallback(settings.voiceLang);
		const voices = webVoices();
		if (!speechAttemptable(settings.voiceEngine, messageSpeechLang(msg.content, fallback, voices), voices)) {
			if (!quiet) setVoiceError("No voice for this language.");
			return;
		}
		const stripped = text.replace(/```[\s\S]*?```/g, " ");
		// Whole-message voice seeds the Latin sentences; each one then
		// resolves its own language, so four languages read in four
		// voices (see sentenceLangsFor).
		const seed = await quoteLangFor(stripped, fallback);
		startSpeech(msg.id, text, await sentenceLangsFor(stripped, seed, voices), quiet);
	}

	/** Speak-button label. */
	function speakTitle(msg: ChatMsg): string {
		if (speakingId === msg.id) return "Stop reading aloud";
		return "Read this message aloud";
	}

	function maybeSpeakReply(inChat = chat): void {
		if (!chatVoiceReadback(inChat, settings.voice)) return;
		// Pinned to the chat that was sent from: completing while the
		// user looks elsewhere must not read back some other chat's
		// last message.
		const last = inChat.messages[inChat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			// Background readback stays silent throughout: no banner for
			// something the user never asked to hear, including a runtime
			// failure after an attemptable-looking voice.
			const voices = webVoices();
			if (
				!speechAttemptable(
					settings.voiceEngine,
					messageSpeechLang(last.content, latinFallback(settings.voiceLang), voices),
					voices
				)
			)
				return;
			void speakReply(last, true);
		}
	}

	/**
	 * Backgrounded long-reply ping (study sessions): when a reply
	 * finishes while the window is hidden/backgrounded, a
	 * permission-gated notification + badge carries its head. Silent
	 * when focused, silent for short replies and failures.
	 */
	function maybeNotifyReplyDone(msg: ChatMsg | undefined): void {
		if (!settings.replyNotifications) return;
		if (!msg || msg.role !== "assistant" || msg.error) return;
		const body = msg.content.trim();
		if (!body) return;
		// Shell goes native (Android WebView has no Notification ctor);
		// the async ping still fires when the reply lands backgrounded.
		void notifyReplyDoneAsync("Reply finished", body, {
			shell: tauriBackendAvailable()
		}).then((pinged) => {
			if (pinged) setStudyBadge(1);
		});
	}

	/**
	 * Effective readback for the visible chat: its own override when
	 * set, else the global default (off at every launch). Reactive —
	 * switching chats re-renders the toggle with that chat's state.
	 */
	function voiceOn(): boolean {
		return chatVoiceReadback(chat, settings.voice);
	}

	function setVoiceEnabled(on: boolean): void {
		// Per-chat setting: the toggle writes this chat's override
		// (persisted with the chats), never the global default — other
		// chats keep theirs.
		setChatVoice(chatState, chatState.activeChatId, on);
		if (!on) stopVoice();
	}

	function toggleVoice(): void {
		// Global stop, always in reach: message audio keeps playing
		// after its row fades (or the user scrolls away from it), and
		// on phones there is no other stop in view. This never flips
		// the readback setting — it only stills the current utterance.
		if (speakingId !== null) {
			stopVoice();
			return;
		}
		setVoiceEnabled(!voiceOn());
	}

	/** Raw speech-recognition errors translated into something actionable. */
	// Mic errors arrive already translated (friendlyMicError in $lib/voice,
	// mapped inside dictateOnce) — callers toast the message directly.

	/**
	 * Highlight-to-speak: only what was selected, only when asked. The quote
	 * keeps its own language (script detection, then Apple's recognizer for
	 * Latin scripts), so a French highlight gets a French voice even when
	 * the message around it is English.
	 */
	async function speakQuote(
		quote: string,
		messageId: ChatMsgId,
		keepMenu = false,
		context: string = quote
	): Promise<void> {
		// The highlight stays: hearing the quote shouldn't clear the
		// selection it came from. Touch auto-read keeps the menu too,
		// so Annotate stays one tap away after listening.
		// Route off the surrounding paragraph, not the bare quote: two
		// kanji identify nothing on their own (Han reads Chinese by
		// default), so a kanji-only highlight inside Japanese text
		// reads Japanese — the quote alone would read Chinese.
		const sentence = sentenceForQuote(context, quote);
		const probe = sentence ?? context;
		const voices = webVoices();
		const lang = effectiveSpeechLang(
			await quoteLangForContext(probe, context, latinFallback(settings.voiceLang)),
			voices
		);
		if (!speechAttemptable(settings.voiceEngine, lang, voices)) {
			selMenu = null;
			setVoiceError("No voice for this language.");
			return;
		}
		if (!keepMenu) selMenu = null;
		speakingSelection = messageId;
		// The surrounding voice seeds; each Latin sentence in the
		// highlight still resolves its own language (see
		// sentenceLangsFor), so a mixed highlight reads each part
		// correctly and a kanji-only one keeps its context voice.
		startSpeech("selection", quote, await sentenceLangsFor(quote, lang, voices));
	}

	/** Pill-mic dictation into the annotation comment box. */
	let pillDictating = $state(false);
	let stopPillDictation: (() => void) | null = null;
	function stopPillMic(): void {
		stopPillDictation?.();
		stopPillDictation = null;
		pillDictating = false;
	}
	/**
	 * Native-first dictation: the OS recognizer where one exists
	 * (Android/macOS/Windows shell), web SpeechRecognition otherwise.
	 * Resolves a stop function, or null when neither path can listen
	 * (the caller toasts). Native hard errors (denied, busy) surface
	 * directly and skip the web attempt.
	 */
	let micStarting = false;
	async function dictateNativeFirst(
		onResult: (transcript: string) => void,
		onError: (message: string) => void
	): Promise<(() => void) | null> {
		micStarting = true;
		try {
			const outcome = await startNativeDictation(latinFallback(settings.voiceLang), {
				onFinal: onResult,
				onError
			});
			if (outcome.kind === "started") return outcome.stop;
			if (outcome.kind === "error") {
				onError(outcome.message);
				return null;
			}
		} catch {
			// Bridge blew up mid-start; the web path gets its chance below.
		} finally {
			micStarting = false;
		}
		return dictateOnce(latinFallback(settings.voiceLang), onResult, onError);
	}
	async function togglePillMic(): Promise<void> {
		if (micStarting) return;
		if (stopPillDictation) {
			stopPillMic();
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				annDraft =
					annDraft === "" || annDraft.endsWith(" ") ? annDraft + transcript : `${annDraft} ${transcript}`;
				stopPillMic();
			},
			(message) => {
				flashErrorToast(message);
				stopPillMic();
			}
		);
		if (!stop) {
			flashErrorToast("Mic input not available in this browser.");
			return;
		}
		stopPillDictation = stop;
		pillDictating = true;
	}

	async function toggleMic(): Promise<void> {
		if (micStarting) return;
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				editor?.insertText(transcript.endsWith(" ") ? transcript : `${transcript} `);
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				flashErrorToast(message);
				dictating = false;
				stopDictation = null;
			}
		);
		if (!stop) {
			flashErrorToast("Mic input not available in this browser.");
			return;
		}
		stopDictation = stop;
		dictating = true;
	}

	/**
	 * Immediate settings save. Keys mirror to secret storage first, then
	 * the shell persists blanks (the browser keeps working as before).
	 * Every save path must use this: a bare saveSettings(settings) would
	 * write live in-memory keys to disk next to the Keychain copy.
	 */
	function saveSettingsNow(source?: AppSettings): void {
		const snapshot = source ?? $state.snapshot(settings);
		void (async () => {
			await persistSecrets(snapshot);
			saveSettings(tauriBackendAvailable() ? withBlankedKeys(snapshot) : snapshot);
		})();
	}

	function persistSettings() {
		saveSettingsNow();
	}

	/**
	 * Offline fallback parking: the drop parks a cloud provider on the
	 * on-device Gemma option; the reconnect restores only what the drop
	 * parked. Not rendered state — the provider switch re-renders itself.
	 */
	let offlineParkedFrom: ProviderId | null = null;

	function handleOffline(): void {
		const target = offlineTarget(settings.activeProviderId);
		if (!target) return;
		offlineParkedFrom = settings.activeProviderId;
		settings.activeProviderId = target;
		persistSettings();
	}

	function handleOnline(): void {
		const restore = onlineRestore(offlineParkedFrom, settings.activeProviderId);
		offlineParkedFrom = null;
		if (!restore) return;
		settings.activeProviderId = restore;
		persistSettings();
	}

	function resolveProvider(): ChatProvider | null {
		if (useMock) return new MockProvider();
		const conf = settings.providers[settings.activeProviderId];
		// Keyless on-device endpoints carry no key by design.
		const keyless =
			getProviderDef(settings.activeProviderId, settings.customProviders).keyless === true;
		if (!keyless && !conf?.apiKey.trim()) return null;
		if (!conf) return null;
		return createProvider(settings.activeProviderId, conf, settings.customProviders);
	}

	async function doSend() {
		// Mobile in-prompt note edit owns the send arrow: file the
		// comment instead of sending a chat (see commitPromptAnnEdit).
		if (promptAnnEdit) {
			commitPromptAnnEdit();
			return;
		}
		// First step lives in sendAction (pinned in submit.test.ts);
		// the preamble and both continuations stay here as effects.
		const action = sendAction({ canSubmit, editing: editingMsgId !== null });
		if (action === "ignore") return;
		// Haptic tap on send (silenced by the vibration setting; native
		// haptics in the shell, Web vibrator in the preview).
		void hapticBeatAsync("send", { enabled: settings.vibration, shell: tauriBackendAvailable() });
		clearStudyBadge();
		// Permission-gated background ping: ask from the send gesture
		// while the window is focused, so a later backgrounded long
		// reply may notify. Shell goes through the notification plugin
		// (the only channel in the Android WebView); web asks the
		// Notification ctor. No-op unless undecided — and never asked
		// when the ping itself is off.
		if (settings.replyNotifications) {
			void ensureReplyNotificationPermissionAsync({ shell: tauriBackendAvailable() });
		}
		if (action === "commit-edit") {
			// Saving an edit rewrites the message in place, never
			// resends — and the composer text below still sends as a
			// fresh message. If the edited message vanished mid-edit,
			// reset the placeholder, then send fresh either way.
			if (!commitMessageEdit()) editor?.setPlaceholder(promptPlaceholder());
		}
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		stopVoice();
		// Paste folds ride the send: same text composerText would give,
		// plus collapsed-paste spans mapped into it (covers image-marker
		// stripping and trim exactly — see sendPasteFolds).
		const { text, folds } = sendPasteFolds(editor?.getText() ?? "", editor?.getPastes() ?? []);
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in. The annotation pill
		// and count go with it: the block is already baked into the sent
		// message, so nothing waits on the reply. Attachment pills clear
		// with it (`outgoing` already captured them for the send).
		editor?.clear();
		attachments = [];
		annotations = [];
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		// Origin chat object (stable by reference): the post-send reads
		// below must not follow a chat switch mid-stream.
		const sentFrom = chat;
		// sendMessage appends the user message (plus the thinking
		// placeholder) synchronously; the scroll waits a tick for the
		// render, or it measures the old height and lands short.
		const sending = sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings, activeReplyCode),
			withAnnotations(text, outgoingAnnotations),
			{
				attachments: outgoing,
				thinking: activeThinkingId(settings),
				pasteFolds: folds,
				// Haptic rumble as the reply starts arriving — only while
				// its chat is still open. A mid-stream switch must not
				// rumble the new chat for the old one's reply.
				onFirstToken: () => {
					if (chat.id !== sentFrom.id) return;
					void hapticBeatAsync("first", { enabled: settings.vibration, shell: tauriBackendAvailable() });
				}
			}
		);
		scrollAfterRender();
		await sending;
		// Keep drafts when the reply failed so nothing silently drops.
		const { sent, stillHere } = resolveSendCompletion(chatState, sentFrom.id, chat.id);
		if (sent?.role === "assistant" && !sent.error) {
			// Same-chat only: the new chat must not thump for the old
			// one's reply (a genuinely missed finish is the background
			// ping's job) — and every reset below touches live component
			// state, which now belongs to the ACTIVE chat. After a
			// switch that is the new chat's staged files, draft notes,
			// and open review: clearing would eat in-progress work
			// there. The origin's baked state already rode the send.
			if (stillHere) {
				void hapticBeatAsync("done", { enabled: settings.vibration, shell: tauriBackendAvailable() });
				attachments = [];
				annotations = [];
				pendingAnn = null;
				reviewOpen = false;
				editingId = null;
				highlightAnnId = null;
				settleAnnPop();
				annPop = null;
			}
		}
		// Follow the stream only while its chat is open: after a switch
		// the new chat keeps its own scroll position.
		if (stillHere) scrollToBottom();
		maybeSpeakReply(sentFrom);
		maybeNotifyReplyDone(sent);
		// The reply's layout churn (hero unmount, list growth, keyboard
		// transitions on phones) can strand the emptied composer's cached
		// line boxes at zero height: settle a re-measure after paint, like
		// the mount path does, so it holds one line without a keystroke.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	async function resend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		stopVoice();
		// A resend is a send too: same tap, rumble, and thump as doSend.
		void hapticBeatAsync("send", { enabled: settings.vibration, shell: tauriBackendAvailable() });
		const resentFrom = chat;
		await resendLast(chatState, provider, effectiveSystemPrompt(settings, activeReplyCode), {
			thinking: activeThinkingId(settings),
			onFirstToken: () => {
				if (chat.id !== resentFrom.id) return;
				void hapticBeatAsync("first", { enabled: settings.vibration, shell: tauriBackendAvailable() });
			}
		});
		// Same origin-chat discipline as a fresh send (see
		// resolveSendCompletion): the live `chat` may point at a new
		// thread by now.
		const { sent: resent, stillHere: resentHere } = resolveSendCompletion(chatState, resentFrom.id, chat.id);
		if (resent?.role === "assistant" && !resent.error) {
			// Same-chat only: a new thread never thumps for the old
			// one's reply (see the fresh-send twin above).
			if (resentHere) {
				void hapticBeatAsync("done", { enabled: settings.vibration, shell: tauriBackendAvailable() });
			}
		}
		// Same stillHere discipline as a fresh send: the scroller
		// belongs to whoever is open now.
		if (resentHere) scrollToBottom();
		maybeSpeakReply(resentFrom);
		maybeNotifyReplyDone(resent);
		// Same settle as a fresh send: the reply's layout churn can
		// strand the composer's cached line boxes at zero height.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	/** The tall composer dwarfs a one-line draft: taps on its empty
	floor focus the editor instead of dying on the container. Buttons,
	fields, and the annotation review keep their own clicks. */
	function focusPromptFloor(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest("button, input, textarea, select, a, .ann-wrap")) return;
		editor?.focus();
	}

	function onSubmit(kind: SubmitKind) {
		// Guards live in submitAction (guard order pinned in
		// submit.test.ts); the always-hide blur and both bodies stay
		// here as effects.
		const action = submitAction({
			annPopOpen: annPop !== null && !annPopClosing,
			canSubmit,
			sendGuardTripped: Date.now() < sendGuardUntil,
			kind
		});
		if (action === "ignore") return;
		// Always-hide mode: sending yields focus, so the prompt hides
		// behind the reply (the focusout below does the hiding; this
		// just drops the caret).
		if (settings.promptIdleSec === PROMPT_IDLE_ALWAYS) editor?.blur();
		if (action === "stage") {
			// ⌥+Enter: most recent message, no reply; the next submit
			// carries the full history in order.
			stageMessage(chatState, composerText(), attachments);
			attachments = [];
			editor?.clear();
			scrollAfterRender();
			return;
		}
		void doSend();
	}

	function retryFailed() {
		dismissFailedAssistant(chatState);
		void resend();
	}

	function rerunFrom(index: number) {
		truncateToMessage(chatState, index);
		void resend();
	}

	/**
	 * Pencil (or E) on an own message: open it for in-place editing
	 * where it sits (a second press toggles back off). The baked
	 * annotation block is provider context, not edit text, so only the
	 * prose seeds the editor; its refs come back as pending annotations
	 * so saving re-bakes the same context. Attachments ride along on
	 * their own state — the composer's draft stays untouched. No-op
	 * mid-send.
	 */
	function editMessage(index: number) {
		// Target gates live in editMessageAction (pinned in
		// submit.test.ts); refs seeding and the edit effects stay here.
		const editAction = editMessageAction(chat.messages, index, {
			sending: chatState.sending,
			editingId: editingMsgId
		});
		if (editAction === "ignore-sending" || editAction === "ignore-not-user") return;
		if (editAction === "toggle-off") {
			cancelMessageEdit();
			return;
		}
		const msg = chat.messages[index];
		if (!msg) return;
		const refs = annRefsFor(msg.content);
		annotations = refs
			? refs.refs.map((r) => ({
					id: newAnnotationId(),
					messageId: msg.id,
					quote: r.quote,
					comment: r.comment
				}))
			: [];
		editingAttachments = msg.attachments ? [...msg.attachments] : [];
		// Message content carries no stripped markers on save, so the
		// seed keeps its marker lines: recount instead of reconciling,
		// or the message's own image attachments would drop as
		// "deleted tags".
		editingSeed = refs ? refs.text : msg.content;
		editingPrevMarkers = countMarkers(editingSeed);
		editingPrevFileMarkers = countMarkers(editingSeed, FILE_MARKER);
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		editingMsgId = msg.id;
		// The edit action focuses on mount; keep the message on screen
		// without yanking it (the composer-at-bottom jump is gone).
		requestAnimationFrame(() =>
			document.getElementById(`msg-${index}`)?.scrollIntoView({ block: "nearest" })
		);
	}

	/**
	 * Inline-edit-only reset: drops the edit (annotations, attachments,
	 * edit id) while leaving the composer's own draft exactly alone.
	 */
	function resetInlineEdit(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editingAttachments = [];
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
	}

	/** Esc during an edit: drop the draft, keep history untouched. */
	function cancelMessageEdit(): void {
		resetInlineEdit();
	}

	/**
	 * Rewrite the edited message in place (text plus re-baked
	 * annotations, attachments, folds). Reads the in-place editor when
	 * it is mounted, so a send from the composer mid-edit still saves
	 * the message text rather than the composer draft.
	 */
	function saveMessageEdit(): void {
		const id = editingMsgId;
		if (id) {
			const src = msgEditor ?? editor;
			const { text, folds } = sendPasteFolds(src?.getText() ?? "", src?.getPastes() ?? []);
			editMessageContent(chatState, id, withAnnotations(text, annotations), {
				attachments: editingAttachments,
				pasteFolds: folds
			});
		}
		resetInlineEdit();
	}

	/**
	 * Enter in the in-place editor (or send from the composer mid-edit):
	 * save the message in place, never resend — later messages stay
	 * exactly as they were. Returns false when the edited message
	 * vanished — the caller then falls through to a fresh send.
	 */
	function commitMessageEdit(): boolean {
		// Target resolution lives in commitEditTarget (pinned in
		// submit.test.ts); the save stays here.
		const index = commitEditTarget(chat.messages, editingMsgId);
		if (index === null) {
			resetInlineEdit();
			return false;
		}
		saveMessageEdit();
		return true;
	}

	/** Pasted image while in-place editing: joins the edit's attachments. */
	function onInlineImagePasted(file: File): void {
		if (!editingMsgId) return;
		void fileToAttachment(file)
			.then((att) => {
				if (!editingMsgId) return;
				editingAttachments = [...editingAttachments, att];
				insertInlineImageMarkers(1);
			})
			.catch((error: unknown) => {
				failAttach(error instanceof Error ? error.message : String(error));
			});
	}

	/** One `[Pasted image]` tag per fresh image, caret after each tag's space. */
	function insertInlineImageMarkers(count: number): void {
		if (!msgEditor || count <= 0) return;
		editingMarkerMuted = true;
		try {
			for (let i = 0; i < count; i++) {
				msgEditor.insertText(imageMarkerInsert(msgEditor.getText()));
			}
			editingPrevMarkers = countMarkers(msgEditor.getText());
		} finally {
			editingMarkerMuted = false;
		}
	}

	/**
	 * Options for the in-place editor: the composer keymap (Enter sends,
	 * Alt+Enter stages, Ctrl+G hops out, Shift+Enter stays fence-aware)
	 * rebound to the edit — Enter and Alt+Enter both save the message
	 * in place, never resending. Markdown highlighting stays on so code
	 * keeps its colors while editing.
	 */
	function inlineOptions(): PromptEditorOptions {
		return {
			initialDoc: editingSeed,
			onSubmit: () => {
				commitMessageEdit();
			},
			onHopOut: () => {
				msgEditor?.blur();
				enterScrollMode();
			},
			onImagePaste: onInlineImagePasted,
			onCopyImageTags: (count) => copyImageTagBlobs(editingAttachments, count),
			onDocChange: (text) => {
				// Tag → attachment half of two-way removal, mirrored
				// from the composer: deleting tags by hand drops the
				// newest attachments of that kind first.
				if (editingMarkerMuted) return;
				const imagesNow = countMarkers(text);
				const filesNow = countMarkers(text, FILE_MARKER);
				if (imagesNow < editingPrevMarkers || filesNow < editingPrevFileMarkers) {
					let kept = dropNewestAttachments(editingAttachments, "image", editingPrevMarkers - imagesNow);
					kept = dropNewestAttachments(kept, "text", editingPrevFileMarkers - filesNow);
					editingAttachments = kept;
					// Attachment-scoped errors die with the attachment.
					clearNotice(notices, "inline");
				}
				editingPrevMarkers = imagesNow;
				editingPrevFileMarkers = filesNow;
			}
		};
	}

	/**
	 * Svelte action mounting the in-place editor inside the message.
	 * Android gets the plain textarea (same WebView measurement reason
	 * as the composer); desktop gets CodeMirror with markdown colors.
	 */
	function msgEditAction(node: HTMLElement): { destroy(): void } {
		msgEditor = androidUI
			? createTextareaEditor(node, inlineOptions())
			: createPromptEditor(node, inlineOptions());
		msgEditor.setPlaceholder("");
		msgEditor.focus();
		return {
			destroy() {
				msgEditor?.destroy();
				msgEditor = null;
			}
		};
	}

	/** Held finger freezes auto-scroll: cancel the in-flight smooth
	scroll in place; stream growth queues nothing mid-hold. */
	function freezeScroll(): void {
		viewport.holding = true;
		const box = scrollBox;
		if (box) box.scrollTo({ top: box.scrollTop, behavior: "instant" });
	}
	/** Finger up: stay exactly where held (re-derive stick from the
	real position, so a later stream can't yank from stale state). */
	function releaseScroll(): void {
		viewport.holding = false;
		if (scrollBox) viewport.stick = nearBottom(scrollBox);
	}
	function scrollToBottom() {
		viewport.stick = true;
		// Resisted at submit: a held finger means stay, not scroll.
		if (viewport.holding) return;
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	/**
	 * Scroll after just-appended content renders: measuring in the same
	 * tick reads the pre-append height and strands the new message below
	 * the viewport (the send landed short on phones). tick() flushes the
	 * append first, so the scroll sees the message — and the thinking
	 * placeholder appended with it.
	 */
	function scrollAfterRender(): void {
		void tick().then(() => scrollToBottom());
	}
	/** Stream-follow: while a reply streams into the visible chat, stay
	pinned to the newest token — but only while stuck. Instant, never
	queued behind the submit smooth-scroll. */
	$effect(() => {
		const sending = chatState.sending;
		const msgs = viewChat.messages;
		const last = msgs[msgs.length - 1];
		const len = sending && last?.role === "assistant" ? last.content.length : 0;
		if (len <= viewport.lastStreamLen) {
			viewport.lastStreamLen = len;
			return;
		}
		viewport.lastStreamLen = len;
		const box = scrollBox;
		if (viewport.stick && !viewport.holding && box)
			box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
	});

	function jumpTo(index: number) {
		selectedIdx = index;
		document.getElementById(`msg-${index}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
	}

	/**
	 * Ctrl+G with the prompt unfocused: enter scroll mode with the cursor
	 * on the current message in view (topmost visible), so j/k/gg/G walk
	 * from where the user is looking instead of the newest message.
	 */
	function scrollToViewCursor(): void {
		// Detached entry: a later Ctrl+G stays out of the prompt (a
		// stale prompt-entry must not hop back).
		scrollFromPrompt = false;
		enterScrollMode();
		const messages = chat.messages;
		if (messages.length === 0) return;
		const viewport = scrollBox?.getBoundingClientRect();
		const top = viewport?.top ?? 0;
		const bottom = viewport?.bottom ?? window.innerHeight;
		// The message crossing a line a few lines below the viewport
		// top — a bottom sliver of the message above never wins, and a
		// taller-than-viewport message still matches by coverage.
		const line = top + Math.min(160, (bottom - top) * 0.25);
		for (let i = 0; i < messages.length; i++) {
			const el = document.getElementById(`msg-${i}`);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (r.bottom > line && r.top < bottom) {
				selectedIdx = i;
				el.focus({ preventScroll: true });
				return;
			}
		}
		selectedIdx = messages.length - 1;
	}

	/**
	 * Index of the rendered message in the middle of the screen (the
	 * m/n pick): viewport-center line through the message rects, -1
	 * with no messages on screen. Missing nodes are skipped, so the
	 * measured array re-aligns to rendered indexes before picking.
	 */
	function centerMessageIndex(): number {
		const box = scrollBox;
		if (!box) return -1;
		const rect = box.getBoundingClientRect();
		const line = rect.top + rect.height / 2;
		const items: { index: number; top: number; bottom: number }[] = [];
		for (let i = 0; i < viewChat.messages.length; i++) {
			const el = document.getElementById(`msg-${i}`);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			items.push({ index: i, top: r.top, bottom: r.bottom });
		}
		const at = indexAtViewportLine(
			items.map((item) => ({ top: item.top, bottom: item.bottom })),
			line
		);
		return at < 0 ? -1 : (items[at]?.index ?? -1);
	}

	function enterScrollMode() {
		focusMode = "scroll";
		// The prompt goes fully dormant: no caret, a hop-back hint, and
		// no typing — keystrokes land on the window, where scroll mode
		// owns the J/K keys and ignores the rest.
		editor?.blur();
		editor?.setPlaceholder(scrollPlaceholder());
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusLog("enter-edit-mode", { from: focusMode, active: describeActiveElement() });
		focusMode = "edit";
		editor?.setPlaceholder(promptPlaceholder());
		// A fresh editing context always shows the prompt: a minted
		// chat (or any landing here) must never inherit a hidden bar.
		restorePrompt();
		editor?.focus();
		// The visible flip (including its visibility ramp) lands async:
		// arriving from a hidden or parked composer, the sync focus
		// above hits a hidden node and no-ops. Retry on frames until
		// the composer is truly focusable, unless focus has since moved
		// somewhere meaningful (a message, modal, or field).
		void tick().then(() => {
			let frames = 0;
			const land = (): void => {
				const active = document.activeElement;
				// A closing sidebar's row is not a settled home: entering
				// from the list focuses the composer only after the
				// collapse drops that row, so keep retrying through it.
				const settled =
					active && active !== document.body && !(settings.sidebarCollapsed && active.closest("aside"));
				if (settled) return;
				const node = document.querySelector<HTMLElement>(".prompt .cm-content");
				if (node && getComputedStyle(node).visibility !== "hidden") {
					editor?.focus();
					// A parked-composer focus no-ops silently: only stop
					// when the caret actually landed.
					const landed = closestFromTarget(
						document.activeElement,
						".prompt .cm-content"
					);
					if (landed) return;
				}
				if (++frames < 60) requestAnimationFrame(land);
			};
			requestAnimationFrame(land);
		});
	}

	/**
	 * Leave scroll mode without touching the prompt: for entries from
	 * a deactivated prompt, Ctrl+G and Esc step back out to the same
	 * deactivated state (nothing selected, no focus stolen).
	 */
	function exitScrollMode(): void {
		focusLog("exit-scroll-mode", { from: focusMode, active: describeActiveElement() });
		focusMode = "edit";
		selectedIdx = -1;
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	}

	/**
	 * Unselected-state chat scrolling (desktop, nothing selected):
	 * smooth line/half-page steps and top/bottom jumps. The hovered
	 * message edge (z/Z) measures in viewport space, like the
	 * double-tap path above.
	 */
	function scrollChatBy(dy: number): void {
		scrollBox?.scrollBy({ top: dy, behavior: "smooth" });
	}
	/**
	 * Start a frame-paced glide: pixels accrue per rAF tick from the first
	 * frame, so holding never fires the cancel-and-restart stutter that
	 * per-keydown smooth scrollBy calls produce under key repeat.
	 */
	function startScrollHold(key: string, velocity: number, tapDy?: number): void {
		stopScrollHold();
		if (!scrollBox) return;
		// The .messages column eases programmatic jumps (scroll-behavior:
		// smooth); per-frame glide sets need instant application, or the
		// box chases a moving target and lags several-fold behind.
		scrollBox.style.scrollBehavior = "auto";
		// Generation check, not identity: the tick closes over the raw
		// hold while reads come back proxied, so only a primitive
		// distinguishes a superseded glide (see ViewportState.holdSeq).
		viewport.holdSeq += 1;
		const seq = viewport.holdSeq;
		viewport.hold = {
			key,
			velocity,
			tapDy: tapDy ?? Math.sign(velocity) * SCROLLKEY_LINE_PX,
			downAt: Date.now(),
			lastT: performance.now(),
			raf: 0
		};
		const tick = (t: number) => {
			const hold = viewport.hold;
			if (!hold || viewport.holdSeq !== seq || !scrollBox) return;
			scrollBox.scrollTop = stepScrollTop(scrollBox.scrollTop, hold.velocity, t - hold.lastT);
			hold.lastT = t;
			hold.raf = requestAnimationFrame(tick);
		};
		const first = viewport.hold;
		if (first) first.raf = requestAnimationFrame(tick);
	}
	/** Release a held key: quick taps land one discrete step, holds just stop. */
	function releaseScrollHold(event: KeyboardEvent): void {
		const hold = viewport.hold;
		if (!hold || event.key.toLowerCase() !== hold.key.toLowerCase()) return;
		cancelAnimationFrame(hold.raf);
		viewport.hold = null;
		scrollBox?.style.removeProperty("scroll-behavior");
		// A tap lands the hold's own step: one line for j/k, the skip
		// step for d/u (the shared scroll effect eases it — never a
		// jump). Holds just stop.
		if (holdIsTap(hold.downAt, Date.now()) && scrollBox) {
			scrollChatBy(hold.tapDy);
		}
	}
	function stopScrollHold(): void {
		if (viewport.hold) cancelAnimationFrame(viewport.hold.raf);
		viewport.hold = null;
		scrollBox?.style.removeProperty("scroll-behavior");
	}
	function scrollChatTop(): void {
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
	}
	function scrollChatBottom(): void {
		if (scrollBox) scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	function scrollHoveredEdge(edge: "start" | "end"): void {
		const el = document.getElementById(`msg-${hoveredIdx}`);
		const box = scrollBox;
		if (!el || !box) return;
		const boxRect = box.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		// The floating card covers the box bottom: landing the message
		// end there slides it (buttons included — the row lives in the
		// article) underneath. Reserve the card plus a gap instead.
		const card = document.querySelector<HTMLElement>("main .prompt");
		const bottomReserve =
			edge === "end" && card ? Math.ceil(card.getBoundingClientRect().height) + 8 : 0;
		box.scrollTo({
			top: messageEdgeScrollTop({
				scrollTop: box.scrollTop,
				boxTop: boxRect.top,
				elTop: elRect.top,
				elHeight: elRect.height,
				viewH: box.clientHeight,
				edge,
				bottomReserve
			}),
			behavior: "smooth"
		});
	}
	/**
	 * Fullscreen exit for a HELD Escape (timer threshold in
	 * scrollkeys.ts). Device-only path: the Tauri window fullscreen
	 * (menu/green light) and the browser Fullscreen API both need a
	 * real window — unit tests pin only the hold threshold, and this
	 * is unverified on device (no playwright coverage for window
	 * chrome). Failures fall through silently: there is simply no
	 * fullscreen to exit.
	 */
	/**
	 * Fullscreen toggle (Cmd+E, Ctrl+Cmd+F): Tauri window chrome when
	 * shelled, the web Fullscreen API in a browser. The shell path
	 * needs core:window:allow-is-fullscreen + allow-set-fullscreen in
	 * the capability list; when both paths fail, say so instead of
	 * dying silent (a trimmed capability list once made both chords
	 * do nothing with zero feedback).
	 */
	async function toggleFullscreen(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				const win = getCurrentWindow();
				await win.setFullscreen(!(await win.isFullscreen()));
				return;
			}
		} catch {
			// Fall through to the web Fullscreen API.
		}
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			flashErrorToast("Fullscreen unavailable");
		}
	}
	/** Fullscreen exits: a 2s Escape hold or the Esc+f chord (a tap never exits). */
	async function exitFullscreen(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				const win = getCurrentWindow();
				if (await win.isFullscreen()) await win.setFullscreen(false);
				return;
			}
		} catch {
			// Fall through to the web Fullscreen API.
		}
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
		} catch {
			// Nothing fullscreen to exit.
		}
	}
	/**
	 * Summon toggle, in-app half (Cmd/Ctrl+Shift+Space outside the
	 * editor): hide the window back to the previous app, mirroring
	 * the OS-global half in `desktop.rs` (both fire on one press;
	 * hide is idempotent so they never fight). The browser preview
	 * has no window to hide, so it keeps the old focus-composer
	 * behavior there.
	 */
	async function hideSummonWindow(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				await getCurrentWindow().hide();
				return;
			}
		} catch {
			// Fall through to focusing the composer.
		}
		enterEditMode();
	}

	function cycleProvider(direction: 1 | -1) {
		const ids = listProviders(settings.customProviders).map((p) => p.id);
		const next = (ids.indexOf(settings.activeProviderId) + direction + ids.length) % ids.length;
		const id = ids[next];
		if (id === undefined) return;
		settings.activeProviderId = id;
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		const support = activeThinkingSupport(settings);
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: cycleThinkingId(support, activeThinkingId(settings), direction)
		};
		persistSettings();
	}

	/**
	 * Voice follow for per-chat pills. appliedPill is the code whose voice
	 * is currently installed; pillBaseVoice is the locale from before it.
	 * Switching chats releases the old pill (restoring the base unless the
	 * user picked their own meanwhile) and installs the new one.
	 */
	let appliedPill: string | null = null;
	let pillBaseVoice: string | null = null;
	$effect(() => {
		const current =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		const code = current?.replyLang ?? null;
		if (code === appliedPill) return;
		const old = appliedPill ? replyLanguageFor(appliedPill) : null;
		if (old && pillBaseVoice !== null && settings.voiceLang === old.voice) {
			settings.voiceLang = pillBaseVoice;
			// The restored value regains its standing, deliberate or not.
			settings.voiceLangPinned = true;
			persistSettings();
		}
		appliedPill = null;
		if (!code) return;
		const lang = replyLanguageFor(code);
		if (!lang) return;
		pillBaseVoice = settings.voiceLang;
		appliedPill = code;
		settings.voiceLang = lang.voice;
		// The pill owns the voice from here, unpinned: a launch without
		// the pill falls back to the system default, while the persisted
		// pill reinstalls its override on launch.
		settings.voiceLangPinned = false;
		persistSettings();
	});

	/** Pill lives on the active chat; the voice-follow effect above
	installs its voice. Unknown codes never reach the field. */
	function setReplyLang(code: string): void {
		if (!replyLanguageFor(code)) return;
		setChatReplyLang(chatState, chatState.activeChatId, code);
		openLangMenu = null;
	}

	function clearReplyLang(): void {
		setChatReplyLang(chatState, chatState.activeChatId, null);
		openLangMenu = null;
	}

	/**
	 * Reset the voice language to the checked keyboard input source
	 * (⇧⌘Delete's second half). Anything unknown — no source id (the
	 * bridge is down in browser preview) or an unrecognized layout —
	 * stays silent and leaves the language untouched: routine chat
	 * deletions must never toast.
	 */
	async function resetVoiceLangFromKeyboard(): Promise<void> {
		const sourceId = await currentKeyboardInputSource();
		if (!sourceId) return;
		const locale = voiceLocaleForInputSource(sourceId);
		if (!locale) return;
		settings.voiceLang = locale;
		persistSettings();
	}

	/**
	 * Drop one chat. The voice language follows the checked keyboard only
	 * when nothing with a language is left (a single blank chat remains).
	 */
	function dropChat(id: ChatId): void {
		// Deletes thump triple (done): unmistakable against the single
		// ticks of opens and folds. Every delete path shares it — row ×,
		// gestures, keyboard — so call sites carry no haptic of their own.
		if (androidUI) {
			void hapticBeatAsync("done", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		stopVoice();
		if (id === chatState.activeChatId) {
			// Dropping the open chat discards its drafts (stored entry
			// pruned via the empty save), then the neighbor that slides
			// into its place restores its own filed drafts — and its
			// filed scroll position, via the switch effect.
			saveChatScroll();
			saveDraftAnnotations(
				id,
				[],
				chatState.chats.map((c) => c.id).filter((c) => c !== id)
			);
			resetDraftExtras();
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			annotations = loadDraftAnnotations(chatState.activeChatId);
			restoreChatScroll(chatState.activeChatId);
		} else {
			// Dropping a background chat must not touch the open
			// composer's in-memory drafts or attachments: only prune the
			// deleted id out of storage.
			deleteChat(chatState, id);
			chatScrollTops.delete(id);
			saveDraftAnnotations(
				chatState.activeChatId,
				annotations,
				chatState.chats.map((c) => c.id)
			);
		}
		if (chatState.chats.length === 1 && chatState.chats[0]?.messages.length === 0) {
			void resetVoiceLangFromKeyboard();
		}
	}

	/** Drop every chat, then reset the voice language to the keyboard. */
	function dropAllChats(): void {
		// Same triple thump as a single delete. Call sites carry no
		// haptic of their own.
		if (androidUI) {
			void hapticBeatAsync("done", {
				enabled: settings.vibration,
				shell: tauriBackendAvailable()
			});
		}
		stopVoice();
		resetDraftExtras();
		chatScrollTops.clear();
		deleteAllChats(chatState);
		// Every filed draft died with its chat: prune the whole record
		// so the fresh blank starts clean even in storage.
		saveDraftAnnotations(chatState.activeChatId, [], [chatState.activeChatId]);
		void resetVoiceLangFromKeyboard();
	}

	/** Sidebar hover tip: message count plus the you/assistant split
	(in-memory only — drafts live per-chat in storage, so counting
	them here would read localStorage on every row render). */
	function sideTip(item: (typeof chatState.chats)[number]): string {
		const n = item.messages.length;
		const you = item.messages.filter((m) => m.role === "user").length;
		const msgs = n === 1 ? "1 message" : `${n} messages`;
		if (n === 0) return msgs;
		return `${msgs} · you ${you} · assistant ${n - you}`;
	}

	function chatLabel(createdAt: number): string {
		const date = new Date(createdAt);
		const today = new Date();
		const sameDay = date.toDateString() === today.toDateString();
		// 2-digit hour keeps the list column aligned (01:30, never 1:30).
		const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		const day = sameDay ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" });
		return `${day} ${time}`;
	}

	function promptOptions(): PromptEditorOptions {
		return {
			onSubmit,
			onHopOut: () => {
				scrollFromPrompt = true;
				enterScrollMode();
			},
			onImagePaste: onImagePasted,
			onCopyImageTags: (count) => copyImageTagBlobs(attachments, count),
			onDocChange: (text) => {
				hasText = text.trim().length > 0;
				// Tag → attachment half of two-way removal: the user
				// deleted tags by hand, so the newest attachments of
				// that kind go with them (newest first — pastes stack
				// in order).
				if (markerSyncMuted) return;
				const imagesNow = countMarkers(text);
				const filesNow = countMarkers(text, FILE_MARKER);
				if (imagesNow < prevMarkerCount || filesNow < prevFileMarkerCount) {
					let kept = dropNewestAttachments(attachments, "image", prevMarkerCount - imagesNow);
					kept = dropNewestAttachments(kept, "text", prevFileMarkerCount - filesNow);
					attachments = kept;
					// Attachment-scoped errors die with the attachment —
					// otherwise the red line dangles over the next draft
					// with nothing left to explain.
					clearNotice(notices, "inline");
				}
				prevMarkerCount = imagesNow;
				prevFileMarkerCount = filesNow;
			}
		};
	}

	/**
	 * Fallback window drag: with the native titlebar gone, empty header
	 * space (and the sidebar head) starts a native move. Controls keep
	 * their clicks (buttons and fields are excluded); the browser preview
	 * early-returns. Needs the `core:window:allow-start-dragging`
	 * capability — without it the invoke is denied and the window sits
	 * immovable with no visible error.
	 */
	/** A drag denial already explained itself; don't toast on every grab. */
	let dragWarned = false;
	function dragWindow(event: MouseEvent): void {
		if (event.button !== 0 || !tauriBackendAvailable()) return;
		// The second press of a double-click zooms instead of dragging.
		if (event.detail > 1) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a, .selectable")
		) {
			return;
		}
		// The startDragging call stays synchronous in the mousedown dispatch —
		// awaiting first would leave the native drag gesture.
		let drag: Promise<void>;
		try {
			drag = getCurrentWindow().startDragging();
		} catch (error) {
			drag = Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
		drag.catch((error: unknown) => {
			// A denial here once meant a silently immovable window (the
			// capability missed `core:window:allow-start-dragging`). Never
			// silent again: log always, toast once per session.
			const message = error instanceof Error ? error.message : String(error);
			console.warn("Window drag failed:", message);
			if (!dragWarned) {
				dragWarned = true;
				flashToast(`Window drag failed: ${message}`);
			}
		});
	}

	/**
	 * Native menu bar clicks (desktop shell only): the Rust side emits
	 * `menu-action` with the item id. The frontend keeps its own key
	 * handlers for the browser runtime, where no menu exists — and on
	 * macOS the menu consumes its accelerators before the webview ever
	 * sees them, so the two paths don't double-fire.
	 */
	async function listenMenuActions(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listen<string>("menu-action", (event) => {
				const action = event.payload;
				if (action === "settings") {
					toggleSettingsPanel();
					if (!settingsOpen) pulseCursor();
				} else if (action === "new-chat") {
					doNewChat();
				} else if (action === "delete-chat") {
					dropChat(chat.id);
					editor?.focus();
				} else if (action === "toggle-sidebar") {
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusActiveSideChat();
				} else if (action === "next-chat") {
					stepChat(1);
				} else if (action === "prev-chat") {
					stepChat(-1);
				} else if (action === "shortcuts") {
					openShortcuts();
				} else if (action === "share-sheet") {
					void shareCurrentChat();
				} else if (action === "print-sheet") {
					printCurrentChat();
				} else if (action === "bigger-text") {
					adjustFontScale(0.1);
				} else if (action === "smaller-text") {
					adjustFontScale(-0.1);
				}
			});
		} catch (error) {
			console.warn(
				"Menu events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * `ccez://` deep links (desktop shell only): `ccez://chat/<id>`
	 * opens the chat when it exists (unknown ids are ignored, never
	 * an error toast), `ccez://new` mints a chat. Cold-start links
	 * wait in the backend drain slot; live ones arrive as events.
	 */
	async function wireDeepLinks(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listenDeepLinks((link) => {
				if (link.kind === "new-chat") {
					doNewChat();
					return;
				}
				const exists = chatState.chats.some((c) => c.id === link.chatId);
				if (!exists) return;
				saveDraftAnnotations(chatState.activeChatId, annotations, chatState.chats.map((c) => c.id));
				selectChat(chatState, link.chatId as ChatId);
				annotations = loadDraftAnnotations(link.chatId);
				enterEditMode();
			});
		} catch (error) {
			console.warn(
				"Deep-link events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * Share the visible chat as a study sheet: the backend writes the
	 * file for native share-out, then the OS sheet / clipboard /
	 * download fallback presents it. One toast names the outcome.
	 */
	async function shareCurrentChat(): Promise<void> {
		const lines = chat.messages.map((m) => ({ role: m.role, content: m.content }));
		const title = sheetTitle(lines);
		const markdown = studySheetMarkdown(title, lines);
		const saved = await exportStudySheet(title, lines);
		const outcome = await shareStudySheet(title, markdown);
		if (outcome === "shared") {
			flashToast(saved ? `Study sheet shared (${saved})` : "Study sheet shared");
		} else if (outcome === "copied") {
			flashToast("Study sheet copied — paste it anywhere");
		} else if (outcome === "downloaded") {
			flashToast("Study sheet downloaded");
		} else {
			flashToast("Sharing is unavailable here");
		}
	}

	/**
	 * Print the visible chat as a study sheet (`#study-sheet-print`
	 * is the only node the print stylesheet shows; Save as PDF in
	 * that dialog writes the file).
	 */
	function printCurrentChat(): void {
		if (!printStudySheet()) flashToast("Printing is unavailable here");
	}

	/**
	 * Double-click the title strip zooms the window (fills the screen):
	 * the macOS titlebar behavior, next to the green light that goes
	 * fullscreen instead. Clicks on controls keep their own actions.
	 */
	/**
	 * Double-click the empty gutters beside the centered column opens
	 * the nearby sidebar: left gutter the chat list, right gutter
	 * settings. Clicks on messages and controls keep their own
	 * actions (double-click still selects words); clicks inside the
	 * column but between messages do nothing.
	 */
	function gutterDoubleClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !scrollBox) return;
		if (
			target.closest(
				"article, button, input, select, textarea, a, summary, details, .sel-menu, .review, .ann-pop"
			)
		) {
			return;
		}
		let left = Infinity;
		let right = -Infinity;
		scrollBox.querySelectorAll("article, .empty-state").forEach((el) => {
			const box = el.getBoundingClientRect();
			left = Math.min(left, box.x);
			right = Math.max(right, box.x + box.width);
		});
		if (left === Infinity) return;
		if (event.clientX < left) {
			if (settings.sidebarCollapsed) {
				settings.sidebarCollapsed = false;
				persistSettings();
			}
		} else if (event.clientX > right) {
			if (!settingsOpen) openSettingsPanel();
		}
	}

	function zoomWindow(event: MouseEvent): void {
		if (!tauriBackendAvailable()) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) {
			return;
		}
		try {
			getCurrentWindow()
				.toggleMaximize()
				.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					console.warn("Window zoom failed:", message);
				});
		} catch (error) {
			console.warn(
				"Window zoom failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	onMount(() => {
		try {
			// iOS rides the same phone UI (touch composer, no hover,
			// native voice picker): the name is historical. Touch
			// tablets join it too: iPads in desktop-mode Safari report
			// a Macintosh UA, so touch points plus the coarse pointer
			// and screen size pick them up (see isTouchTablet).
			androidUI = isAndroidUserAgent(navigator.userAgent) || isIOSUserAgent(navigator.userAgent)
				|| isTouchTablet({
					ua: navigator.userAgent,
					coarse: isCoarsePointer((q) => window.matchMedia(q)),
					maxTouchPoints: navigator.maxTouchPoints ?? 0,
					smallestScreenDim: Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)
				});
			iosUI = isIOSUserAgent(navigator.userAgent);
		} catch {
			androidUI = false;
			iosUI = false;
		}
		// Phones keep the prompt on screen instead of idle-hiding it:
		// there is no keyboard summon (i/Enter/Space) and the sliders
		// are hidden, so migrate an uncustomized timeout to "never"
		// and release any boot park before first paint.
		if (androidUI && !idleTimeoutCustomized) {
			settings.promptIdleSec = PROMPT_IDLE_NEVER;
			persistSettings();
			bootParked = false;
			promptIdle = false;
		}
		// Phones stay portrait: the native shell pins it in the
		// manifest (MainActivity screenOrientation); this runtime
		// attempt covers browser-hosted runs, and rejects harmlessly
		// where the API needs fullscreen first.
		try {
			if (androidUI && typeof screen.orientation?.lock === "function") {
				void screen.orientation.lock("portrait").catch(() => {});
			}
		} catch {
			// Orientation lock is best-effort outside the native shell.
		}
		// Chromium-only viewport key, appended at runtime on Android
		// alone: a static tag makes WebKit log "not recognized" noise
		// on every desktop/iOS load, and only the Android WebView
		// reads it (keyboard resizes the layout viewport there).
		try {
			if (isAndroidUserAgent(navigator.userAgent)) {
				const meta = document.querySelector('meta[name="viewport"]');
				const content = meta?.getAttribute("content") ?? "";
				if (meta && !content.includes("interactive-widget")) {
					meta.setAttribute("content", `${content}, interactive-widget=resizes-content`);
				}
			}
		} catch {
			// Viewport tuning is best-effort; the visualViewport pin covers the rest.
		}
		// Shortcuts-modal labels: navigator.platform with User-Agent
		// Client Hints winning (see currentPlatform). Unknown platforms
		// read as non-Mac, so the Ctrl/Alt labels show.
		isMac = currentPlatform().isMac;
		// One engine everywhere, pinned silently (the desktop engine
		// picker is gone): system voices when the bridge is up, web
		// voices when it is not. The settings panel repeats the probe
		// for its picker; this is the silent path.
		void nativeTtsSupported().then((supported) => {
			const want = supported ? "native" : "web";
			if (settings.voiceEngine !== want) {
				settings.voiceEngine = want;
				persistSettings();
			}
		});
		// External-text bridge (Android OS selection menu): the entry
		// comes from the Annotate/Speak/Inspect manifest aliases, so
		// the text it carries is either a share from another app or
		// the selection just made in-app. Foreign text prefills the
		// composer; matching (or absent) text runs the tapped action
		// on the live web selection. The web row itself is untouched.
		if (tauriBackendAvailable()) {
			try {
				void listen<{ text: string | null; action: string | null }>(
					"annotate-external",
					(event) => {
						const text = event.payload?.text ?? null;
						const live = window.getSelection()?.toString() ?? "";
						const route = routeExternalText(event.payload?.action, text, live);
						if (route === "prefill" && text) {
							if (!chatState.activeChatId) newChat(chatState);
							editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
							editor?.focus();
							return;
						}
						placeSelMenu();
						if (!selMenu?.quote.trim()) {
							flashToast(
								`Select text first, then ${route === "speak" ? "Speak" : route === "inspect" ? "Inspect" : "Annotate"}.`
							);
							return;
						}
						if (route === "speak") speakDockSelection();
						else if (route === "inspect") openInspect();
						else annotate();
					}
				).then(() => {
					// Cold start: a share that arrived before setup parked
					// in Rust — the listener is registered now, so drain it.
					void invoke("drain_pending_external").catch(() => {});
				});
			} catch (error) {
				console.warn(
					"External-text events unavailable:",
					error instanceof Error ? error.message : String(error)
				);
			}
		}
		// File Handling launch: a .md file opened with the app lands
		// its text in the composer (blank-line joined like shared
		// text); anything else rides the attachments path. Where
		// launchQueue is missing no launch can arrive, and the
		// consumer stays unset.
		const launchQueue = window.launchQueue ?? null;
		consumeLaunchFiles(launchQueue, async (files) => {
			const { markdown, rest } = splitLaunchFiles(files);
			for (const file of markdown) {
				try {
					const text = await file.text();
					if (!chatState.activeChatId) newChat(chatState);
					editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
				} catch (error) {
					failAttach(error instanceof Error ? error.message : String(error));
				}
			}
			if (markdown.length > 0) {
				editor?.focus();
				flashToast(
					markdown.length === 1
						? "Opened file in the composer"
						: "Opened files in the composer"
				);
			}
			if (rest.length > 0) {
				const kinds = await addFiles(rest);
				insertAttachmentMarkers(kinds);
			}
		});
		// A pill-owned voice must not leak past its chat: when the
		// launch chat carries no reply pill and nobody pinned the
		// field, the voice falls back to the system default — new
		// chats start in English, pill chats reinstall their own.
		const launchChat =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		if (!settings.voiceLangPinned && !launchChat?.replyLang) {
			const fallback = systemLocale();
			if (settings.voiceLang !== fallback) {
				settings.voiceLang = fallback;
				persistSettings();
			}
		}
		// Edge swipes toggle the sidebars on touch screens (Android
		// milestone): rightward from the left edge for chats, leftward
		// from the right edge for settings. Toggle, not open-only: with
		// no keyboard or Esc key, a swipe is the touch user's only way
		// back out. Multi-touch cancels, and the mostly-horizontal rule
		// keeps scrolling and code-block pans to themselves. Passive:
		// the app never blocks a scroll.
		/**
		 * Mid-screen swipe target (phone only): like the edge rule, but for
		 * strokes starting in the middle of the conversation. Gated on the
		 * Android UA so touchscreen laptops never see it, and suppressed
		 * while text is selected (handle-dragging), while starting in an
		 * editable, or while the shortcuts modal owns the screen.
		 */
		function middleSwipeTarget(
			start: { x: number; y: number; clean: boolean },
			ended: { clientX: number; clientY: number }
		): EdgePanel | null {
			if (!androidUI || !start.clean || shortcutsOpen || inspectChar) return null;
			if (window.getSelection()?.isCollapsed === false) return null;
			return contentSwipeTarget(start.x, start.y, ended.clientX, ended.clientY);
		}
		/**
		 * Shared edge-stroke outcome (touch swipes and desktop mouse
		 * drags): dismiss first, summon second. A rightward stroke with
		 * settings open closes settings; a leftward stroke with chats
		 * open closes the sheet. Gutter double-click stays as-is.
		 */
		function applyEdgeTarget(target: EdgePanel | null): void {
			// A summoned drawer replaces the phone switcher (never
			// stack) — but a null target summons nothing, so a lift
			// that resolves to no panel leaves the switcher alone
			// (this closed the hold-summoned switcher on release).
			if (target !== null && androidUI) chatSwitcherOpen = false;
			if (target === "chats") {
				if (settingsOpen) toggleSettingsPanel();
				// Touch: a left-to-right swipe opens the chats sidebar
				// (with its search box) and never closes it — a
				// rightward stroke only summons, the leftward stroke
				// below folds.
				else if (settings.sidebarCollapsed) {
					settings.sidebarCollapsed = false;
					persistSettings();
				}
			} else if (target === "settings") {
				// A leftward stroke never closes settings once open —
				// only a rightward stroke (the "chats" branch) dismisses.
				if (settingsOpen) return;
				if (!settings.sidebarCollapsed) {
					settings.sidebarCollapsed = true;
					persistSettings();
				} else toggleSettingsPanel();
			}
		}
		/**
		 * Desktop mouse edge-drag: the desktop analog of the touch edge
		 * swipe — press near the screen edge and drag horizontally to
		 * summon or dismiss the sidebars. Touch hardware rides the touch
		 * path above, so this is mouse-only and desktop-only. Text
		 * selection drags never count: a stroke that changed the
		 * selection, or started in an editable or on a control, is
		 * ignored. Passive: the app never blocks the drag.
		 */
		let edgeMouse: { x: number; y: number; clean: boolean; sel: string } | null = null;
		window.addEventListener("pointerdown", (event) => {
			if (androidUI || event.pointerType !== "mouse" || event.button !== 0) return;
			const target = event.target;
			const clean =
				!(target instanceof Element) ||
				target.closest(
					".cm-content, input, textarea, select, [contenteditable='true'], button, a"
				) === null;
			edgeMouse = {
				x: event.clientX,
				y: event.clientY,
				clean,
				sel: window.getSelection()?.toString() ?? ""
			};
		});
		window.addEventListener("pointerup", (event) => {
			const start = edgeMouse;
			edgeMouse = null;
			if (!start || !start.clean || androidUI) return;
			if (event.pointerType !== "mouse" || event.button !== 0) return;
			if ((window.getSelection()?.toString() ?? "") !== start.sel) return;
			applyEdgeTarget(
				edgeSwipeTarget(start.x, start.y, event.clientX, event.clientY, window.innerWidth)
			);
		});
		let edgeTouch: {
			id: number;
			x: number;
			y: number;
			at: number;
			scrollTop: number;
			clean: boolean;
			rowSwipe: boolean;
			msgId: ChatMsgId | null;
			zone: FlickZone;
			inSwitcher: boolean;
			promptHadFocus: boolean;
		} | null = null;
		/** Single-finger hold on dead space (quick-switcher summon):
		armed on touchstart, cancelled by lift, travel, or scroll. */
		let emptyHoldTimer: ReturnType<typeof setTimeout> | null = null;
		function clearEmptyHoldTimer(): void {
			if (emptyHoldTimer) {
				clearTimeout(emptyHoldTimer);
				emptyHoldTimer = null;
			}
		}
		/**
		 * Where a single-finger stroke began, for the vertical-flick
		 * gestures (message / prompt / empty). Controls, fields, and
		 * chrome count as "other": taps there keep native behavior and
		 * strokes there belong to their owner, never to a gesture.
		 */
		/** Last single-tap point: pairs into the double-tap sidebar open. */
		let lastTapAt = 0;
		let lastTapX = 0;
		let lastTapY = 0;
		/** Pending empty-tap focus (new chat): fired unless the second
		tap pairs into the sidebar open instead. */
		let emptyTapTimer: ReturnType<typeof setTimeout> | null = null;
		/** Last single-tap point on a message: pairs into the double-tap
		jump to that message's end (phones). Own pairing — empty-space
		taps keep theirs above. */
		let lastMsgTapAt = 0;
		let lastMsgTapX = 0;
		let lastMsgTapY = 0;
		let lastMsgTapId: ChatMsgId | null = null;
		function flickZoneOf(target: EventTarget | null): FlickZone {
			const el = target instanceof Element ? target : null;
			if (!el) return "other";
			if (el.closest("button, a, input, textarea, select, summary, [contenteditable], .actions"))
				return "other";
			if (el.closest(".prompt")) return "prompt";
			if (articleOf(el)) return "message";
			if (
				el.closest("main") &&
				el.closest(
					"aside, .modal, .modal-veil, .settings-panel, .find-bar, .search-palette, .sel-menu, .review, .lang-menu, .lang-menus, .hero, .toast"
				) === null
			)
				return "empty";
			return "other";
		}
		// Desktop twin of the tap-out rule below: a press starting
		// outside the composer cancels an in-prompt note edit.
		// Composer presses (typing, send arrow) keep it; the review
		// itself lives inside .prompt, so its buttons never cancel.
		window.addEventListener("mousedown", (event) => {
			if (
				promptAnnEdit &&
				!(event.target instanceof Element && event.target.closest(".prompt"))
			) {
				cancelPromptAnnEdit();
			}
		});
		window.addEventListener(
			"touchstart",
			(event) => {
				// Mobile in-prompt note edit: a stroke starting outside
				// the composer cancels it (tapping out drops the draft).
				// Composer taps keep it; the send arrow commits instead
				// (see doSend). Runs before every gesture below.
				if (
					promptAnnEdit &&
					!(event.target instanceof Element && event.target.closest(".prompt"))
				) {
					cancelPromptAnnEdit();
				}
				if (event.touches.length > 1) {
					edgeTouch = null;
					clearEmptyHoldTimer();
					return;
				}
				const touch = event.touches[0];
				if (!touch) return;
				// Mid-screen swipes must never steal text entry: a swipe
				// starting in the composer or a field is cursor/scroll work.
				const target = event.target;
				const clean =
					!(target instanceof Element) ||
					target.closest(".cm-content, input, textarea, select, [contenteditable='true']") === null;
				// Message the stroke starts on (for swipe-to-fold). The
				// article id carries the viewChat index (see msg-{i}).
				const art = target instanceof Element ? articleOf(target) : null;
				const msgIndex = art ? Number(art.id.slice(4)) : NaN;
				const msgId =
					Number.isInteger(msgIndex) ? (viewChat.messages[msgIndex]?.id ?? null) : null;
				// A stroke starting on the action row is the row's own
				// scroll: scrolling an overflowing row must never fold
				// the message or summon a sidebar.
				const rowSwipe = target instanceof Element && target.closest(".actions") !== null;
				// Strokes inside the chat switcher belong to the switcher
				// card (cycle on swipe): the window paths below stay out.
				const inSwitcher = target instanceof Element && target.closest(".chat-switcher") !== null;
				// Snapshot before the tap blurs anything: a tap-away that
				// dismisses the keyboard must not re-arm focus below.
				const promptHadFocus =
					document.activeElement instanceof Element &&
					document.activeElement.closest(".prompt") !== null;
				edgeTouch = {
					id: touch.identifier,
					x: touch.clientX,
					y: touch.clientY,
					at: Date.now(),
					scrollTop: scrollBox?.scrollTop ?? 0,
					clean,
					rowSwipe,
					msgId,
					zone: flickZoneOf(target),
					inSwitcher,
					promptHadFocus
				};
				// Single-finger hold on dead space summons the quick
				// switcher too (not just the double-tap): a still
				// half-second press, cancelled by lift, travel, scroll,
				// or a second finger. Text keeps its native long-press
				// (only the "empty" zone arms here).
				clearEmptyHoldTimer();
				if (
					androidUI &&
					!chatSwitcherOpen &&
					edgeTouch.zone === "empty" &&
					(window.getSelection()?.isCollapsed ?? true)
				) {
					const heldId = touch.identifier;
					const heldTop = scrollBox?.scrollTop ?? 0;
					emptyHoldTimer = setTimeout(() => {
						emptyHoldTimer = null;
						if (edgeTouch?.id !== heldId) return;
						if ((scrollBox?.scrollTop ?? 0) !== heldTop) return;
						openChatSwitcher();
					}, 500);
				}
			},
			{ passive: true }
		);
		// A travelling finger is a scroll or swipe, never a hold.
		window.addEventListener(
			"touchmove",
			(event) => {
				if (!emptyHoldTimer || !edgeTouch || event.touches.length !== 1) return;
				const touch = event.touches[0];
				if (
					touch &&
					Math.hypot(touch.clientX - edgeTouch.x, touch.clientY - edgeTouch.y) > 12
				) {
					clearEmptyHoldTimer();
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = edgeTouch;
				edgeTouch = null;
				clearEmptyHoldTimer();
				if (!start) return;
				let ended: { identifier: number; clientX: number; clientY: number } | null = null;
				for (let i = 0; i < event.changedTouches.length; i++) {
					const candidate = event.changedTouches[i];
					if (candidate && candidate.identifier === start.id) ended = candidate;
				}
				if (!ended) return;
				// Strokes on the switcher veil cycle chats anywhere on
				// screen (taps still close via click): every other
				// window gesture stays out.
				if (start.inSwitcher) {
					const dx = ended.clientX - start.x;
					const dy = ended.clientY - start.y;
					if (Math.abs(dx) >= 64 && Math.abs(dy) < Math.abs(dx)) {
						stepSwitcher(dx > 0 ? 1 : -1);
					}
					return;
				}
				// Phone: a leftward stroke starting on a message folds it
				// (a rightward stroke instead summons the chats list via
				// the stroke below — the fold only wins on a leftward
				// message stroke). An active text selection wins —
				// folding mid-select would eat the highlight.
				const foldDx = ended.clientX - start.x;
				const foldDy = ended.clientY - start.y;
				if (
					androidUI &&
					start.msgId &&
					!start.rowSwipe &&
					foldDx <= -64 &&
					Math.abs(foldDy) < Math.abs(foldDx) &&
					window.getSelection()?.isCollapsed !== false
				) {
					// Haptic lives inside toggleFold (every fold path
					// shares it — swipe, alt-click, action button).
					toggleFold(start.msgId);
					return;
				}
				// Double-tap on empty space opens the quick switcher
				// (Android): the list keeps its swipe and button openers,
				// and prompt flicks never count. Taps are short, still, unscrolled
				// strokes over dead space: text keeps native double-tap
				// word select, controls keep their taps.
				if (androidUI && !iosUI) {
					const now = Date.now();
					const tapped =
						now - start.at <= 300 &&
						Math.hypot(ended.clientX - start.x, ended.clientY - start.y) <= 12 &&
						Math.abs((scrollBox?.scrollTop ?? 0) - start.scrollTop) <= 10 &&
						start.zone === "empty" &&
						window.getSelection()?.isCollapsed !== false;
					const paired =
						tapped &&
						now - lastTapAt < 400 &&
						Math.hypot(ended.clientX - lastTapX, ended.clientY - lastTapY) < 32;
					if (tapped) {
						lastTapAt = now;
						lastTapX = ended.clientX;
						lastTapY = ended.clientY;
					}
					if (paired) {
						lastTapAt = 0;
						// The second tap owns the gesture: a pending
						// empty-tap focus must not pop the keyboard
						// behind the opening switcher.
						if (emptyTapTimer) {
							clearTimeout(emptyTapTimer);
							emptyTapTimer = null;
						}
						// Dead-space double-tap opens the quick switcher
						// (the list keeps its swipe and button openers).
						openChatSwitcher();
						return;
					}
					// Single tap on the dead space of an empty new chat
					// focuses the composer (phones have no i key). Fired
					// past the double-tap window so the opener above wins
					// the pair; chats with messages keep tap-to-peace. A
					// tap that dismisses the keyboard never re-arms: the
					// prompt had focus when the stroke began, so this tap
					// is the way out, not the way in.
					if (tapped && !paired && viewChat.messages.length === 0 && !start.promptHadFocus) {
						if (emptyTapTimer) clearTimeout(emptyTapTimer);
						emptyTapTimer = setTimeout(() => {
							emptyTapTimer = null;
							editor?.focus();
						}, 380);
					}
				}
				// Double-tap on a message jumps to its end (phones):
				// huge replies strand their buttons below the fold
				// and phones have no End key. Text keeps native
				// double-tap word select (a pick leaves a selection,
				// failing the collapsed check); controls keep taps.
				if (androidUI && start.msgId && !start.rowSwipe) {
					const now = Date.now();
					const msgTapped =
						now - start.at <= 300 &&
						Math.hypot(ended.clientX - start.x, ended.clientY - start.y) <= 12 &&
						Math.abs((scrollBox?.scrollTop ?? 0) - start.scrollTop) <= 10 &&
						start.zone === "message" &&
						window.getSelection()?.isCollapsed !== false;
					const msgPaired =
						msgTapped &&
						start.msgId === lastMsgTapId &&
						now - lastMsgTapAt < 400 &&
						Math.hypot(ended.clientX - lastMsgTapX, ended.clientY - lastMsgTapY) < 32;
					if (msgTapped) {
						lastMsgTapAt = now;
						lastMsgTapX = ended.clientX;
						lastMsgTapY = ended.clientY;
						lastMsgTapId = start.msgId;
					}
					if (msgPaired) {
						lastMsgTapAt = 0;
						lastMsgTapId = null;
						// Pin the revealed row open: the second tap's
						// click would otherwise toggle it shut (see
						// toggleMessageActions).
						msgDoubleTapPin = { id: start.msgId, at: now };
						const tapEl = document.elementFromPoint(ended.clientX, ended.clientY);
						const art = tapEl ? articleOf(tapEl) : null;
						if (art instanceof HTMLElement) {
							art.scrollIntoView({ block: "end", behavior: "smooth" });
						} else if (scrollBox) {
							scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
						}
						void hapticBeatAsync("send", {
							enabled: settings.vibration,
							shell: tauriBackendAvailable()
						});
						return;
					}
				}
				const target = start.rowSwipe
					? null
					: (edgeSwipeTarget(start.x, start.y, ended.clientX, ended.clientY, window.innerWidth) ??
						middleSwipeTarget(start, ended));
				// The quick switcher owns every swipe while up: strokes
				// on its veil cycle chats, and nothing may summon a
				// sidebar behind it.
				if (chatSwitcherOpen && (target === "chats" || target === "settings")) return;
				if (target === "chats" && androidUI && !iosUI) {
					// A rightward stroke summons the chats list (double-tap
					// stays as the other opener) and never dismisses it —
					// only a settings panel yields to it, and only the
					// leftward stroke below folds the list itself.
					if (settingsOpen) settingsOpen = false;
					else if (settings.sidebarCollapsed) {
						settings.sidebarCollapsed = false;
						persistSettings();
					}
					return;
				}
				if (target === "settings" && androidUI) {
					// Phones: a leftward stroke off messages and the
					// prompt opens settings (message-start strokes fold
					// via the branch above — or do nothing when short —
					// and prompt-start strokes never reach here as
					// unclean). An open chats list folds instead, and
					// an open panel stays (rightward dismisses it).
					// Desktop keeps the shared edge outcome below.
					if (settingsOpen) return;
					if (start.msgId || start.rowSwipe) return;
					if (!settings.sidebarCollapsed) {
						settings.sidebarCollapsed = true;
						persistSettings();
					} else openSettingsPanel(true);
					return;
				}
				applyEdgeTarget(target);
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				edgeTouch = null;
			},
			{ passive: true }
		);
		// Touch text selection: a long-press selects natively, but the
		// compatibility mouse sequence trailing it looks like a stale
		// click (mousedown snapshots the already-made selection, mouseup
		// clears it as "unchanged"), so the menu never appears. Handle
		// touchend directly — a lift over message text with a NEW
		// selection summons the menu — and the guard in onMouseUp
		// swallows the compat mouseup behind it. Multi-touch gestures
		// claim their own sequences; taps matching the pre-touch
		// selection are handle nudges, not new picks.
		let touchMenuAt = 0;
		let multiTouchSeen = false;
		let selTouchStart: { x: number; y: number; sel: string } | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					multiTouchSeen = true;
					selTouchStart = null;
					return;
				}
				const first = event.touches[0];
				selTouchStart = first
					? { x: first.clientX, y: first.clientY, sel: window.getSelection()?.toString() ?? "" }
					: null;
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = selTouchStart;
				selTouchStart = null;
				if (event.touches.length === 0) {
					const claimed = multiTouchSeen;
					multiTouchSeen = false;
					if (claimed) return;
				} else if (multiTouchSeen) {
					return;
				}
				if (!androidUI || shortcutsOpen || inspectChar || !start) return;
				const touch = event.changedTouches[0];
				if (!touch) return;
				// No travel limit: dragging the selection handles across
				// lines ends far from where the touch began, and that lift
				// is exactly the multi-line pick the menu must serve. Scrolls
				// can't summon it (they leave the selection unchanged, so the
				// equality check below filters them), and lifts outside text
				// fail the .rendered check.
				const el = document.elementFromPoint(touch.clientX, touch.clientY);
				if (!el?.closest(".messages .rendered")) return;
				const live = window.getSelection()?.toString() ?? "";
				if (live === "" || live === start.sel) return;
				placeSelMenu(touch.clientX, touch.clientY);
				touchMenuAt = Date.now();
				// Headphones in: the fresh selection reads itself aloud
				// on release (when a voice fits). The menu stays up, so
				// Annotate is still one tap away after listening.
				// Phones never do this: every selection would talk.
				if (!androidUI && settings.autoSpeakSelection) {
					const fresh = currentQuote();
					if (fresh) void speakQuote(fresh.quote, fresh.messageId, true, fresh.context);
				}
			},
			{ passive: true }
		);
		// A dead highlight drops its menu at once: taps elsewhere (and
		// handle collapses) clear the selection without touching the
		// mouse/touch summon paths, so without this the menu stranded
		// until the 4.5s timer. Presses that began in the menu stand
		// down (see menuPressAt): the button's own release collapses
		// the highlight, and Annotate runs off the stored quote.
		document.addEventListener("selectionchange", () => {
			if (!selMenu) return;
			if (Date.now() - menuPressAt < 1000) return;
			// A hover transition's engine collapse (no press at all):
			// put the stored range back while the hover change is
			// fresh. Any other clear falls through to the dismiss
			// below — plain clicks always press first, so they never
			// land here.
			if (Date.now() - lastHoverChangeAt < 500) {
				const liveKeep = window.getSelection();
				if (selMenu?.range && (!liveKeep || liveKeep.toString() === "")) {
					try {
						liveKeep?.removeAllRanges();
						liveKeep?.addRange(selMenu.range.cloneRange());
					} catch {
						// Detached since the click: fall through below.
					}
					if ((liveKeep?.toString() ?? "") !== "") return;
				}
			}
			// Hover-shaped engine clear: no press, no key, no
			// programmatic clear since the menu opened — the pointer
			// cruising other messages (or the menu's own shadow) must
			// not cost the highlight. Put the stored range back and
			// keep the menu; detached nodes fall through to the
			// dismiss below. Genuine clears always stamp newer (a
			// click-away or fresh drag presses, an arrow-collapse
			// keys, Escape/pills clear programmatically), so they
			// keep dismissing.
			// Only an empty live selection rescues: a live one is new
			// work (reselects, swaps), never a hover-clear.
			const liveBefore = window.getSelection();
			const rescueRange =
				!liveBefore || liveBefore.isCollapsed || liveBefore.toString() === ""
					? selMenu?.range
					: null;
			if (
				rescueRange &&
				lastPressAt <= selMenuOpenedAt &&
				lastProgrammaticClearAt <= selMenuOpenedAt
			) {
				const liveRescue = window.getSelection();
				try {
					if (
						document.contains(rescueRange.startContainer) &&
						document.contains(rescueRange.endContainer)
					) {
						liveRescue?.removeAllRanges();
						liveRescue?.addRange(rescueRange.cloneRange());
					}
				} catch {
					// Detached mid-hover: fall through to the dismiss below.
				}
				if ((liveRescue?.toString() ?? "") !== "") return;
			}
			const live = window.getSelection();
			if (!live || live.isCollapsed || live.toString() === "") {
				const anchor = live?.anchorNode;
				// No anchor at all (a bare removeAllRanges, no press
				// behind it): a body swap always leaves a collapsed or
				// detached anchor behind, so anchorless is a genuine
				// clear and the menu drops at once. The pointer riding
				// the menu stands down — WebKit empties the document
				// selection on menu hover, and the enter restore below
				// puts it back.
				if (!anchor) {
					if (!selMenuHover) selMenu = null;
					return;
				}
				// A body swap under the highlight (stream chunk, aid
				// rebuild, late enhancement) detaches the anchor node:
				// the stored quote still stands, so the menu stands with
				// it and Annotate keeps working...
				if (!document.contains(anchor)) return;
				// ...or collapses it onto the attached container (WebKit
				// fires selectionchange for this; Chromium stays silent):
				// when the collapse is newer than the last press it is
				// the swap's, so the menu stands on its stored quote. A
				// real clear always arrives on a press and still dismisses.
				if (lastBodySwapAt > lastPressAt) return;
				// WebKit also empties the document selection when the
				// pointer moves onto the floating menu itself — no DOM
				// change, no press, nothing to stamp (Chromium keeps
				// it). While the pointer is over the menu the collapse
				// is the engine's, so the menu stands on its stored
				// quote and Annotate keeps working. The message must
				// still be there: a Delete/cut with the pointer parked
				// over the menu really does clear, and must dismiss.
				const menuMessageId = selMenu?.messageId;
				if (
					selMenuHover &&
					menuMessageId !== undefined &&
					chat.messages.some((m) => m.id === menuMessageId)
				)
					return;
				selMenu = null;
			}
			// Live reselects refresh the stored quote in place
			// (replacement, never mutation, so the dock re-renders):
			// extending past one character hides Inspect, shrinking
			// back restores it. Rescue paths returned above, so a live
			// selection here is new work.
			if (live && !live.isCollapsed && live.toString() !== "" && selMenu) {
				const refreshed = currentQuote();
				if (refreshed && refreshed.quote !== selMenu.quote) {
					selMenu = {
						...selMenu,
						quote: refreshed.quote,
						context: refreshed.context,
						messageId: refreshed.messageId,
						range: live.rangeCount > 0 ? live.getRangeAt(0).cloneRange() : selMenu.range
					};
				}
			}
		});
		// Two-finger horizontal swipes open drawers (left = settings,
		// right = chats list); a vertical two-finger slide jumps the chat
		// (up to the top, down to the bottom — gg and G); a three-finger
		// horizontal swipe steps chats (right = newer, left = older, no
		// focus: the keyboard stays down); a two-finger double tap deletes
		// the current chat on Android (sidebar toggle on iOS); a double
		// three-finger tap deletes every chat on Android (current chat on
		// iOS). Taps start away from controls, drawers, and the modal;
		// swipes and slides track from anywhere a modal isn't open, and
		// the swipe's pinch veto (see twoFingerSwipeDir) keeps page zoom.
		let twoTrack: {
			start: [FingerTrack, FingerTrack];
			end: [FingerTrack, FingerTrack];
			/** False when a finger landed on a control: swipes and slides
			still fire (settings from anywhere), but tap-pairing never
			does (a double-tap on a button must not delete a chat). */
			clean: boolean;
		} | null = null;
		// Main-chat pinch owns font size (both phone platforms; the
		// sidebar keeps the default page zoom): while a clean
		// two-finger press starts in the messages column, spread steps
		// scale the text and veto the swipe/tap paths at release.
		let pinchBaseline = 0;
		let pinchStartSpread = 0;
		let pinchFont = false;
		let pinchMoved = false;
		let pinchStepped = false;
		let threeTrack: {
			id: number;
			x: number;
			y: number;
			cx: number;
			cy: number;
			moved: number;
			at: number;
		} | null = null;
		let lastThreeTapAt = 0;
		let twoTapAt = 0;
		let lastTwoTapAt = 0;
		/**
		 * Chat switcher overlay (phones): a two-finger hold on the main
		 * chat opens it; swipes inside cycle chats, tapping away closes.
		 * The flag itself is top-level state (runes can't live in
		 * onMount); only the hold timer lives here.
		 */
		/** Two-finger hold: armed while both fingers rest, fired once. */
		let holdTimer: ReturnType<typeof setTimeout> | null = null;
		let holdFired = false;
		function clearHoldTimer(): void {
			if (holdTimer) {
				clearTimeout(holdTimer);
				holdTimer = null;
			}
		}
		/** Lead-finger travel of the live two-finger press, if any. */
		function twoFingerHeldStill(maxMove = 12): boolean {
			if (!twoTrack) return false;
			return (
				Math.hypot(
					twoTrack.end[0].x - twoTrack.start[0].x,
					twoTrack.end[0].y - twoTrack.start[0].y
				) <= maxMove &&
				Math.hypot(
					twoTrack.end[1].x - twoTrack.start[1].x,
					twoTrack.end[1].y - twoTrack.start[1].y
				) <= maxMove
			);
		}
		const gestureClean = (event: TouchEvent): boolean => {
			if (!androidUI || shortcutsOpen) return false;
			const target = event.target;
			return (
				!(target instanceof Element) ||
				target.closest(
					".cm-content, input, textarea, select, [contenteditable='true'], button, aside, .settings-panel, .modal, .sel-menu"
				) === null
			);
		};
		const trackOf = (t: Touch): FingerTrack => ({ id: t.identifier, x: t.clientX, y: t.clientY });
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					// Phones track from anywhere a modal isn't open: a
					// finger landing on a button used to kill the whole
					// gesture, which read as "swipe left sometimes
					// doesn't open settings". A live highlight no longer
					// vetoes either — the swipe itself picks text on the
					// way down, which self-vetoed message-start swipes
					// almost every time. Loose tracks still swipe and
					// slide; only clean ones pair taps, and taps never
					// pair mid-select (see the guards below).
					const modalBusy = shortcutsOpen || palette.open || inspectChar !== null;
					const clean = !modalBusy && gestureClean(event);
					twoTrack =
						a && b && androidUI && !modalBusy
							? { start: [trackOf(a), trackOf(b)], end: [trackOf(a), trackOf(b)], clean }
							: null;
					// A clean two-finger press starts the double-tap clock.
					twoTapAt = twoTrack !== null && twoTrack.clean ? Date.now() : 0;
					threeTrack = null;
					// Pinch-to-font arms only in the messages column: the
					// sidebar and sheets keep the default page zoom.
					const target = event.target;
					pinchFont =
						twoTrack !== null &&
						target instanceof Element &&
						target.closest("main .messages") !== null;
					pinchBaseline = pinchStartSpread =
						a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
					pinchMoved = false;
					pinchStepped = false;
					// Two-finger hold opens the chat switcher: both fingers
					// resting on the main chat (not controls, drawers, or a
					// modal) for half a second. Movement or release cancels
					// before it fires; firing consumes the release below.
					clearHoldTimer();
					holdFired = false;
					if (twoTrack !== null && twoTrack.clean && !chatSwitcherOpen) {
						holdTimer = setTimeout(() => {
							holdTimer = null;
							if (twoTrack !== null && twoFingerHeldStill()) {
								holdFired = true;
								openChatSwitcher();
							}
						}, 500);
					}
				} else if (event.touches.length === 3) {
					const first = event.touches[0];
					threeTrack =
						first && gestureClean(event)
							? {
									id: first.identifier,
									x: first.clientX,
									y: first.clientY,
									cx: first.clientX,
									cy: first.clientY,
									moved: 0,
									at: Date.now()
								}
							: null;
					twoTrack = null;
					clearHoldTimer();
					pinchFont = false;
					pinchMoved = false;
				} else {
					twoTrack = null;
					clearHoldTimer();
					pinchFont = false;
					pinchMoved = false;
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				if (threeTrack) {
					const lead = Array.from(event.touches).find((t) => t.identifier === threeTrack?.id);
					if (lead) {
						threeTrack.moved = Math.max(
							threeTrack.moved,
							Math.hypot(lead.clientX - threeTrack.x, lead.clientY - threeTrack.y)
						);
						threeTrack.cx = lead.clientX;
						threeTrack.cy = lead.clientY;
					}
				}
				if (twoTrack) {
					for (const t of Array.from(event.touches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					// A wandering hold is a swipe-in-progress, not a hold.
					if (holdTimer && !twoFingerHeldStill()) clearHoldTimer();
				}
				// Main-chat pinch steps the text size live: re-baseline
				// per step so a held pinch keeps scaling, one haptic
				// tick per step. Any real spread change vetoes the
				// swipe/tap paths at release below.
				if (pinchFont && event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					if (a && b) {
						const spread = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
						if (Math.abs(spread - pinchStartSpread) > 12) pinchMoved = true;
						const step = pinchZoomStep(pinchBaseline, spread);
						if (step !== 0) {
							pinchBaseline = spread;
							pinchStepped = true;
							adjustFontScale(step * 0.1, true);
							void hapticBeatAsync("send", {
								enabled: settings.vibration,
								shell: tauriBackendAvailable()
							});
						}
					}
				}
			},
			{ passive: true }
		);
		// Main-chat pinch owns its gesture: block the default page zoom
		// while both fingers are down in the messages column (a separate
		// non-passive listener — the tracker above stays passive).
		window.addEventListener(
			"touchmove",
			(event) => {
				if (pinchFont && event.touches.length === 2) event.preventDefault();
			},
			{ passive: false }
		);
		// iOS ignores touchmove prevention for pinch zoom: its gesture
		// event must preventDefault instead (a no-op everywhere else).
		document.addEventListener("gesturestart", (event) => {
			if (pinchFont) event.preventDefault();
		});
		window.addEventListener(
			"touchend",
			(event) => {
				clearHoldTimer();
				if (twoTrack) {
					// A fired hold owns the release: no swipe, slide, or
					// tap pairing after the switcher opens.
					if (holdFired && event.touches.length === 0) {
						holdFired = false;
						twoTrack = null;
						pinchFont = false;
						pinchMoved = false;
						pinchStepped = false;
						return;
					}
					for (const t of Array.from(event.changedTouches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					if (event.touches.length === 0) {
						const twoStart = twoTrack.start;
						const twoEnd = twoTrack.end;
						const dir = twoFingerSwipeDir(twoStart, twoEnd);
						// Phones slide vertically too (handled below): compute
						// while the tracks are alive; horizontal strokes read
						// null here so the swipe step above keeps them.
						const slide =
							androidUI && dir === null ? twoFingerSlideDir(twoStart, twoEnd) : null;
						const now = Date.now();
						const moved = Math.max(
							Math.hypot(twoEnd[0].x - twoStart[0].x, twoEnd[0].y - twoStart[0].y),
							Math.hypot(twoEnd[1].x - twoStart[1].x, twoEnd[1].y - twoStart[1].y)
						);
						twoTrack = null;
						// A pinch owns the gesture: spread motion vetoes
						// the swipe step, the vertical slide, and the tap pairing below.
						// Settings opens on a shorter leftward glide (64px):
						// message-start swipes run short on thumbs, and the
						// panel dismisses with one tap, so a hair-trigger
						// costs nothing. Every other direction keeps 96px.
						if (dir === null && androidUI && !pinchMoved && !settingsOpen) {
							if (twoFingerSwipeDir(twoStart, twoEnd, 64) === -1) {
								openSettingsPanel(true);
							}
						}
						if (dir !== null && !pinchMoved) {
							// Phones: a two-finger swipe left opens
							// settings (the one-finger left stroke never
							// does); a two-finger swipe right summons the
							// chats list. Chat steps moved to three
							// fingers; desktop keeps stepping both
							// directions.
							if (dir === -1 && androidUI && !settingsOpen) openSettingsPanel(true);
							else if (dir === 1 && androidUI) {
								if (settingsOpen) settingsOpen = false;
								else if (settings.sidebarCollapsed) {
									settings.sidebarCollapsed = false;
									persistSettings();
								}
								chatSwitcherOpen = false;
							} else stepChat(dir, false);
						}
						// Still two-finger taps pair into a delete (Android:
						// no keyboard for the Delete key, and the sidebar
						// moved to swipe-up-from-prompt); swipes take the
						// step path instead. iOS keeps the sidebar toggle.
						// Never mid-select: opening settings stopped
						// vetoing on a highlight, but a delete must not
						// fire under one.
						else if (
							!pinchMoved &&
							androidUI &&
							twoTapAt > 0 &&
							moved <= 12 &&
							now - twoTapAt <= 400 &&
							window.getSelection()?.isCollapsed !== false
						) {
							if (now - lastTwoTapAt < 600) {
								lastTwoTapAt = 0;
								if (iosUI) {
									// The open keyboard would cover the sidebar.
									if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
									toggleSidebar();
								} else {
									// Haptic lives inside dropChat (triple thump).
									dropChat(chatState.activeChatId);
									flashToast("Chat deleted");
								}
							} else lastTwoTapAt = now;
						}
						// Phones: a two-finger vertical slide jumps the chat —
						// up to the top, down to the bottom (phones have no
						// Home/End keys). Same pinch veto as the swipe step;
						// desktop keeps swipes only.
						if (slide !== null && !pinchMoved && scrollBox) {
							if (slide === "top") scrollBox.scrollTo({ top: 0, behavior: "smooth" });
							else scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
							void hapticBeatAsync("send", {
								enabled: settings.vibration,
								shell: tauriBackendAvailable()
							});
						}
						// Pinch zoom toasts once on release with the
						// landed size (steps stay quiet mid-gesture).
						if (pinchStepped) flashToast(`Text size ${Math.round(settings.fontScale * 100)}%`);
						pinchFont = false;
						pinchMoved = false;
						pinchStepped = false;
					}
				}
				if (threeTrack && event.touches.length === 0) {
					const track = threeTrack;
					threeTrack = null;
					const now = Date.now();
					// The lead finger's lift carries its last position:
					// fold it in before judging, so a swipe released
					// without a final move still measures full travel.
					for (const t of Array.from(event.changedTouches)) {
						if (t.identifier === track.id) {
							track.cx = t.clientX;
							track.cy = t.clientY;
						}
					}
					// Phones step chats on a three-finger horizontal swipe
					// (right = newer, left = older, keyboard stays down);
					// a near-stationary trio still pairs into the tap below.
					const swipe = androidUI ? threeFingerSwipeDir(track.x, track.y, track.cx, track.cy) : null;
					if (swipe !== null) {
						stepChat(swipe, false);
						void hapticBeatAsync("send", {
							enabled: settings.vibration,
							shell: tauriBackendAvailable()
						});
					// Never mid-select, like the two-finger delete above.
					} else if (
						isThreeFingerTap(3, track.moved, now - track.at) &&
						window.getSelection()?.isCollapsed !== false
					) {
						if (now - lastThreeTapAt < 600) {
							lastThreeTapAt = 0;
							// Android: three fingers clear everything (two
							// already take the current chat). iOS keeps the
							// single-chat delete.
							if (iosUI) {
								// Haptic lives inside dropChat (triple thump).
								dropChat(chatState.activeChatId);
								flashToast("Chat deleted");
							} else {
								// Haptic lives inside dropAllChats (triple thump).
								dropAllChats();
								flashToast("All chats deleted");
							}
						} else {
							lastThreeTapAt = now;
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				twoTrack = null;
				threeTrack = null;
				clearHoldTimer();
				holdFired = false;
			},
			{ passive: true }
		);
		if (!promptEl) return;
		// Android gets the plain-textarea composer: no measurement cache
		// (no collapse) and no compositor layer games (no tap ghost).
		editor = androidUI
			? createTextareaEditor(promptEl, promptOptions())
			: createPromptEditor(promptEl, promptOptions());
		editor.setPlaceholder(promptPlaceholder());
		// Desktop lands in the prompt on launch; phones don't — popping
		// the keyboard on every cold start is the mobile annoyance.
		// Always-hide mode never takes focus on its own: the prompt is
		// visible exactly while the composer holds focus, so a mount
		// steal would restore it straight back (and fight every
		// remount, including hot reloads).
		if (!androidUI && settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) {
			editor.focus();
			// Mount-time focus can lose to hydration churn; retry on next
			// frame so a fresh window and a new chat both land in the prompt.
			requestAnimationFrame(() => editor?.focus());
		}
		// First paint can measure while the webview is still settling
		// (window restore, DPR): cached line boxes go stale and the prompt
		// snaps to a new height on the next measure. Settle it up front,
		// after paint, like the window-focus path does.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));

		/**
		 * One Escape ladder for the whole app (capture phase, so it
		 * pre-empts bubble-phase widget handlers like the pill's own
		 * Esc): topmost layer first, exactly one layer per press.
		 * Callers preventDefault + stopPropagation around it.
		 */
		const dismissEscape = (inEditor: Element | null | undefined): void => {
			if (shortcutsOpen || inspectChar) {
				// A modal always wins Esc, even from inside the prompt.
				shortcutsOpen = false;
				inspectChar = null;
			} else if (chatSwitcherOpen) {
				// The phone switcher dismisses like any modal.
				closeChatSwitcher();
			} else if (palette.open) {
				// The search palette wins Esc next, even from its input.
				// A first ESC moves DOM focus input -> list (the query
				// stays, the highlight is already tracked); a second
				// ESC — or one with no results — closes.
				if (document.activeElement === searchInputEl && palette.hits.length > 0) {
					focusSearchHit(palette.cursor);
				} else closeSearch();
			} else if (find.open) {
				// The find bar closes from anywhere (its input included).
				closeFind();
			} else if (reviewOpen) {
				// The annotations review closes from anywhere (its
				// textarea keeps its own Esc-to-cancel below).
				reviewOpen = false;
				editingId = null;
			} else if (refsPopOpen) {
				// A sent message's filed-annotations card sits below
				// the review in z, so it dismisses right after it —
				// but a row edit cancels first and the card stays
				// open (a second Esc closes it).
				if (refsEditing) cancelRefsEdit();
				else refsPopOpen = null;
			} else if (expandedTags.length > 0) {
				// A history attachment popup is Svelte state (not DOM),
				// so it sits in the ladder beside the filed-annotations
				// card: Esc closes it.
				expandedTags = [];
			} else if (editingMsgId) {
				// An in-progress message edit cancels from anywhere,
				// including inside the prompt (capture phase pre-empts
				// the editor, which binds nothing to Esc).
				cancelMessageEdit();
			} else if (inEditor) {
				// ESC with the composer focused: drop the caret and
				// dismiss composer-adjacent overlays. Voice keeps playing
				// (it has its own toggle); modals, search, and
				// message edits keep their earlier branches above.
				editor?.blur();
				selMenu = null;
				selPinyin = null;
				openLangMenu = null;
			} else {
				// A bare Esc must never reach the OS/browser default
				// that exits native fullscreen — Esc+f is the only way
				// out. No text harm outside fields.
				// The pill's own Esc handler sits on its textarea
				// (bubble phase), which this capture branch pre-empts —
				// so close it here, or Esc strands an open box.
				cancelAnnPop();
				selMenu = null;
				selPinyin = null;
				inspectChar = null;
				openLangMenu = null;
				settingsOpen = false;
				shortcutsOpen = false;
				stopVoice();
				// Bare Esc drops a lingering message highlight with the
				// menu (click-away parity): editor and field selections
				// are another gesture's business and keep theirs.
				const liveEsc = window.getSelection();
				const escAnchor =
					liveEsc?.anchorNode instanceof Element
						? liveEsc.anchorNode
						: liveEsc?.anchorNode?.parentElement;
				if (liveEsc && !liveEsc.isCollapsed && escAnchor?.closest(".messages .rendered")) {
					clearSelection();
				}
				// Scroll mode entered from a deactivated prompt steps
				// back out on Esc (prompt-entry Esc keeps scroll mode).
				if (focusMode === "scroll" && !scrollFromPrompt) exitScrollMode();
			}
		};

		const onKey = (event: KeyboardEvent) => {
			// Idle-prompt restore allowlist: while hidden, only bare
			// i / Enter / Space / backslash bring the prompt back
			// (never typed — the key is a summon, like scroll mode's
			// i). Every other key merely re-arms the hide timer via
			// the stamp listener.
			if (promptIdle) {
				const inPromptEditor = isPromptEditorTarget(event.target);
				const idleAction = promptIdleKeyAction({
					...keyFacts(event),
					repeat: event.repeat,
					isComposing: event.isComposing,
					inPromptEditor,
					activeInPrompt: isPromptTarget(document.activeElement),
					overlayOpen: stageOwnedByOverlay({
						shortcutsOpen,
						searchOpen: palette.open,
						inspectOpen: inspectChar !== null,
						findOpen: find.open,
						settingsOpen,
						sidebarOpen: !settings.sidebarCollapsed
					}),
					inOwnedTarget: isIdleOwnedTarget(event.target)
				});
				if (idleAction === "restore") {
					focusLog("key-idle-restore", {
						key: event.key,
						target: describeFocusTarget(event.target),
						active: describeActiveElement()
					});
					event.preventDefault();
					restorePrompt();
					// The visibility flip flushes async: focusing now
					// would hit a still-hidden composer (a no-op), so
					// land once the tick makes it focusable again.
					void tick().then(() => enterEditMode());
					return;
				}
				if (idleAction === "swallow") {
					focusLog("key-idle-swallow", {
						key: event.key,
						target: describeFocusTarget(event.target),
						active: describeActiveElement()
					});
					event.preventDefault();
					return;
				}
			}
			// H/L step the Inspect stroke preview while it is open
			// (never leaves the menu): bare keys only, never from a
			// field, and never with modifiers.
			const inspectStep = inspectStepAction({
				...keyFacts(event),
				inspectOpen: inspectChar !== null,
				inField: isInspectFieldTarget(event.target)
			});
			if (inspectStep !== null) {
								consumeEvent(event);
				stepInspect(inspectStep);
				return;
			}
			// The shortcuts filter types freely: bare keys never reach
			// the global bindings — only Esc (close) and ⌘F (focus)
			// keep theirs, both handled below. Modified chords pass
			// through like any other input.
			if (
				shortcutsFilterBlocksKey({
					...keyFacts(event),
					inFilter: isFilterTarget(event.target)
				})
			) {
				return;
			}
			// Bare Space or backslash on an empty composer dismisses:
			// no message starts with a space, so it is never content
			// (backslash rides as the Space-equivalent) — blur (and
			// always-hide hides on blur). Repeats are swallowed while
			// focused; the restore path above already ignores repeats,
			// so a held key can't bounce the prompt back open. Own-
			// message edits and attachment drafts are exempt: clearing
			// real work must stay explicit (Escape).
			const spaceAction = spaceKeyAction({
				...keyFacts(event),
				repeat: event.repeat,
				isComposing: event.isComposing,
				editing: editingMsgId !== null,
				hasAttachments: attachments.length > 0,
				composerEmpty: composerText() === "",
				inPrompt: isPromptEditorTarget(event.target)
			});
			if (spaceAction === "dismiss-composer") {
				event.preventDefault();
				editor?.blur();
				return;
			}
			if (spaceAction === "swallow-repeat") {
				event.preventDefault();
				return;
			}
			// Fullscreen-hold tracking rides above every Escape path:
			// the keydown dismiss behavior below is untouched (a tap
			// still dismisses exactly as today); the keyup handler
			// exits fullscreen only past the hold threshold.
			if (event.key === "Escape" && !event.repeat) escDownAt = Date.now();
			const inEditor = closestFromTarget(event.target, ".cm-content, .ta-input");
			// One snapshot for the whole modifier-chord table below (see
			// commandChord): priority lives in the table, bodies stay here
			// as `if (chord === ...)` chains, never a switch.
			const chord = commandChord(keyFacts(event));
			if (event.key === "Escape") {
				// One ladder for every layer (see dismissEscape):
				// topmost first, exactly one per press.
								consumeEvent(event);
				dismissEscape(inEditor);
				return;
			}
			if (chord === "toggle-palette") {
				// Full-text search palette across chats/annotations.
				// Browsers reserve Ctrl+P for print and may keep it; the
				// shell owns the combo and always delivers it.
								consumeEvent(event);
				if (palette.open) closeSearch();
				else openSearch();
				return;
			}
				if (chord === "toggle-fullscreen") {
					// Fullscreen toggle: Cmd+E and Ctrl+Cmd+F. Claimed
					// before find below, so the dual-modifier chord never
					// reads as Cmd/Ctrl+F.
										consumeEvent(event);
					void toggleFullscreen();
					return;
				}
				if (chord === "find-toggle") {
					// In-chat find across the visible messages, cycling hits.
					// The fullscreen chords are claimed above, so
					// Ctrl+Cmd+F never lands here.
										consumeEvent(event);
					if (shortcutsOpen) {
						// The modal owns ⌘F while open: it filters this
						// list only, never the chat.
						const shortcutInput: HTMLInputElement | null = shortcutInputEl;
						if (shortcutInput) {
							/* eslint-disable @typescript-eslint/no-unsafe-call -- lint-program-only: the $state rune type
							does not resolve under eslint's program here, but svelte-check (real tsc) types both calls. */
							shortcutInput.focus();
							shortcutInput.select();
							/* eslint-enable @typescript-eslint/no-unsafe-call */
						}
						return;
					}
					// Repeat ⌘F closes the bar it opened.
					if (find.open) closeFind();
					else openFind();
					return;
				}
			if (isSummonHotkey(event) && !inEditor) {
			// Summon chord (Cmd/Ctrl+Shift+Space) outside the editor:
			// the toggle's hide half — back to the previous app (the
			// OS-global half in desktop.rs fires too; hide is
			// idempotent). Inside the editor the chord stays unbound
			// so Ctrl+Shift+Space still types a non-breaking space.
						consumeEvent(event);
			void hideSummonWindow();
			return;
		}
			if (chord === "toggle-pastes") {
				// Pasted-text tags: with the prompt focused and tags
				// present, Ctrl+O expands/collapses them all (Muse Code
				// style). Anywhere else the chord does nothing — still
				// swallowed so the browser won't open a file.
				if (inEditor) editor?.togglePastes();
								consumeEvent(event);
				return;
			}
			if (chord === "send") {
				// ⌘Enter sends from anywhere — not just with the prompt
				// focused. Settings fields keep ⌘Enter for themselves.
				if (isFieldTarget(event.target)) return;
								consumeEvent(event);
				onSubmit("send");
				return;
			}
			if (
				chord === "provider-next" ||
				chord === "provider-prev" ||
				chord === "thinking-next" ||
				chord === "thinking-prev"
			) {
				// Capture phase (see listener below): fires before CodeMirror can
				// swallow the combo, so the shortcuts work from anywhere.
								consumeEvent(event);
				if (chord === "provider-next") cycleProvider(1);
				else if (chord === "provider-prev") cycleProvider(-1);
				else if (chord === "thinking-next") cycleThinking(1);
				else cycleThinking(-1);
				return;
			}
			if (chord === "new-chat") {
				// New chat from anywhere, even inside the prompt. The
				// Ctrl+Alt+N spelling uses the physical key code: macOS
				// Option+N reports key "~". ⇧⌘N does the same:
				// single-window app, so there is no new window to open.
				// Note: browsers reserve ⌘N for a new window, so in a
				// plain browser tab this never arrives — the shell owns it.
								consumeEvent(event);
				doNewChat();
				return;
			}
			if (chord === "toggle-voice") {
								consumeEvent(event);
				setVoiceEnabled(!voiceOn());
				return;
			}
			const delScope = deleteChatScope({
				...keyFacts(event),
				inEditor: inEditor !== null,
				inEditable: isEditableTarget(event.target)
			});
			if (delScope === "chat") {
				// ⌘Delete drops the whole current chat (a blank one takes
				// its place, so the composer never strands) and resets the
				// voice language to the checked keyboard. Mac Delete-key
				// reports Backspace; forward-delete reports Delete. Typing
				// targets keep the chord for line-kill habits.
								consumeEvent(event);
				dropChat(chat.id);
				editor?.focus();
				return;
			}
			if (delScope === "all") {
				// ⌘⇧Delete drops EVERY chat (a blank one takes their
				// place, so the composer never strands) and resets the
				// voice language to the checked keyboard.
								consumeEvent(event);
				dropAllChats();
				editor?.focus();
				return;
			}
			// One snapshot for the sidebar/settings/zoom cluster (see
			// chromeChord): same token across spellings, bodies stay
			// here as `if (chrome === ...)` chains, never a switch.
			const chrome = chromeChord({
				...keyFacts(event),
				inEditor: inEditor !== null,
				hovered: hoveredIdx >= 0,
				inField: isFieldTarget(event.target)
			});
			if (chrome === "toggle-sidebar") {
				// ⇧⌘[ and ⌘B: physical key codes for the shifted
				// brackets (layout-dependent `key` values), plain key
				// for ⌘B. Opening the list lands on the active chat.
								consumeEvent(event);
				toggleSidebar();
				if (!settings.sidebarCollapsed) focusActiveSideChat();
				return;
			}
			if (chrome === "toggle-settings") {
				// ⇧⌘], ⌘., ⌘, (the macOS Settings shortcut), and ⇧⌘,
				// (Shift turns the comma key into "<" on US layouts, so
				// both spellings count).
								consumeEvent(event);
				toggleSettingsPanel();
				return;
			}
			if (chrome === "dismiss-or-sidebar") {
				// ⇧⌘H with settings open closes them and lands in the
				// prompt; otherwise it mirrors ⌘B for the chat list.
								consumeEvent(event);
				if (settingsOpen) {
					settingsOpen = false;
					enterEditMode();
					return;
				}
				toggleSidebar();
				if (!settings.sidebarCollapsed) focusActiveSideChat();
				return;
			}
			if (chrome === "dismiss-or-settings") {
				// ⇧⌘L with the chat list open closes it and lands in
				// the prompt; otherwise it mirrors ⌘, for settings.
								consumeEvent(event);
				if (!settings.sidebarCollapsed) {
					settings.sidebarCollapsed = true;
					persistSettings();
					enterEditMode();
					return;
				}
				toggleSettingsPanel();
				return;
			}
			if (chrome === "shortcuts-toggle") {
				// ⇧⌘/ (the "?" chord) toggles the shortcuts modal.
								consumeEvent(event);
				if (shortcutsOpen) shortcutsOpen = false;
				else openShortcuts();
				return;
			}
			if (chrome === "step-chat-newer" || chrome === "step-chat-older") {
				// ⇧⌘J steps down (newer chat, minting one past the
				// newest end); ⇧⌘K steps up (older). Works sidebar-closed.
								consumeEvent(event);
				stepChat(chrome === "step-chat-newer" ? 1 : -1);
				return;
			}
			if (chrome === "zoom") {
				// ⌘+ / ⌘- scales the whole UI (the app's own zoom — the
				// shell has no browser-chrome zoom to fall back on). With Shift
				// held the same chords widen/narrow the chat column instead.
								consumeEvent(event);
				const narrow = event.key === "-" || event.key === "_";
				if (event.shiftKey) adjustChatWidth(narrow ? -2 : 2);
				else adjustFontScale(narrow ? -0.1 : 0.1);
				return;
			}
			if (chrome === "quick-lang") {
				// ⌘1…⌘0 toggles the priority language in flag order —
				// pressing the active one's key clears it again. The
				// body checks the code exists first.
				const code = QUICK_LANG_CODES[quickLangIndexForKey(event.key)];
				if (code) {
										consumeEvent(event);
					if (activeReplyCode === code) clearReplyLang();
					else setReplyLang(code);
					return;
				}
			}
			if (chrome === "delete-message") {
				const target = chat.messages[hoveredIdx];
				if (target) {
										consumeEvent(event);
					deleteMessage(chatState, hoveredIdx);
					return;
				}
			}
			// One snapshot for every hovered-message hotkey below: the
			// guards each walked the target themselves, so this is also
			// fewer ancestor walks per keypress, not more.
			const msgFacts = {
				...keyFacts(event),
				inEditor: inEditor !== null,
				inField: isFieldTarget(event.target),
				inEditable: isEditableTarget(event.target),
				inInteractive: isInteractiveTarget(event.target),
				inFieldOrFilter: isInspectFieldTarget(event.target),
				hasSelection: (window.getSelection()?.toString() ?? "") !== "",
				hoveredIdx,
				escDownAt
			};
			const msgAction = messageKeyAction(msgFacts);
			if (msgAction === "toggle-aids") {
				// A toggles every aid the hovered message offers — pinyin
				// over Chinese lines, furigana over Japanese ones (dual
				// rendering applies each to its own lines, so a mixed
				// message reads end to end instead of favoring Japanese).
				// Same offers the buttons show: refs-stripped display
				// text over the rendered list, never raw stored content.
				const target = viewChat.messages[hoveredIdx];
				const kinds = target ? offeredLocalAids(aidDisplayText(target.content), activeReplyCode) : [];
				if (target && kinds.length > 0) {
										consumeEvent(event);
					const { pin, unpin } = toggleAidKinds(kinds, pinnedKinds(target.id));
					for (const kind of unpin) unpinLocalAid(target, kind);
					for (const kind of pin) pinLocalAid(target, kind);
					return;
				}
			}
			if (msgAction === "pin-pinyin" || msgAction === "pin-furigana") {
				// M pins pinyin, N pins furigana on the message in the
				// middle of the screen (toggle — a second press lifts it).
				// Kinds the center message doesn't offer stay off, exactly
				// like A on an unoffered hover. The token names the kind,
				// so the body never re-reads the key.
				const idx = centerMessageIndex();
				const target = idx >= 0 ? viewChat.messages[idx] : undefined;
				const want: LocalAid = msgAction === "pin-pinyin" ? "pinyin" : "furigana";
				const toggle =
					target ?
						toggleSingleAid(
							offeredLocalAids(aidDisplayText(target.content), activeReplyCode),
							pinnedKinds(target.id),
							want
						)
					:	null;
				if (target && toggle !== null) {
										consumeEvent(event);
					if (toggle === "unpin") unpinLocalAid(target, want);
					else pinLocalAid(target, want);
					return;
				}
			}
			if (msgAction === "exit-fullscreen") {
				// Esc+f exits fullscreen — the only way out. Escape
				// alone never exits (it keeps its dismiss job).
								consumeEvent(event);
				escDownAt = 0;
				void exitFullscreen();
				return;
			}
			if (msgAction === "fold-hovered") {
				// F folds/unfolds the hovered message. The prompt owns
				// keystrokes inside it, so typing "f" there is untouched.
				const target = chat.messages[hoveredIdx];
				if (target) {
					event.preventDefault();
					toggleFold(target.id);
					return;
				}
			}
			if (msgAction === "edit-hovered") {
				// E pulls the hovered own message into the composer for
				// editing — same ownership rule as F, own messages only.
				if (canEditMessage(chat.messages, hoveredIdx)) {
					event.preventDefault();
					editMessage(hoveredIdx);
					return;
				}
			}
		if (msgAction === "cut-hovered") {
				// X cuts the hovered message (copies, then deletes): Shift+D
				// below deletes without touching the clipboard.
				// An in-place code edit owns its keystrokes — X types x.
				event.preventDefault();
				cutHoverMessage(hoveredIdx);
				return;
		}
		if (msgAction === "delete-hovered") {
			// Shift+D drops the hovered message and copies nothing
			// (X is the cut key). Bare Delete never deletes — too easy
			// to hit while reading. Physical code, so any layout's D
			// works. Buttons and links keep their own keys.
			event.preventDefault();
			deleteMessage(chatState, hoveredIdx);
			return;
		}
		if (msgAction === "copy-hovered") {
			// C copies the hovered message as plain text (the row
			// button's own path, toast included) — only with nothing
			// selected, so a live selection keeps its keys.
			const target = viewChat.messages[hoveredIdx];
			if (target) {
				consumeEvent(event);
				copyText(target.content, target.role);
				return;
			}
		}
		if (msgAction === "branch-hovered") {
			// Shift+C branches from the hovered message, same as its
			// row button.
			const target = viewChat.messages[hoveredIdx];
			if (target) {
				consumeEvent(event);
				branchFrom(chatState, hoveredIdx);
				return;
			}
		}
		if (msgAction === "speak-hovered") {
			// Shift+R reads the hovered message aloud (Stop when it is
			// the one playing) — the row button's toggle, gated the
			// same way, so languageless text stays silent.
			const target = viewChat.messages[hoveredIdx];
			if (target && messageSpeakable(target)) {
				consumeEvent(event);
				if (speakingId === target.id) stopVoice();
				else void speakReply(target);
				return;
			}
		}
		// One snapshot for the open chat list (see sidebarListAction):
		// it owns j/k/space/l/Delete with preview-as-you-go. Bodies
		// stay here as `if (sideAction === ...)` chains, never a switch.
		const inSidebar = isSidebarTarget(event.target);
		if (isFieldTarget(event.target)) {
			focusLog("key-in-field", {
				key: event.key,
				target: describeFocusTarget(event.target),
				active: describeActiveElement(),
				focusMode,
				promptIdle
			});
		}
		const sideAction = sidebarListAction({
			...keyFacts(event),
			listOpen: !settings.sidebarCollapsed,
			inSidebar,
			inField: isFieldTarget(event.target)
		});
			if (sideAction !== null) {
				focusLog("key-sidebar-consume", {
					key: event.key,
					action: sideAction,
					target: describeFocusTarget(event.target),
					active: describeActiveElement()
				});
			}
			if (sideAction === "walk-down" || sideAction === "walk-up") {
				// Walking switches to each chat (preview-as-you-go).
				event.preventDefault();
				const delta = sideAction === "walk-down" ? 1 : -1;
				const chats = chatState.chats;
				const from =
					sideIdx >= 0 ? sideIdx : chats.findIndex((c) => c.id === chatState.activeChatId);
				focusSideChat(from + delta);
				const landed = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
				if (landed) transitionToChat(landed.id);
				return;
			}
			if (sideAction === "enter") {
				// Space would click the focused button by default; take
				// it over so entering always lands in the prompt
				// (resolveSidebarSpaceEnter: nothing selected stays
				// on the current chat, never the top one).
				event.preventDefault();
				settings.sidebarCollapsed = true;
				persistSettings();
				if (resolveSidebarSpaceEnter(sideIdx, chatState.chats.length).kind === "stay") {
					enterEditMode();
				} else enterSideChat();
				return;
			}
			if (sideAction === "delete-chat") {
				// Delete drops the focused chat and lands on the one
				// below (or a fresh blank when the list empties).
				event.preventDefault();
				deleteSideChat();
				return;
			}
			// Bare Space never changes modes: it belongs to typing and
			// buttons, scrolls natively everywhere else, and summons
			// the hidden prompt through the key path above — scroll
			// mode is entered with Ctrl+G only.
			if (
				scrollEnterAction({
					...keyFacts(event),
					inScrollMode: focusMode === "scroll",
					inEditor: inEditor !== null,
					androidUI,
					shortcutsOpen,
					searchOpen: palette.open,
					inspectOpen: inspectChar !== null,
					inOwnedTarget: isScrollEnterOwnedTarget(event.target)
				})
			) {
				// Ctrl+G outside the composer enters scroll mode at the
				// current message in view (scroll → edit stays on the
				// branch below, like I).
				event.preventDefault();
				scrollToViewCursor();
				return;
			}
			const modalScroll = modalScrollAction({
				...keyFacts(event),
				shortcutsOpen,
				searchOpen: palette.open,
				inspectOpen: inspectChar !== null,
				inEditor: inEditor !== null,
				androidUI,
				inEditable: isEditableTarget(event.target)
			});
			if (modalScroll !== null) {
				// The shortcuts modal scrolls under j/k like the main
				// chat, contained: the palette and Inspect keep their own
				// keys, fields keep typing, and the main column never moves.
				const modalBox = document.querySelector<HTMLElement>(".modal-veil .modal");
				if (modalBox) {
					const dy = modalScroll === "line-down" ? SCROLLKEY_LINE_PX : -SCROLLKEY_LINE_PX;
										consumeEvent(event);
					modalBox.scrollBy({ top: dy, behavior: "smooth" });
					return;
				}
			}
			if (focusMode !== "scroll" && !inEditor && !androidUI) {
				// Desktop scrolling with nothing selected: no message
				// selected (edit mode), no sidebar focus, no modal
				// owning the screen, and no typing target under the
				// key. Every existing binding above keeps its keys —
				// this branch only claims otherwise-unbound bare keys.
				const modalOpen = Boolean(shortcutsOpen || palette.open || inspectChar);
				const typing = Boolean(inEditor || isEditableTarget(event.target) || inSidebar);
				// Ctrl+U/D jumps and empty-chat Space/Enter/i (see
				// unselectedScrollAction); the intent glide below keeps
				// its own guard and extracted call.
				const unselected = unselectedScrollAction({
					...keyFacts(event),
					scrollable: true,
					modalOpen,
					typing,
					findOpen: find.open,
					emptyPromptSpace: keyFocusesEmptyPrompt({
						...keyFacts(event),
						messageCount: viewChat.messages.length,
						inInteractive: isSpaceInteractiveTarget(event.target)
					}),
					hasScrollBox: scrollBox !== undefined
				});
				if (unselected === "half-jump-up" || unselected === "half-jump-down") {
					// Ctrl+U / Ctrl+D jump an instant half-page, vim-style
					// (repeats jump again) — including with nothing selected.
					// Bare d/u fast-scroll instead (desktop) or stay dead
					// (phones); other ctrl chords keep theirs.
					event.preventDefault();
					lastGAt = 0;
					if (scrollBox) {
						scrollChatBy(
							halfPageDy(scrollBox.clientHeight, unselected === "half-jump-up" ? -1 : 1)
						);
					}
					return;
				}
				if (unselected === "empty-enter") {
					event.preventDefault();
					lastGAt = 0;
					enterEditMode();
					return;
				}
				if (!modalOpen && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
					const intent = unselectedScrollIntent(event.key, ggArmed(lastGAt, Date.now()));
					if (intent) {
						if (intent.kind === "gg-prefix") {
							lastGAt = Date.now();
						} else {
							lastGAt = 0;
							if (
								intent.kind === "line" ||
								intent.kind === "half-page" ||
								intent.kind === "skip"
							) {
								// Bare d/u stay dead on phones (touch owns
								// scrolling there); desktop skips a smooth
								// fixed step per tap and glides fast while
								// held — never an instant jump.
								if (intent.kind === "half-page" && androidUI) {
									event.preventDefault();
									return;
								}
								// Held keys glide via the rAF loop (no restart
								// stutter); the loop owns repeats until keyup.
								// Other line sources (arrows) keep stepping.
								// Taps land the hold's own step (line for
								// j/k, skip step for d/u).
								const velocity = scrollBox ? scrollHoldVelocity(event.key) : null;
								if (velocity !== null) {
									if (!event.repeat && scrollBox) {
										const tapDy =
											intent.kind === "half-page"
												? halfPageDy(scrollBox.clientHeight, intent.dir)
												: intent.kind === "skip"
													? intent.dir * SCROLLKEY_SKIP_PX
													: Math.sign(velocity) * SCROLLKEY_LINE_PX;
										startScrollHold(event.key, velocity, tapDy);
									}
								} else if (intent.kind === "line") scrollChatBy(intent.dy);
								else if (scrollBox) scrollChatBy(halfPageDy(scrollBox.clientHeight, intent.dir));
							} else if (intent.kind === "top") scrollChatTop();
							else if (intent.kind === "bottom") scrollChatBottom();
							else if (intent.kind === "hovered-edge" && hoveredIdx >= 0) {
								scrollHoveredEdge(intent.edge);
							} else return;
						}
						event.preventDefault();
						return;
					}
					lastGAt = 0;
				}
			}
			// One snapshot for the scroll-mode tail (see scrollModeAction):
			// `lastGAt` bookkeeping and every scroll effect stay here as
			// `if` chains, never a switch.
			const scrollAction = scrollModeAction({
				...keyFacts(event),
				phoneUI: androidUI,
				inScrollMode: focusMode === "scroll",
				inEditor: inEditor !== null,
				inFind: isFindBarTarget(event.target),
				inField: isFieldTarget(event.target),
				gArmed: ggArmed(lastGAt, Date.now()),
				atNewest: selectedIdx >= chat.messages.length - 1,
				scrollFromPrompt
			});
			if (scrollAction === null) {
				if (focusMode !== "scroll" || inEditor) return;
				if (isFindBarTarget(event.target)) return;
				return;
			}
			focusLog("key-scroll-consume", {
				key: event.key,
				action: scrollAction,
				target: describeFocusTarget(event.target),
				active: describeActiveElement(),
				focusMode
			});
			if (scrollAction === "arm-g") {
				// A lone g starts the gg beat without consuming the key.
				lastGAt = Date.now();
				return;
			}
			if (scrollAction === "step-down") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(selectedIdx + 1);
				return;
			}
			if (scrollAction === "step-up") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 1, 0));
				return;
			}
			if (scrollAction === "go-top") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(0);
				return;
			}
			if (scrollAction === "go-bottom") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(chat.messages.length - 1);
				return;
			}
			if (scrollAction === "half-jump-up" || scrollAction === "half-jump-down") {
				// Ctrl+U / Ctrl+D jump one instant half-page per press,
				// vim-style (repeats jump again). Shift+D keeps its
				// delete job above.
				event.preventDefault();
				lastGAt = 0;
				const dir: 1 | -1 = scrollAction === "half-jump-up" ? -1 : 1;
				if (scrollBox) scrollChatBy(halfPageDy(scrollBox.clientHeight, dir));
				return;
			}
			if (scrollAction === "skip-down" || scrollAction === "skip-up") {
				// Bare d/u taps skip one smooth fixed step (a little,
				// never a half-page) — repeats skip again.
				event.preventDefault();
				lastGAt = 0;
				const dir: 1 | -1 = scrollAction === "skip-up" ? -1 : 1;
				if (scrollBox) scrollChatBy(dir * SCROLLKEY_SKIP_PX);
				return;
			}
			if (scrollAction === "enter-edit") {
				event.preventDefault();
				lastGAt = 0;
				enterEditMode();
				return;
			}
			if (scrollAction === "scroll-toggle") {
				// Ctrl+G returns to a focused, type-ready composer only
				// when scroll mode started there (the editor keymap
				// handles edit → scroll). Entering from a deactivated
				// prompt steps back out instead. Either way swallow the
				// chord: the browser would open find-next.
				event.preventDefault();
				lastGAt = 0;
				if (scrollFromPrompt) enterEditMode();
				else exitScrollMode();
				return;
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			focusLog("focusin", {
				target: describeFocusTarget(event.target),
				active: describeActiveElement(),
				focusMode
			});
			if (closestFromTarget(event.target, ".cm-content")) {
				focusMode = "edit";
			}
		};
		// Badge press switches the edit box directly (A → B in one
		// click). Mousedown with preventDefault runs before the open
		// textarea's blur-save can fire, so the current pop saves and
		// the next opens synchronously — no re-stamp race eats the
		// press. The delegated click in MessageBody stays as the
		// keyboard path (Enter). Desktop Chrome eats the click that
		// trails a preventDefaulted mousedown, but iOS Safari fires
		// it — without the press stamp below, every tap opens the
		// menu on mousedown and toggles it straight shut on click.
		const onBadgePress = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			const badge = target?.closest<HTMLElement>("[data-ann-badge]");
			if (!badge) return;
			event.preventDefault();
			const id = (badge.dataset.annBadge ?? "") as AnnotationId;
			// A re-press toggles closed (cancel): saving first would
			// restart the fade the toggle is about to cancel.
			if (!(annPop && !annPopClosing && annPop.id === id)) saveAnnPop();
			// Same boundary as MessageBody's badge click: stamped ids.
			// The press point anchors the desktop edit menu; phones
			// edit in the composer and ignore it.
			focusLog("badge-press", { id, active: describeActiveElement() });
			openBadge(id, { x: event.clientX, y: event.clientY });
			lastBadgePress = { id, at: Date.now() };
		};
		/**
		 * Click-off closes the annotations review (desktop): a press
		 * outside the pill/card unpins it. Presses inside .ann-wrap
		 * (pill toggle, quote jumps, edit buttons) keep their own
		 * behavior; phones keep tap-driven flow and skip this.
		 */
		const dismissReview = (event: MouseEvent) => {
			if (event.button !== 0 || androidUI || !reviewOpen) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(".ann-wrap")) return;
			reviewOpen = false;
			editingId = null;
		};
		// Double-click summons the menu for the native word pick (the
		// pick finalizes after mouseup, so mouseup alone never sees it).
		// Triple-click keeps native paragraph selection: badges are
		// absolutely-positioned overlays with user-select:none, so they
		// no longer interrupt it the way inline marks did.
		const clickGuardsPass = (event: MouseEvent): boolean => {
			if (event.altKey) return false;
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest(".cm-content, .sel-menu, .review, button, input, textarea")
			) {
				return false;
			}
			return true;
		};
		/**
		 * Middle-click toggles the shortcuts modal from anywhere
		 * (links included — the app has no external links worth a
		 * new tab): open when closed, close when open. Either way
		 * it interrupts speech like Esc does — a modal over talking
		 * is never what the click meant.
		 */
		const onMiddleClick = (event: MouseEvent) => {
			if (event.button !== 1) return;
			event.preventDefault();
			shortcutsOpen = !shortcutsOpen;
			stopVoice();
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (!clickGuardsPass(event)) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
			// Word picks at a line's end grab the trailing newline,
			// painting the line beneath (same terminator as triple-click
			// paragraph picks, which trims in onSelectEnd instead).
			if (live && live.rangeCount > 0) {
				try {
					trimParagraphTerminator(live.getRangeAt(0));
				} catch {
					// Cosmetic: the untrimmed pick still summons.
				}
			}
			placeSelMenu(event.clientX, event.clientY);
			if (androidUI) scrollActionsIntoView(event);
		};
		/**
		 * Double-tapping a message whose action row is off-screen
		 * scrolls the row into view: its buttons live below the fold
		 * and a phone has no hover to reveal them. Rows already
		 * visible never move (nearest), and desktop keeps word-select
		 * only. Own and assistant rows share the .actions class.
		 */
		const scrollActionsIntoView = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			const actions = target?.closest("article")?.querySelector(".actions");
			const box = scrollBox;
			if (!(actions instanceof HTMLElement) || !(box instanceof HTMLElement)) return;
			const row = actions.getBoundingClientRect();
			const view = box.getBoundingClientRect();
			if (row.bottom > view.bottom || row.top < view.top) {
				actions.scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		};
		// No triple-click handler: native paragraph selection finalizes
		// on the third mouseup, where onSelectEnd already locks it to the
		// message and summons the menu.
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			downSel = window.getSelection()?.toString() ?? "";
		};
		/**
		 * A press that starts outside message text must not eat a live
		 * highlight: dragging in from the gutter would otherwise collapse
		 * the selection at press time, before mouseup ever sees it. Only
		 * dead chrome qualifies — the prompt, sidebars, and controls keep
		 * their native press behavior (clicks still fire everywhere;
		 * this only skips the selection reset).
		 */
		const preserveMessageHighlight = (event: MouseEvent): void => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!target?.closest("main") || target.closest(".rendered, .prompt")) return;
			const live = window.getSelection();
			const anchor =
				live && !live.isCollapsed
					? live.anchorNode instanceof Element
						? live.anchorNode
						: live.anchorNode?.parentElement
					: null;
			if (!anchor?.closest(".messages .rendered")) return;
			event.preventDefault();
		};
		/** Press point for the drag-vs-click read in onMouseUp below. */
		let downClient: { x: number; y: number } | null = null;
		const noteDownPoint = (event: MouseEvent): void => {
			downClient = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
		};
		/** Latest pointer point (drag-vs-click for the mid-drag
		collapse restore below). Passive, one store per move. */
		let lastMoveClient: { x: number; y: number } | null = null;
		const noteMovePoint = (event: MouseEvent): void => {
			if (!selectingInMessage && !offChatDragArmed) return;
			lastMoveClient = { x: event.clientX, y: event.clientY };
			// Silent engine collapses (no selectionchange fires) get
			// restored here, synchronously before paint; evented ones
			// go through trimMessageDrag below. Plain lets only — no
			// re-render for pointer travel.
			const live = window.getSelection();
			if (live) {
				restoreDragSelection(live);
				trackDragSelection(live);
			}
		};
		// A drag that starts in message text never highlights its
		// neighbors: while the button is down, any selection escaping
		// the anchor article trims back live (mouseup's lock only fixed
		// it after the fact, flashing two messages blue mid-drag).
		let selectingInMessage = false;
		// A drag that starts off-chat (gutter, margins, off-screen)
		// never highlights above the cursor's current line: while the
		// button is down, an anchor end outside message text pins back
		// to the focus line's start on every selection change.
		let offChatDragArmed = false;
		// Cross-message drag containment (WebKit): the engine re-anchors
		// a drag into the next selectable block, and the flip fires no
		// selectionchange the lock can see — post-flip both ends sit in
		// one article, so the highlight visibly jumps messages and the
		// quote lands on the wrong one. While a message drag is down,
		// every other article's prose goes unselectable inline (a
		// stylesheet can't reach the child component's .rendered past
		// scoping): the engine clamps at the anchor article's edge
		// instead of flipping, and mouseup's lock only ever sees one
		// article. Always cleared on mouseup/blur — never a resting state.
		let dragAnchorArticle: Element | null = null;
		const containDragTo = (article: Element | null): void => {
			if (dragAnchorArticle === article) return;
			for (const el of document.querySelectorAll("[data-drag-none]")) {
				if (el instanceof HTMLElement) {
					el.style.userSelect = "";
					el.style.removeProperty("-webkit-user-select");
				}
				el.removeAttribute("data-drag-none");
			}
			dragAnchorArticle?.removeAttribute("data-drag-anchor");
			dragAnchorArticle = article;
			if (!article) return;
			article.setAttribute("data-drag-anchor", "1");
			const scope = article.closest(".messages") ?? document;
			for (const prose of scope.querySelectorAll(
				'article[id^="msg-"]:not([data-drag-anchor]) .rendered'
			)) {
				if (prose instanceof HTMLElement) {
					prose.setAttribute("data-drag-none", "1");
					prose.style.userSelect = "none";
					prose.style.setProperty("-webkit-user-select", "none");
				}
			}
		};
		// Last in-article drag selection (nodes + offsets): WebKit folds
		// the whole drag when the focus crosses into unselectable
		// content (gaps, contained articles), collapsing mid-gesture.
		// While the button stays down and moving, that collapse is
		// never intent — put the last good selection back before paint
		// so the highlight freezes at the anchor article's edge instead
		// of vanishing. Clicks never move (>4px, the onMouseUp line),
		// so click-deselect still clears. Nodes are re-checked on every
		// restore (stream swaps detach them).
		let lastGoodDragRange: { an: Node; ao: number; fn: Node; fo: number } | null = null;
		const movedSinceDown = (): boolean => {
			if (!downClient || !lastMoveClient) return false;
			return Math.hypot(lastMoveClient.x - downClient.x, lastMoveClient.y - downClient.y) > 4;
		};
		const trackDragSelection = (live: Selection): void => {
			if (live.isCollapsed || live.rangeCount === 0) return;
			const anchorNode = live.anchorNode;
			const focusNode = live.focusNode;
			if (!anchorNode || !focusNode) return;
			const anchorArticle = articleOf(anchorNode);
			if (anchorArticle && anchorArticle === dragAnchorArticle) {
				lastGoodDragRange = { an: anchorNode, ao: live.anchorOffset, fn: focusNode, fo: live.focusOffset };
			}
		};
		const restoreDragSelection = (live: Selection): boolean => {
			if (!live.isCollapsed) return false;
			if (!movedSinceDown() || !lastGoodDragRange) return false;
			// Dragging home to the anchor point cancels: only resurrect
			// collapses stranded outside the anchor article.
			if (articleOf(live.anchorNode) === dragAnchorArticle) return false;
			// Collapses inside the prompt or a control are that
			// gesture's business (editor selections), never the
			// message drag's.
			const collapsedEl =
				live.anchorNode instanceof Element ? live.anchorNode : live.anchorNode?.parentElement;
			if (collapsedEl?.closest(".cm-content, input, textarea")) return false;
			const { an, ao, fn, fo } = lastGoodDragRange;
			if (!document.contains(an) || !document.contains(fn)) {
				lastGoodDragRange = null;
				return false;
			}
			try {
				live.setBaseAndExtent(an, ao, fn, fo);
				return true;
			} catch {
				return false;
			}
		};
		const armMessageDrag = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			// Clicking off dismisses the pinyin overlay even when the
			// highlight itself lingers (the panel is pointer-transparent,
			// so every press lands outside it). A right-click re-summons
			// through contextmenu right after when it still applies.
			selPinyin = null;
			selectingInMessage = event.button === 0 && !!target?.closest(".messages .rendered");
			offChatDragArmed = event.button === 0 && !target?.closest(".messages .rendered");
			lastGoodDragRange = null;
			containDragTo(selectingInMessage ? articleOf(target) : null);
		};
		const trimMessageDrag = (): void => {
			if (selectingInMessage) {
				const live = window.getSelection();
				if (live) {
					restoreDragSelection(live);
					trackDragSelection(live);
					lockSelectionToMessage(live, articleOf);
				}
				return;
			}
			clampOffChatDrag();
			// The pinyin overlay belongs to one highlight: a changed or
			// cleared selection dismisses it (mid-drag leaves it until
			// release, like the menu's own paths).
			if (selPinyin) {
				const now = currentQuote();
				if (!now || now.messageId !== selPinyin.messageId || now.quote !== selPinyin.quote)
					selPinyin = null;
			}
		};
		const clampOffChatDrag = (): void => {
			if (!offChatDragArmed) return;
			try {
				const live = window.getSelection();
				if (!live || live.rangeCount === 0) return;
				// Mid-drag engine collapse first (same restore as the
				// in-message path below): WebKit folds the drag when
				// the focus crosses unselectable content.
				restoreDragSelection(live);
				if (live.isCollapsed) return;
				const anchorNode = live.anchorNode;
				const focusNode = live.focusNode;
				if (!anchorNode || !focusNode) return;
				const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
				const focusEl = focusNode instanceof Element ? focusNode : focusNode.parentElement;
				if (!focusEl?.closest(".messages .rendered")) return;
				// Anchors in the prompt or a control are their own
				// gesture (editor selections, button presses) — never
				// an off-chat message drag. An anchor stranded in
				// ANOTHER message's prose (first contact grazed it on
				// the way in) re-seats below instead of freezing: the
				// highlight would span messages and mouseup's lock
				// would quote text the pointer never settled on.
				if (anchorEl?.closest(".cm-content, input, textarea")) return;
				if (
					anchorEl?.closest(".messages .rendered") &&
					articleOf(anchorNode) === articleOf(focusNode)
				)
					return;
				// Only the upward side clamps: an anchor below the
				// cursor highlights below it, which is allowed.
				let anchorAbove: boolean;
				if (anchorNode === focusNode) anchorAbove = live.anchorOffset < live.focusOffset;
				else {
					anchorAbove = !!(anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING);
				}
				if (!anchorAbove) {
					// An anchor below the cursor is allowed — unless it
					// sits in another message's prose, where mouseup's
					// lock would quote text the pointer never settled
					// on. Re-seat it to the focus line like the upward
					// side; anchors below in non-message content still
					// highlight below them untouched.
					if (
						anchorEl?.closest(".messages .rendered") &&
						articleOf(anchorNode) !== articleOf(focusNode) &&
						focusNode instanceof Text
					) {
						containDragTo(articleOf(focusNode));
						const text = focusNode.textContent ?? "";
						const start = lineStartOffset(text, live.focusOffset);
						live.setBaseAndExtent(focusNode, start, focusNode, live.focusOffset);
						trackDragSelection(live);
					}
					return;
				}
				// First contact with message text anchors the drag: later
				// moves into other articles clamp at this article's edge
				// instead of flipping the anchor (see containDragTo).
				containDragTo(articleOf(focusNode));
				if (anchorNode instanceof Text && anchorNode === focusNode) {
					const text = anchorNode.textContent ?? "";
					const fixed = clampDragAnchorToFocusLine(text, live.anchorOffset, live.focusOffset);
					if (fixed !== live.anchorOffset) {
						live.setBaseAndExtent(anchorNode, fixed, focusNode, live.focusOffset);
					}
					trackDragSelection(live);
					return;
				}
				// Cross-node: the anchor sits in earlier (or foreign)
				// content — pin it to the cursor line's start inside
				// the focus node, so nothing above that line stays
				// highlighted.
				if (focusNode instanceof Text) {
					const text = focusNode.textContent ?? "";
					const start = lineStartOffset(text, live.focusOffset);
					live.setBaseAndExtent(focusNode, start, focusNode, live.focusOffset);
				}
				trackDragSelection(live);
			} catch {
				// Selection trimming is cosmetic: never break the drag.
			}
		};
		const onMouseUp = (event: MouseEvent) => {
			// Release-restore before the clears below: a drag that died
			// mid-gesture (WebKit folds it crossing unselectable
			// content) summons off its last live selection instead of
			// nothing. Clicks never moved (restore no-ops) so
			// click-deselect still clears; releases outside the chat
			// stay silent (sidebar release = cancel); right-click keeps
			// its speak path.
			const upTarget = event.target instanceof Element ? event.target : null;
			if (event.button !== 2 && upTarget?.closest(".messages")) {
				const liveUp = window.getSelection();
				if (liveUp) restoreDragSelection(liveUp);
			}
			selectingInMessage = false;
			offChatDragArmed = false;
			lastGoodDragRange = null;
			lastMoveClient = null;
			containDragTo(null);
			// Compat mouseup trailing a touch-handled selection: the menu
			// is already up, and the staleness check below would clear it
			// as a no-change click (touchMenuAt lives with the touchend
			// listener above).
			if (Date.now() - touchMenuAt < 800) return;
			// Ignore clicks that start inside the prompt, popups, or buttons —
			// only freshly selected message text summons the menu.
			if (event.button === 2) return; // right-click speaks via contextmenu, never the menu
			// Non-element targets (synthetic document/window events) carry no
			// selection UI — real mouse-ups always target an Element.
			const target = event.target instanceof Element ? event.target : null;
			if (openLangMenu) {
				if (!target?.closest(".lang-menu")) openLangMenu = null;
			}
			if (target?.closest(".cm-content, .sel-menu, .ann-dock, .review, button, input, textarea")) {
				// Clicking away into the prompt or a control clears the
				// highlight and drops the menu with it — but never the
				// menu's own clicks: the Annotate button's click fires
				// after this mouseup (the phone composer's docked twin
				// included). Drags ending on a control keep the old path
				// (a selection drawn across into a button still summons).
				if (!target?.closest(".sel-menu, .ann-dock")) {
					const endedDrag = downClient
						? Math.hypot(event.clientX - downClient.x, event.clientY - downClient.y) > 4
						: false;
					if (!endedDrag) {
						focusLog("mouseup-clear-on-control", {
							target: describeFocusTarget(event.target),
							active: describeActiveElement()
						});
						// WebKit: clearing the selection on mouseup after a
						// field took focus destroys the just-placed caret —
						// later keystrokes dispatch yet never become text
						// (see mouseupKeepsSelection: clicks into editables
						// already moved the selection there, and presses
						// that keep field focus keep a live caret too).
						if (!mouseupKeepsSelection(event.target, document.activeElement)) {
							window.getSelection()?.removeAllRanges();
						}
						selMenu = null;
					} else if ((window.getSelection()?.toString() ?? "") === "") {
						selMenu = null;
					}
				}
				return;
			}
			const live = window.getSelection();
			const liveText = live?.toString() ?? "";
			// Clicks clear stale highlights; drags never do — a press in
			// the gutter that travels into the chat keeps the highlight
			// it started with (the press itself is preserved above).
			const dragged = downClient
				? Math.hypot(event.clientX - downClient.x, event.clientY - downClient.y) > 4
				: false;
			// A plain click anywhere dismisses: the stale-highlight path
			// below clears it (a changed selection from a multi-click
			// reselect is new work, not a collapse — it falls through to
			// the normal summon path). Escape / the timer still dismiss.
			if (!dragged && liveText === downSel && (event.detail <= 1 || event.detail >= 4)) {
				// A plain click changed nothing: blank space, a collapsed
				// caret, or inside the old highlight (the engine collapses
				// that only after mouseup dispatches, so the stale text
				// still reads "selected" here — re-summoning off it is what
				// stranded the menu on a cleared highlight). Drop any stale
				// highlight and never re-summon. Multi-click sequences
				// (detail 2–3) keep the old path: their picks finalize
				// around these events.
				if (liveText !== "") live?.removeAllRanges();
				selMenu = null;
				return;
			}
			if (!dragged && !target?.closest(".rendered") && liveText !== "" && liveText === downSel) {
				live?.removeAllRanges();
				selMenu = null;
				return;
			}
			onSelectEnd(event, event.clientX);
		};
		// Word under the cursor, or "" on open space / non-text.
		function wordUnderCursor(event: MouseEvent, body: Element): string {
			let range: Range | null = null;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					range = document.caretRangeFromPoint(event.clientX, event.clientY);
				}
			} catch {
				range = null;
			}
			const node = range?.startContainer;
			if (!node || node.nodeType !== Node.TEXT_NODE || !body.contains(node)) return "";
			return extractWordAt(node.textContent ?? "", range?.startOffset ?? 0);
		}
		/** True when the right-click point lands on a Han character
		inside the message body (same hit test as the word reader). */
		function hanCharUnderCursor(event: MouseEvent, body: Element): boolean {
			let range: Range | null = null;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					range = document.caretRangeFromPoint(event.clientX, event.clientY);
				}
			} catch {
				range = null;
			}
			const node = range?.startContainer;
			if (!node || !body.contains(node)) return false;
			let ch: string;
			if (node.nodeType === Node.TEXT_NODE) {
				ch = (node.textContent ?? "")[range?.startOffset ?? 0] ?? "";
			} else {
				const kid = node.childNodes[range?.startOffset ?? 0];
				ch = kid?.textContent?.[0] ?? "";
			}
			return ch !== "" && isHanChar(ch);
		}
		/** Dock the readings overlay centered on the highlight, above
		it (below only when the top edge leaves no room). Centering
		rides CSS translateX so panel width — and font size — never
		matters; a frame later the true width clamps it exactly into
		the viewport. The above branch anchors on the highlight's top
		edge the same way, so tall readings never need measuring. */
		function placeSelPinyin(quoted: { quote: string; messageId: ChatMsgId }, html: string): void {
			const live = window.getSelection();
			const rect = live?.rangeCount ? live.getRangeAt(0).getBoundingClientRect() : null;
			if (!rect) return;
			const above = rect.top >= 128;
			const y = above ? rect.top : Math.min(rect.bottom, window.innerHeight - 40);
			selPinyin = {
				x: Math.min(Math.max(8, rect.left), window.innerWidth - 208),
				y,
				above,
				quote: quoted.quote,
				messageId: quoted.messageId,
				html
			};
			requestAnimationFrame(() => {
				const node = document.querySelector(".sel-pinyin");
				const current = window.getSelection();
				const now = current?.rangeCount ? current.getRangeAt(0).getBoundingClientRect() : null;
				if (!node || !now || !selPinyin) return;
				// Same highlight still live (not scrolled or changed)?
				if (Math.abs(now.left - rect.left) > 2 || Math.abs(now.top - rect.top) > 2) return;
				const w = node.getBoundingClientRect().width;
				const x = Math.min(Math.max(w / 2 + 8, now.left + now.width / 2), window.innerWidth - w - 8);
				if (Math.abs(x - selPinyin.x) > 1) selPinyin = { ...selPinyin, x };
			});
		}
		/**
		 * Japanese side of the overlay: furigana for just the highlight,
		 * converted on demand (worker). The panel lands at once with a
		 * pending mark — the dictionary load behind a cold worker takes
		 * seconds, and a silent wait reads as a dead click (the second
		 * right-click only "worked" because the first fetch had landed
		 * by then). Stale right-clicks never fill it: a moved-on
		 * highlight drops the result instead of showing it.
		 */
		async function showSelectionFurigana(quoted: {
			quote: string;
			messageId: ChatMsgId;
		}): Promise<void> {
			placeSelPinyin(quoted, "…");
			let html: string;
			try {
				html = await furiganaHtml(quoted.quote, "furigana");
			} catch {
				html = "";
			}
			const now = currentQuote();
			if (!now || now.messageId !== quoted.messageId || now.quote !== quoted.quote) return;
			const readings = readingsOnly(html, "", ".frt");
			if (!readings) {
				if (selPinyin?.quote === quoted.quote) selPinyin = null;
				return;
			}
			placeSelPinyin(quoted, readings);
		}
		// Desktop right-click reads aloud (the selection, else the word
		// under the cursor, else the whole message; a second
		// right-click restarts it, never stops it) AND opens the
		// native menu: no preventDefault here, so Copy stays
		// available beside speech.
		// (Android long-press never starts audio — it summons the menu.)
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			// Android long-press fires contextmenu mid-hold, before
			// touchend: summon the menu off the live selection without
			// consuming the event, so the native callout (Copy) still
			// appears.
			if (androidUI && target?.closest(".messages .rendered")) {
				if (currentQuote()) {
					placeSelMenu(event.clientX, event.clientY);
					touchMenuAt = Date.now();
				}
				return;
			}
			if (androidUI) return;
			const body = target?.closest(".messages .rendered");
			if (!body) return;
			// Code comes before the control check below on purpose: the
			// copy icon is a button, but a code block (body or folded
			// label) toggles its fold here, never speech. Headless
			// chrome has no fold bar, so the wrapper toggles directly;
			// the copy and Run icons stay silent via the control check.
			const codeBlock = closestFromTarget(event.target, ".ccez-code");
			if (codeBlock && body.contains(codeBlock) && !target?.closest("[data-code-copy], [data-code-run]")) {
				// Right-click toggles the fold (a left click on the
				// folded label opens it back up).
				if (codeBlock.dataset.folded === "1") codeBlock.removeAttribute("data-folded");
				else codeBlock.dataset.folded = "1";
				return;
			}
			// Display math folds the same way. Inline math has no
			// body chrome, so it falls through to speech below.
			const mathWrap = closestFromTarget(event.target, "[data-math-index]");
			if (
				mathWrap &&
				body.contains(mathWrap) &&
				mathWrap.classList.contains("ccez-math") &&
				!target?.closest(".ccez-math-copy, .ccez-math-tex")
			) {
				if (mathWrap.dataset.folded === "1") mathWrap.removeAttribute("data-folded");
				else mathWrap.dataset.folded = "1";
				return;
			}
			// Controls and links inside messages stay silent.
			if (target?.closest("button, input, textarea, a, summary")) return;
			// Highlighted text wins: a right-click with a live message
			// selection reads the whole selection (same per-quote
			// language as the sel-menu button). On a Han character it
			// also shows readings for just the highlight — pinyin in
			// Chinese text, furigana in Japanese — speech always runs;
			// the panel is a silent extra. Like Inspect, a lone Han
			// char reads its locale from the surrounding sentence.
			const quoted = currentQuote();
			if (quoted) {
				const probe = sentenceForQuote(quoted.context, quoted.quote) ?? quoted.context;
				if (hanCharUnderCursor(event, body)) {
					if (
						hanOverlayLangFor(probe) !== "ja" &&
						offeredLocalAids(quoted.quote, activeReplyCode).includes("pinyin")
					) {
						const readings = readingsOnly(pinyinRuby(quoted.quote), " ", "rt");
						if (readings) placeSelPinyin(quoted, readings);
					} else if (hanOverlayLangFor(probe) === "ja") {
						void showSelectionFurigana(quoted);
					}
				}
				void speakQuote(quoted.quote, quoted.messageId, false, quoted.context);
				return;
			}
			// No selection: a word under the cursor reads just that word
			// (same per-quote path as a selection); open message space
			// reads the whole message. speakReply gates the voice.
			const article = body.closest('article[id^="msg-"]');
			const msg = article ? chat.messages[Number(article.id.slice(4))] : undefined;
			if (!msg) return;
			const word = wordUnderCursor(event, body);
			if (word) {
				void speakQuote(word, msg.id, false, speechText(msg.content));
				return;
			}
			void speakReply(msg);
		};
		// Holding Option morphs the send button into "Add +" (stage).
		const onAlt = (event: KeyboardEvent) => {
			if (event.key === "Alt") altHeld = event.type === "keydown";
		};
		/**
		 * Escape keyup: a HOLD past the threshold exits fullscreen; a
		 * tap does nothing here (the keydown path above already
		 * dismissed menus/overlays exactly as today).
		 */
		const onEscapeUp = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// A 2s hold exits fullscreen (tap never does — keydown above
			// already dismissed exactly as today). Device-only path, like
			// the Esc+f chord: no window chrome here, no observable effect.
			if (isEscapeHold(escDownAt, Date.now())) void exitFullscreen();
			escDownAt = 0;
		};
		const onBlur = () => {
			altHeld = false;
			escDownAt = 0;
			stopScrollHold();
			// A drag released off-window never sees mouseup: drop the
			// containment so prose stays selectable on return.
			lastGoodDragRange = null;
			lastMoveClient = null;
			containDragTo(null);
		};
		// Coming back to the window lands you in the prompt (pill box when
		// annotating), so Tab continues from there. Never yank focus out of
		// a field that already holds it.
		const onWinFocus = () => {
			// Back from background: the reply was seen, drop its badge.
			clearStudyBadge();
			const active = document.activeElement;
			if (
				active &&
				active !== document.body &&
				document.contains(active) &&
				(active.tagName === "INPUT" ||
					active.tagName === "TEXTAREA" ||
					active.tagName === "SELECT" ||
					(active instanceof HTMLElement && active.isContentEditable))
			) {
				return;
			}
			if (annPop && annPopBox) annPopBox.focus({ preventScroll: true });
			else if (settings.promptIdleSec !== PROMPT_IDLE_ALWAYS) {
				// Remeasure first: occlusion or a DPR change while away
				// leaves CodeMirror's cached line boxes stale, and the
				// first keystroke would snap the prompt to a new height.
				// Always-hide mode skips the focus steal: returning to the
				// window must not summon a hidden prompt.
				editor?.remeasure();
				editor?.focus();
			}
		};
		// Web SpeechRecognition is service-blocked inside the Tauri
		// WKWebView (and there is no native dictation path), so the
		// Mic buttons hide there instead of toasting an error.
		canMic = micAvailable() && !tauriBackendAvailable();
		// Voice inventory arrives async (slow on phones): the first
		// getVoices() kicks the load, voiceschanged bumps the gates.
		try {
			if (typeof speechSynthesis !== "undefined") {
				speechSynthesis.getVoices();
				speechSynthesis.onvoiceschanged = () => {
					webVoiceVersion++;
				};
				// Already loaded (desktop): still re-render once so the
				// gates read the real inventory, not the first empty one.
				if (speechSynthesis.getVoices().length > 0) webVoiceVersion++;
			}
		} catch {
			// Speech stays gated off, as before.
		}
		window.addEventListener("focus", onWinFocus);
		// Soft-keyboard transitions resize the visual viewport without
		// ever touching the document, and old phone WebViews time
		// CodeMirror's own ResizeObserver unreliably around them — the
		// emptied composer can strand at zero height after send until
		// the next keystroke re-measures. A settled viewport re-measures
		// up front instead (typing would heal it anyway; this heals it
		// before the next keystroke).
		let viewportTimer: number | undefined;
		const onViewportResize = (): void => {
			// Pin synchronously on every viewport frame: the old trailing
			// debounce let the composer lag a beat behind the keyboard
			// animation, then jump. Only the remeasure stays debounced.
			// Phone keyboard without resizes-content: the layout
			// viewport doesn't shrink, so the full-height flex
			// column (and the latest messages) slides under the
			// keyboard with no way to reach it. Pin .app to the
			// visual height while the keyboard is open, and expose
			// the overlap as --kb-height so the composer reflows
			// just above it. Modern Chrome tracks via the viewport
			// meta, so the heights agree and this stays inert — it
			// is the pre-108 fallback. Desktop and keyboard-closed
			// phones keep stylesheet height.
			if (androidUI && appEl && window.visualViewport) {
				const vv = window.visualViewport;
				const overlap = keyboardOverlapPx(window.innerHeight, vv.height, vv.offsetTop);
				if (isKeyboardOpen(window.innerHeight, vv.height, vv.offsetTop)) {
					appEl.style.height = `${vv.height}px`;
					appEl.style.setProperty("--kb-height", `${overlap}px`);
				} else {
					appEl.style.height = "";
					appEl.style.setProperty("--kb-height", "0px");
				}
			}
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			viewportTimer = window.setTimeout(() => {
				viewportTimer = undefined;
				editor?.remeasure();
			}, 250);
		};
		window.visualViewport?.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("scroll", onViewportResize);
		void listenMenuActions();
		void wireDeepLinks();
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("keyup", onEscapeUp);
		window.addEventListener("keyup", releaseScrollHold);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mousedown", dismissReview, true);
		window.addEventListener("mousedown", onBadgePress, true);
		window.addEventListener("mousedown", preserveMessageHighlight, true);
		window.addEventListener("mousedown", snapSelection, true);
		window.addEventListener("mousedown", noteDownPoint, true);
		window.addEventListener("mousedown", armMessageDrag, true);
		window.addEventListener("mousemove", noteMovePoint, { passive: true });
		document.addEventListener("selectionchange", trimMessageDrag);
		// Secondary scrollers share the main chat's fade: scroll events
		// don't bubble, so catch them on the way down and toggle the
		// same .scrolling class with the same short hold.
		const fadeTimers = new WeakMap<Element, number>();
		const onFadeScroll = (event: Event) => {
			const box = closestFromTarget(event.target, "[data-fade-scroll]");
			if (!box || box === scrollBox) return;
			box.classList.add("scrolling");
			const pending = fadeTimers.get(box);
			if (pending !== undefined) window.clearTimeout(pending);
			fadeTimers.set(
				box,
				window.setTimeout(() => {
					box.classList.remove("scrolling");
					fadeTimers.delete(box);
				}, 120)
			);
		};
		window.addEventListener("scroll", onFadeScroll, true);
		// The readings overlay tracks its highlight while it scrolls
		// (same anchor math as placement): a detached or collapsed
		// range dismisses it instead of stranding it.
		const trackSelPinyin = (): void => {
			if (!selPinyin) return;
			try {
				const live = window.getSelection();
				if (!live || live.rangeCount === 0 || live.isCollapsed) {
					selPinyin = null;
					return;
				}
				const range = live.getRangeAt(0);
				if (!document.contains(range.startContainer)) {
					selPinyin = null;
					return;
				}
				const rect = range.getBoundingClientRect();
				const above = rect.top >= 128;
				const y = above ? rect.top : Math.min(rect.bottom + 8, window.innerHeight - 40);
				if (selPinyin.y !== y || selPinyin.above !== above)
					selPinyin = { ...selPinyin, y, above };
			} catch {
				selPinyin = null;
			}
		};
		window.addEventListener("scroll", trackSelPinyin, true);
		window.addEventListener("resize", trackSelPinyin);
		// The selection menu tracks its highlight while it scrolls
		// (same anchor math as the readings overlay above): the stored
		// summon range repositions it cursorlessly, and a detached
		// range dismisses it instead of stranding it. Scrolling never
		// dismisses a live menu on desktop — a wheel mid-aim is still
		// aiming. Phones keep the scroll dismiss in noteScrolling (the
		// docked menu owns composer space the scroll needs back).
		const trackSelMenu = (): void => {
			if (androidUI || !selMenu?.range) return;
			try {
				const { range } = selMenu;
				if (!document.contains(range.startContainer) || !document.contains(range.endContainer)) {
					selMenu = null;
					return;
				}
				const rect = range.getBoundingClientRect();
				const { x, y } = selMenuPlacement({
					cursorX: undefined,
					cursorY: undefined,
					rectLeft: rect.left,
					rectTop: rect.top,
					rectBottom: rect.bottom,
					viewportWidth: window.innerWidth,
					viewportHeight: window.innerHeight,
					androidUI,
					iosUI,
					menuWidth: selMenuWidthEstimate(selMenu.quote)
				});
				if (selMenu.x !== x || selMenu.y !== y || selMenu.left !== rect.left || selMenu.w !== rect.width)
					selMenu = { ...selMenu, x, y, left: rect.left, w: rect.width };
			} catch {
				selMenu = null;
			}
		};
		window.addEventListener("scroll", trackSelMenu, true);
		window.addEventListener("resize", trackSelMenu);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("dblclick", onDoubleClick);
		// Middle-click anywhere opens the shortcuts modal (no autoscroll).
		window.addEventListener("auxclick", onMiddleClick);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("scroll", onViewportResize);
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("keyup", onEscapeUp);
		window.removeEventListener("keyup", releaseScrollHold);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mousedown", dismissReview, true);
			window.removeEventListener("mousedown", onBadgePress, true);
			window.removeEventListener("mousedown", preserveMessageHighlight, true);
			window.removeEventListener("mousedown", snapSelection, true);
			window.removeEventListener("mousedown", noteDownPoint, true);
			window.removeEventListener("mousedown", armMessageDrag, true);
			window.removeEventListener("mousemove", noteMovePoint);
			document.removeEventListener("selectionchange", trimMessageDrag);
			window.removeEventListener("scroll", onFadeScroll, true);
			window.removeEventListener("scroll", trackSelPinyin, true);
			window.removeEventListener("resize", trackSelPinyin);
			window.removeEventListener("scroll", trackSelMenu, true);
			window.removeEventListener("resize", trackSelMenu);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("dblclick", onDoubleClick);
			window.removeEventListener("auxclick", onMiddleClick);
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.clearTimeout(viewport.idleTimer);
			stopSpeaking();
			stopNative();
			releaseStudyWake();
			stopDictation?.();
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez LLM</title>
</svelte:head>

<div
	class="app"
	bind:this={appEl}
	data-focus-mode={focusMode}
	data-shell={tauriBackendAvailable() ? "tauri" : "browser"}
	data-android={androidUI || null}
	data-ios={iosUI || null}
	style="--font-scale: {androidUI ? Math.min(8, settings.fontScale) : settings.fontScale}; --chat-width: {effectiveChatWidth(androidUI, settings.fontScale, settings.chatWidth ?? 36)}; --msg-gap: {settings.messageGap ?? MESSAGE_GAP_DEFAULT}rem"
	data-mac={isMac && !androidUI || null}
>
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed} data-fade-scroll
		ondblclick={(event) => {
			const target = event.target;
			if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) return;
			settings.sidebarCollapsed = true;
			persistSettings();
		}}>
		<div class="side-head" data-tauri-drag-region aria-hidden="true" onmousedown={dragWindow} ondblclick={zoomWindow}>
		</div>
		<!-- Sidebar search: a swipe left-to-right opens the list on this
		box; tapping it focuses with the keyboard up (a real input, never
		auto-focused on open, so the keyboard only comes on tap). -->
		<div class="side-search-wrap">
			<input
				type="search"
				class="side-search"
				bind:this={sideSearchEl}
				bind:value={sideSearch}
				placeholder="Search chats"
				aria-label="Search chats"
				inputmode="search"
				enterkeyhint="search"
				autocomplete="off"
				onclick={() => focusSideSearch()}
			/>
			{#if sideSearch}
				<button
					type="button"
					class="side-search-clear"
					aria-label="Clear chat search"
					onclick={() => {
						sideSearch = "";
						focusSideSearch();
					}}>×</button
				>
			{/if}
		</div>
		<ul onmouseleave={() => endPreview()} data-fade-scroll>
			{#each sideVisibleChats() as item (item.id)}
				<!-- Preview hover lives on the row, not the label: moving
				within the row (label to export/delete and back) must not
				drop the preview for the hovered chat. Rows clear nothing
				on leave — the gaps between rows would flash the active
				chat while crossing; only leaving the whole list (the ul
				handler below) drops the preview. -->
				<li onmouseenter={() => previewHover(item.id)}>
					<button
						type="button"
						class="side-chat"
						class:active={item.id === chatState.activeChatId}
						onclick={() => {
							// No preview clear here: transitionToChat clears
							// it inside the transition (clearing first
							// flashes the old chat before landing).
							sideIdx = chatState.chats.findIndex((c) => c.id === item.id);
							transitionToChat(item.id);
							// A picked chat just closes the list: entering must
							// not summon the composer (a parked prompt stays
							// parked — summoning is one keypress away).
							// Keyboard Enter (enterSideChat) still lands in
							// the prompt; hands are already on keys there.
							settings.sidebarCollapsed = true;
							persistSettings();
						}}
					>
						{chatLabel(item.createdAt)}{#if androidUI} <span class="side-count"
							>· {item.messages.length > 99 ? "99+" : item.messages.length}</span
						>{/if}
					</button>
					<button
						type="button"
						class="exp"
						title="Export chat as Markdown"
						aria-label="Export chat as Markdown"
						onclick={() => void exportOneChat(item)}
					>
						<ActionIcon kind="export" />
					</button>
					<button
						type="button"
						class="del"
						aria-label="Delete chat"
						onclick={() => {
							dropChat(item.id);
							requestAnimationFrame(() => focusSideChat(sideIdx));
						}}><ActionIcon kind="close" /></button
					>
					<span class="side-tip" role="tooltip">{sideTip(item)}</span>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="new"
			title={tip(isMac ? "New chat (⌘N or ⇧⌘N)" : "New chat (Ctrl+N or Ctrl+Shift+N)", "New chat")}
			aria-label="New chat"
			onclick={() => doNewChat()}
		>
			+
		</button>
		{#if androidUI}
			<!-- Touch settings entry: one-finger swipes never open
			settings, so the list owns a visible button (phones have
			no ⌘, to teach) next to the two-finger swipe left. -->
			<button
				type="button"
				class="side-settings"
				aria-label="Open settings"
				title="Settings"
				onclick={() => openSettingsPanel()}
			>
				Settings
			</button>
		{/if}
	</aside>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
	<!-- Click-off closes the settings panel (keyboard users get Esc and ⌘,). -->
	<main
		class:empty={viewChat.messages.length === 0}
		class:hide-messages={settings.hideMessages}
		class:hide-buttons={settings.hideButtons}
		class:plain-user={!settings.ownBubble}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:scale-actions={settings.scaleActionsWithFont}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onclick={closeSettingsFromMain}
	>
		{#if notices.errorToast.message}
			<button type="button" class="toast error" title="Dismiss" aria-live="polite" transition:fade={{ duration: 160 }} onclick={dismissErrorToast}>{notices.errorToast.message}</button>
		{:else if notices.toast.message}
			<button type="button" class="toast" title="Click to copy" aria-live="polite" transition:fade={{ duration: 160 }} onclick={copyToast}>{notices.toast.message}</button>
		{/if}
		<!-- Empty drag strip: nothing but the traffic-light clearance
		(the active reply language shows on the send button instead).
		Double-click zooms. -->
		<header role="toolbar" aria-label="App" tabindex="-1" onmousedown={dragWindow} ondblclick={zoomWindow}>
		</header>

		<!-- In-chat find (Cmd/Ctrl+F): message-level cycling browser-style. -->
		{#if find.open && !androidUI}
			<div class="find-bar" role="search" aria-label="Find in chat">
				<input
					type="search"
					bind:this={findInputEl}
					bind:value={find.query}
					oninput={() => {
						find.cursor = 0;
						landFindHit();
					}}
					onkeydown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							// One hit is "done": close (the cursor dies
							// with the bar). Several keep cycling; none
							// keeps the bar.
							if (currentFindHits().length === 1) closeFind();
							else stepFind(e.shiftKey ? -1 : 1);
						}
					}}
					placeholder="Find in chat"
					aria-label="Find in chat"
					autocomplete="off"
					spellcheck={false}
				/>
				<span class="find-count" aria-live="polite">
					{currentFindHits().length === 0
						? find.query.trim()
							? "No matches"
							: ""
						: `${Math.min(find.cursor + 1, currentFindHits().length)}/${currentFindHits().length}`}
				</span>
				<button type="button" aria-label="Previous match" title="Previous (Shift+Enter)" onclick={() => stepFind(-1)}>↑</button>
				<button type="button" aria-label="Next match" title="Next (Enter)" onclick={() => stepFind(1)}>↓</button>
				<button type="button" aria-label="Close find" title="Close (Esc)" onclick={closeFind}>×</button>
			</div>
		{/if}

		{#if points.length > 3 && !settingsOpen && !previewing}
			<nav aria-label="Waypoints">
				{#if wpOpen}
					<!-- Sheet backdrop: a press outside the sheet (which is
					outside .wp-wrap) also trips the pinned-menu closer. -->
					<button type="button" class="wp-veil" tabindex={-1} aria-label="Close message list" transition:fade={{ duration: 150 }} onclick={() => (wpOpen = false)}></button>
				{/if}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="wp-wrap"
					class:open={wpOpen}
					bind:this={wpWrap}
					onkeydown={(e) => {
						if (e.key === "Escape") wpOpen = false;
					}}
					onmouseleave={() => {
						// Hovering outside closes the menu after a jump.
						// Focus on a menu *item* keeps it (tabbing users
						// don't lose their place to a mouse jiggle), but
						// focus lingering on the toggle after a mouse click
						// must not pin it open.
						const menu = wpWrap?.querySelector(".wp-menu");
						const deep =
							menu != null &&
							document.activeElement instanceof Element &&
							menu.contains(document.activeElement);
						if (wpOpen && !deep) wpOpen = false;
					}}
				>
					<button
						type="button"
						class="wp-btn"
						data-fade-scroll
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						{#each points as index (index)}
							<span class="wp-tick" aria-hidden="true"></span>
						{/each}
					</button>
					<div
						class="wp-menu"
						role="menu"
						tabindex={-1}
						aria-label="Waypoints"
						data-fade-scroll
						ontouchstart={(e) => (wpTouchY = e.touches[0]?.clientY ?? null)}
						ontouchend={(e) => {
							const start = wpTouchY;
							wpTouchY = null;
							const end = e.changedTouches[0]?.clientY;
							if (start == null || end == null) return;
							const menu = e.currentTarget;
							if (menu instanceof HTMLElement && menu.scrollTop <= 0 && end - start > 56)
								wpOpen = false;
						}}
					>
						<div class="wp-sheet-head">
							<span>Jump to a message</span>
							<button type="button" aria-label="Close message list" onclick={() => (wpOpen = false)}>×</button>
						</div>
						{#each points as index, n (index)}
							{@const target = chat.messages[index]}
							<button
								type="button"
								role="menuitem"
								aria-current={n === wpPos - 1}
								title={waypointLabel(target?.content ?? "", 200)}
								onclick={(e) => {
									jumpTo(index);
									wpOpen = false;
									// Mouse jumps release focus so hover-outside can
									// close: focus pinned on the item would hold the
									// menu open under a stationary pointer. Keyboard
									// (detail 0) keeps focus and the pin, so tabbing
									// users don't lose their place.
									if (e.detail > 0) e.currentTarget.blur();
								}}
							>
								<span class="wp-dot" data-role={target?.role ?? "user"} aria-hidden="true"></span>
								{waypointLabel(target?.content ?? "") || `Message ${index + 1}`}
							</button>
						{/each}
					</div>
				</div>
			</nav>
		{/if}

		<div
			class="messages"
			class:step-newer={androidUI && chatStepDir === 1}
			class:step-older={androidUI && chatStepDir === -1}
			bind:this={scrollBox}
			onscroll={noteScrolling}
			ontouchstart={freezeScroll}
			ontouchend={releaseScroll}
			ontouchcancel={releaseScroll}
			ondblclick={gutterDoubleClick}
			onanimationend={(e) => {
				if (e.target === e.currentTarget) chatStepDir = null;
			}}
		>
			{#if viewChat.messages.length === 0}
				<div class="empty-state">
					<h1 class="hero">What can I do for you?</h1>
					{#if useMock}
						<p class="mock-note"><strong>Mock provider active.</strong></p>
					{/if}
				</div>
			{/if}
			{#each viewChat.messages as msg, i (msg.id)}
				{@const sentRefs = annRefsFor(msg.content)}
				{@const refsOnly = sentRefs ? sentRefs.text.trim() === "" : false}
				{@const isFolded = foldedIds.has(msg.id)}
				{@const script = detectScript(sentRefs ? sentRefs.text : msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				{@const localKinds = offeredLocalAids(sentRefs ? sentRefs.text : msg.content, activeReplyCode)}
				{@const streamingThis =
					chatState.sending &&
					viewChat.id === chatState.sendingChatId &&
					msg.role === "assistant" &&
					i === viewChat.messages.length - 1}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Fold button below. -->
				<article
					id="msg-{i}"
					tabindex="-1"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					class:folded-msg={isFolded}
					class:speaking={speakingId === msg.id}
					class:speaking-sel={speakingSelection === msg.id}
					class:aid-loading={aidBusy.has(msg.id) || vocalizing.has(msg.id)}
					data-actions-open={shownActionsId === msg.id}
					onclick={(e) => {
						if (e.target instanceof Element && e.target.closest(".sent-fold,.sent-open")) return;
						if (e.altKey) toggleFold(msg.id);
						toggleMessageActions(msg.id, e);
					}}
					onmouseenter={() => {
						hoveredIdx = i;
						lastHoverChangeAt = Date.now();
					}}
					onmouseleave={(event) => onArticleLeave(event, msg, i)}
				>
					{#if msg.attachments && msg.attachments.length > 0}
						{@const leftoverModels = sentTagModels(
							msg,
							(sentRefs ? (refsOnly && !isFolded ? REFS_ONLY_BODY : sentRefs.text) : null) ??
								msg.content
						)}
						{#if leftoverModels.length > 0}
							<!-- Sent-message tags: one per attachment with no
							literal left in the text (literals rebuild inline
							instead, so each file shows exactly once). Above
							the message as body-size blue fold buttons like
							pasted content; clicking floats the composer-pill
							card above the tag, X / click-away / ESC closes.
							A long turn scrolls sideways in place instead of
							stretching. -->
							<div
								class="sent-tags"
								class:pop-open={leftoverModels.some((m) => m.open)}
							>
								{#each leftoverModels as m (m.id)}
									{@const att = msg.attachments?.find((a) => a.id === m.id)}
									<span class="sent-wrap">
										<button
											type="button"
											class="paste-fold sent-fold"
											onclick={() => toggleSentTag(msg, m.id)}
											>{m.kind === "text" ? FILE_MARKER : IMAGE_MARKER}</button
										>
										{#if m.open}
											<span class="sent-open">
												<span class="sent-card">
													{#if m.kind === "image" && m.dataUrl?.startsWith("data:image/")}
														<img class="sent-img" src={m.dataUrl} alt="" />
													{:else if m.kind === "text" && m.text !== null}
														<span class="sent-excerpt">{fileExcerpt(m.text)}</span>
													{/if}
													<span class="sent-foot">
														<span class="sent-name">{m.name}</span>
														<span class="sent-tok" title="{m.tokens} tokens">{formatTokenCount(m.tokens)}</span>
														{#if att}
															<button
																type="button"
																class="sent-icobtn"
																aria-label="Copy attachment"
																title="Copy attachment"
																onclick={(e) => {
																	e.stopPropagation();
																	copyAttachment(att);
																}}><ActionIcon kind="copy" /></button
															>
															{#if att.kind === "image" && att.dataUrl}
																<button
																	type="button"
																	class="sent-btn"
																	disabled={ocrBusyId === att.id}
																	onclick={(e) => {
																		e.stopPropagation();
																		void recognizeAttachment(att);
																	}}>{ocrBusyId === att.id ? "\u2026" : "OCR"}</button
																>
															{/if}
															<button
																type="button"
																class="sent-icobtn"
																aria-label="Close preview"
																title="Close preview"
																onclick={() => toggleSentTag(msg, m.id)}
																><ActionIcon kind="close" /></button
															>
														{/if}
													</span>
												</span>
											</span>
										{/if}
									</span>
								{/each}
							</div>
						{/if}
					{/if}
				{#if sentRefs}
						<!-- Previous-annotations card: filed annotations
						baked onto a sent message, collapsed above it.
						The count stays visible like the composer
						pill; hovering (or tabbing to) the number itself
						reveals the saved quotes. Provider context is
						unaffected — only the display is redacted. A
						refs-only message always shows the pill: unfolded,
						its body is just an em-dash (see REFS_ONLY_BODY). -->
						<div class="ann-refs" class:open={refsPopOpen === msg.id}>
							<button
								type="button"
								class="ann-refs-pill"
								aria-label={sentRefs.refs.length === 1 ? "1 annotation" : `${sentRefs.refs.length} annotations`}
								aria-expanded={refsPopOpen === msg.id}
								onclick={() => (refsPopOpen = refsPopOpen === msg.id ? null : msg.id)}
							>
								{annotationCountLabel(sentRefs.refs.length)}
							</button>
							<div class="ann-refs-pop" role="tooltip">
								{#each sentRefs.refs as ref (ref.n)}
									<!-- Only the quote navigates, like the
									composer card: one jump per annotation, on
									the text itself. The note stays selectable,
									buttons keep their clicks (see
									refsQuoteClick), drag-selects stay picks. -->
									<div
									class="ann-refs-item"
									class:blink={refsBlink?.messageId === msg.id && refsBlink?.n === ref.n}
								>
										<span class="ann-refs-num">{ref.n}.</span>
										<span class="ann-refs-body">
											<button
												type="button"
												class="ann-refs-quote"
												title="Jump to this annotation in the chat"
												onclick={() => refsQuoteClick(msg.id, ref.quote, ref.n)}
											>
												“{ref.quote}”
											</button>
											{#if refsEditing?.messageId === msg.id && refsEditing.n === ref.n}
												<!-- Desktop row edit (see startRefsEdit):
												a single-line field — newlines would
												break the baked block shape. Enter
												saves, Escape cancels (global). -->
												<input
													type="text"
													class="ann-refs-input"
													bind:this={refsEditBox}
													bind:value={refsEditDraft}
													aria-label="Edit note {ref.n}. Enter saves, Escape cancels."
													onkeydown={(e) => {
														if (e.key === "Enter") {
															e.preventDefault();
															saveRefsEdit();
														}
													}}
												/>
											{:else if ref.comment}
												<span class="ann-refs-comment">{ref.comment}</span>
											{/if}
										</span>
										{#if refsEditing?.messageId === msg.id && refsEditing.n === ref.n}
											<button type="button" class="ann-refs-edit-btn" onclick={saveRefsEdit}>
												Save
											</button>
											<button type="button" class="ann-refs-edit-btn" onclick={cancelRefsEdit}>
												Cancel
											</button>
										{:else}
											<button
												type="button"
												class="ann-refs-copy"
												title="Copy annotation"
												aria-label="Copy annotation {ref.n}"
												onclick={() => copyAnnotation(ref.quote, ref.comment)}
											>
												<ActionIcon kind="copy" />
											</button>
											{#if !androidUI}
												<!-- Desktop only: phones never edited
												previous notes in place (no pencil
												there today), and the row stays a
												clean jump target. -->
												<button
													type="button"
													class="ann-refs-pencil"
													data-refs-pencil={ref.n}
													title="Edit note"
													aria-label="Edit note {ref.n}"
													onclick={() => startRefsEdit(msg.id, ref)}
												>
													<ActionIcon kind="pencil" />
												</button>
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					{#if editingMsgId === msg.id && msg.role === "user"}
						<!-- In-place own-message edit: the editor mounts
						where the text sat, colors intact; the actions row
						below stays live (pencil toggles back off). -->
						<div class="msg-edit">
							<div class="msg-edit-box" use:msgEditAction></div>
							<div class="msg-edit-bar">
								<button type="button" class="msg-edit-btn" onclick={() => commitMessageEdit()}>
									Save
								</button>
								<button type="button" class="msg-edit-btn" onclick={() => cancelMessageEdit()}>
									Cancel
								</button>
							</div>
						</div>
					{:else}
					<div class:bubble={msg.role === "user"}>
						<MessageBody
							message={msg}
							streaming={streamingThis}
							sourcesWanted={sourcesWanted}
							folded={isFolded}
							foldPreview={refsOnly && sentRefs ? sentRefs.refs.map((r) => `"${r.quote}"`).join(" ") : null}
							marks={marksFor(msg.id)}
							washId={annPop?.id ?? editingId ?? annBlink ?? hoverBadgeId}
						onBadgeHover={(id: string | null) => (hoverBadgeId = id)}
							onBadgeClick={openBadgeClick}
							onAttachAction={sentTagAction}
							expandedTags={expandedTags}
							onTagToggle={(id: string) => toggleSentTag(msg, id)}
							onToast={flashToast}
							onFoldToggle={(index: number) => togglePasteFold(msg, index)}
						onUnfold={() => toggleFold(msg.id)}
							textOverride={aidedTextFor(msg)}
							contentOverride={sentRefs ? (refsOnly && !isFolded ? REFS_ONLY_BODY : sentRefs.text) : null}
							aidPreview={aidPeek?.id === msg.id && !aidPin.has(msg.id)}
							preview={previewing}
							aidKinds={localAidsOverrideFor(msg)}
							aidPreferred={preferredLocalAid(activeReplyCode)}
							onAidLoadingChange={(loading: boolean) => setAidBusy(msg.id, loading)}
							onAidError={(_id: ChatMsgId, reason?: string) => aidFailed(msg.id, reason)}
						/>
					</div>
					{/if}
					{#if settings.showMessageButtons && !(streamingThis && msg.content.trim() === "")}
					<!-- Preview renders the same row inert: the peek
					reserves the row's space (opening the chat moves
					nothing) while honoring the hover-only rhythm, so
					no peek button is ever visible or firing. The
					Messages toggle removes the row outright (its
					shortcuts keep working on hover). -->
					<div
						class="actions"
						role="group"
						aria-label="Message actions"
						inert={previewing}
						onmouseleave={releaseRowFocus}
						onpointerdown={holdActionsOpen}
						onpointerup={releaseActionsHold}
						onpointercancel={releaseActionsHold}
					>
						{#if !androidUI}
							<!-- Desktop only: phones fold by swipe and unfold
							by tapping the folded body (its row stays hidden),
							so the chevron would be dead chrome in the row. -->
							<button
								type="button"
								class="icon-btn"
								class:folded={isFolded}
								data-tip={tip(isMac ? "Fold this message (F or Option-click)" : "Fold this message (F or Alt-click)", "Fold this message")}
								aria-label={isFolded ? "Unfold this message" : "Fold this message"}
								onclick={() => toggleFold(msg.id)}
							>
								<ActionIcon kind="fold" />
							</button>
						{/if}
						<button
							type="button"
							class="icon-btn"
							data-tip="Copy as plain text"
							aria-label="Copy as plain text"
							onclick={() => copyText(msg.content, msg.role)}
						>
							<ActionIcon kind="copy" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Branch from here"
							aria-label="Branch from here"
							onclick={() => branchFrom(chatState, i)}
						>
							<ActionIcon kind="branch" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip={tip(isMac ? "Delete this message (⌘D)" : "Delete this message", "Delete this message")}
							aria-label={tip(isMac ? "Delete this message (⌘D)" : "Delete this message", "Delete this message")}
							onclick={() => deleteMessage(chatState, i)}
						>
							<ActionIcon kind="delete" />
						</button>
						<button
							type="button"
							class="icon-btn"
							class:active={speakingId === msg.id}
							data-tip={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-label={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-pressed={speakingId === msg.id}
							disabled={speakingId !== msg.id && !messageSpeakable(msg)}
							onclick={() => {
								if (speakingId === msg.id) stopVoice();
								else void speakReply(msg);
							}}
						>
							<ActionIcon kind="speak" />
						</button>
						{#if msg.role === "assistant" && !streamingThis}
							<!-- Reading aids live here, right of speak: hover
							previews, click pins (show original unpins). Model
							and local aids sit side by side on mixed messages;
							a model pin composes with local pins (the model revert drops
						only the vocalized text), while furigana and pinyin pin
						independently. -->
							{#if aidId || localKinds.length > 0}
								{#if aidId}
									{#if aidModelPin.has(msg.id)}
										<button
											type="button"
											data-tip={MODEL_AIDS[aidId]?.revertTip ?? "Show original"}
											onclick={() => unpinModelAid(msg)}
										>
											{MODEL_AIDS[aidId]?.revert ?? "show original"}
										</button>
									{:else}
										{@const aid = MODEL_AIDS[aidId]}
										{#if aid}
											<button
												type="button"
												data-tip={aid.title}
												disabled={vocalizing.has(msg.id)}
												aria-busy={vocalizing.has(msg.id)}
												onmouseenter={() => peekAid(msg, aidId)}
												onmouseleave={() => unpeekAid(msg)}
												onclick={() => void runModelAidFor(msg, aidId, true)}
											>
													{#if vocalizing.has(msg.id)}
												{aid.button}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
											{:else}
												{aid.button}
											{/if}
											</button>
									{/if}
									{/if}
								{/if}
								{#if localKinds.length > 0}
								<!-- One button per aid, pinned independently: each
								swaps in place to its own show-original, so the
								row never shuffles when the other pins. -->
								{#each localKinds as localKind (localKind)}
									{@const showOriginal = LOCAL_AID_SHOW_ORIGINAL[localKind]}
									{#if pinnedKinds(msg.id).includes(localKind)}
											{@const furiganaBusy = localKind === "furigana" && aidBusy.has(msg.id)}
											<button
												type="button"
												data-tip={furiganaBusy ? `${LOCAL_AID_BUTTON[localKind]}...` : showOriginal}
												onclick={() => unpinLocalAid(msg, localKind)}
											>
												{showOriginal}{#if furiganaBusy}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
											</button>
									{:else}
										<button
											type="button"
											data-tip={LOCAL_AID_ADD_TITLE[localKind]}
											onmouseenter={() => peekAid(msg, null, localKind)}
											onmouseleave={() => unpeekAid(msg)}
											onclick={() => pinLocalAid(msg, localKind)}
										>
											{LOCAL_AID_BUTTON[localKind]}{#if localKind === "furigana" && aidBusy.has(msg.id)}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
										</button>
									{/if}
								{/each}
								{/if}
							{/if}
						{/if}
						{#if msg.role === "user"}
							<button
								type="button"
								class="icon-btn"
								data-tip="Edit"
								aria-label="Edit this message"
								onclick={() => editMessage(i)}
							>
								<ActionIcon kind="pencil" />
							</button>
							<button
								type="button"
								class="icon-btn"
								data-tip="Rerun"
								aria-label="Rerun"
								onclick={() => rerunFrom(i)}
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
								onclick={retryFailed}
							>
								<ActionIcon kind="rerun" />
							</button>
						{/if}
						{#if msg.error && !androidUI}
							<span class="error">{msg.error}</span>
						{/if}
						<!-- Last in the row, always mounted (hidden when idle)
						so it never shoves the buttons around. -->
						<span
							class="speaking-dot"
							class:on={speakingId === msg.id}
							role="status"
							aria-label="Speaking this message"
						></span>
					</div>
					{/if}
				</article>
			{/each}
			{#if isSending(chatState, viewChat.id)}
				<p class="sending" role="status" aria-label="Waiting for a reply">
					Thinking<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
				</p>
			{/if}
		</div>

		{#if missingKey && !androidUI}
			<p class="error-banner" role="alert">
				Set an API key first —
				<button
					type="button"
					class="link"
					data-settings-toggle
					onclick={() => {
					openSettingsPanel();
					pulseCursor();
				}}
				>
					open Settings</button
				>.
			</p>
		{/if}

		{#if attachments.length > 0 || notices.inline.message}
			<ul
				class="attachments"
				class:composer-idle={promptIdle}
				class:dragging={stripDragging}
				onpointerdown={stripDragStart}
				onpointermove={stripDragMove}
				onpointerup={stripDragEnd}
				oncancel={stripDragEnd}
				onpointercancel={stripDragEnd}
				ondragstart={(event) => event.preventDefault()}
				onclickcapture={stripClickGate}
			>
				{#each attachments as att (att.id)}
					<li class:card={att.kind === "image" && !!att.dataUrl}>
						{#if att.kind === "image" && att.dataUrl}
							<!-- Inert thumbnail: clicking previews nothing
							(the big peek is gone) — it only drags the row. -->
							<span class="thumb" aria-hidden="true">
								<img src={att.dataUrl} alt="" draggable="false" />
							</span>
						{:else}
							<span class="file-kind" aria-hidden="true">FILE</span>
						{/if}
						<span class="name" title="{att.name} · ~{att.tokens} tokens">{att.name}</span>
						<span class="tok" title="{att.tokens} tokens">{formatTokenCount(att.tokens)}</span>
						<button
							type="button"
							class="card-btn"
							aria-label="Copy attachment"
							title="Copy attachment"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => copyAttachment(att)}
						>
							<ActionIcon kind="copy" />
						</button>
						{#if att.kind === "image" && att.dataUrl}
							<button
								type="button"
								class="ocr-btn"
								aria-label="Recognize text in image"
								title="Recognize text in image"
								disabled={ocrBusyId === att.id}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => void recognizeAttachment(att)}
							>
								{ocrBusyId === att.id ? "…" : "OCR"}
							</button>
						{/if}
						<button
							type="button"
							class="card-btn"
							aria-label="Remove attachment"
							title="Remove attachment"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => removeAttachment(att.id)}
						>
							<ActionIcon kind="close" />
						</button>
					</li>
				{/each}
			</ul>
			{#if notices.inline.message && !androidUI}
				<p class="error attach-error" class:composer-idle={promptIdle} role="alert">{notices.inline.message}</p>
			{/if}
		{/if}

		<input
			type="file"
			class="hidden-input"
			bind:this={attachInput}
			multiple
			accept="image/*,.txt,.md,.markdown,.json,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.swift,.kt,.php,.sh,.yaml,.yml,.toml,.xml,.html,.css,.sql,.csv,.log"
			onchange={(e) => {
				const files = [...(e.currentTarget.files ?? [])];
				e.currentTarget.value = "";
				if (files.length > 0) void addFiles(files).then((kinds) => insertAttachmentMarkers(kinds));
			}}
		/>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="prompt"
			class:has-anns={annotations.length > 0}
			class:has-mic={canMic && settings.micEnabled}
			class:prompt-hidden={!!annPop && androidUI && !iosUI}
			class:prompt-idle={promptParked()}
			class:prompt-preview={previewing && viewChat.messages.length === 0}
			data-empty={!hasText}
			inert={previewing && viewChat.messages.length === 0}
			bind:this={promptEl}
			onclick={focusPromptFloor}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				const files = dropFilesFromDataTransfer(e.dataTransfer);
				if (files.length > 0) {
					void addFiles(files).then((kinds) => insertAttachmentMarkers(kinds));
				}
			}}
		>
			<div class="prompt-tools">
				{#if androidUI && points.length > 3 && !selMenu}
					<!-- Touch-only jump-to-message trigger: an icon in the
					tools cluster, styled like attach/mic. Desktop and web
					keep the far-right tick control instead — one owner
					for jumps. On phones the selection dock takes this
					slot instead — both side by side crowd the
					placeholder. -->
					<button
						type="button"
						class="wp-jump"
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						<ActionIcon kind="jump" />
					</button>
				{/if}
				{#if androidUI && selMenu && !previewing}
					<!-- Phone selection dock: the highlight menu lives in the
					composer tools, not floating over the text (the native
					callout owns that space on both phones). Same handlers
					as the desktop floating menu it replaces — and the same
					click-away exemption in onMouseUp, or the tap collapses
					the highlight and clears the menu before onclick fires.
					Speak always docks between them; Inspect joins for
					single Han characters with the setting on. The wrapper
					overlays the whole card (see CSS): the buttons split it
					evenly without resizing anything. -->
					<div class="ann-dock-wrap">
						<button
							type="button"
							class="ann-dock"
							aria-label="Annotate selection"
							transition:fade={{ duration: 150 }}
							onmousedown={noteMenuPress}
							ontouchstart={noteMenuBtnTouch}
							ontouchend={annotateTouch}
							onclick={annotate}
						>Annotate</button>
						<button
							type="button"
							class="ann-dock"
							aria-label="Speak selection"
							transition:fade={{ duration: 150 }}
							onmousedown={noteMenuPress}
							ontouchstart={noteMenuBtnTouch}
							ontouchend={speakTouch}
							onclick={speakDockSelection}
						>Speak</button>
						{#if shouldShowInspect(selMenu.quote, settings.inspectEnabled)}
							<button
								type="button"
								class="ann-dock"
								aria-label="Inspect character"
								transition:fade={{ duration: 150 }}
								onmousedown={noteMenuPress}
								ontouchstart={noteMenuBtnTouch}
								ontouchend={inspectTouch}
								onclick={openInspect}
							>Inspect</button>
						{/if}
					</div>

				{/if}
				{#if annotations.length > 0}
					<!-- New-annotations dock: unsent drafts filed from
					this chat, reviewed before sending (the filed half
					lives in the previous-annotations sent-refs card on
					sent messages). -->
					<div class="ann-wrap" class:pinned={reviewOpen}>
						<button
							type="button"
							class="ann-pill"
							bind:this={annPill}
							title="Review annotations"
							aria-label={annotations.length === 1 ? "1 unsent annotation" : `${annotations.length} unsent annotations`}
							aria-expanded={reviewOpen}
							onclick={() => (reviewOpen = !reviewOpen)}
						>
							{annotationCountLabel(annotations.length)}
						</button>
						<div class="review" role="dialog" aria-label="Annotations" data-fade-scroll>
							<div class="review-tools">
								<button
									type="button"
									aria-label="Delete all annotations"
									title="Delete all annotations"
									onclick={clearAllAnnotations}
								>
									Clear all
								</button>
							</div>
							{#each annotations as ann, n (ann.id)}
								<!-- Only the quote navigates: one jump per
								annotation, on the text itself. The note stays
								selectable, buttons keep their clicks (see
								reviewQuoteClick), drag-selects stay picks. -->
								<div
									class="review-item"
									class:highlight={highlightAnnId === ann.id}
								>
									<div class="review-head">
										<span class="review-num">{n + 1}.</span>
										<button
											type="button"
											class="review-quote"
											title="Jump to this annotation in the chat"
											onclick={() => reviewQuoteClick(ann)}
										>
											“{ann.quote}”
										</button>
										<button
											type="button"
											class="review-copy"
											title="Copy annotation"
											aria-label="Copy annotation {n + 1}"
											onclick={() => copyAnnotation(ann.quote, ann.comment)}
										>
											<ActionIcon kind="copy" />
										</button>
										<button
											type="button"
											class="review-del"
											aria-label="Delete annotation {n + 1}"
											title="Delete annotation"
											onclick={() => removeAnnotation(ann.id)}
										>
											<ActionIcon kind="close" />
										</button>
									</div>
									{#if editingId === ann.id}
										<label>
											<span class="review-label">-</span>
											<textarea rows="2" bind:this={editBox} bind:value={editDraft} placeholder="Add an optional comment…"
												aria-label="Edit annotation note. Enter saves, Shift+Enter adds a line, Escape cancels."
												onkeydown={(e) => {
													const action = reviewEditKey(e.key, e.shiftKey);
													if (action === "save") {
														e.preventDefault();
														saveEdit(ann.id);
													} else if (action === "cancel") {
														e.preventDefault();
														editingId = null;
														highlightAnnId = null;
														focusPill();
													}
												}}
											></textarea>
										</label>
										<div class="review-edit-actions">
											<button type="button" onclick={() => saveEdit(ann.id)}>Save</button>
											<button
												type="button"
												onclick={() => {
													editingId = null;
													highlightAnnId = null;
													// Cancel unmounts the focused textarea:
													// park focus on the pill or the
													// overlay drops on touch.
													focusPill();
												}}>Cancel</button
											>
										</div>
									{:else}
										<div class="review-head">
											<span class="review-label">-</span>
											<span class="review-comment">{ann.comment || "—"}</span>
											<button
												type="button"
												class="review-pencil"
												title="Edit comment"
												aria-label="Edit comment for annotation {n + 1}"
												onclick={() => {
												// Desktop edits at the mark in the
												// floating card, phones in the
												// composer (see
												// editAnnotationAtMark) — the
												// inline textarea below stays
												// retired.
												highlightAnnId = ann.id;
												editAnnotationAtMark(ann.id);
											}}
											>
												<ActionIcon kind="pencil" />
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
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

				{#if canMic && settings.micEnabled}
					<button
						type="button"
						class="mic-btn"
						class:recording={dictating}
						title={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-label={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-pressed={dictating}
						onclick={toggleMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
				<button
					type="button"
					class="voice-float"
					class:on={voiceOn()}
					title={speakingId !== null ? "Stop reading aloud" : tip(`Toggle voice readback (Ctrl+${altm}+S)`, "Toggle voice readback")}
					aria-label={speakingId !== null ? "Stop reading aloud" : "Toggle voice readback"}
					aria-pressed={voiceOn()}
					onclick={toggleVoice}
				>
					<ActionIcon kind="speak" />
				</button>
			</div>
			<button
				type="button"
				class="send-btn"
				class:wide={altHeld}
				disabled={!canSubmit}
				title={altHeld
					? `Stage (${altm}+Enter)`
					: activeReplyLang
						? `Send in ${activeReplyLang.name} (Enter) — repeat its number key to clear`
						: "Send (Enter)"}
				aria-label={altHeld ? "Stage" : activeReplyLang ? `Send in ${activeReplyLang.name}` : "Send"}
				onclick={(event) => onSubmit(altHeld || event.altKey ? "stage" : "send")}
			>
				{altHeld ? "Add +" : activeReplyLang ? activeReplyLang.badge : "↑"}
			</button>
		</div>
		{#if notices.banner.message && !androidUI}
			<p class="error-banner" role="alert">{notices.banner.message}</p>
		{/if}

		{#if notices.voice.message && !androidUI}
			<!-- Top notice, not the bottom banner: speech errors arrive
			while the eyes are on the message, and a tap dismisses. -->
			<button type="button" class="voice-error" title="Dismiss" transition:fade={{ duration: 160 }} onclick={() => setVoiceError(null)}>
				<span role="alert">{notices.voice.message}</span>
			</button>
		{/if}

		{#if viewChat.messages.length === 0}
			<!-- A hover preview of an empty chat shows the same pills,
			inert: they preview the empty state, but every tap belongs
			to the active chat — hovering away restores it. -->
			<div class="lang-menus" aria-label="Reply language" inert={previewing}>
				{#each LANGUAGE_MENUS as menu (menu.id)}
					<div class="lang-menu">
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={openLangMenu === menu.id}
							title="Reply in a {menu.label.toLowerCase()} language"
							onclick={() => (openLangMenu = openLangMenu === menu.id ? null : menu.id)}
						>
							<span aria-hidden="true">{menu.marker}</span>
							{menu.label}
						</button>
						{#if openLangMenu === menu.id}
							<div class="lang-list" role="menu">
								<!-- Menu-click clears only languages without a number key
								(keyed ones clear by repeating the key). -->
								{#each [...menu.languages].sort((a, b) => a.name.localeCompare(b.name, "en")) as lang (lang.code)}
									{@const quickKey = quickKeyFor(lang.code)}
									<button
										type="button"
										role="menuitem"
										class:selected={activeReplyCode === lang.code}
										title={quickKey ? `${lang.name} (${quickKey})` : lang.name}
										onclick={() => {
										if (activeReplyCode === lang.code && !quickKey) clearReplyLang();
										else setReplyLang(lang.code);
										// Picking a language hands focus to the composer:
										// typing starts there next, and focus never
										// lingers on the unmounted option (which left
										// a stuck pointer behind).
										editor?.focus();
									}}
									>
										<span class="badge" aria-hidden="true">{lang.badge}</span>
										{lang.name}
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</main>

	{#if selMenu && !previewing && !androidUI}
		<div
			class="sel-menu"
			bind:this={selMenuEl}
			style="left: {selMenu.x}px; top: {selMenu.y}px"
			role="menu"
			tabindex="-1"
			transition:fade={{ duration: 150 }}
			onmousedown={noteMenuPress}
			ontouchstart={noteMenuPress}
			onmouseenter={enterSelMenu}
			onmouseleave={() => (selMenuHover = false)}
		>
			<!-- Desktop only: Annotate floats above the highlight while
			the OS bubble keeps its own slot. Phones dock it in the
			composer instead (the native callout owns the text space).
			Copy and Read Aloud live on the message action rows
			instead of doubling here. Inspect joins Annotate only for
			a single kanji/hanzi highlight with the setting on;
			everything else gets Annotate alone. -->
			<button
				type="button"
				onmousedown={noteMenuPress}
				onclick={annotate}
				ontouchstart={noteMenuBtnTouch}
				ontouchend={annotateTouch}
			>Annotate</button>
			{#if shouldShowInspect(selMenu.quote, settings.inspectEnabled)}
				<button
					type="button"
					aria-label="Inspect character"
					onmousedown={noteMenuPress}
					ontouchstart={noteMenuBtnTouch}
					ontouchend={inspectTouch}
					onclick={openInspect}
				>Inspect</button>
			{/if}

		</div>
	{/if}

	{#if selPinyin && !previewing}
		<!-- Selection readings: pronunciations for just the highlight,
		docked above it (below only without headroom). Pointer-transparent
		so it never disturbs the selection or blocks the native menu;
		the highlight clearing dismisses it (see trimMessageDrag), and
		scrolling tracks it (see trackSelPinyin). -->
		<div
			class="sel-pinyin"
			class:above={selPinyin.above}
			style="left: {selPinyin.x}px; top: {selPinyin.y}px"
			aria-live="polite"
		><!-- eslint-disable-line svelte/no-at-html-tags -- html is "…" or readingsOnly output (inert by unit test, see reading.ts) -->{@html selPinyin.html}</div>
	{/if}

	{#if annPop}
		<!-- Mousedown on the buttons keeps textarea focus: without it the
		blur-save fires first and Cancel/Delete can never win the race. -->
		<div
			class="ann-pop"
			class:fresh={annPop.fresh}
			class:closing={annPopClosing}
			style="left: {annPop.x}px; top: {annPop.y}px"
			role="dialog"
			aria-label={annPop.fresh ? "Annotate" : "Edit annotation"}
		>
			<textarea
				rows={1}
				bind:this={annPopBox}
				bind:value={annDraft}
				placeholder="Add a comment"
				aria-label="Annotation comment. Enter or clicking away saves, Escape cancels."
				use:growPill
				onkeydown={annPopKey}
				onblur={(event) => {
					// Tabbing between the card's own buttons is not
					// leaving: only a departure blur-saves (clicking
					// away saves, Escape cancels). Tab reports its
					// destination reliably in every engine, unlike a
					// WebKit button press (see onFocusOutIdle).
					const next = event.relatedTarget;
					if (next instanceof Element && next.closest(".ann-pop")) return;
					blurAnnPop();
				}}
			></textarea>
			{#if annPop.fresh}
				{#if canMic && settings.micEnabled}
					<button
						type="button"
						class="ann-tool"
						class:recording={pillDictating}
						class:gone={!(pillDictating || annDraft.trim().length === 0)}
						aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
						aria-pressed={pillDictating}
						aria-hidden={!(pillDictating || annDraft.trim().length === 0)}
						tabindex={pillDictating || annDraft.trim().length === 0 ? 0 : -1}
						title="Dictate comment"
						onmousedown={(e) => e.preventDefault()}
						onclick={togglePillMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
				{#if androidUI}
					<!-- Phones get a submit button at the pill's end: the
					software keyboard's enter key is unreliable for filing
					(desktop keeps Enter-only and the compact pill). Same
					up-arrow face as the composer's send button. -->
					<button
						type="button"
						class="ann-save ann-pill-save"
						aria-label="Save annotation"
						onmousedown={(e) => e.preventDefault()}
						onclick={() => saveAnnPop()}
					>↑</button>
				{/if}
			{:else}
			<div class="ann-pop-row">
				<button
					type="button"
					class="ann-tool"
					aria-label="Delete annotation"
					title="Delete annotation"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => {
						if (annPop) {
							removeAnnotation(annPop.id);
							editor?.focus();
						}
					}}
				>
					<ActionIcon kind="delete" />
				</button>
				<span class="ann-pop-spacer"></span>
				{#if canMic && settings.micEnabled}
				<button
					type="button"
					class="ann-tool"
					class:recording={pillDictating}
					aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
					aria-pressed={pillDictating}
					title="Dictate comment"
					onmousedown={(e) => e.preventDefault()}
					onclick={togglePillMic}
				>
					<ActionIcon kind="mic" />
				</button>
				{/if}
				<button
					type="button"
					class="ann-cancel"
					onmousedown={(e) => e.preventDefault()}
					onclick={cancelAnnPop}>Cancel</button
				>
				<button
					type="button"
					class="ann-save"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => saveAnnPop()}>Save</button
				>
			</div>
			{/if}
		</div>
	{/if}

	<!-- Double-click on open space closes the panel; keyboard users
	keep Meta+,. -->
	<aside
		class="settings-panel"
		class:closed={!settingsOpen}
		data-fade-scroll
		aria-label="Settings"
		inert={!settingsOpen}
		ondblclick={(e) => {
			// Open space only: the tap must land on the panel's own
			// padding (the aside, inner wrapper, or a section/fieldset
			// box itself). Text, controls, and anything inside them
			// keep their behavior — including double-click text picks.
			const t = e.target instanceof Element ? e.target : null;
			if (t?.closest("aside, .settings-inner, section, fieldset") === t) settingsOpen = false;
		}}
	>
		<!-- Fixed-width inner: the panel clips instead of reflowing text mid-collapse. -->
		<div class="settings-inner">
			<SettingsPanel
			settings={settings}
			onToast={flashToast}
			onClose={() => {
			settingsOpen = false;
			pulseCursor();
		}}
			onShortcuts={openShortcuts}
			onExpand={zoomWindow}
			tokensLabel="{formatTokens(split.prompt)} in / {formatTokens(split.completion)} out"
			tokensTitle="{total} tokens total this chat"
			androidUI={androidUI}
		/>
		</div>
	</aside>

	{#if androidUI && chatSwitcherOpen}
		<!-- Phone chat switcher: opened by a two-finger hold on the main
		chat. Swipes (and arrows) cycle chats without closing; tapping
		away or Esc closes. Desktop never renders it. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="modal-veil chat-switcher"
			onclick={(e) => {
				if (e.target !== e.currentTarget) return;
				// The opening gesture's own compat click (double-tap or
				// hold release) lands here within a beat: taps inside
				// the grace window never close.
				if (Date.now() - switcherOpenedAt < 600) return;
				closeChatSwitcher();
			}}
		>
			<div
				class="modal switcher-card"
				role="dialog"
				aria-modal="true"
				aria-label="Switch chat"
				tabindex="-1"
			>
				<button
					type="button"
					class="switcher-arrow"
					aria-label="Older chat"
					onclick={() => stepSwitcher(-1)}>‹</button
				>
				<div class="switcher-mid">
					<div class="switcher-title">{chatLabel(activeChat(chatState)?.createdAt ?? Date.now())}</div>
					<div class="switcher-pos">
						{chatState.chats.findIndex((c) => c.id === chatState.activeChatId) + 1} / {chatState.chats.length}
					</div>
				</div>
				<button
					type="button"
					class="switcher-arrow"
					aria-label="Newer chat"
					onclick={() => stepSwitcher(1)}>›</button
				>
			</div>
		</div>
	{/if}

	{#if shortcutsOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Backdrop click only; keyboard users get Esc and the × button. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) shortcutsOpen = false;
			}}
		>
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby={androidUI ? undefined : "shortcuts-heading"} aria-label={androidUI ? "Touch gestures" : undefined} data-fade-scroll>
				<div class="modal-head">
					{#if !androidUI}<h2 id="shortcuts-heading">Keyboard shortcuts</h2>{/if}
					<input
						type="search"
						class="shortcuts-filter"
						bind:this={shortcutInputEl}
						bind:value={shortcutQuery}
						placeholder={isMac ? "Filter (⌘F)" : "Filter (Ctrl+F)"}
						aria-label={androidUI ? "Filter gestures" : "Filter shortcuts"}
						autocomplete="off"
						spellcheck={false}
					/>
					<button
						type="button"
						aria-label="Close shortcuts"
						title={tip(isMac ? "Close (⇧⌘/)" : "Close (Ctrl+Shift+/)", "Close")}
						onclick={() => (shortcutsOpen = false)}
					>
						×
					</button>
				</div>
				{#if androidUI}
					<!-- Android milestone: key chords don't exist on a phone,
					so the same modal teaches the touch equivalents. -->
					<dl class="keys">
						{#each filteredShortcuts(touchShortcuts(), shortcutQuery) as row (row.name)}
							<div><dt>{row.name}</dt><dd>{row.keys}</dd></div>
						{:else}
							<div class="keys-empty">No matches</div>
						{/each}
					</dl>
				{:else}
				<dl class="keys">
					{#each filteredShortcuts(desktopShortcuts(isMac), shortcutQuery) as row (row.name)}
						<div><dt>{row.name}</dt><dd>{row.keys}</dd></div>
					{:else}
						<div class="keys-empty">No matches</div>
					{/each}
				</dl>
				{/if}
			</div>
		</div>
	{/if}

	{#if palette.open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Command palette: full-text search across chats/annotations. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) closeSearch();
			}}
		>
			<div class="modal search-palette" role="dialog" aria-modal="true" aria-label="Search chats">
				<div class="modal-head">
					<input
						type="search"
						class="search-input"
						bind:this={searchInputEl}
						bind:value={palette.query}
						oninput={runSearchQuery}
						placeholder="Search chats and annotations"
						aria-label="Search chats and annotations"
						inputmode="search"
						enterkeyhint="search"
						autocomplete="off"
						onkeydown={(e) => {
							if (e.key === "ArrowDown") {
								e.preventDefault();
								moveSearchCursor(1);
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								moveSearchCursor(-1);
							} else if (e.key === "Enter") {
								e.preventDefault();
								const hit = palette.hits[palette.cursor];
								if (hit) enterSearchHit(hit);
							}
						}}
					/>
					<button type="button" aria-label="Close search" title="Close (Esc)" onclick={closeSearch}>
						×
					</button>
				</div>
				<div
					class="search-results"
					bind:this={searchResultsEl}
					data-fade-scroll
					role="listbox"
					aria-label="Search results"
				>
					{#if palette.busy}
						<p class="search-status" role="status">Searching…</p>
					{:else if palette.query.trim() && palette.hits.length === 0}
						<p class="search-status">No matches.</p>
					{:else}
						{#each palette.hits as hit, n (hit.doc.chatId + (hit.doc.msgId ?? "") + hit.doc.kind)}
							<button
								type="button"
								role="option"
								aria-selected={n === palette.cursor}
								class="search-hit"
								class:cursor={n === palette.cursor}
								onmouseenter={() => (palette.cursor = n)}
								onclick={() => enterSearchHit(hit)}
								onkeydown={(e) => {
									if (e.key === "j" || e.key === "ArrowDown") {
										e.preventDefault();
										moveSearchCursor(1);
										focusSearchHit(palette.cursor);
									} else if (e.key === "k" || e.key === "ArrowUp") {
										e.preventDefault();
										moveSearchCursor(-1);
										focusSearchHit(palette.cursor);
									}
								}}
							>
								<span class="search-kind">{hit.doc.kind}</span>
								<span class="search-snippet">{hit.snippet}</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	{/if}
	{#if inspectChar && inspectData}
		{@const strokeTotal = inspectStrokes?.length ?? inspectData.strokeCount ?? 0}
		{@const strokeShown = Math.min(inspectStroke, Math.max(strokeTotal, 1))}
		{@const onKunInspect = onKunLine(inspectData)}
		{@const decompInspect = inspectChar ? decomposeTree(inspectChar) : null}
		<!-- Character Inspect overlay: same modal-veil/modal pattern as
		the shortcuts overlay. Component splits come from the vendored
		cjk-decomp subset; count, radical, definition, and readings
		(Mandarin, Japanese on/kun) from the generated Unihan bundle —
		all offline, no hand-curated entries. Stroke vectors load on
		demand from KanjiVG (CC BY-SA 3.0) and step manually — never
		autoplay; the font glyph stands in while they load. The
		JP/中文 toggle flips the predicted reading
		locale (kana = Japanese, else Chinese) for genuinely ambiguous
		Han text. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Backdrop click only; keyboard users get Esc and the × button. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) inspectChar = null;
			}}
		>
			<div class="modal inspect-modal" role="dialog" aria-modal="true" aria-labelledby="inspect-heading" data-fade-scroll>
				<div class="modal-head">
					<h2 id="inspect-heading">Inspect <span lang={HAN_OVERLAY_LANG_TAG[inspectLang]}>{inspectData.char}</span></h2>
					<button
						type="button"
						aria-label="Close character inspect"
						title="Close (Esc)"
						onclick={() => (inspectChar = null)}
					>
						×
					</button>
				</div>
				{#if inspectChar && isHanOverlayLangUncertain(inspectChar)}
					<div class="inspect-lang" role="group" aria-label="Reading language">
						<button
							type="button"
							aria-pressed={inspectLang === "ja"}
							aria-label="Show Japanese reading"
							title="Show Japanese reading"
							onclick={() => (inspectLang = "ja")}
						>日本語</button>
						<button
							type="button"
							aria-pressed={inspectLang === "zh"}
							aria-label="Show Chinese reading"
							title="Show Chinese reading"
							onclick={() => (inspectLang = "zh")}
						>中文</button>
					</div>
				{/if}
				<div class="inspect-body">
					<div class="inspect-glyph">
						{#if inspectStrokes && inspectStrokes.length > 0}
							<!-- KanjiVG vectors (CC BY-SA 3.0): unstepped
							strokes stay grey, stepped ones paint light. -->
							<svg
								viewBox="0 0 109 109"
								class="inspect-svg"
								role="img"
								aria-label={`Stroke order for ${inspectChar}`}
							>
								{#each inspectStrokes as d, i (i)}
									<path d={d} class:painted={i < strokeShown} />
								{/each}
							</svg>
						{:else}
							<div class="inspect-char" lang={HAN_OVERLAY_LANG_TAG[inspectLang]} aria-hidden="true">
								{inspectData.char}
							</div>
						{/if}
						{#if inspectStrokes && inspectStrokes.length > 0}
							<!-- Stepper waits for the vectors: the static
							char shows first, and the arrows must not offer
							steps through a drawing that isn't here yet. -->
							<div class="inspect-stepper">
								<button
									type="button"
									aria-label="Previous stroke (h)"
									title="Previous stroke (h)"
									disabled={inspectStroke <= 1}
									onpointerdown={() => startStrokeHold(-1)}
									onpointerup={stopStrokeHold}
									onpointerleave={stopStrokeHold}
									onpointercancel={stopStrokeHold}
									onclick={() => strokeStep(-1)}>‹</button
								>
								<span class="inspect-count" aria-live="polite">{strokeShown} / {strokeTotal}</span>
								<button
									type="button"
									aria-label="Next stroke (l)"
									title="Next stroke (l)"
									disabled={inspectStroke >= strokeTotal}
									onpointerdown={() => startStrokeHold(1)}
									onpointerup={stopStrokeHold}
									onpointerleave={stopStrokeHold}
									onpointercancel={stopStrokeHold}
									onclick={() => strokeStep(1)}>›</button
								>
							</div>
						{/if}
					</div>
					<div class="inspect-facts">
						{#if inspectData.components.length > 0}
							<p><strong>Components:</strong> {inspectData.components.join(" + ")}</p>
						{:else}
							<p class="note">Component breakdown unavailable offline for this character.</p>
						{/if}
						{#if inspectData.strokeCount !== null}
							<p><strong>Strokes:</strong> {inspectData.strokeCount}</p>
						{:else}
							<p class="note">Stroke count unavailable offline for this character.</p>
						{/if}
						{#if inspectData.radical !== null && inspectData.radicalRest !== null}
							<p><strong>Radical:</strong> {inspectData.radical} + {inspectData.radicalRest}</p>
						{/if}
						{#if inspectData.definition !== null}
							<p><strong>Definition:</strong> {inspectData.definition}</p>
						{:else}
							<p class="note">Unihan definition unavailable offline for this character.</p>
						{/if}
						{#if inspectLang === "zh"}
							{#if inspectData.mandarin !== null}
								<p><strong>Mandarin:</strong> <span lang="zh-Latn-pinyin">{inspectData.mandarin}</span></p>
							{:else}
								<p class="note">Mandarin reading unavailable offline for this character.</p>
							{/if}
						{:else}
							{#if onKunInspect !== null}
								<p class="inspect-onkun">{onKunInspect}</p>
							{:else}
								<p class="note">Japanese readings unavailable offline for this character.</p>
							{/if}
						{/if}
					</div>
				</div>
				{#if decompInspect && decompInspect.children.length > 0}
					<div class="inspect-decomp" aria-label="Character decomposition">
						<span class="inspect-decomp-char root">{decompInspect.char}</span>
						<span class="inspect-decomp-arrow" aria-hidden="true">→</span>
						{#each decompInspect.children as child, ci (ci)}
							<span class="inspect-decomp-group">
								<span class="inspect-decomp-char">{child.char}</span>
								{#if child.children.length > 0}
									<span class="inspect-decomp-sub">
										<span class="inspect-decomp-arrow" aria-hidden="true">→</span>
										{#each child.children as grand, gi (gi)}
											<span class="inspect-decomp-char sub">{grand.char}</span>{#if gi < child.children.length - 1}<span
													class="inspect-decomp-plus"
													aria-hidden="true"
													> + </span
												>{/if}
										{/each}
									</span>
								{/if}
							</span>{#if ci < decompInspect.children.length - 1}<span
									class="inspect-decomp-plus"
									aria-hidden="true"
									> + </span
								>{/if}
						{/each}
					</div>
				{:else}
					<p class="note">No decomposition in the vendored subset for this character.</p>
				{/if}
			</div>
		</div>
	{/if}
	<!-- Print-only study sheet: hidden on screen, the sole visible
	node under `@media print` (File → Print Study Sheet…, or Save as
	PDF from that dialog). Plain text on purpose — the PDF is a study
	artifact, not a theme snapshot. -->
	<section id="study-sheet-print" aria-hidden="true">
		<h1>{sheetTitle(chat.messages)}</h1>
		<p class="sheet-sub">Ccez LLM study sheet — {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"}.</p>
		{#each chat.messages as msg (msg.id)}
			<h2>{msg.role === "user" ? "You" : "Ccez"}</h2>
			<p>{msg.content}</p>
		{/each}
	</section>
</div>

<style>
	.app {
		display: flex;
		height: 100vh;
		height: 100dvh;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		color: var(--ink);
		background: #fff;
		background: var(--bg);
		color-scheme: light dark;
		/* Phones never pan sideways: a horizontal drift is a gesture,
		not a scroll (it used to open settings by accident). clip, not
		hidden, so fixed drawers stay viewport-relative. */
		overflow-x: clip;
	}
	/* Overlay drawer: the chat list slides over the main column instead
	of squeezing it — the main chat keeps full width whether sidebars
	are open or not. */
	aside {
		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		width: 13rem;
		z-index: 55;
		background: #fff;
		background: var(--bg);
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		border-right: 1px solid #e5e5ea;
		border-right-color: var(--line-soft);
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
	}
	aside ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	aside li {
		display: flex;
		gap: 0.25rem;
		position: relative;
	}
	/* Hover tip: message counts under the row, inside the drawer
	(the list scrolls, so nothing may stick out sideways). Inverted
	pill voice, pointer-transparent so the preview and row buttons
	never notice it. */
	.side-tip {
		position: absolute;
		top: calc(100% + 2px);
		left: 0;
		z-index: 5;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		font-size: 0.72rem;
		font-weight: 600;
		border-radius: 6px;
		padding: 0.2rem 0.5rem;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	aside li:hover .side-tip,
	aside li:focus-within .side-tip {
		opacity: 1;
	}
	aside li button:first-child {
		flex: 1;
		text-align: left;
	}
	/* The row × overlays instead of reserving its slot, so the chat
	pill spans the full row width flush with the + button below it.
	Keyboard focus brings it back (focus-within); touch has no hover,
	so the × stays in flow there. */
	/* Row buttons share one fixed box: same size, centered glyph, so
	hover states never shift layout. The × reads bigger in a smaller
	button; export sits one box plus a gap left of it. will-change
	pins the compositing layer across the opacity fade: without it
	the layer promotes/drops mid-hover and fractional
	translateY(-50%) paint-snaps a pixel on some engines — the
	buttons must only ever fade in place, never travel. */
	aside li .del {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 1.75rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		font-size: 1.15rem;
		line-height: 1;
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
	}
	aside li:hover .del,
	aside li:focus-within .del {
		opacity: 1;
		pointer-events: auto;
	}
	/* Per-row export: icon-only, parked left of the delete x on the
	same overlay contract (pill keeps full width; keyboard focus
	brings it back; touch keeps it in flow like the x). */
	aside li .exp {
		position: absolute;
		right: 2.1rem;
		top: 50%;
		transform: translateY(-50%);
		width: 1.75rem;
		height: 1.75rem;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		will-change: opacity;
		pointer-events: none;
		border: 0;
		background: none;
		cursor: pointer;
		color: #6e6e73;
		color: var(--muted);
		padding: 0;
		line-height: 0;
	}
	aside li:hover .exp,
	aside li:focus-within .exp {
		opacity: 1;
		pointer-events: auto;
	}
	aside li .exp:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	@media (hover: none) {
		aside li .del,
		aside li .exp {
			position: static;
			transform: none;
			opacity: 1;
			pointer-events: auto;
		}
		/* Thumb-sized new-chat button (44px target). */
		aside .new {
			width: 100%;
			min-height: 2.75rem;
			font-size: 1.15rem;
			padding: 0.6rem;
		}
		/* Touch settings entry under it: same thumb target. */
		aside .side-settings {
			width: 100%;
			min-height: 2.75rem;
			margin-top: 0.4rem;
			font-size: 0.95rem;
			padding: 0.6rem;
			border-color: #c7c7cc;
			border-color: var(--line);
		}
	}
	aside button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		/* Same ButtonText trap as side-chat below: old phone WebViews
		resolve unpinned button colors against the wrong scheme and the
		text vanishes (Settings and + went invisible in light theme). */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
		/* Never wrap mid-collapse: clip instead of reflowing over itself. */
		white-space: nowrap;
	}
	/* The current chat wears a marker bar, never a background — so the
	hover wash reads on every row including the current one. */
	aside ul button.side-chat {
		position: relative;
		/* Same ButtonText trap as .sel-menu: pin the color explicitly. */
		color: #1c1c1e;
		color: var(--ink);
		/* Uniform row labels: monospace keeps every chat's date/count
		columns aligned no matter the title text. */
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		/* The overlaid icon boxes (delete 1.75rem at right 0, export
		1.75rem at right 2.1rem) sit in this reserved padding, never on
		the title text: the pill keeps its full-width click target while
		the text truncates clear of both icons. */
		padding-right: 4rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	aside button.active {
		background: transparent;
		font-weight: 650;
	}
	aside button.active::before {
		content: "";
		position: absolute;
		left: 0.12rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.22rem;
		height: 1.05rem;
		border-radius: 999px;
		background: #007aff;
		background: var(--accent);
	}
	aside ul button:hover {
		background: #ececf1;
		background: var(--hover-wash);
	}
	aside .new:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	aside .del:hover {
		color: #94250a;
		color: var(--danger);
	}

	aside .new {
		border-color: #c7c7cc;
		border-color: var(--line);
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
		/* No sidebar controls left (⌘B/⌘N live on keys only now): keep
		a grabbable drag strip where the button row was. */
		min-height: 1.25rem;
	}
	/* Sidebar search box (search-mobile): full-width field under the
	drag strip; the clear button sits inside on the right. */
	.side-search-wrap {
		position: relative;
		margin: 0.25rem 0 0.35rem;
	}
	.side-search {
		width: 100%;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 1.6rem 0.4rem 0.6rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.side-search-clear {
		position: absolute;
		right: 0.15rem;
		top: 50%;
		transform: translateY(-50%);
		border: none;
		min-width: 1.5rem;
	}
	aside {
		/* One duration for slide and fade: the old 0.12s opacity
		finished first, so closes read as a fade while the slide ran
		invisibly. Drawers slide both ways now. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
		overflow: hidden;
	}
	aside.collapsed {
		transform: translateX(-105%);
		opacity: 0;
	}
	/* Overlay drawer, right side: same contract as the chat list —
	the main chat never squeezes. */
	.settings-panel {
		position: fixed;
		right: 0;
		/* The chat-list drawer rule parks asides left: reset it here or
		the right-docked panel over-constrains and left wins. */
		left: auto;
		top: 0;
		bottom: 0;
		width: 22rem;
		z-index: 55;
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
		padding: 1.2rem 0.7rem 2rem;
		overflow-y: auto;
		overflow-x: hidden;
		background: #fff;
		background: var(--bg);
		/* Same drawer contract as the chat list (see aside): the
		fade used to finish first and swallow the closing slide. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}
	.settings-panel.closed {
		transform: translateX(105%);
		opacity: 0;
	}
	.settings-inner {
		width: 20.6rem;
		flex-shrink: 0;
		/* Right-docked panels clip from the left: the header (the close
		target) stays put while collapsing, so it lands back under the cursor. */
		margin-left: auto;
	}
	.modal-veil {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
	.modal {
		width: min(52rem, calc(100vw - 3rem));
		max-height: min(38rem, calc(100vh - 3rem));
		max-height: min(38rem, calc(100dvh - 3rem));
		overflow-y: auto;
		background: #fff;
		background: var(--bg);
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		padding: 0.9rem 1.4rem 1rem;
		box-sizing: border-box;
	}
	.modal-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.35rem;
	}
	.modal-head h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}
	.modal-head button {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 1.1rem;
		line-height: 1;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
		color: var(--focus);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	/* Shortcuts filter: sits between the heading and ×, same field
	chrome as the search palette input. */
	.shortcuts-filter {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.modal-head .shortcuts-filter + button {
		margin-left: 0;
	}
	/* The filter reads dead on focus without this: same ring as the
	selected article, so keyboard users see where they are. */
	.shortcuts-filter:focus-visible,
	.search-input:focus-visible {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 1px;
	}
	.keys-empty {
		padding: 0.6rem 0;
		color: var(--muted);
		font-size: 0.8rem;
	}
	/* Search palette (search-mobile): pinned to the top so the phone
	keyboard never covers the input; hits read as full-width rows. */
	.search-palette {
		align-self: flex-start;
		margin-top: 8vh;
		margin-top: 8dvh;
		padding: 0.7rem 0.9rem 0.8rem;
	}
	.search-input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.95rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.search-results {
		max-height: 50vh;
		max-height: 50dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.search-hit {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		text-align: left;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.search-hit.cursor {
		background: #eef4ff;
		background: var(--hl);
		border-color: #e5e5ea;
		border-color: var(--line-soft);
	}
	.search-kind {
		flex: none;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6e6e73;
		color: var(--dim);
	}
	.search-snippet {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-status {
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--dim);
		padding: 0.6rem;
		margin: 0;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* Character Inspect overlay: narrow modal, big glyph beside the
	facts, schematic stroke progress below. */
	.inspect-modal {
		width: min(28rem, calc(100vw - 3rem));
	}
	/* Phone chat switcher veil: the card rides near the top of the
	screen (not centered) — a thumb stays near the arrows while the
	thread below stays readable. */
	.modal-veil.chat-switcher {
		align-items: flex-start;
		padding-top: 18dvh;
	}
	/* Phone chat switcher card: title plus position between two thumb
	arrows. Rendered only on phones (androidUI gate in markup), so no
	platform prefix is needed; desktop never sees it. */
	.switcher-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: min(22rem, calc(100vw - 3rem));
		padding: 1rem 1.2rem;
	}
	.switcher-mid {
		flex: 1;
		min-width: 0;
		text-align: center;
	}
	.switcher-title {
		font-weight: 650;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.switcher-pos {
		color: #6e6e73;
		color: var(--dim);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}
	.switcher-arrow {
		flex: none;
		min-width: 2.75rem;
		min-height: 2.75rem;
		font-size: 1.5rem;
		line-height: 1;
		background: none;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 12px;
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
	}
	/* Reading-locale toggle: small JP/中文 pair for ambiguous Han text. */
	.inspect-lang {
		display: flex;
		gap: 0.35rem;
		margin: 0.2rem 0 0.1rem;
	}
	/* Every inspect button is a control: pointer on hover. */
	.inspect-modal button {
		cursor: pointer;
	}
	.inspect-lang button {
		font-size: 0.8rem;
		padding: 0.15rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
	}
	.inspect-lang button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* Active locale reads as filled, not just bold: bold alone never
	scanned as selected. */
	.inspect-lang button[aria-pressed="true"] {
		font-weight: 700;
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		border-color: transparent;
	}
	.inspect-body {
		display: flex;
		gap: 1.1rem;
		align-items: flex-start;
		margin: 0.4rem 0 0.6rem;
	}
	.inspect-char {
		font-size: 3.4rem;
		line-height: 1.1;
	}
	.inspect-facts {
		flex: 1;
		min-width: 0;
	}
	.inspect-facts p {
		margin: 0.3rem 0;
	}
	.inspect-modal .note {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	/* Glyph column: vector (or font) glyph up top, stepper beneath. */
	.inspect-glyph {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		min-width: 5.5rem;
	}
	.inspect-svg {
		width: 5.5rem;
		height: 5.5rem;
	}
	.inspect-svg path {
		fill: none;
		stroke: #8e8e93;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.inspect-svg path.painted {
		stroke: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .inspect-svg path {
		stroke: #48484a;
	}
	:global(html[data-theme="dark"]) .inspect-svg path.painted {
		stroke: #f2f2f7;
	}
	.inspect-stepper {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	.inspect-stepper button {
		font-size: 1.1rem;
		line-height: 1;
		padding: 0.1rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		color: inherit;
	}
	.inspect-stepper button:not(:disabled):hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.inspect-stepper button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.inspect-count {
		font-variant-numeric: tabular-nums;
		font-size: 0.85rem;
	}
	.inspect-onkun {
		overflow-wrap: anywhere;
	}
	/* Decomposition tree (mdbg-style, two levels): root → parts,
	nested splits inline. */
	.inspect-decomp {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem;
		margin-top: 0.5rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 8px;
		font-size: 1.15rem;
	}
	.inspect-decomp-group {
		display: inline-flex;
		align-items: baseline;
		gap: 0.3rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 6px;
	}
	.inspect-decomp-char.sub {
		font-size: 0.95rem;
	}
	.inspect-decomp-arrow,
	.inspect-decomp-plus {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.keys {
		margin: 0;
		display: grid;
		grid-template-columns: 1fr 1fr;
		column-gap: 2rem;
	}
	.keys div {
		display: flex;
		gap: 0.7rem;
		padding: 0.26rem 0;
		border-top: 1px solid #e5e5ea;
		border-top-color: var(--line-soft);
		font-size: 0.8rem;
	}
	/* Two-column grid: the whole first row skips the divisor. */
	.keys div:nth-child(-n + 2) {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 8rem;
		color: #3a3a3c;
		color: var(--focus);
	}
	.keys dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	aside .del {
		color: #6e6e73;
		color: var(--dim);
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		position: relative;
	}
	/* Slim title strip: an empty drag surface, no bar. Tall enough to
	clear the traffic lights, borderless so it reads as window chrome
	instead of UI. */
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 1.75rem;
		padding: 0 1.4rem;
		font-size: 0.82rem;
		/* Chrome, not content: no I-beam, no text selection for the
		native window-drag region to fight over. Buttons keep their
		own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
		/* Invisible gesture strip: no background, blur, or border, so
		messages bleed edge to edge underneath it. It still overlays
		the column (position + z-index) for its only two jobs —
		mousedown window-drag and double-click zoom — which means the
		top strip's pixels show text but don't take clicks. Companion
		rules: .messages keeps zero top padding (full bleed) while
		scroll-padding-top parks programmatic scrolls below the strip
		so jumped-to targets stay clickable. */
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 35;
		background: transparent;
		border-bottom: 0;
	}
	/* The title strip stays a drag surface everywhere except controls
	(see dragWindow). */
	/* Hidden until the pointer comes near (JS toggles .wp-near by
	distance); nearness alone brings the stack to a dim rest.
	Clickable only while visible. */
	.wp-btn {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.18s ease;
	}
	/* :global — toggled from JS (mousemove distance), invisible to the
	compiler, so scoping must not prune it. */
	.wp-wrap:global(.wp-near) .wp-btn {
		opacity: 0.35;
		pointer-events: auto;
	}
	.wp-btn:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	/* While the panel is up it covers the tick stack, so the trigger
	rests with it: no doubled chrome, and on hover-off the ticks fade
	back only after the menu is gone. Focus keeps its button (the
	:not guard) so keyboard users never tab onto an invisible toggle. */
	.wp-wrap:hover .wp-btn:not(:focus-visible),
	.wp-wrap:focus-within .wp-btn:not(:focus-visible),
	.wp-wrap.open .wp-btn:not(:focus-visible) {
		opacity: 0;
		pointer-events: none;
	}
	/* Touch-only waypoint chrome: toolbar jump icon, sheet backdrop,
	sheet head, current-item mark. Display none on pointer devices,
	where the hover ticks and floating card stay. Role dots ride both
	menus. */
	.wp-jump,
	.wp-veil,
	.wp-sheet-head {
		display: none;
	}
	.wp-dot {
		display: inline-block;
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		margin-right: 0.55rem;
		transform: translateY(-1px);
		background: #007aff;
		background: var(--accent);
	}
	.wp-dot[data-role="assistant"] {
		background: #30d158;
	}
	.wp-menu button[aria-current="true"] {
		background: #f1f1f4;
		background: var(--bg-wash);
		font-weight: 600;
	}
	/* Touch waypoint rules live after the base waypoint block (later in
	this file): equal-specificity overrides must come second to win. */
	@keyframes wp-sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.find-bar {
		/* Floating overlay, never in-flow: opening find must not push
		the column down. Upper half of the viewport (never dead
		center), over the messages. High z-index so hits reach it,
		not the text underneath. */
		position: fixed;
		top: 25%;
		left: 50%;
		transform: translate(-50%, -50%);
		z-index: 60;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	.find-bar input[type="search"] {
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
		background: none;
		border: 0;
		outline: none;
		width: 12rem;
	}
	.find-count {
		font-size: 0.75rem;
		color: #6e6e73;
		color: var(--muted);
		min-width: 3.2rem;
		text-align: right;
		white-space: nowrap;
	}
	.find-bar button {
		font: inherit;
		font-size: 0.85rem;
		border: 0;
		border-radius: 6px;
		background: none;
		cursor: pointer;
		color: inherit;
		padding: 0.1rem 0.35rem;
		line-height: 1.2;
	}
	.find-bar button:hover {
		background: rgba(120, 120, 128, 0.18);
	}
	button.link {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	/* Overlay traffic lights sit at x:20–72, y:26 (see trafficLightPosition
	in tauri.conf.json). The header clears them with left padding; the
	empty sidebar head indents by the same amount so the chat list
	starts at the same x. */
	.app[data-shell="tauri"] header {
		padding-left: 5.75rem;
		/* Sit the top chrome a touch lower so it centers on the
		native traffic lights instead of riding above them. */
		padding-top: 1.15rem;
	}
	/* The shell's strip is taller by that same padding: the first
	message stands off the full height there. */
	.app[data-shell="tauri"] article:first-of-type {
		margin-top: calc(1.75rem + 1.15rem);
	}
	.app[data-shell="tauri"] .side-head {
		margin-left: 5.75rem;
		margin-top: 0.35rem;
	}
	/* Traffic-light hover fade lives in the shell (see
	src-tauri/src/trafficlights.rs): the native Overlay buttons paint
	above the webview, so no web patch can fade them — the stale
	bg-colored cover that sat here fought the native fade and ghosted
	the cluster, and is gone. */
	/* Android is a Tauri shell with no traffic lights and no window
	drag: drop the desktop clearance and the empty drag strip. */
	.app[data-android] header {
		padding-left: 1.4rem;
		padding-top: 0;
		/* The strip stays: with the webview reporting a zero top inset,
		its 28px is the status-clock clearance, not spare room. */
	}
	.app[data-android] .side-head {
		margin-left: 0;
		margin-top: 0;
		min-height: 0;
	}
	/* Notch and home-indicator clearance: the reply pill stops riding
	under the status clock, the composer clears the gesture bar. env()
	is 0 where the webview already insets, so this no-ops there. */
	.app[data-android] header {
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app[data-android] main {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	/* Original spacing stands: the header strip plus the list's own
	inset keep the first message clear of the island. Trimming it
	(any of three tries) slid text under the clock — the first-message
	gap was never worth chasing. */
	.app[data-android] .messages {
		padding-top: calc(1rem + env(safe-area-inset-top, 0px));
	}
	/* Full-width settings sheet on phones: no sliver to tap, no
	weird one-tap-close strip. left+right with auto width fills
	exactly (a 100% width would add the padding on top and overflow).
	The inner column centers itself. */
	.app[data-android] .settings-panel {
		left: 0;
		width: auto;
		padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
	}
	.app[data-android] .settings-inner {
		width: auto;
		max-width: 26rem;
		margin-left: auto;
		margin-right: auto;
	}
	/* Chats with messages lift the composer off the bottom and give
	it more rows: the empty state's hero layout keeps its own rhythm.
	No font-size here — CodeMirror caches line metrics, and a size
	change out from under it collapses the editor to zero height. */
	/* iOS zooms into any text field under 16px on focus (and the
	zoom is what unlocks sideways panning): phone fields floor at
	16px. Desktop keeps its optical sizes. */
	.app[data-android] .prompt :global(.ta-input) {
		font-size: 16px;
	}
	.app[data-android] main:not(.empty) .prompt {
		/* Hug the keyboard: the old 1.8rem margin plus the 1.1rem base
		offset stranded the composer ~3rem above it. */
		margin-bottom: 0.6rem;
		bottom: 0.6rem;
		min-height: 7.25rem;
	}
	/* Phone composer: text on top, buttons below (other chat apps'
	rhythm). The card becomes a plain column: the field grows to its
	cap then scrolls, the tools row sits static underneath with the
	send button pinned at its right end. Desktop keeps the overlaid
	tools cluster and its measured reservations. */
	.app[data-android] .prompt {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.7rem 0.8rem 0.6rem;
	}
	.app[data-android] .prompt :global(.ta-input) {
		/* Top bar is text-only: the tools live in the row below, so no
		right-side reservation (desktop keeps its overlaid cluster). */
		--tools-pad: 0rem;
		--tools-extra: 0rem;
		padding: 0 0 0.1rem;
		/* Small single line (~26px): the old 2rem floor read 60/40
		against the button bar. The field owns its height where
		supported, JS stands down. */
		min-height: 1.5rem;
		max-height: 7.5rem;
	}
	.app[data-android] .prompt-tools {
		position: static;
		order: 5;
		width: auto;
		margin-top: auto;
		padding-right: 2.6rem;
		/* Bottom bar: one even row under the text, no divider. */
		align-items: center;
		padding-top: 0.35rem;
	}
	.app[data-android] .send-btn {
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
	/* Phones scroll by thumb: no scrollbar chrome anywhere. Touch
	scrolling itself is untouched — only the track/thumb paint hides.
	:global (not a bare *) so Svelte keeps the rule: it prunes vendor
	pseudo-elements it cannot verify, which would drop the paint half. */
	.app[data-android] :global(*) {
		scrollbar-width: none;
	}
	.app[data-android] :global(*::-webkit-scrollbar) {
		display: none;
	}
	/* Phone composer: one line at rest, two on focus. Unfocused the
	field clamps to a single line and the tools row + send button park
	invisible; focusing (tap or keyboard) grows the field to two lines
	and slides the buttons into their second line. Live annotation UI
	(the selection dock, the pill/review wrap) holds the row open —
	parking it would strand the dock the tap just summoned. */
	.app[data-android] .prompt :global(.ta-input) {
		transition:
			max-height 0.22s ease,
			min-height 0.22s ease;
	}
	/* Sidebar parking parks and restores instantly on phones: the
	0.35s slide plus a chat-switch re-render threw the card
	mid-screen for a frame. Phones never idle-hide (migrated to
	never), so the ramp serves nothing there; desktop keeps it. */
	.app[data-android] .prompt {
		transition:
			border-color 0.18s ease,
			visibility 0s;
	}
	.app[data-android] .prompt:not(.prompt-idle) {
		transition:
			border-color 0.18s ease,
			visibility 0s;
	}
	.app[data-android] .prompt:not(:focus-within) {
		gap: 0;
		/* Let the card hug the single line: the 7.25rem keyboard floor
		below only applies while focused (typing). */
		min-height: 0;
	}
	.app[data-android] .prompt:not(:focus-within) :global(.ta-input) {
		max-height: 1.5rem;
		overflow: hidden;
	}
	.app[data-android] .prompt:focus-within :global(.ta-input) {
		/* Focus never inflates the field: height follows content up to
		the same cap, so an empty tap stays one line tall. */
		min-height: 1.5rem;
		max-height: 7.5rem;
	}
	/* The row snaps (no height ramp): ramping its height would slide
	its buttons under tapping fingers mid-flight. The field above may
	ramp freely — the row is bottom-anchored, so field growth never
	moves it. */
	/* The tools bar is always up on phones — idle single-bar mode is
	gone, so the row never collapses, fades, or hides its buttons.
	Highlight mode still stands the other tools down (see the
	:has(.ann-dock) rules below). */
	.app[data-android] .prompt-tools {
		max-height: 3rem;
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.app[data-android] .prompt :global(.ta-input),
		.app[data-android] .prompt-tools,
		.app[data-android] .send-btn {
			transition: none;
		}
	}
	/* The composer stands down while the annotation box owns the
	keyboard — but holds its space: unmounting the card collapses
	the tail clearance and snaps the thread on focus. */
	.app[data-android] .prompt.prompt-hidden {
		visibility: hidden;
		pointer-events: none;
	}
	/* Phone thumb row: attach, dictation, and voice match the send
	button's seat — one even row, no small outlier. Desktop keeps its
	optical sizes. */
	.app[data-android] .attach-btn,
	.app[data-android] .mic-btn,
	.app[data-android] .voice-float {
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		font-size: 1.15rem;
	}
	.app[data-android] .attach-btn :global(.action-glyph),
	.app[data-android] .mic-btn :global(.action-glyph),
	.app[data-android] .voice-float :global(.action-glyph) {
		height: 1.15em;
	}
	/* Highlight up: the dock wrapper overlays the whole card, so
	Annotate/Inspect cover both bars at exactly 50/50 without
	resizing anything (the card keeps its idle geometry to the
	pixel). Every other tool stands down beneath the overlay;
	visibility (not display) keeps their boxes, so the row holds
	its height. Phones only; desktop keeps the floating menu. */
	.app[data-android] .prompt:has(.ann-dock) .ann-dock-wrap {
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
	.app[data-android] .prompt:has(.ann-dock) .ann-dock {
		flex: 1 1 0;
		min-height: 0;
		height: 100%;
		font-size: 1.3rem;
		padding: 0.55rem 0.6rem;
	}
	/* The overlay escapes the row: its 3rem overflow cap would clip
	the card-sized wrapper to a strip. */
	.app[data-android] .prompt:has(.ann-dock) .prompt-tools {
		overflow: visible;
	}
	.app[data-android] .prompt:has(.ann-dock) .attach-btn,
	.app[data-android] .prompt:has(.ann-dock) .mic-btn,
	.app[data-android] .prompt:has(.ann-dock) .voice-float,
	.app[data-android] .prompt:has(.ann-dock) .wp-jump,
	.app[data-android] .prompt:has(.ann-dock) .send-btn,
	.app[data-android] .prompt:has(.ann-dock) .ann-wrap {
		visibility: hidden;
		pointer-events: none;
	}
	.app[data-android] .prompt:has(.ann-dock) :global(.ta-input::placeholder),
	.app[data-android] .prompt:has(.ann-dock) :global(.cm-placeholder) {
		color: transparent;
	}
	/* Empty chat on phones: the pills row is the last in-flow child, so
	a tall hero plus big fonts push it under the floating prompt card
	(which then eats its taps). Reserve the prompt's footprint below. */
	.app[data-android] main.empty {
		padding-bottom: 9.5rem;
	}
	/* Touch has no hover: tooltips only ever appear as a clipped
	flash on long-press (the fold button's runs off-screen). */
	.app[data-android] .actions [data-tip]::after {
		display: none;
	}
	/* Thumb-sized Cancel targets on phones: the annotation review and
	pill buttons plus the chat-row ×. Message-row icons stay tight so
	the row never overflows the phone width. */
	.app[data-android] .review-edit-actions button {
		padding: 0.6rem 1.2rem;
		min-height: 2.75rem;
	}
	.app[data-android] .ann-cancel,
	.app[data-android] .ann-save {
		min-height: 2.75rem;
	}
	/* The create pill's arrow rides round like the composer's send:
	compact pill, compact button. */
	.app[data-android] .ann-pop.fresh .ann-pill-save {
		min-height: 0;
		height: 2.2rem;
		width: 2.2rem;
		padding: 0;
		border-radius: 50%;
		font-size: 1.1rem;
		line-height: 1;
	}
	.app[data-android] aside li .del {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		/* The box grew already; the glyph itself stays text-sized. */
		font-size: 1.15rem;
	}
	/* Per-row export shares the delete box on phones: same thumb
	target, so the two icons sit vertically aligned in the row.
	Desktop keeps the overlaid icon pair. */
	.app[data-android] aside li .exp {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
	}
	.app[data-android] aside li {
		align-items: center;
	}
	/* Phones slide the chat list in from the left covering ~3/4 of
	the width (thumb-reachable, main chat kept as a sliver behind).
	Desktop keeps its left drawer; the settings panel keeps its
	right drawer (one sidebar at a time). */
	.app[data-android] aside:not(.settings-panel) {
		left: 0;
		right: auto;
		top: 0;
		bottom: 0;
		width: min(78vw, 20rem);
		max-height: none;
		overflow: hidden;
		border-right: 1px solid #e5e5ea;
		border-right-color: var(--line-soft);
		border-top: 0;
		border-radius: 0;
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.16);
		padding-bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
		/* Thumb-first column: search alone at the top with breathing
		room, the list fills the middle, and new + settings ride the
		bottom edge. Desktop keeps its top-down drawer. */
		display: flex;
		flex-direction: column;
		padding-top: calc(2.5rem + env(safe-area-inset-top, 0px));
	}
	.app[data-android] aside:not(.settings-panel) .side-search-wrap {
		margin-top: 0;
	}
	/* Twice the tap height with adult type. Desktop keeps the
	compact filter. */
	.app[data-android] aside:not(.settings-panel) .side-search {
		font-size: 1.15rem;
		min-height: 4.5rem;
		padding: 0.8rem 2.2rem 0.8rem 0.8rem;
	}
	/* Counter pill rides right of the audio button (DOM-first, so
	order pushes it past voice); the wrap goes static so the review
	panel anchors to the card. Desktop keeps its left slot and its
	inline review. */
	.app[data-android] .prompt-tools .ann-wrap {
		order: 4;
		position: static;
	}
	.app[data-android] .prompt-tools .ann-wrap .review {
		position: absolute;
		left: 0.8rem;
		right: 0.8rem;
		bottom: calc(100% + 0.5rem);
		width: auto;
		max-height: min(26rem, 52dvh);
		margin: 0;
		overflow-y: auto;
		z-index: 40;
		font-size: calc(0.92rem * var(--font-scale, 1));
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
	}
	/* Annotation boxes read at the screen's message size on phones:
	a fixed 1rem box next to 800% message type strands the eyes.
	Desktop keeps its fixed overlay type. */
	.app[data-android] .ann-pop textarea {
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	.app[data-android] aside:not(.settings-panel) ul {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
	}
	/* Settings owns the bottom edge at double height: the last child
	of the pile, impossible to miss. Desktop keeps its inline row. */
	.app[data-android] aside:not(.settings-panel) .side-settings {
		min-height: 5.5rem;
		font-size: 1.15rem;
		margin-top: 0.6rem;
	}
	/* The per-chat message counter rides dim beside the label, so the
	date column keeps its alignment. Phone-only markup; desktop rows
	never render it. */
	.side-count {
		color: #6e6e73;
		color: var(--dim);
	}
	.app[data-android] aside:not(.settings-panel).collapsed {
		transform: translateX(-105%);
	}
	/* Four region menus share one row on a phone: no wrap, tighter
	chrome. Desktop keeps the wrapping rhythm. */
	.app[data-android] .lang-menus {
		flex-wrap: nowrap;
		gap: 0.4rem;
	}
	.app[data-android] .lang-menu > button {
		font-size: 0.75rem;
		padding: 0.3rem 0.55rem;
		white-space: nowrap;
	}
	/* The gestures list goes single-column on phones: two columns
	overflow a 360px viewport by ~60px, clipping the very text that
	teaches the gestures. Touch descriptions are prose, not key
	chords, so they drop the monospace too. */
	.app[data-android] .keys {
		grid-template-columns: 1fr;
	}
	.app[data-android] .keys div:nth-child(2) {
		border-top: 1px solid #e5e5ea;
	}
	.app[data-android] .keys dd {
		font-family: inherit;
		font-size: 0.8rem;
	}
	nav {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		border-bottom-color: var(--line-soft);
		overflow-x: auto;
	}
	nav button {
		font-size: 0.75rem;
		min-width: 1.6rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: #fff;
		background: var(--bg-raised);
		/* No unclassed button renders inside nav today, but ButtonText
		would strike here the moment one does. */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
	}
	/* Waypoint jump menu: a hamburger floating at the viewport's
	middle-right, revealing the message list on hover, focus, or
	pinned click. No strip — the bar is gone. */
	nav[aria-label="Waypoints"] {
		position: fixed;
		right: 1.75rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		border: 0;
		padding: 0;
		overflow: visible;
	}
	.wp-wrap {
		position: relative;
	}
	/* One tick per message: the stack grows with the chat, then scrolls. */
	.wp-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		max-height: 4rem;
		overflow-y: auto;
		border: 0;
		background: none;
		padding: 0.3rem 0.15rem;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	.wp-tick {
		display: block;
		flex-shrink: 0;
		width: 1.3rem;
		height: 3px;
		border-radius: 2px;
		background: currentColor;
	}
	/* The open panel overlaps the tick stack (no dead gap): sliding the
	pointer down off the ticks lands straight on the menu. */
	.wp-menu {
		position: absolute;
		right: 0;
		top: 0;
		z-index: 50;
		min-width: 12rem;
		max-width: 20rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.4rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 16px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		/* Fade out first, then hide: the delayed visibility flip keeps
		the panel painted for the whole opacity ramp. */
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.3s ease,
			visibility 0s linear 0.3s;
	}
	.wp-wrap:hover .wp-menu,
	.wp-menu:focus-within,
	.wp-wrap.open .wp-menu {
		/* Reveal now, fade in: the incoming transition governs. */
		opacity: 1;
		visibility: visible;
		transition:
			opacity 0.3s ease,
			visibility 0s;
	}
	.wp-menu button {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 0.85rem;
		color: #1c1c1e;
		color: var(--ink);
		border: 0;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.45rem 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
		-webkit-user-select: none;
		transition: background-color 0.18s ease;
	}
	.wp-menu button:hover {
		background: #f1f1f4;
		background: color-mix(in oklab, var(--ink) 6%, transparent);
		background: var(--bg-wash);
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
	main.scale-actions .messages {
		gap: calc(var(--msg-gap, 0.35rem) * var(--font-scale, 1));
	}
	/* Overscroll past the tail: the last message lifts a touch above
	the composer instead of docking hard at the column's end. Fixed
	unless the opt-in below says otherwise (capped like the bubble,
	so huge type doesn't drown in spacer). Non-empty only: the empty
	hero centers in its zone and must not drift. */
	main:not(.empty) .messages::after {
		content: "";
		display: block;
		flex: none;
		height: 2rem;
	}
	/* Same opt-in as the list gap: the tail spacer grows with the
	text size only when message-button scaling is on. */
	main.scale-actions:not(.empty) .messages::after {
		height: calc(2rem * min(var(--font-scale, 1), 2));
	}
	/* Chat-switch crossfade covers the messages only: an unscoped
	transition snapshots the whole page, so the closing sidebar and
	the parking prompt ghost mid-switch — the prompt reads as
	summoned twice, flickering. The root pair cuts instantly while
	message bodies keep the crossfade (:global — these pseudos live
	on the document, and the scope hash would break them). The
	`messages` name lives only around the switch (see
	scopeMessagesTransition): a standing name makes .messages a
	stacking context, trapping the annotation badges under the
	header strip so their clicks land on the chrome beneath. */
	:global(::view-transition-old(root)),
	:global(::view-transition-new(root)) {
		animation: none;
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
	/* Every other scroller fades exactly like the main chat: invisible
	until a scroll is in flight (one capture-phase listener below toggles
	.scrolling with the same short hold). */
	[data-fade-scroll] {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.3s ease;
	}
	[data-fade-scroll]::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	[data-fade-scroll]::-webkit-scrollbar-track {
		background: transparent;
	}
	[data-fade-scroll]::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.3s ease;
	}
	[data-fade-scroll]:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	[data-fade-scroll]:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* The two drawers slide on transform (plus their collapse widths),
	which the shared fade shorthand above would replace: restate the
	full lists here so the scrollbar fade joins instead of killing the
	slide. Every list keeps transform, or closes read as a fade. */
	aside[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.3s ease;
	}
	.settings-panel[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.3s ease;
	}
	aside[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	.settings-panel[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	/* Same clobber, smaller victims: the waypoint tick stack and its menu
	carry data-fade-scroll for their own overflow, which ate the opacity
	fades. Restate both lists here. */
	.wp-btn[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.3s ease;
	}
	.wp-btn[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.12s ease;
	}
	.wp-menu[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.3s ease;
	}
	.wp-menu[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.12s ease;
	}
	/* Touch waypoint: the tick strip is pointer-sized and parked on the
	wrong edge for thumbs, so touch gets a jump icon in the composer
	tools opening a bottom sheet. Desktop keeps its hover ticks and
	floating card untouched. Later than the base waypoint rules, so
	equal-specificity ties win. */
	@media (hover: none) {
		.wp-btn {
			display: none;
		}
		/* Touch has no hover intent: a tap's sticky :hover/:focus would
		paint the sheet over the pill before the click lands, stealing
		it. Closed-only (the :not guard), so the open sheet survives the
		sticky hover + pill focus that opening by tap leaves behind. The
		sheet opens on wpOpen only; keyboard/AT activation is a click,
		so it still opens. */
		.wp-wrap:not(.open):hover .wp-menu,
		.wp-wrap:not(.open):focus-within .wp-menu {
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 0.18s ease,
				visibility 0s linear 0.18s;
		}
		nav[aria-label="Waypoints"] {
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			transform: none;
			pointer-events: none;
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
		.wp-veil {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 60;
			border: 0;
			/* Full-bleed square corners: without this the legacy
			`nav button` pill radius turns the backdrop into an oval. */
			border-radius: 0;
			background: rgba(0, 0, 0, 0.32);
			pointer-events: auto;
		}
		.wp-menu {
			position: fixed;
			left: 0.75rem;
			right: 0.75rem;
			bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
			top: auto;
			z-index: 62;
			min-width: 0;
			max-width: none;
			max-height: 55vh;
			border-radius: 20px;
			padding: 0.25rem 0.4rem 0.5rem;
			pointer-events: auto;
		}
		.wp-wrap.open .wp-menu {
			animation: wp-sheet-in 0.18s ease-out;
		}
		.wp-sheet-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.35rem 0.1rem 0.35rem 0.7rem;
			font-size: 0.8rem;
			color: #8e8e93;
		}
		.wp-menu .wp-sheet-head button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
			font-size: 1.4rem;
			line-height: 1;
			color: inherit;
		}
		.wp-menu button[role="menuitem"] {
			padding: 0.75rem 0.7rem;
			font-size: 0.9rem;
		}
	}
	main.empty .messages {
		justify-content: center;
		/* Roomy hero zone: on the empty screen the prompt and pills sit
		below the fold of the hero, neither middle nor bottom. */
		max-height: 60%;
	}
	main.empty .lang-menus {
		/* Docked above the prompt's reserved floor, never mid-page:
		the auto margin eats the free space between the hero zone
		and the pills, so the row sits just over the composer. */
		margin-top: auto;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem 0.5rem;
	}
	.hero {
		margin: 0;
		text-align: center;
		text-wrap: balance;
		font-size: 1.65rem;
		font-weight: 650;
		letter-spacing: -0.01em;
		/* Welcome text is chrome, not content: never selectable. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	.mock-note {
		margin: 0;
		color: #6e6e73;
		font-size: 0.85rem;
	}
	.lang-menus {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	main.empty .lang-menus {
		justify-content: center;
		padding: 0.55rem 1.2rem 0.6rem;
	}
	/* No row-level fade here: hovering open space inside the row lit
	every button at once and the opacity shimmer read as movement.
	Each pill answers only for itself (border-color on
	.lang-menu > button:hover below); the row stays put on all
	platforms. Touch layouts untouched. */
	.lang-menu {
		position: relative;
	}
	.lang-menu > button {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
		color: var(--ink);
		transition: border-color 0.15s ease;
	}
	.lang-menu > button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		/* Open upward over the composer, never down past it. */
		bottom: calc(100% + 0.35rem);
		left: 0;
		/* Shrink-wrap the longest name: a fixed min-width leaves dead
		space right of every short option and pushes right-edge menus
		(like African) off-screen. */
		min-width: 0;
		width: max-content;
		max-width: calc(100vw - 1rem);
		/* Full extent, never a scrollbar: the longest menu is 15 items
		and the list opens upward over the messages. */
		display: flex;
		flex-direction: column;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	@media (hover: none) {
		/* A phone can't fit the 15-item list above the pills, so it
		gets a capped sheet with its own scroll instead of flying off
		the top of the screen. Desktop keeps full extent, no scrollbar. */
		.lang-list {
			max-height: 52vh;
			overflow-y: auto;
		}
		/* Phone menus must not trail off-screen: middle menus center
		under their button, while the edge menus hug their own edge
		(Europe's list spilled left, Classics' right). The capped
		max-width still bounds every list to the viewport. */
		.lang-menu .lang-list {
			left: 50%;
			right: auto;
			transform: translateX(-50%);
		}
		.lang-menu:first-child .lang-list {
			left: 0;
			transform: none;
		}
		.lang-menu:last-child .lang-list {
			left: auto;
			right: 0;
			transform: none;
		}
	}
	/* The last menu (Classics) hugs the right edge: a left-anchored
	list of long nowrap names trails off the page there. Right-anchor
	it instead (all viewports — narrow desktop windows clip it too). */
	.lang-menu:last-child .lang-list {
		left: auto;
		right: 0;
	}
	.lang-list button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.45rem;
		text-align: left;
		color: #1c1c1e;
		color: var(--ink);
		white-space: nowrap;
		transition: background-color 0.15s ease;
	}
	.lang-list button:hover,
	.lang-list button:focus-visible {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.lang-list button.selected {
		font-weight: 650;
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.badge {
		display: inline-block;
		min-width: 2rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #3a3a3c;
		color: var(--focus);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
	}
	article {
		position: relative;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		/* Flex items default to min-width:auto: a nowrap folded preview
		refuses to shrink and shoves the whole chat sideways (stray
		scrollbars). Zero lets the ellipsis bite instead. */
		min-width: 0;
		/* Text starts only at the message body: dragging anywhere else
		(empty space, action rows) is a plain pointer drag, never an
		I-beam selection. .rendered re-enables both below. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* Mid-drag containment covers the whole contained article: KaTeX
	bodies and folded labels declare their own user-select:text,
	which overrules the inline none containDragTo sets on the
	article's .rendered — without this, off-window drags wander
	into other messages' math. !important: only inline styles lose
	to it, and the attribute lives for the drag alone (mouseup
	clears it, so this is never a resting state). */
	article :global(.rendered[data-drag-none]),
	article :global(.rendered[data-drag-none] *) {
		user-select: none !important;
		-webkit-user-select: none !important;
	}
	/* A user message opens a new pair, so it carries the
	between-pair separation on top; replies hug underneath.
	The Gap size slider plus a hair, unless the button-scaling
	opt-in says otherwise (same contract as the list gap above). */
	article.user {
		margin-top: calc(var(--msg-gap, 0.35rem) + 0.1rem);
	}
	main.scale-actions article.user {
		margin-top: calc((var(--msg-gap, 0.35rem) + 0.1rem) * var(--font-scale, 1));
	}
	article:first-of-type {
		margin-top: 0;
	}
	/* Even wrapping reads better in a chat column; one line, and
	engines without it just wrap normally. Assistant only: on short
	own messages pretty balances the lines into even halves, reshaping
	the bubble (a lone "paragraphs." gets "Japanese" pulled down to
	join it) — own text keeps its natural ragged wrap. */
	.messages article.assistant :global(.rendered) {
		text-wrap: pretty;
	}
	article.user {
		align-self: flex-end;
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right docks the right edge to the assistant column
		(centered min(100%, chat-width)), so own messages never drift
		right past AI width on narrow windows. */
		width: fit-content;
		max-width: min(100%, calc(var(--chat-width, 36) * 1rem));
		margin-right: max(0rem, calc((100% - min(100%, var(--chat-width, 36) * 1rem)) / 2));
		/* No background or padding here: the bubble wraps the text only,
		so the action row below sits outside it. */
		padding: 0;
	}
	/* Own-message bubble: shrink-wraps the text (never the wider action
	row underneath) and docks hard right, so the side padding matches on
	both sides. Text stays left-aligned inside the right-docked bubble;
	long text wraps at 90% instead of going full-bleed, so a wrapped
	message keeps a visible left gutter and still reads as right-docked.
	Slightly tighter on top, where the text sat low. */
	article.user .bubble {
		background: #f1f1f4;
		background: var(--bg-wash);
		/* Radius and padding track the text size only up to 2x: past that
		the article cap stays fixed while the font keeps growing, so an
		unbounded scale domes the top corners and squeezes the text into
		a tall tower with dead gray shoulders. */
		border-radius: calc(1.75rem * min(var(--font-scale, 1), 2));
		padding:
			calc(0.45rem * min(var(--font-scale, 1), 2))
			calc(1rem * min(var(--font-scale, 1), 2))
			calc(0.55rem * min(var(--font-scale, 1), 2));
		text-align: left;
		width: fit-content;
		/* 100%, not 90%: the article already caps at min(100%, chat-width),
		and 90% here resolves against the shrink-wrapped article itself —
		squeezing short prompts into an early wrap with dead space left. */
		max-width: 100%;
		margin-left: auto;
	}
	/* Structured content stays left-aligned inside own messages: code
	and tables read badly right-aligned. */
	article.user :global(.rendered pre),
	article.user :global(.rendered table),
	article.user :global(.ccez-code) {
		text-align: left;
	}
	/* In-place own-message edit: same right-docked footprint as the
	bubble, with a visible editing frame (the bubble shade would fight
	the code colors). The bar holds the touch path — phones have no
	Esc and no Enter-to-save. */
	article.user .msg-edit {
		background: var(--bg-raised);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.5rem 0.75rem 0.4rem;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
		text-align: left;
	}
	.msg-edit-box :global(.cm-editor) {
		background: none;
	}
	.msg-edit-box :global(.cm-scroller) {
		max-height: 16rem;
	}
	/* In-place edit on phones: the textarea editor misses the
	prompt-scoped textarea styles, so it falls back to native chrome;
	and the desktop editing frame fights the bubble. Match the bubble
	instead (same wash, radius, padding, right dock) with a bare
	text field inside — the bar keeps the touch path (phones have no
	Esc and no Enter-to-save). */
	.app[data-android] article.user .msg-edit {
		background: var(--bg-wash);
		border: 0;
		border-radius: calc(1.75rem * min(var(--font-scale, 1), 2));
		padding:
			calc(0.45rem * min(var(--font-scale, 1), 2))
			calc(1rem * min(var(--font-scale, 1), 2))
			calc(0.55rem * min(var(--font-scale, 1), 2));
		width: 100%;
		box-sizing: border-box;
		/* Same type as the message it replaces (see MessageBody's
		.rendered): the bare textarea inherits this, so the draft
		reads at exactly the message size. Desktop keeps its own
		editing frame above. */
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
	}
	.app[data-android] .msg-edit-box :global(.ta-input) {
		width: 100%;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		resize: none;
		outline: none;
		field-sizing: content;
		padding: 0;
	}
	.msg-edit-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.35rem;
	}
	.msg-edit-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: none;
		color: var(--ink);
		cursor: pointer;
	}
	.msg-edit-btn:hover {
		border-color: var(--line-hover);
	}
	article.assistant {
		align-self: center;
		padding-left: 0;
		padding-right: 0;
		/* Assistant text packs tight: the list gap already separates
		messages, so no vertical padding here (desktop and touch). */
		padding-top: 0;
		padding-bottom: 0;
	}
	/* Unshaded own messages read like replies: no bubble, but the same
	right-docked flow — alignment never changes with the background.
	Shrink-wrap + auto margin docks short messages hard right (a full
	width here would strand them left with dead space on the right). */
	main.plain-user article.user .bubble {
		background: none;
		/* No bottom pad: the action row below sits as close as the
		assistant's (its margin is the whole gap). 100%, not 90%: the
		article already caps at min(100%, chat-width), and 90% here
		resolves against the shrink-wrapped article itself — same early
		wrap the shaded bubble's rule calls out. */
		padding: 0.5rem 0 0;
		text-align: left;
		width: fit-content;
		max-width: 100%;
		margin-left: auto;
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 2px;
	}
	/* Palette jumps land DOM focus on the article itself (tabindex -1
	for programmatic focus only, never in the Tab order): .selected
	carries the keyboard indicator, so focus adds no second ring. */
	article:focus {
		outline: none;
	}
	article.selected:focus {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 2px;
	}
	/* Hover-only button modes keep the actions row in the layout
	(invisible via opacity), so the article ring would box the buttons'
	empty floor too. The article ring goes quiet there and the text body
	carries the selected indicator instead. */
	main.hover-user article.user.selected,
	main.hover-user article.user.selected:focus,
	main.hover-assistant article.assistant.selected,
	main.hover-assistant article.assistant.selected:focus {
		outline-color: transparent;
	}
	main.hover-user article.user.selected .bubble,
	main.hover-assistant article.assistant.selected :global(.rendered) {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
		outline-offset: 6px;
		border-radius: 8px;
	}
	/* Holding Option arms message click actions (fold/unfold): the
	pointer says clickable where the I-beam says selectable. */
	main.alt article,
	main.alt article * {
		cursor: pointer;
	}
	/* Sent-message tags: the marker text as links — body-size type,
	underlined, in a sideways-scrolling row when many. Hovering shows
	the composer's big preview card (image or file excerpt). History
	is read-only: no buttons, no meta lines, just the picture. */
	.sent-tags {
		display: flex;
		gap: 0.35rem 0.6rem;
		overflow-x: auto;
		margin-bottom: 0.35rem;
		padding-bottom: 0.15rem;
		/* Body-size like the inline tags (the strip sits outside
		.rendered, whose 0.92rem the buttons would otherwise miss). */
		font-size: calc(0.92rem * var(--font-scale, 1));
	}
	/* Own messages pack to the right edge: the strip hugs it too. */
	article.user .sent-tags {
		justify-content: flex-end;
	}
	/* Leftover-strip folds reuse the pasted-content look (the fold
	stylesheet lives on the message body, outside this tree). */
	.sent-tags .paste-fold {
		flex: none;
		font: inherit;
		font-weight: 700;
		color: #007aff;
		color: var(--accent);
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	/* Expanded tag popup: overlay above the tag (below for strip
	tags, which sit atop the message), so opening never moves message
	content and the tag stays visible right below it. Below the
	floating composer in z (prompt is 30), above message chrome.
	Global: half the tags ride raw `{@html}`, which carries no Svelte
	scope hash, so scoped selectors never reach them. */
	:global(.sent-wrap) {
		position: relative;
		display: inline-block;
	}
	:global(.sent-open) {
		display: block;
		position: absolute;
		bottom: 100%;
		/* Centered over the tag (static transform, no motion): the
		card straddles its anchor instead of spilling right. */
		left: 50%;
		transform: translateX(-50%);
		z-index: 20;
		margin-bottom: 0.3rem;
	}
	/* Strip popups open upward like inline ones (above the tag, never
	covering the message below). Near the viewport top the card can
	reach the header — accepted: downward covered content instead. */
	/* Unclipped while a popup floats: the strip only scrolls collapsed
	tags; an open popup must escape its box. */
	.sent-tags.pop-open {
		overflow: visible;
	}
	:global(.sent-card) {
		display: block;
		/* Hug the content (capped for huge previews and narrow
		viewports): no stranded wash beside a short preview. Contents
		center, so the image rides the middle with the footer beneath
		it even when the footer is the narrower run. */
		width: max-content;
		max-width: min(16rem, calc(100vw - 2rem));
		padding: 0.4rem 0.5rem;
		font-size: 0.78rem;
		text-align: center;
		background: #eef4ff;
		background: var(--hl);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 12px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
	}
	:global(.sent-foot) {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		margin-top: 0.3rem;
	}
	:global(.sent-name) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		/* Shrink-to-fit cards need a bound: long names ellipsize
		instead of stretching the card past its cap. */
		min-width: 0;
		max-width: 12rem;
	}
	:global(.sent-tok) {
		flex: none;
		white-space: nowrap;
		color: #6e6e73;
		color: var(--muted);
	}
	:global(.sent-icobtn) {
		display: inline-flex;
		align-items: center;
		flex: none;
		padding: 0.1rem;
		background: none;
		border: 0;
		cursor: pointer;
		color: #3a3a3c;
		color: var(--ink-soft);
	}
	/* The glyphs ride raw `{@html}` (no static markup carries the
	class), so the rule is global; strip icons size below. */
	:global(.sent-glyph) {
		height: 1em;
	}
	:global(.sent-icobtn .action-glyph) {
		height: 1em;
	}
	:global(.sent-btn) {
		flex: none;
		padding: 0.1rem 0.25rem;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		background: none;
		border: 0;
		border-radius: 6px;
		cursor: pointer;
		color: #3a3a3c;
		color: var(--ink-soft);
	}
	:global(.sent-btn:disabled) {
		opacity: 0.45;
		cursor: default;
	}
	:global(.sent-img) {
		display: block;
		max-width: 14rem;
		max-height: 10rem;
		margin: 0 auto;
		border-radius: 6px;
	}
	:global(.sent-excerpt) {
		display: block;
		max-height: 8rem;
		overflow: auto;
		white-space: pre-wrap;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
	}
	/* Sent-message annotation refs: the baked block collapses to the
	count (like the composer pill); hover or Tab reveals the saved
	quotes in a card above. Content-only — provider context keeps the
	full block. */
	/* Baked-refs count floats above the message (overlay, never
	in-flow): annotated history keeps the exact dimensions of plain
	history. No circle, no border — just the number, quiet. */
	.ann-refs {
		position: absolute;
		top: -1.2rem;
		left: 0.8rem;
		display: flex;
		margin: 0;
	}
	article.user .ann-refs {
		left: auto;
		right: 0.8rem;
	}
	.ann-refs-pill {
		position: relative;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: #6e6e73;
		/* The count tracks the chat text size like badges do (dampened:
		never compounding rem, just the message scale). */
		font-size: calc(0.72rem * var(--font-scale, 1));
		font-weight: 650;
		line-height: 1.4;
		padding: 0 0.1rem;
		/* A disclosure button like any other: the hand invites the
		click that toggles its card (in-text badges already point). */
		cursor: pointer;
	}
	/* Opens overlapping its number pill (flush with the row's bottom
	edge): the cursor is already inside the card the moment it
	appears, so hovering the number never needs a travel gap. The
	invisible bridge below stays as backstop for the fade. */
	.ann-refs-pop {
		position: absolute;
		bottom: 0;
		left: 0;
		z-index: 40;
		min-width: 14rem;
		max-width: 24rem;
		background: #1c1c1e;
		color: #f2f2f7;
		/* Transparent by default so the light theme can paint just
		the edge without shifting geometry on theme switch. */
		border: 1px solid transparent;
		border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		padding: 0.55rem 0.75rem;
		/* Tracks the chat text size like the count pill above it,
		so the saved quotes never sit tiny under huge type. */
		font-size: calc(0.8rem * var(--font-scale, 1));
		line-height: 1.45;
		/* Notes stay selectable for copying: the article disables
		selection outside .rendered, so re-enable it here (the quote
		keeps its own none as the jump control). */
		user-select: text;
		-webkit-user-select: text;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	article.user .ann-refs-pop {
		left: auto;
		right: 0;
	}
	/* The number itself summons the card — not the row around it. The
	invisible bridge keeps it open while crossing into the card. */
	.ann-refs-pill::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 0.5rem;
	}
	/* Click-toggle only — no hover-open anywhere: hover flaps the
	card while reaching for its buttons (a copy click reads as a
	jump when the card reopens under the cursor). The pill is a
	plain disclosure button, so Enter/Space toggle like a click. */
	.ann-refs.open .ann-refs-pop,
	.ann-refs-pop:hover {
		opacity: 1;
		pointer-events: auto;
	}
	.ann-refs-item {
		display: flex;
		gap: 0.45rem;
		padding: 0.2rem 0;
		/* Default cursor on the row: only the quote points (like the
		draft card). The row still jumps on a clean press — the quote
		is the promise, the row keeps the target generous. */
		cursor: default;
	}
	.ann-refs-item + .ann-refs-item {
		border-top: 1px solid rgba(255, 255, 255, 0.14);
	}
	/* Pressed-row blink: same wash as the draft rows, so a sent
	jump reads even where the highlight wash can't paint. */
	.ann-refs-item.blink {
		background: #eef4ff;
		background: var(--hl);
		border-radius: 6px;
	}
	.ann-refs-num {
		font-weight: 700;
		flex-shrink: 0;
	}
	/* Quote stacks over its note: the note reads below the thing
	annotated, never squeezed to its right. */
	.ann-refs-body {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		flex: 1;
		min-width: 0;
	}
	/* Only the quote navigates (see refsQuoteClick): unselectable
	quote with a pointer cursor, so a click reads as a jump and
	never as a text pick. The quote is one line, cut with an
	ellipsis — the full text lives at the mark. Notes stay
	selectable for copying, on one line that scrolls sideways. */
	.ann-refs-quote {
		/* A real button (keyboard reachable), reset to text. */
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		text-align: left;
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s ease;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Same link contract as the composer card's quote — including
	the fading underline (line always drawn, transparent at rest). */
	.ann-refs-quote:hover {
		text-decoration: underline;
		text-decoration-color: currentcolor;
	}
	/* Italic gloss on the quote: pale grey on the dark card, the
	quiet voice on light (see the theme block below) — same role as
	the draft card's note. The row editor below stays roman, like
	every other field. */
	.ann-refs-comment {
		color: #c7c7cc;
		font-style: italic;
		white-space: nowrap;
		overflow-x: auto;
		min-width: 0;
	}
	/* Per-annotation copy in the sent-refs card: icon only, no text,
	pushed to the row's end like the panel's delete button. */
	.ann-refs-copy {
		margin-left: auto;
		flex: none;
		align-self: center;
		display: inline-flex;
		border: 0;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
		padding: 0.1rem;
		border-radius: 6px;
	}
	.ann-refs-copy :global(.action-glyph) {
		/* Same chat-text tracking as the card around it. */
		height: calc(0.75rem * var(--font-scale, 1));
	}
	.ann-refs-copy:hover {
		color: #fff;
	}
	/* Row pencil: same icon-only voice as the copy button beside it
	(the copy button's own auto margin pushes the pair to the end). */
	.ann-refs-pencil {
		flex: none;
		align-self: center;
		display: inline-flex;
		border: 0;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
		padding: 0.1rem;
		border-radius: 6px;
	}
	.ann-refs-pencil :global(.action-glyph) {
		height: calc(0.75rem * var(--font-scale, 1));
	}
	.ann-refs-pencil:hover {
		color: #fff;
	}
	/* Row note editor: a single-line field in the comment's slot, so
	the row never grows — long drafts scroll sideways like the note
	they replace. */
	.ann-refs-input {
		width: 100%;
		box-sizing: border-box;
		font: inherit;
		color: #f2f2f7;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 6px;
		padding: 0.15rem 0.4rem;
		min-width: 0;
	}
	.ann-refs-input:focus {
		outline: none;
		border-color: rgba(255, 255, 255, 0.45);
	}
	/* Save/Cancel take the icon buttons' slots at the row's end. */
	.ann-refs-edit-btn {
		flex: none;
		align-self: center;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 6px;
		background: none;
		color: #f2f2f7;
		font: inherit;
		font-size: 0.85em;
		padding: 0.15rem 0.5rem;
		cursor: pointer;
	}
	.ann-refs-edit-btn:hover {
		border-color: #aeaeb2;
	}
	/* Light theme: the sent card matches the draft card (panel
	surface, soft edge, ink text) instead of floating dark. */
	:global(html[data-theme="light"]) .ann-refs-pop {
		background: #fafafc;
		background: var(--panel);
		color: #1c1c1e;
		color: var(--ink);
		border-color: #e5e5ea;
		border-color: var(--line-soft);
	}
	:global(html[data-theme="light"]) .ann-refs-item + .ann-refs-item {
		border-top-color: #e5e5ea;
		border-top-color: var(--line-soft);
	}
	:global(html[data-theme="light"]) .ann-refs-comment {
		color: #6e6e73;
		color: var(--muted);
	}
	:global(html[data-theme="light"]) .ann-refs-copy,
	:global(html[data-theme="light"]) .ann-refs-pencil {
		color: #6e6e73;
		color: var(--muted);
	}
	:global(html[data-theme="light"]) .ann-refs-copy:hover,
	:global(html[data-theme="light"]) .ann-refs-pencil:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-refs-input {
		color: #1c1c1e;
		color: var(--ink);
		background: #fff;
		background: var(--field);
		border-color: #c7c7cc;
		border-color: var(--line);
	}
	:global(html[data-theme="light"]) .ann-refs-input:focus {
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	:global(html[data-theme="light"]) .ann-refs-edit-btn {
		border-color: #c7c7cc;
		border-color: var(--line);
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="light"]) .ann-refs-edit-btn:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	/* Attachment strip: same 1.2rem column edges as the composer (never
	a full-bleed row), one scrolling row when many — pills never wrap
	into a tall stack and never spill past the column. The strip is a
	positioned overlay, exactly as wide as the prompt but only as tall
	as its cards: it docks a fixed margin above the card while the
	thread runs full-height behind and beside it, text visible around
	the pills. */
	.attachments {
		position: absolute;
		left: 1.2rem;
		right: 1.2rem;
		z-index: 25;
		/* Gaps stay thread territory (selectable, scrollable): only
		the pills and cards take pointer events. */
		pointer-events: none;
		list-style: none;
		display: flex;
		flex-wrap: nowrap;
		gap: 0.4rem;
		margin: 0 1.2rem;
		padding: 0.3rem 0 0.15rem;
		box-sizing: border-box;
		max-width: calc(100% - 2.4rem);
		overflow-x: auto;
		/* Plain scrolling row, never a bar: revealing one on hover
		reshapes the row on classic scrollbars, so every card jumps
		a few pixels. Scroll still works (wheel, touch, drag, keys);
		clipped cards are the affordance. */
		scrollbar-width: none;
	}
	.attachments::-webkit-scrollbar {
		width: 0;
		height: 0;
	}
	.attachments li {
		display: flex;
		align-items: center;
		pointer-events: auto;
		gap: 0.25rem;
		flex-shrink: 0;
		font-size: 0.78rem;
		background: #eef4ff;
		background: var(--hl);
		border-radius: 999px;
		padding: 0.25rem 0.3rem 0.25rem 0.7rem;
		max-width: 100%;
		/* Overflowing rows pan by hand: the card is the grip. */
		cursor: grab;
	}
	/* While the pan owns the gesture every card shows the fist. */
	.attachments.dragging li,
	.attachments.dragging li button {
		cursor: grabbing;
	}
	.attachments .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}
	.attachments .tok {
		flex: none;
		white-space: nowrap;
		color: #6e6e73;
		color: var(--muted);
	}
	.attachments button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
	}
	.attachments .thumb {
		border: 0;
		background: none;
		line-height: 0;
		padding: 0;
	}
	/* Image cards: thumbnail preview up top, token/copy/OCR/X footer
	below (the strip itself stays one scrolling row — only the card
	wraps internally). The blue wash is back on the card: it reads
	as one basic pill-card over the thread, text visible between
	the cards. */
	.attachments li.card {
		flex-wrap: wrap;
		row-gap: 0.3rem;
		border-radius: 12px;
		padding: 0.4rem 0.5rem;
		max-width: 12rem;
		align-items: center;
		background: #eef4ff;
		background: var(--hl);
	}
	.attachments li.card .thumb {
		flex: 1 1 100%;
	}
	.attachments .thumb img {
		display: block;
		width: 100%;
		height: 4.5rem;
		object-fit: cover;
		border-radius: 8px;
	}
	/* Card buttons are icon-only (message-button copy glyph, close
	glyph), sized to the card's font so they track it. */
	.attachments .card-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.1rem;
		font-size: 0.78rem;
	}
	.attachments .card-btn :global(.action-glyph) {
		height: 1em;
	}
	.attachments .ocr-btn {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.1rem 0.25rem;
		border-radius: 6px;
	}
	.attachments .ocr-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	/* The tray paints no background of its own: pills float over the
	thread with the text visible between them (a veil here read as a
	white block occluding the messages). Surfaces are solid now —
	no frost anywhere — so the strip simply stays transparent. */
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
	/* Speech errors ride under the toast: top of the screen, big
	enough to notice, same dark-red pairing as the old banner so it
	reads in both themes. A tap dismisses; silence still expires it. */
	.voice-error {
		position: fixed;
		top: max(6.75rem, calc(3rem + env(safe-area-inset-top, 0px)));
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		max-width: min(30rem, calc(100vw - 2rem));
		background: #3d1008;
		color: #ffb4a2;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.4;
		padding: 0.7rem 1.1rem;
		border: 0;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
	}
	@keyframes voice-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	/* Pulsing dot on the message currently being read aloud. The slot
	is always reserved (hidden, not absent) so the row never reflows. */
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
	/* Pretty default text selection in both themes… */
	:global(::selection) {
		background: rgba(0, 122, 255, 0.28);
		background: var(--sel-tint);
	}
	/* …tinted amber on the message a speak-aloud selection came from,
	restored automatically when speech ends. */
	article.speaking-sel ::selection {
		background: rgba(245, 158, 11, 0.45);
	}
	.hidden-input {
		display: none;
	}
	/* System-callout look: one translucent pill, hairline dividers, no
	gaps. On iOS this IS the selection menu (the native callout is
	suppressed over messages), so it should feel at home there — a
	generic pill with text buttons, no Apple marks. */
	.sel-menu {
		position: fixed;
		z-index: 50;
		display: flex;
		align-items: stretch;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.88);
		-webkit-backdrop-filter: blur(18px) saturate(1.6);
		backdrop-filter: blur(18px) saturate(1.6);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		overflow: hidden;
		/* The menu is chrome, not text: dragging across it must not
		start a selection of its own label. */
		user-select: none;
		-webkit-user-select: none;
	}
	:global(html[data-theme="dark"]) .sel-menu {
		background: rgba(30, 30, 32, 0.88);
	}
	.sel-menu button {
		font-size: 0.95rem;
		border: 0;
		border-radius: 0;
		background: none;
		/* Buttons resolve color to system ButtonText, never inheritance:
		pin it or dark mode reads phone-default black. */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
		padding: 0.55rem 0.95rem;
		white-space: nowrap;
	}
	/* Single-button menu (Annotate alone): no dividers; Inspect adds
	a hairline between the two when a single Han character qualifies. */
	.sel-menu button + button {
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
	}
	.sel-menu button:hover {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.sel-menu button:active {
		opacity: 0.55;
	}
	/* Selection pinyin: readings for just the highlight. Same glass
	as the selection menu, but pointer-transparent (read-only — it
	must never disturb the highlight or block the native menu) and
	docked below the highlight while the menu takes above. */
	.sel-pinyin {
		position: fixed;
		z-index: 50;
		pointer-events: none;
		max-width: 20rem;
		padding: 0.3rem 0.55rem;
		border-radius: 8px;
		font-size: 0.85rem;
		background: rgba(255, 255, 255, 0.88);
		-webkit-backdrop-filter: blur(18px) saturate(1.6);
		backdrop-filter: blur(18px) saturate(1.6);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		color: #1c1c1e;
		color: var(--ink);
	}
	:global(html[data-theme="dark"]) .sel-pinyin {
		background: rgba(30, 30, 32, 0.88);
	}
	/* Centered on the highlight whatever the panel width (and so
	whatever the font size): the style left is the highlight's
	center. Above hangs 4px over its top edge; below clears 4px
	under it. */
	.sel-pinyin {
		transform: translateX(-50%);
	}
	.sel-pinyin.above {
		transform: translate(-50%, calc(-100% - 4px));
	}
	.sel-pinyin:not(.above) {
		margin-top: 4px;
	}
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
		width: 24rem;
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
		min-height: 4.5rem;
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
		width: 19rem;
		padding: 0.55rem 0.6rem 0.55rem 1rem;
		border-radius: 999px;
	}
	.ann-pop.fresh textarea {
		flex: 1;
		min-width: 0;
		min-height: 0;
		font-size: 1rem;
		padding: 0.15rem 0;
	}
	.review {
		margin: 0.5rem 1.2rem 0;
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: #fafafc;
		background: var(--panel);
	}
	.review-item {
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
		/* Default cursor throughout: only the quote button points (see
		.review-quote) — the row itself navigates nowhere. */
	}
	.review-item.highlight {
		background: #eef4ff;
		background: var(--hl);
	}
	.review-head {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		font-size: 1rem;
	}
	/* The note sits a breath below its quote: two stacked heads read
	as one card, never one crowded line. */
	.review-head + .review-head {
		margin-top: 0.45rem;
	}
	.review-head button {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.review-head button:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
	}
	.review-num {
		font-weight: 700;
	}
	.review-label {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	/* The quote is one line, cut with an ellipsis: long quotes
	never stretch the row (the full text lives at the mark — click
	to jump there). Pointer plus no-select: the quote is the jump
	control, never a pick. */
	.review-quote {
		/* A real button (keyboard reachable), reset to text: the UA
		button face must not leak into the row. */
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		font-weight: 550;
		color: inherit;
		text-align: left;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	/* The note reads like a previous message's annotation
	(italic gloss on the quote, not body text): it rides the quiet
	voice so it stays readable on the white light-theme card, where
	the pale dark-card grey washes out. One line that scrolls
	sideways, so the full note fits without stretching the row. */
	.review-comment {
		color: #6e6e73;
		color: var(--muted);
		font-style: italic;
		white-space: nowrap;
		overflow-x: auto;
		min-width: 0;
	}
	.review label {
		display: block;
		font-size: 1rem;
		margin-top: 0.3rem;
	}
	.review textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		font: inherit;
		color: inherit;
		background: #fff;
		background: var(--field);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
		resize: vertical;
	}
	.review textarea:focus {
		outline: none;
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* The edit box stays readable in dark mode: the near-black field
	surface swallows typed text under dim panels, so edits ride a
	raised surface with light ink instead. */
	:global(html[data-theme="dark"]) .review textarea {
		background: #3a3a3c;
		color: #f2f2f7;
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .review textarea::placeholder {
		color: #aeaeb2;
	}
	/* Save is the solid primary pill (same fill as the send button);
	Cancel is quiet text — the two never look like twins. */
	.review-edit-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.35rem;
	}
	.review-edit-actions button {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		border: 1px solid #1c1c1e;
		border-color: var(--invert);
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		/* On the base (not :hover) so Save and Cancel animate
		symmetrically in and back out, instead of snapping one way. */
		transition:
			opacity 0.15s ease,
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.review-edit-actions button:hover {
		opacity: 0.8;
	}
	/* Light theme Save: the accent fill like the send button (dark keeps
	the inverted fill). Cancel rides the quiet rule below, untouched. */
	:global(html[data-theme="light"]) .review-edit-actions button:not(:last-child) {
		border-color: #007aff;
		border-color: var(--accent);
		background: #007aff;
		background: var(--accent);
		color: #fff;
	}
	.review-edit-actions button:last-child {
		border-color: transparent;
		background: none;
		color: #6e6e73;
		color: var(--muted);
		font-weight: 400;
	}
	.review-edit-actions button:last-child:hover {
		opacity: 1;
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
	}
	/* Merged pill: the wrap carries the single border; the count and ×
	buttons inside are bare segments. Later than the prompt tool buttons
	so the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: none;
		padding: 0.2rem 0.35rem;
	}
	.ann-wrap > button {
		border: 0;
		background: none;
		padding: 0 0.3rem;
		font-size: 0.78rem;
		color: #6e6e73;
		color: var(--muted);
		cursor: pointer;
		/* Controls, not content: labels stay out of selections. */
		user-select: none;
		-webkit-user-select: none;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	.ann-pill {
		font-weight: 650;
	}
	/* Clear-all heads the popup, top-right. */
	.review-tools {
		display: flex;
		justify-content: flex-end;
		padding: 0.35rem 0.2rem 0.1rem;
	}
	.review-tools button {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.1rem 0.3rem;
	}
	.review-tools button:hover {
		color: #94250a;
		color: var(--danger);
	}
	/* Phones track the chat text size in the review card: every fixed
	rem above scales with it (desktop keeps its compact sizes). */
	.app[data-android] .review-head {
		font-size: calc(0.82rem * var(--font-scale, 1));
	}
	.app[data-android] .review-head button,
	.app[data-android] .review-tools button,
	.app[data-android] .review-label {
		font-size: calc(0.75rem * var(--font-scale, 1));
	}
	.app[data-android] .review label {
		font-size: calc(0.82rem * var(--font-scale, 1));
	}
	.app[data-android] .review-head button.review-copy :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	.app[data-android] .review-head button.review-del :global(.action-glyph) {
		height: calc(0.8rem * var(--font-scale, 1));
	}
	/* Per-note edit is a pencil in the message-action style (same
	stroke icon, same quiet gray) instead of a text button. It rides
	right after the note text — not margin-left:auto at the card's far
	edge, where the cursor overshoots the card reaching it and the
	whole overlay drops. */
	.review-head button.review-pencil {
		display: inline-flex;
		align-items: center;
		align-self: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* On the base (not :hover) so the color animates symmetrically
		in and back out, instead of snapping one way. */
		transition: color 0.15s ease;
	}
	.review-head button.review-pencil :global(.action-glyph) {
		height: 0.95rem;
	}
	/* Per-note copy rides at the row's end in the pencil's style:
	icon only, no text. margin-left:0 keeps it with the quote while
	the delete button's auto margin holds the row's right edge.
	Rows stay one line tall, so the icon never floats in dead
	space. */
	.review-head button.review-copy {
		display: inline-flex;
		align-items: center;
		align-self: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* Same 0.15s color beat as the pencil: all three icons light
		up together instead of the copy snapping first. */
		transition: color 0.15s ease;
	}
	.review-head button.review-copy :global(.action-glyph) {
		height: 0.95rem;
	}
	.review-head button.review-copy:hover {
		color: #1c1c1e;
		color: var(--ink);
		/* Icon buttons never underline: the generic button hover above
		draws a line under the glyph that flashes during traversal and
		reads as the row jumping. */
		text-decoration: none;
	}
	/* Delete rides the row's far edge as a geometric X (same icon
	voice as copy), never a text × whose font bearings sit it low.
	All three icons self-center against the row's baseline text.
	Hover goes Clear-all red, never underlined. */
	.review-head button.review-del {
		margin-left: auto;
		flex: none;
		align-self: center;
		display: inline-flex;
		align-items: center;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.15rem;
		border-radius: 6px;
		/* Same 0.15s color beat as copy and pencil. */
		transition: color 0.15s ease;
	}
	.review-head button.review-del :global(.action-glyph) {
		height: 0.95rem;
	}
	.review-head button.review-del:hover {
		color: #94250a;
		color: var(--danger);
		text-decoration: none;
	}
	/* The quote is a button (keyboard reachable) but reads as plain
	text: opt out of the generic head-button voice (far-edge auto
	margin, small muted type) the icon buttons use. flex-shrink
	re-opts into shrinking — the generic rule pins it off, which
	once let long quotes stretch the whole card instead of clipping. */
	.review-head button.review-quote {
		margin-left: 0;
		flex-shrink: 1;
		font-size: inherit;
		color: inherit;
		/* The underline fades in instead of snapping: the line is
		always drawn but transparent until hover (color, unlike the
		line itself, ramps on the icon beat). */
		text-decoration: underline;
		text-decoration-color: transparent;
		transition: text-decoration-color 0.15s ease;
	}
	/* The quote navigates, so it links: underline on hover like any
	jump control. (Icon buttons never underline — a line under a tiny
	glyph reads as the row jumping.) */
	.review-head button.review-quote:hover {
		color: inherit;
		text-decoration: underline;
		text-decoration-color: currentcolor;
	}
	/* Hover goes accent-blue instead of going ink: the pencil is small
	and quiet-gray, so an ink hover read as disappearing. Color only —
	no background, no glow, no underline: the signal stays inside the
	glyph's own box. */
	.review-head button.review-pencil:hover {
		color: #007aff;
		color: var(--accent);
		text-decoration: none;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule.
	Flush against the pill (no gap): the pointer travels straight
	from badge to popup without crossing dead hover space. */
	/* The pill sits at the prompt's right edge, so the card anchors
	right and grows up-and-left — growing right would run it off the
	column (and over the send button's airspace). The pill toggles
	it (pinned): no hover-open anywhere, so reaching for its buttons
	never flaps it shut. */
	.ann-wrap .review {
		position: absolute;
		/* Floats above the tools row with the pill exposed: the open
		card must never cover its own toggle (click-to-close would
		have no target). */
		bottom: calc(100% + 0.5rem);
		right: 0;
		z-index: 60;
		width: max-content;
		min-width: 16rem;
		max-width: min(30rem, calc(100vw - 3rem));
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		/* display:none can't fade: the card always lays out but sits
		invisible and untouchable until the pill pins it. */
		visibility: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.16s ease,
			visibility 0.16s;
	}
	.ann-wrap .review-quote {
		overflow-wrap: anywhere;
	}
	/* Click-toggle only, like the sent-refs card above: hover
	flaps the panel while reaching for its buttons. The pill owns
	the state, so tabbing through never strands it open-or-shut. */
	.ann-wrap.pinned .review {
		visibility: visible;
		opacity: 1;
		pointer-events: auto;
	}
	/* Phone: the card anchors left of the paperclip by default — nudge
	it right so it covers the tools cluster instead of the draft. */
	.app[data-android="true"] .ann-wrap .review {
		right: -2.4rem;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
		transition: opacity 0.18s ease;
	}
	/* Desktop rows may outgrow the column at very large text sizes
	(400%): wrap instead of clipping. Phones keep their own sideways
	scroll treatment below, so this stays off the touch rules. */
	.app:not([data-android]) .actions {
		flex-wrap: wrap;
		row-gap: 0.35rem;
	}
	@media (hover: none) {
		/* Aid labels (show original) can outgrow the message: the row
		scrolls sideways inside itself instead of spilling out and
		dragging the whole chat along. Vertical drags still reach the
		chat; the bar stays clean with no scrollbar of its own. */
		.actions {
			max-width: 100%;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}
		.actions::-webkit-scrollbar {
			display: none;
		}
	}
	/* Hover-only actions, per side: the row fades in when the pointer is
	over the message or the row itself (or keyboard focus lands inside
	either). Opacity only — the buttons never move. Touch always shows
	it — there is no hover to wait for. */
	main.hover-user article.user .actions,
	main.hover-assistant article.assistant .actions {
		opacity: 0;
		/* Pre-create the compositor layer so the fade blends an
		already-rasterized row: without this the row is re-rasterized
		when the fade starts and the icons visibly shimmer mid-fade
		(worst at fractional offsets, e.g. with the settings panel
		narrowing the column). Applies shown or hidden — the layer
		must exist in both states or the switch still happens. */
		will-change: opacity;
	}
	main.hover-user article.user:hover .actions,
	main.hover-user article.user:focus-within .actions,
	main.hover-user article.user .actions:hover,
	main.hover-user article.user .actions:focus-within,
	main.hover-assistant article.assistant:hover .actions,
	main.hover-assistant article.assistant:focus-within .actions,
	main.hover-assistant article.assistant .actions:hover,
	main.hover-assistant article.assistant .actions:focus-within {
		opacity: 1;
	}
	/* Hovering the refs count never summons the row: the pill is the
	article's child, so without this the row would rise under it. */
	main.hover-user article.user:has(.ann-refs-pill:hover) .actions,
	main.hover-assistant article.assistant:has(.ann-refs-pill:hover) .actions {
		opacity: 0;
	}
	/* A message being read aloud keeps its row up while the audio runs:
	the green stop button must stay clickable after the pointer leaves. */
	main.hover-user article.user.speaking .actions,
	main.hover-assistant article.assistant.speaking .actions {
		opacity: 1;
	}
	/* Same while an aid loads (tashkeel run, furigana conversion):
	the row summoned the work, so it stays until the work lands. */
	main.hover-user article.user.aid-loading .actions,
	main.hover-assistant article.assistant.aid-loading .actions {
		opacity: 1;
	}
	@media (hover: none) {
		main.hover-user article.user .actions,
		main.hover-assistant article.assistant .actions {
			opacity: 1;
		}
	}
	/* Hide-messages mode (touch option): bodies and baked quote blocks
	stay hidden until their message is tapped open; the open row shows
	text and buttons for 3s. Later than the hover rules so it wins ties;
	the open-row attr outranks them outright. */
	main.hide-messages article :global(.rendered),
	main.hide-messages article .ann-refs {
		display: none;
	}
	main.hide-messages article .actions {
		opacity: 0;
	}
	main.hide-messages article[data-actions-open="true"] :global(.rendered),
	main.hide-messages article[data-actions-open="true"] .ann-refs {
		display: block;
	}
	main.hide-messages article[data-actions-open="true"] .actions {
		opacity: 1;
	}
	/* Touch default: action rows hide until their message is tapped open
	(the open row shows for 3s). Bodies always show — only hideMessages
	hides those. Android-scoped, so desktop keeps its hover rhythm;
	later than the hover rules and outranking them, so it wins ties. */
	/* Phones sit the row tighter under the text. */
	.app[data-android] .actions {
		margin-top: 0.2rem;
	}
	/* The row sits in flow and always reserves its line, like the
	desktop rows — hidden is opacity only, so revealing pushes
	nothing. No pill chrome of its own. will-change pre-creates
	the fade layer in both states (same shimmer fix as the hover rows):
	without it the icons re-rasterize mid-fade and visibly shiver. */
	.app[data-android] main.hide-buttons article .actions {
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
	}
	.app[data-android] main.hide-buttons article[data-actions-open="true"] .actions {
		opacity: 1;
		pointer-events: auto;
	}
	/* Folded messages show no row: the pill would float over the next
	message's text. Tapping the folded body unfolds (see
	toggleMessageActions) — the only press path, since the fold button
	lives in the hidden row. */
	.app[data-android] article.folded-msg .actions {
		display: none;
	}
	/* The row scales with the text-size opt-in like the
	desktop rows (same cap), so huge type never strands tiny
	buttons — and never domes them past 200%. */
	.app[data-android]
		main.hide-buttons.scale-actions
		.actions
		button {
		font-size: calc(0.75rem * min(var(--font-scale, 1), 2));
	}
	.app[data-android]
		main.hide-buttons.scale-actions
		.actions
		.icon-btn
		:global(.action-glyph) {
		height: calc(1.05rem * min(var(--font-scale, 1), 2));
	}
	/* No bubble, no bubble padding: text keeps its horizontal place
	(only the background disappears), and the tighter vertical rhythm
	drops the text closer to its buttons. */
	.app[data-android] main.plain-user article.user .bubble {
		padding: 0.25rem 1rem 0;
	}
	/* My-message background OFF on phones: the edit box carries no
	background either (it mirrors the plain text, not the bubble).
	Desktop keeps its editing frame above. */
	.app[data-android] main.plain-user article.user .msg-edit {
		background: none;
	}
	/* Message text never spills sideways off a phone: inner scrollers
	(code blocks, aid-label rows) keep their own axes. */
	.app[data-android] .messages {
		overflow-x: clip;
	}
	/* CJK wraps at the column edge on phones, like desktop: the shared
	body rule uses word-break: break-word (legacy anywhere semantics),
	which lets shrink-wrapped rows size to a narrow min-content and
	wraps Chinese far too early at huge text sizes. Phones keep normal
	character breaking with kinsoku (strict) while long Latin strings
	still break via overflow-wrap — desktop keeps its own rule. */
	.app[data-android] .messages :global(.rendered) {
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
	.app[data-android] .messages.step-newer {
		animation: step-in-right 0.18s ease-out;
	}
	.app[data-android] .messages.step-older {
		animation: step-in-left 0.18s ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		.app[data-android] .messages.step-newer,
		.app[data-android] .messages.step-older {
			animation: none;
		}
	}
	/* dir=auto puts Arabic paragraphs at the right edge; the chat
	reads left-aligned, so alignment follows the column while the
	base direction (selection, drag) stays with the text. */
	.app[data-android] :global(.rendered [dir="auto"]) {
		text-align: left;
	}
	/* Own messages pack to the right edge: block, text column, and row. */
	article.user .actions {
		justify-content: flex-end;
	}
	/* The always-mounted speaking slot reserves room on the far left of
	own rows, mirroring the far-right slot on assistant rows. */
	article.user .speaking-dot {
		order: -1;
	}
	/* Row tooltips hang below the buttons and render in one rise-and-settle
	(single-run keyframes on a static transform): unlike the native title
	bubble, nothing can fire a second nudge while the pointer stays put.
	Absolute, so they never push the row around. The 2s hold means
	brush-past hovers stay quiet; reduced-motion users get a plain fade. */
	@keyframes tip-rise {
		from {
			opacity: 0;
			translate: -50% 4px;
		}
		to {
			opacity: 1;
			translate: -50% 0;
		}
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
		.wp-wrap.open .wp-menu {
			animation: none;
		}
		aside,
		.settings-panel {
			transition: none;
		}
	}
	/* Text and icon buttons share one stable box: padding makes a real
	hit area, hover is a color shift only (no underline, no background),
	and no box property changes between states — hovering can't nudge
	the row. */
	.actions button {
		font-size: 0.75rem;
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
	/* Opt-in (Settings): message buttons grow with the text-size
	setting instead of holding their fixed 0.75rem — capped like the
	bubble, so huge type doesn't dome them into towers. */
	main.scale-actions .actions button {
		font-size: calc(0.75rem * min(var(--font-scale, 1), 2));
	}
	/* Same opt-in for the logo icons: the glyph holds its fixed
	1.05rem height otherwise, so larger text leaves tiny icons. */
	main.scale-actions .actions .icon-btn :global(.action-glyph) {
		height: calc(1.05rem * min(var(--font-scale, 1), 2));
	}
	/* Loading buttons hold their look while the dots pulse. */
	.actions button:disabled {
		cursor: default;
		opacity: 0.8;
	}
	/* A speak button with no voice for the language dims further: it is
	off, not busy (vocalizing aids keep the rule above). */
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
	/* Fold chevron points right while collapsed. Glyph-only transform,
	so no box moves (the row-reveal stylesheet test forbids motion on
	that row's selectors — keep its selector text out of these rules). */
	button.icon-btn :global(svg) {
		transition: transform 0.18s ease;
	}
	button.icon-btn.folded :global(svg) {
		transform: rotate(-90deg);
	}
	.error {
		/* Same size as the status line, so error text and its retry
		button row read as one row. Fixed unless the button opt-in
		below says otherwise. */
		font-size: 0.85rem;
		color: #94250a;
	}
	/* Same opt-in as the message buttons: row error text follows the
	text size only when message-button scaling is on (same cap). */
	main.scale-actions .error {
		font-size: calc(0.85rem * min(var(--font-scale, 1), 2));
	}
	/* Same opt-in for the latex chrome: the `$` toggle and copy button
	scale with the text size like the message buttons (same cap), so the
	pair never reads tiny under huge type. Box, `$` type, and glyph
	scale together, keeping the shared-box centering. */
	main.scale-actions :global(.ccez-math-tex),
	main.scale-actions :global(.ccez-math-copy) {
		height: calc(1.3rem * min(var(--font-scale, 1), 2));
		width: calc(1.3rem * min(var(--font-scale, 1), 2));
		font-size: calc(0.85rem * min(var(--font-scale, 1), 2));
	}
	main.scale-actions :global(.ccez-math-copy .action-glyph) {
		height: calc(1rem * min(var(--font-scale, 1), 2));
		width: calc(1rem * min(var(--font-scale, 1), 2));
	}
	.sending {
		color: #6e6e73;
		/* Status reading text: tracks the text-size setting like messages. */
		font-size: calc(0.85rem * var(--font-scale, 1));
		/* Breathing room, explicit (never UA margins): the status
		stands off the last message above and the composer below. */
		margin: 0.9rem 0 1.1rem;
	}
	/* Loading dots exist only while busy, so an idle aid button is
	exactly its visible label — hover and spacing never cover text
	that isn't there. */
	.tdots span {
		display: inline-block;
		animation: tdot-pulse 1.2s ease-in-out infinite;
	}
	.tdots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.tdots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes tdot-pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
	/* Hover state changes ease everywhere (reduced-motion keeps these;
	only the landing glide and the hover underline are gated there). */
	button {
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease,
			opacity 0.15s ease;
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
	.app:not([data-android]) .prompt-tools {
		transition: transform 0.25s ease;
	}
	.app:not([data-android]) .prompt.prompt-idle .prompt-tools {
		transform: translateY(-0.75rem);
	}
	.app:not([data-android]) .prompt.prompt-idle.prompt-preview .prompt-tools {
		transform: none;
		transition: transform 0.35s ease;
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
		/* Fixed floor so mounting the editor never shifts layout.
		CodeMirror itself sets no minimum — this floor is ours, at
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
	/* Idle-hide covers the attachment strip too (pills, preview
	image, error): it rides the same slide/fade as the prompt so no
	image bubble lingers over the chat, and restores with it on the
	next input (the class drops together with prompt-idle). */
	.attachments,
	.attach-error {
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s;
	}
	:is(.attachments, .attach-error).composer-idle {
		/* Same 0.75rem settle and ramp as the card: the old
		full-height slide outran the prompt — taller trays visibly
		faster. The fade does the hiding; the slide just settles. */
		transform: translateY(0.75rem);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 0.25s ease,
			opacity 0.25s ease,
			visibility 0s linear 0.25s;
	}
	/* Reduced motion settles the summon instantly: no slide, no fade
	ramp on the card or its strip — what lands is the final frame.
	After every ramp above (equal specificity, later wins), so the
	desktop rise honors the OS setting like the drawers already do. */
	@media (prefers-reduced-motion: reduce) {
		.prompt,
		.prompt:not(.prompt-idle),
		.prompt.prompt-idle.prompt-preview,
		.app:not([data-android]) .prompt-tools,
		.attachments,
		.attach-error {
			transition: none;
		}
	}
	/* No entrance animation on the composer: it used to glide down on the
	first message, exactly while the first tokens streamed in — on a slow
	phone GPU the overlap reads as flicker. The composer just stays put. */
	.send-btn {
		position: absolute;
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
	.file-kind {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #6e6e73;
	}
	/* Prompt editor legibility (global: CodeMirror owns these nodes).
	   Dark rules live here — not in the CM theme object — because real
	   media queries are the only reliable switch. */
	.prompt :global(.cm-content) {
		/* Same stack as the chat text — the draft should look like the
		message it becomes, not a terminal. */
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		padding-right: calc(var(--tools-pad) + var(--tools-extra));
		caret-color: #1c1c1e;
		caret-color: var(--ink);
	}
	/* Emptied composer: no stray caret while UNFOCUSED. Clearing the
	draft (paste then delete-all, or a send) leaves focus in place —
	but a focused empty box keeps its blink: the cursor is the only
	focus signal, and hiding it strands the caret invisibly.
	(data-empty rides hasText, which onDocChange maintains; .cm-focused
	is CodeMirror's own focus mark, so no JS watches this.) */
	.prompt[data-empty="true"] :global(.cm-editor:not(.cm-focused)) :global(.cm-content) {
		caret-color: transparent;
	}
	.prompt[data-empty="true"] :global(.cm-editor:not(.cm-focused)) :global(.cm-cursor) {
		display: none;
	}
	.prompt[data-empty="true"] :global(.ta-input:not(:focus)) {
		caret-color: transparent;
	}
	/* The mic icon widens the tools cluster: hold the first line clear
	of it, but only while it is actually mounted. */
	.prompt.has-mic :global(.cm-content) {
		--tools-pad: 5.8rem;
	}
	/* Annotation count badge joins the tools cluster: hold the first
	line clear of the wider row while any annotations exist. */
	.prompt.has-anns :global(.cm-content) {
		--tools-pad: 9.5rem;
	}
	.prompt.has-mic.has-anns :global(.cm-content) {
		--tools-pad: 8.5rem;
	}
	/* Declarative mirrors of the has-mic/has-anns classes above: same
	seats, no JS. The classes stay as fallback. */
	.prompt:has(.mic-btn) :global(.cm-content) {
		--tools-pad: 5.8rem;
	}
	.prompt:has(.ann-wrap) :global(.cm-content) {
		--tools-pad: 9.5rem;
	}
	.prompt:has(.mic-btn):has(.ann-wrap) :global(.cm-content) {
		--tools-pad: 8.5rem;
	}
	/* Jump trigger joins the cluster in long threads: reserve its seat
	on top of whichever combo is live (var composition, not ×4 rules). */
	.prompt:has(.wp-jump) {
		--tools-extra: 1.8rem;
	}
	.prompt :global(.cm-editor) {
		/* Beats the CodeMirror theme's own font-size on specificity.
		Fixed size on purpose: the text-size setting scales reading
		(messages), never the input — typing at 400%+ shows a word or
		two per line. */
		font-size: 0.95rem;
		/* The prompt grows with typing, but never eats the messages:
		past this the editor scrolls internally. */
		max-height: 40vh;
	}
	/* Android textarea composer: fixed like the CodeMirror input above —
	the text-size setting scales reading, never typing. */
	.prompt :global(.ta-input) {
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		font-size: 0.95rem;
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
	}
	.prompt.has-mic :global(.ta-input) {
		--tools-pad: 8.6rem;
	}
	.prompt.has-anns :global(.ta-input) {
		--tools-pad: 9.5rem;
	}
	.prompt.has-mic.has-anns :global(.ta-input) {
		--tools-pad: 11.5rem;
	}
	.prompt:has(.mic-btn) :global(.ta-input) {
		--tools-pad: 8.6rem;
	}
	.prompt:has(.ann-wrap) :global(.ta-input) {
		--tools-pad: 9.5rem;
	}
	.prompt:has(.mic-btn):has(.ann-wrap) :global(.ta-input) {
		--tools-pad: 11.5rem;
	}
	.prompt :global(.cm-placeholder) {
		color: #8e8e93;
		color: var(--line-hover);
		/* Clicks pass through to the editor so the caret lands by
		   coordinates (start of the empty prompt), not after the hint. */
		pointer-events: none;
		/* Hint text, not content: never part of a selection. */
		user-select: none;
		-webkit-user-select: none;
	}
	:global(.cm-editor.cm-focused) {
		/* Kills the dotted focus outline some Chromium builds draw. */
		outline: none !important;
	}
	:global(.cm-editor .cm-cursor) {
		/* !important: CodeMirror injects its own cursor styles at runtime,
		   after this stylesheet — only importance wins deterministically. */
		border-left-color: #1c1c1e !important;
	}
	.app[data-focus-mode="scroll"] :global(.cm-cursorLayer) {
		/* Scroll mode shows no prompt cursor at all (see enterScrollMode). */
		display: none;
	}
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	/* Caret rides --ink, placeholders ride --line-hover. The ta-input
	twins are Android-only nodes with identical pairs. */
	/* The CM cursor node only mounts while focused, so its dark shade
	stays a pinned rule rather than an untestable token. */
	:global(html[data-theme="dark"]) :global(.cm-editor .cm-cursor) {
		border-left-color: #f2f2f7 !important;
	}
	/* !important throughout: the CodeMirror theme object injects its
	light rules after this stylesheet, so only importance wins. */
	:global(html[data-theme="dark"]) :global(.cm-paste-marker) {
		color: #98989f !important;
	}
	/* Centered reading column on wide screens (DeepSeek-web rhythm).
	The cap rides --chat-width off .app (desktop slider, 36 = the default
	fixed width); the fallback keeps phones and older saves identical. */
	article,
	.empty-state,
	.sending {
		align-self: center;
		width: 100%;
		max-width: min(100%, calc(var(--chat-width, 36) * 1rem));
		box-sizing: border-box;
	}
	/* Only the very first message stands off the top: one strip-height
	of margin clears the invisible drag strip at scroll zero, so the
	first line is clickable as well as visible. Everything after it
	bleeds edge to edge (see .messages padding). */
	article:first-of-type {
		margin-top: 1.75rem;
	}
	.prompt {
		/* Pinned to the default width: the composer never grows with the
		chat slider, but still shrinks on narrow columns. --sbw (set from
		JS: messages' scrollbar gutter, 0 with overlay bars) keeps the
		card centered on the article column instead of the full width,
		so text never sticks out on the right side only. */
		width: calc(100% - 2.4rem - var(--sbw, 0px));
		max-width: min(calc(var(--chat-width, 36) * 1rem), 36rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
		right: calc(1.2rem + var(--sbw, 0px));
	}
	.lang-menus,
	.attachments,
	.review,
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

	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) {
		color-scheme: dark;
	}
	/* .app rides the --bg/--ink tokens now; no dark override needed. */
	/* aside rides the --bg/--line-soft tokens now; no dark override needed. */
	/* active is transparent in the base already; row/new/del ride
	--hover-wash/--focus/--alarm/--line/--dim now. */
	/* Sidebar text never rides on inheritance alone: old phone
	WebViews resolve button colors (ButtonText) against the wrong
	scheme, and the × had no dark color at all. */
	/* side-chat pins --ink (ButtonText trap); del rides --dim now. */
	/* header carries no border width, so its dark border-color was a
	no-op; .voice-float split out into --muted above (hover rides
	--ink with the other tool icons). */
	/* Selection tint rides --sel-tint now (pinned in the chrome paint test). */
	/* .voice-float.on rides --ok now. */
	/* .settings-panel rides the --bg/--line-soft tokens now; no dark override needed. */
	/* The overlay pill rides --bg-raised/--line-soft now; no dark override needed. */
	/* .modal rides the --bg/--ink/--line-soft tokens now; no dark override needed. */
	/* .modal-head button rides --line/--focus/--strong now. */
	/* The dark × hover lifts past every token to near-white: a lone
	declaration is cheaper than a single-use variable. */
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	/* .keys ride --line-soft/--focus/--ink now. */
	:global(html[data-theme="dark"]) .app[data-android] .keys div:nth-child(2) {
		border-top-color: #38383a;
	}
	/* nav rides --line-soft; its buttons ride --bg-raised/--line/--ink now. */
	/* wp-menu rides --bg-raised/--line/--ink/--bg-wash now (sheet-head stays: touch-only). */
	:global(html[data-theme="dark"]) .wp-sheet-head {
		color: #98989f;
	}
	/* .bubble rides the --bg-wash token now; no dark override needed. */
	/* plain-user is background:none in the base already: nothing to override. */
	/* article.selected rides --focus now. */
	/* .actions buttons ride --muted/--ink now (icon-btn shares the hover). */
	/* The message being read aloud: green stop button, held on hover
	(the equal-specificity hover above would otherwise strip it). */
	:global(html[data-theme="dark"]) .actions .icon-btn.active,
	:global(html[data-theme="dark"]) .actions .icon-btn.active:hover {
		color: #7cc3a3;
	}
	/* tool-icon hovers ride --ink now. */
	/* .error-banner rides --error-bg/--error-ink now: no dark override needed. */
	/* sent tags inherit body type; attachment pills ride --hl now.
	The pill × keeps its rule: light --focus against dark --ink. */
	:global(html[data-theme="dark"]) .attachments button {
		color: #f2f2f7;
	}
	/* ann-wrap rides --line/--muted/--ink; review-tools ride --muted/--danger now. */
	/* sel-menu rides --bg-raised/--line/--bg-wash/--ink;
	ann-pop is dark-always; review rides --panel/--line-soft. */
	/* .review-item.highlight rides --hl now. */
	/* review-head/label ride --muted/--ink; review textarea rides --field/--line/--strong. */
	/* Dark primary: light pill, dark text (mirrors the send
	button's inversion); Cancel stays quiet gray text. */
	/* edit-actions ride --invert/--invert-ink/--muted/--ink now. */
	/* .muted rides --muted now (sole use: the translating note). */
	/* .prompt rides --bg/--line/--line-hover/--focus now; no dark overrides needed. */
	/* Lang menus ride --ink/--strong/--line/--bg-raised/--bg-wash/--focus now. */
	/* .send-btn rides --invert/--invert-ink now. */
	/* Study-sheet print: the section stays out of layout on screen;
	the print dialog (File → Print Study Sheet…, Save as PDF there)
	shows only it — every other .app child hides. */
	#study-sheet-print {
		display: none;
	}
</style>
