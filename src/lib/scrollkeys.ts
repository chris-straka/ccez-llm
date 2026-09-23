/**
 * Scrollkeys (bucket): desktop keyboard scrolling when no message is
 * selected, plus the press-and-HOLD Escape threshold for exiting
 * fullscreen. Pure helpers only — call sites feed DOM measurements
 * (scrollBox rects, `Date.now()`); Vitest runs in node, where no
 * window exists. DOM work stays in `+page.svelte`.
 */

/** One j/k step: a few lines, fixed so unit tests can pin it. */
export const SCROLLKEY_LINE_PX = 72;

/**
 * Scale a fixed scroll distance with the text size: a j-step moves
 * lines, and lines grow with the font — unscaled steps crawl at
 * 370%. Half-page jumps stay viewport-based (a page is a page).
 * Non-finite or non-positive scales read as 1, never 0 or NaN.
 */
export function scaleScrollPx(px: number, fontScale: number): number {
	const scale =
		Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
	return px * scale;
}

/**
 * One bare d/u tap: three j/k steps — quick without jumping a
 * half-page per tap. Fixed like the line step so tests can pin it;
 * held d/u still glide fast, Ctrl+U / Ctrl+D still jump half-pages.
 */
export const SCROLLKEY_SKIP_PX = SCROLLKEY_LINE_PX * 3;

/** Stick-to-bottom slop: within this of the bottom counts as bottom. */
export const STICK_PX = 64;

/**
 * Whether a scroller sits at (or near) its bottom. Pure over the
 * box metrics so the stick re-derives from the real position, never
 * from stale state.
 */
export function nearBottom(
	metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
	slopPx = STICK_PX
): boolean {
	return (
		metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= slopPx
	);
}

/** How long Escape must be held to exit fullscreen: two full seconds,
Chrome parity — a tap or a firm press still only dismisses
menus/overlays exactly as today. */
export const ESCAPE_HOLD_MS = 2000;

/** Lone-g arming window for gg (mirrors the scroll-mode beat). */
export const GG_WINDOW_MS = 800;

/** Breathing room above/below a z/Z-landed message (matches the
chat's 1rem scroll-padding-top). */
export const HOVER_EDGE_MARGIN_PX = 16;

/** What a bare keypress means when nothing is selected (desktop,
outside the prompt/fields/menus — the page owns the guards). */
export type UnselectedScrollIntent =
	| { kind: "line"; dy: number }
	| { kind: "half-page"; dir: 1 | -1 }
	| { kind: "skip"; dir: 1 | -1 }
	| { kind: "gg-prefix" }
	| { kind: "top" }
	| { kind: "bottom" }
	| { kind: "hovered-edge"; edge: "start" | "end" };

/**
 * Classify a bare keydown with no message selected. `gArmed` is true
 * while a lone g is still inside its beat (see `ggArmed`); shifted
 * keys arrive as their uppercase spelling ("G", "Z").
 */
export function unselectedScrollIntent(
	key: string,
	gArmed: boolean
): UnselectedScrollIntent | null {
	switch (key) {
		case "j":
			return { kind: "line", dy: SCROLLKEY_LINE_PX };
		case "k":
			return { kind: "line", dy: -SCROLLKEY_LINE_PX };
		// Bare d/u skip a smooth fixed step on desktop (the call site
		// gates phones, where bare taps stay dead and only Ctrl+U /
		// Ctrl+D jump) — taps scroll a little, never a half-page.
		case "d":
			return { kind: "skip", dir: 1 };
		case "u":
			return { kind: "skip", dir: -1 };
		case "g":
			return gArmed ? { kind: "top" } : { kind: "gg-prefix" };
		case "G":
			return { kind: "bottom" };
		case "z":
			return { kind: "hovered-edge", edge: "start" };
		case "Z":
			return { kind: "hovered-edge", edge: "end" };
		default:
			return null;
	}
}

/** True while a lone g is still inside its gg beat. */
export function ggArmed(
	lastGAt: number,
	now: number,
	windowMs = GG_WINDOW_MS
): boolean {
	return now - lastGAt < windowMs;
}

export type SidebarSpaceEnter =
	{ kind: "stay" } | { kind: "enter"; index: number };

