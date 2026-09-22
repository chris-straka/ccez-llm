/**
 * Mobile-platform guards (Android milestone): the desktop app assumes a
 * keyboard, hover, and macOS speech. These pure helpers decide the
 * touch/Android branches. Call sites read navigator/matchMedia; tests
 * pass explicit values — Vitest runs in node, where neither exists.
 */

/** Android WebView or browser, by user agent string. */
export function isAndroidUserAgent(ua: string): boolean {
	return /android/i.test(ua);
}

/**
 * Android major version from a legacy user-agent string ("Android
 * 14; ..."). Null when absent or unparseable (iOS, desktop, reduced
 * UA) — callers keep their old behavior then. Pure.
 */
export function androidMajorFromUA(ua: string): number | null {
	const match = /android\s+(\d+)/i.exec(ua ?? "");
	if (!match) return null;
	const major = Number(match[1]);
	return Number.isSafeInteger(major) ? major : null;
}

/**
 * Whether the OS itself confirms a clipboard write, making an app
 * toast a duplicate. Android 13+ shows a system "Copied" overlay on
 * every copy; older Android and desktop stay silent, so the app's
 * own toast still owns confirmation there. Pure.
 */
export function osConfirmsClipboard(androidMajor: number | null): boolean {
	return androidMajor !== null && androidMajor >= 13;
}

/**
 * iPhone/iPad WebView or browser, by user agent string. (iPads in
 * desktop-mode Safari report "Macintosh" and stay on the desktop UI;
 * the Tauri shell reports a real iPhone/iPad token.)
 */
export function isIOSUserAgent(ua: string): boolean {
	return /iphone|ipad|ipod/i.test(ua);
}

/**
 * Native window dragging needs a desktop shell: mobile shells have no
 * draggable window, so `startDragging` there only rejects (once per
 * session, into an error toast). Desktop browsers keep their own
 * backend gate at the call site.
 */
export function canWindowDrag(ua: string): boolean {
	return !isAndroidUserAgent(ua) && !isIOSUserAgent(ua);
}

/**
 * Primary input is touch (no hover to wait for). The query runner is
 * injected so tests can stub it: pass `(q) => window.matchMedia(q)`.
 */
export function isCoarsePointer(
	query: (media: string) => { matches: boolean }
): boolean {
	try {
		return query("(pointer: coarse)").matches;
	} catch {
		return false;
	}
}

/**
 * iPad in desktop-mode Safari: the UA reports "Macintosh" (no iPad
 * token), but the device has a touchscreen. `navigator.maxTouchPoints`
 * (> 1 on touch hardware, 0/1 on real Macs) tells the two apart. Pure
 * so the shape unit-tests without tablet hardware.
 */
export function isIPadDesktopMode(ua: string, maxTouchPoints: number): boolean {
	return /macintosh/i.test(ua) && maxTouchPoints > 1;
}

/**
 * Desktop modifier labels (shortcuts modal, tooltips): macOS shows the
 * ⌘/⌥/⇧ glyphs, Windows/Linux show the Ctrl/Alt/Shift names. The key
 * handlers accept both metaKey and ctrlKey (and altKey either way), so
 * the label only names the platform's primary modifier — it always
 * matches a combo the handler takes. Call sites read navigator (see
 * `currentPlatform`); tests pass explicit values — Vitest runs in
 * node, where navigator doesn't exist.
 */

/**
 * True when the platform reports macOS. `navigator.userAgentData.platform`
 * (User-Agent Client Hints: "macOS") wins when present; otherwise the
 * legacy `navigator.platform` ("MacIntel"). Empty/unknown reads as
 * non-Mac, so the Ctrl/Alt labels show — every handler accepts those.
 */
export function isMacPlatform(platform: string, uaDataPlatform = ""): boolean {
	const hint = uaDataPlatform.trim();
	if (hint) return /mac/i.test(hint);
	return /mac/i.test(platform);
}

/**
 * True when the platform reports Windows. Same precedence as
 * `isMacPlatform`: Client Hints ("Windows") win, else `navigator.platform`
 * ("Win32"). Feeds the browser voice-install guidance in settings.
 */
export function isWindowsPlatform(
	platform: string,
	uaDataPlatform = ""
): boolean {
	const hint = uaDataPlatform.trim();
	if (hint) return /win/i.test(hint);
	return /win/i.test(platform);
}

/** Primary modifier label: ⌘ on Mac, Ctrl elsewhere. */
export function modKeyLabel(isMac: boolean): string {
	return isMac ? "⌘" : "Ctrl";
}