/**
 * Space in the open chat list: with no row selected (sideIdx < 0) the
 * user stays on the current chat and lands in its prompt — never the
 * top chat. Otherwise the clamped row is entered.
 */
export function resolveSidebarSpaceEnter(
	sideIdx: number,
	chatCount: number
): SidebarSpaceEnter {
	if (sideIdx < 0 || chatCount <= 0) return { kind: "stay" };
	return {
		kind: "enter",
		index: Math.min(Math.max(sideIdx, 0), chatCount - 1)
	};
}

/**
 * Bare Space / Enter / i on an empty chat focuses the composer: with
 * no messages there is nothing to scroll, so the key lands in the
 * prompt instead of scrolling nowhere (or doing nothing — neither
 * Enter nor i scrolls anywhere either). The key is a summon, never
 * typed. Never fires with a modifier, inside a field or button
 * (Space types and clicks, Enter clicks, there), or on a chat with
 * history.
 */
export function keyFocusesEmptyPrompt(args: {
	key: string;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	messageCount: number;
	inInteractive: boolean;
}): boolean {
	return (
		(args.key === " " || args.key === "Enter" || args.key === "i") &&
		!args.shiftKey &&
		!args.metaKey &&
		!args.ctrlKey &&
		!args.altKey &&
		args.messageCount === 0 &&
		!args.inInteractive
	);
}

/** d/u fast scroll distance: half the visible chat height. */
export function halfPageDy(viewH: number, dir: 1 | -1): number {
	return dir * Math.max(1, Math.floor(viewH / 2));
}

/**
 * Target scrollTop landing the hovered message's top (`start`, z)
 * or bottom (`end`, Z) in view. All inputs are measured pixels:
 * the chat box's current scrollTop, the box and message top edges
 * in the same (viewport) coordinate space, the message height, and
 * the visible chat height. `bottomReserve` (end edge only) is the
 * floating composer's height plus a gap: the box runs full-height
 * behind the card, so an unreserved landing parks the message
 * bottom underneath it instead of above it.
 */
export function messageEdgeScrollTop(args: {
	scrollTop: number;
	boxTop: number;
	elTop: number;
	elHeight: number;
	viewH: number;
	edge: "start" | "end";
	margin?: number;
	bottomReserve?: number;
}): number {
	const margin = args.margin ?? HOVER_EDGE_MARGIN_PX;
	const elTopInBox = args.scrollTop + (args.elTop - args.boxTop);
	if (args.edge === "start") return elTopInBox - margin;
	const reserve = args.bottomReserve ?? 0;
	return elTopInBox + args.elHeight - args.viewH + reserve + margin;
}

/**
 * True when an Escape press counts as a HOLD (exit fullscreen) rather
 * than a tap (dismiss menus/overlays as today). `downAt` is the
 * keydown timestamp (0 when no press is tracked); `now` the keyup
 * timestamp, both from the same clock.
 */
export function isEscapeHold(
	downAt: number,
	now: number,
	thresholdMs = ESCAPE_HOLD_MS
): boolean {
	return downAt > 0 && now - downAt >= thresholdMs;
}

/** Hold-to-glide velocity for j/k: continuous pixels per second. */
export const SCROLLKEY_JK_VELOCITY_PX_S = 720;

/** Hold-to-glide velocity for d/u: the fast version of j/k (3x). */
export const SCROLLKEY_DU_VELOCITY_PX_S = 2160;

/** A hold shorter than this is a tap: it lands one discrete step. */
export const SCROLL_HOLD_TAP_MS = 150;

/**
 * Hold-glide ramp: ms from key-down speed to peak velocity. Short
 * enough that a deliberate hold still gets fast quickly; long
 * enough that engaging the hold never kicks.
 */
export const SCROLL_HOLD_RAMP_MS = 300;

/**
 * Viewport-space rect of one message, for the screen-center pick.
 * Missing nodes never reach here (the caller skips them).
 */
export interface MessageRect {
	top: number;
	bottom: number;
}

/**
 * Index of the message crossing a viewport line (the m/n screen-center
 * pick): the first message covering `line`; when none covers it (a gap
 * between messages), the nearest message center wins; -1 when empty.
 * Pure over measured viewport-space rects so Vitest can pin it.
 */
export function indexAtViewportLine(
	rects: MessageRect[],
	line: number
): number {
	for (let i = 0; i < rects.length; i++) {
		const r = rects[i];
		if (r && r.top <= line && r.bottom > line) return i;
	}
	let best = -1;
	let bestDist = Infinity;
	for (let i = 0; i < rects.length; i++) {
		const r = rects[i];
		if (!r) continue;
		const dist = Math.abs((r.top + r.bottom) / 2 - line);
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
}

/**
 * Glide velocity for a held scroll key, or null for keys that do not
 * glide (gg/G/z/Z and everything else keep their discrete behavior).
 * d/u glide fast on desktop; phone call sites never start their
 * holds, so bare taps stay dead there.
 */
export function scrollHoldVelocity(key: string): number | null {
	switch (key) {
		case "j":
			return SCROLLKEY_JK_VELOCITY_PX_S;
		case "k":
			return -SCROLLKEY_JK_VELOCITY_PX_S;
		case "d":
			return SCROLLKEY_DU_VELOCITY_PX_S;
		case "u":
			return -SCROLLKEY_DU_VELOCITY_PX_S;
		default:
			return null;
	}
}

/** Advance a glide by one frame: pure so tests can pin the pacing. */
export function stepScrollTop(
	current: number,
	velocityPxS: number,
	dtMs: number
): number {
	return current + (velocityPxS * Math.max(0, dtMs)) / 1000;
}

/**
 * Glide velocity for a hold `holdMs` milliseconds old: j/k cruise
 * at their flat speed, while d/u start there and accelerate to
 * peak over SCROLL_HOLD_RAMP_MS — the hold engages without a kick
 * and still gets fast. Pure over the key and hold age so tests can
 * pin the pacing; the tick feeds rAF-clock age (never the wall
 * clock, which ticks a different clock than the frame callback).
 */
export function holdGlideVelocity(key: string, holdMs: number): number {
	const peak = scrollHoldVelocity(key);
	if (peak === null) return 0;
	const base = Math.sign(peak) * SCROLLKEY_JK_VELOCITY_PX_S;
	if (Math.abs(peak) <= SCROLLKEY_JK_VELOCITY_PX_S) return peak;
	const t =
		Math.min(Math.max(holdMs, 0), SCROLL_HOLD_RAMP_MS) / SCROLL_HOLD_RAMP_MS;
	return base + (peak - base) * t;
}

/** True when a key hold was really a tap (lands one discrete step). */
export function holdIsTap(
	downAt: number,
	upAt: number,
	tapMs = SCROLL_HOLD_TAP_MS
): boolean {
	return downAt > 0 && upAt - downAt < tapMs;
}

/**
 * Release step for a tap: the discrete step minus glide frames already
 * accrued, so a tap lands exactly its step total — never glide frames
 * plus the full step (the old jump). Zero when the glide already
 * covered it (a slow release), never a backwards correction.
 */
export function tapReleaseRest(tapDy: number, glided: number): number {
	const rest = tapDy - glided;
	if (rest === 0) return 0;
	return Math.sign(rest) === Math.sign(tapDy) ? rest : 0;
}

/**
 * Discrete tap totals stay taps at huge type: a font-scaled skip step
 * at 240% crosses 65% of a viewport per tap. Clamp tap totals to a
 * viewport fraction (holds are velocity-driven and need no clamp).
 */
export const TAP_STEP_VIEWPORT_FRAC = 0.4;

/** Clamp a discrete tap total to a viewport fraction, sign-preserving. */
export function clampTapDy(
	dy: number,
	clientHeight: number,
	frac = TAP_STEP_VIEWPORT_FRAC
): number {
	const cap = Math.max(0, clientHeight) * frac;
	if (Math.abs(dy) <= cap) return dy;
	return Math.sign(dy) * cap;
}

/**
 * Scroll-mode entry line (REFACTOR §6): a few lines below the
 * viewport top — a bottom sliver of the message above never wins,
 * and a taller-than-viewport message still matches by coverage.
 */
export function viewCursorLine(viewTop: number, viewBottom: number): number {
	return viewTop + Math.min(160, (viewBottom - viewTop) * 0.25);
}