/** Secondary modifier label: ⌥ on Mac, Alt elsewhere. */
export function altKeyLabel(isMac: boolean): string {
	return isMac ? "⌥" : "Alt";
}

/** Shift label: ⇧ on Mac, Shift elsewhere. */
export function shiftKeyLabel(isMac: boolean): string {
	return isMac ? "⇧" : "Shift";
}

/**
 * Runtime desktop-OS probe for the shortcuts modal and voice guidance:
 * reads `navigator.platform` with User-Agent Client Hints winning when
 * present. Never throws; unknown platforms read as non-Mac/non-Windows
 * so the Ctrl/Alt labels and generic guidance show.
 */
export function currentPlatform(): { isMac: boolean; isWindows: boolean } {
	try {
		const nav = navigator as Navigator & {
			userAgentData?: { platform?: string };
			platform?: string;
		};
		const platform = nav.platform ?? "";
		const hint = nav.userAgentData?.platform ?? "";
		return {
			isMac: isMacPlatform(platform, hint),
			isWindows: isWindowsPlatform(platform, hint)
		};
	} catch {
		return { isMac: false, isWindows: false };
	}
}

/** Inputs for the touch-tablet probe (call sites read navigator/screen). */
export interface TouchTabletProbe {
	ua: string;
	/** Primary input is touch (pass `isCoarsePointer` over matchMedia). */
	coarse: boolean;
	/** `navigator.maxTouchPoints` (0 where unsupported). */
	maxTouchPoints: number;
	/** Shorter screen side in CSS px (`screen.width/height`). */
	smallestScreenDim: number;
}

/**
 * True when a touch tablet should get the touch UI. Covers iPads in
 * desktop-mode Safari (Macintosh UA + touch points) and any other
 * coarse-pointer tablet at least `minTabletDim` px on its short side —
 * phones already match the UA gates above, and touchscreen laptops
 * report a fine primary pointer, so neither is pulled in. Pure so the
 * contract unit-tests without the hardware.
 */
export function isTouchTablet(
	probe: TouchTabletProbe,
	minTabletDim = 600
): boolean {
	if (isIPadDesktopMode(probe.ua, probe.maxTouchPoints)) return true;
	return (
		probe.coarse &&
		probe.maxTouchPoints > 1 &&
		probe.smallestScreenDim >= minTabletDim
	);
}

export type EdgePanel = "chats" | "settings";

/** One tracked touch point (identifier + last-seen position). */
export interface FingerTrack {
	id: number;
	x: number;
	y: number;
}

/**
 * Two-finger horizontal chat step: both fingers glide mostly horizontally
 * in the same direction. Pinches change finger spread instead of gliding,
 * so a spread change vetoes the step and page zoom keeps working. Swipe
 * right steps newer (+1), swipe left steps older (-1). One finger still
 * scrolls, so the spare second finger owns navigation.
 */
/**
 * Pinch-zoom font step: the finger spread moved a full step since the
 * baseline — +1 spread apart, -1 pinched together, 0 inside the step.
 * The caller re-baselines on nonzero so a held pinch keeps stepping.
 * Pure so the step unit-tests without touch hardware.
 */
export function pinchZoomStep(
	baseline: number,
	current: number,
	stepPx = 48
): 1 | -1 | 0 {
	if (current - baseline >= stepPx) return 1;
	if (baseline - current >= stepPx) return -1;
	return 0;
}

/**
 * Two-finger vertical slide: both fingers glide mostly vertically in
 * the same direction. Slide-up reaches the chat top ("top"),
 * slide-down the chat bottom ("bottom"). Same pinch veto as the
 * horizontal step so page zoom keeps working. Pure so the rule
 * unit-tests without touch hardware.
 */
export function twoFingerSlideDir(
	start: [FingerTrack, FingerTrack],
	end: [FingerTrack, FingerTrack],
	minDistance = 96
): "top" | "bottom" | null {
	const dy0 = end[0].y - start[0].y;
	const dy1 = end[1].y - start[1].y;
	if (dy0 === 0 || Math.sign(dy0) !== Math.sign(dy1)) return null;
	const dy = (dy0 + dy1) / 2;
	if (Math.abs(dy) < minDistance) return null;
	for (let i = 0; i < 2; i++) {
		const s = start[i];
		const e = end[i];
		if (!s || !e) return null;
		if (Math.abs(e.x - s.x) > Math.abs(dy) / 2) return null;
	}
	const spread0 = Math.hypot(start[0].x - start[1].x, start[0].y - start[1].y);
	const spread1 = Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y);
	if (Math.abs(spread1 - spread0) > 24) return null;
	return dy < 0 ? "top" : "bottom";
}

export function twoFingerSwipeDir(
	start: [FingerTrack, FingerTrack],
	end: [FingerTrack, FingerTrack],
	minDistance = 96
): 1 | -1 | null {
	const dx0 = end[0].x - start[0].x;
	const dx1 = end[1].x - start[1].x;
	if (dx0 === 0 || Math.sign(dx0) !== Math.sign(dx1)) return null;
	const dx = (dx0 + dx1) / 2;
	if (Math.abs(dx) < minDistance) return null;
	for (let i = 0; i < 2; i++) {
		const s = start[i];
		const e = end[i];
		if (!s || !e) return null;
		if (Math.abs(e.y - s.y) > Math.abs(dx) / 2) return null;
	}
	const spread0 = Math.hypot(start[0].x - start[1].x, start[0].y - start[1].y);
	const spread1 = Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y);
	if (Math.abs(spread1 - spread0) > 24) return null;
	return dx > 0 ? 1 : -1;
}

/**
 * Three-finger horizontal swipe: the lead finger glides mostly
 * horizontally past minDistance, and the trailing fingers must not
 * wander vertically past half of that (a loose shape — three fingers
 * never track evenly). Steps chats: right is newer (1), left older
 * (-1). Pure so the rule unit-tests without touch hardware.
 */
export function threeFingerSwipeDir(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	minDistance = 96
): 1 | -1 | null {
	const dx = endX - startX;
	if (dx === 0 || Math.abs(dx) < minDistance) return null;
	if (Math.abs(endY - startY) > Math.abs(dx) / 2) return null;
	return dx > 0 ? 1 : -1;
}

/**
 * Quick-switcher veil swipe (phone only): a mostly-horizontal stroke
 * anywhere on the veil cycles chats. Left steps newer (minting past
 * the end), right steps older — the arrow buttons read the same way
 * (‹ older, newer ›). Taps still close via click; anything short or
 * diagonal stays out.
 */
export function switcherVeilStep(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	minDistance = 64
): 1 | -1 | null {
	const dx = endX - startX;
	const dy = endY - startY;
	if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx))
		return null;
	return dx > 0 ? -1 : 1;
}

/**
 * Three-finger double-tap delete: each tap is short, near-stationary, and
 * exactly three fingers. The pairing window lives at the call site (it
 * needs a clock); this judges one tap. Pure so the shape unit-tests
 * without touch hardware.
 */
export function isThreeFingerTap(
	fingers: number,
	moved: number,
	durationMs: number,
	maxMove = 12,
	maxDuration = 400
): boolean {
	return fingers === 3 && moved <= maxMove && durationMs <= maxDuration;
}

/**
 * Provider ids visible under the platform caps. `local-mlkit` is the
 * on-device entry: it lists only on Android (nowhere else has
 * its bridge), and it is the ONLY entry when Android is offline —
 * cloud models can't answer without a connection. Desktop and online
 * phones see everything. Pure so the contract unit-tests without a
 * device; call sites feed `navigator.onLine` plus online/offline
 * events (settings radios track while open, the cycle reads live).
 */
export function visibleProviderIds<T extends string>(
	all: T[],
	caps: { android: boolean; online: boolean; local: boolean }
): T[] {
	const listed = all.filter(
		(id) => id !== "local-mlkit" || (caps.android && caps.local)
	);
	if (caps.android && !caps.online)
		return listed.filter((id) => id === "local-mlkit");
	return listed;
}

/**
 * Whether the mic buttons show. Web SpeechRecognition covers browsers;
 * inside a shell they ride the native recognizer instead, which exists
 * on macOS and Android. Windows needs package identity the installer
 * lacks and Linux has no OS speech API, so shells there stay hidden
 * rather than toasting on every tap. iOS is excluded even when it
 * reports Macintosh (iPad desktop mode): it has no native recognizer.
 * Pure so the gate unit-tests.
 */
export function micButtonsShown(
	webMic: boolean,
	inShell: boolean,
	isMac: boolean,
	isAndroid: boolean,
	isIOS: boolean
): boolean {
	if (isIOS) return webMic;
	return webMic || (inShell && (isMac || isAndroid));
}

/**
 * Edge-swipe target for touch sidebars: a mostly-horizontal swipe of at
 * least `minDistance` px starting inside the screen's edge zone. Left
 * edge swipes right to open chats; right edge swipes left for settings.
 * Vertical scrolls, short drags, and mid-screen swipes never qualify,
 * so code blocks and the prompt keep their own gestures. (A bottom-up
 * summon was tried and dropped: it fires during message scrolling.)
 */
export function edgeSwipeTarget(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	width: number,
	minDistance = 48,
	edgeZone = 24
): EdgePanel | null {
	const dx = endX - startX;
	const dy = endY - startY;
	if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx)) return null;
	if (dx > 0 && startX <= edgeZone) return "chats";
	if (dx < 0 && startX >= width - edgeZone) return "settings";
	return null;
}

/**
 * Mid-screen swipe (phone only): right opens chats, left opens settings.
 * Longer stroke than the edge rule, since mid-screen horizontal drift
 * during vertical scrolling is common. Callers gate this on the Android
 * UA plus their own guards (no text selected, started outside editable
 * text) — desktops with touchscreens must never see it.
 */
export function contentSwipeTarget(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	minDistance = 64
): EdgePanel | null {
	const dx = endX - startX;
	const dy = endY - startY;
	if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx)) return null;
	return dx > 0 ? "chats" : "settings";
}

/**
 * Message fold stroke (phone only): a mostly-horizontal stroke starting
 * on a message folds it — either direction, so rightward message
 * strokes never summon the chats list while fold on swipe is on.
 * Same 64px floor as the mid-screen rule, so scroll drift never folds.
 * Callers gate this on the Android UA, the fold toggle, a resolved
 * message id, a clean start (never the action row or code/math), and
 * no text selection — geometry alone never folds.
 */
export function messageFoldSwipe(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	minDistance = 64
): boolean {
	const dx = endX - startX;
	const dy = endY - startY;
	return Math.abs(dx) >= minDistance && Math.abs(dy) < Math.abs(dx);
}

/**
 * Where a single-finger tap began: "message" (an article body, never
 * its action row or a control), "prompt" (the composer card outside any
 * field or button), "empty" (dead main-column space), or "other"
 * (controls, sidebars, modals — taps keep their native behavior).
 * Double-tap on "empty" opens the chats list; everything else taps
 * natively.
 */
export type FlickZone = "message" | "prompt" | "empty" | "other";

/** One tap in a consecutive-tap run (double/triple/quadruple). */
export interface TapSequence {
	count: number;
	at: number;
	x: number;
	y: number;
}

/**
 * Fold a tap into its sequence: taps within `windowMs` and `maxDist`
 * of the last increment the count (cycling back to one after four);
 * anything else restarts at one. Pure — handlers own the clock.
 */
export function nextTapCount(
	prev: TapSequence | null,
	at: number,
	x: number,
	y: number,
	windowMs = 400,
	maxDist = 32
): TapSequence {
	if (
		prev &&
		at - prev.at < windowMs &&
		Math.hypot(x - prev.x, y - prev.y) < maxDist
	) {
		return { count: prev.count >= 4 ? 1 : prev.count + 1, at, x, y };
	}
	return { count: 1, at, x, y };
}

/**
 * Whether a release belongs to tap 2+ of a consecutive-tap run
 * (double/triple/quadruple): the run's own selection (native word
 * pick, sentence/paragraph override) lands between touchend and the
 * compatibility mouseup, so a staleness check that compares against
 * the press-time snapshot misreads the fresh pick as "nothing
 * changed". Single taps and stale runs never qualify. Pure.
 */
export function multiTapOwnsRelease(
	seq: TapSequence | null,
	now: number,
	windowMs = 800
): boolean {
	return (
		seq !== null && seq.count >= 2 && now - seq.at >= 0 && now - seq.at < windowMs
	);
}

/**
 * One step through a cyclic id list (REFACTOR §6): the provider
 * cycle wraps through the visible ids. Unknown currents land on
 * the neighbor past the insertion point (indexOf -1 + direction +
 * length), never stuck; empty lists stay undefined.
 */
export function stepCyclicId<T>(
	ids: T[],
	current: T,
	direction: 1 | -1
): T | undefined {
	if (ids.length === 0) return undefined;
	const next =
		(ids.indexOf(current) + direction + ids.length) % ids.length;
	return ids[next];
}

/**
 * True when a touch traveled past the tap slop (REFACTOR §6): menu
 * drags, button taps, and scroll-stroke tracking share the one
 * distance check with their own slops.
 */
export function touchPastSlop(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	slop: number
): boolean {
	return Math.hypot(x2 - x1, y2 - y1) > slop;
}
