/**
 * Study-session media APIs (media bucket): Screen Wake Lock during
 * read-aloud/TTS, MediaRecorder waveform + voice-activity auto-stop
 * for dictation, background-reply Notifications + Badging, and
 * vibrate ticks on send/annotate.
 *
 * Every runtime touch is feature-detected with a clean fallback
 * (plain browser preview, jsdom, unsupported devices): probes return
 * false, actions return null/false, and nothing ever throws into UI
 * teardown. Pure decisions take injected values so Vitest pins them
 * without DOM; the page passes live state, tests pass literals.
 */

/** Minimal shape of a held Screen Wake Lock (structural: no DOM lib type). */
export interface WakeLockRelease {
  release(): void;
}

interface WakeLockRequester {
  request(type: string): Promise<{ release(): void }>;
}

function globalOf(name: string): unknown {
  try {
    return (globalThis as unknown as Record<string, unknown>)[name] ?? null;
  } catch {
    return null;
  }
}

function globalNavigator(): unknown {
  try {
    return typeof navigator === "undefined" ? null : navigator;
  } catch {
    return null;
  }
}

function wakeLockOf(nav: unknown): WakeLockRequester | null {
  if (typeof nav !== "object" || nav === null) return null;
  const lock = (nav as { wakeLock?: unknown }).wakeLock;
  if (typeof lock !== "object" || lock === null) return null;
  if (typeof (lock as { request?: unknown }).request !== "function")
    return null;
  return lock as WakeLockRequester;
}

/** True when a Screen Wake Lock can be requested in this runtime. */
export function wakeLockSupported(nav: unknown = globalNavigator()): boolean {
  return wakeLockOf(nav) !== null;
}

/**
 * Hold the screen on for a study read-aloud. Resolves a releasable
 * handle, or null where Wake Lock is unsupported or denied. The
 * caller releases on stop/end (see releaseStudyWakeLock) — a stale
 * acquire that resolves after the utterance ended must be released
 * immediately instead of kept.
 */
export async function acquireStudyWakeLock(
  nav: unknown = globalNavigator(),
): Promise<WakeLockRelease | null> {
  const lock = wakeLockOf(nav);
  if (!lock) return null;
  try {
    const sentinel = await lock.request("screen");
    let released = false;
    return {
      release(): void {
        if (released) return;
        released = true;
        try {
          sentinel.release();
        } catch {
          // Already released by the OS; nothing to do.
        }
      },
    };
  } catch {
    return null;
  }
}

/** Release a handle from acquireStudyWakeLock. Null-safe, never throws. */
export function releaseStudyWakeLock(handle: WakeLockRelease | null): void {
  if (!handle) return;
  try {
    handle.release();
  } catch {
    // Teardown must never throw from UI paths.
  }
}

/** RMS energy of PCM samples in [-1, 1]; 0 for empty input. */
export function rmsOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

function mediaDevicesGetUserMedia(): unknown {
  try {
    if (typeof navigator === "undefined") return null;
    return navigator.mediaDevices?.getUserMedia ?? null;
  } catch {
    return null;
  }
}

/** True when MediaRecorder capture can run here (voice-bar fallback path). */
export function mediaRecorderSupported(
  ctor: unknown = globalOf("MediaRecorder"),
): boolean {
  return typeof ctor === "function";
}

/**
 * True when voice-activity detection can run here: an AudioContext
 * (or webkit prefix) for levels plus getUserMedia for the mic. Pure
 * over injected values; defaults probe the live runtime.
 */
export function vadSupported(input?: {
  audioContext?: unknown;
  getUserMedia?: unknown;
}): boolean {
  const audioContext =
    input?.audioContext ??
    globalOf("AudioContext") ??
    globalOf("webkitAudioContext");
  const getUserMedia = input?.getUserMedia ?? mediaDevicesGetUserMedia();
  return (
    typeof audioContext === "function" && typeof getUserMedia === "function"
  );
}

/**
 * Which dictation capture to use: live voice-activity auto-stop
 * where analyzable, a fixed-length MediaRecorder pass where VAD is
 * unavailable, or nothing where capture itself is missing. Pure.
 */
export type DictationCaptureMode = "vad" | "fixed" | "none";

export function dictationCaptureMode(
  vad: boolean,
  recorder: boolean,
): DictationCaptureMode {
  if (vad) return "vad";
  if (recorder) return "fixed";
  return "none";
}

/** Tunables for the dictation voice-activity state machine. */
export interface VadOptions {
  /** RMS at/above which speech is considered started. */
  startThreshold: number;
  /** RMS below which the end-hangover starts counting. */
  endThreshold: number;
  /** Silence below endThreshold that ends the utterance. */
  endHangoverMs: number;
}

/** Defaults: sensitive start, forgiving end (pauses must not cut speech). */
export const DEFAULT_VAD_OPTIONS: VadOptions = {
  startThreshold: 0.02,
  endThreshold: 0.015,
  endHangoverMs: 900,
};

export type VadPhase = "idle" | "speech";

export interface VadState {
  phase: VadPhase;
  belowSince: number | null;
}

export type VadEvent = "speech-start" | "speech-end";

/** Fresh VAD state (idle, no hangover clock). */
export function createVadState(): VadState {
  return { phase: "idle", belowSince: null };
}

/**
 * Feed one RMS level (with its timestamp) through the VAD machine.
 * Emits speech-start once per utterance and speech-end after the
 * hangover of sub-threshold silence. Pure and unit-tested; the page
 * stops dictation on speech-end and falls back to fixed recording
 * where vadSupported() is false.
 */
export function vadUpdate(
  state: VadState,
  rms: number,
  nowMs: number,
  opts: VadOptions,
): VadEvent | null {
  if (state.phase === "idle") {
    if (rms >= opts.startThreshold) {
      state.phase = "speech";
      state.belowSince = null;
      return "speech-start";
    }
    return null;
  }
  if (rms >= opts.endThreshold) {
    state.belowSince = null;
    return null;
  }
  if (state.belowSince === null) {
    state.belowSince = nowMs;
    return null;
  }
  if (nowMs - state.belowSince >= opts.endHangoverMs) {
    state.phase = "idle";
    state.belowSince = null;
    return "speech-end";
  }
  return null;
}

/**
 * Voice-bar levels for one RMS reading: `bars` heights in 0..1 with
 * a rounded taper so the ends rest even at full level. Pure; the
 * page paints these and clamps the input itself.
 */
export function waveformBars(level: number, bars: number): number[] {
  const clamped = Math.min(1, Math.max(0, level));
  if (!(bars > 0)) return [];
  const n = Math.floor(bars);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const taper = n === 1 ? 1 : Math.sin((Math.PI * (i + 1)) / (n + 1));
    out.push(clamped * taper);
  }
  return out;
}

/** Replies at/above this length ping when they finish backgrounded. */
export const LONG_REPLY_MIN_CHARS = 240;

export interface ReplyDoneGate {
  hidden: boolean;
  focused: boolean;
  permission: string;
  replyChars: number;
  minChars?: number;
}

/**
 * Whether a finished reply earns a notification: permission granted,
 * window backgrounded (hidden or unfocused), and the reply long
 * enough to have kept the user waiting. Pure and unit-tested.
 */
export function shouldNotifyReplyDone(gate: ReplyDoneGate): boolean {
  if (gate.permission !== "granted") return false;
  if (!(gate.hidden || !gate.focused)) return false;
  return gate.replyChars >= (gate.minChars ?? LONG_REPLY_MIN_CHARS);
}

function documentHiddenNow(): boolean {
  try {
    const doc = globalOf("document") as {
      hidden?: unknown;
      visibilityState?: unknown;
    } | null;
    if (typeof doc?.hidden === "boolean") return doc.hidden;
    if (typeof doc?.visibilityState === "string")
      return doc.visibilityState === "hidden";
  } catch {
    // Unknown: treat as visible (stay silent, never noisy).
  }
  return false;
}

function windowFocusedNow(): boolean {
  try {
    const doc = globalOf("document") as { hasFocus?: unknown } | null;
    if (doc && typeof doc.hasFocus === "function")
      return (doc.hasFocus as () => unknown)() !== false;
  } catch {
    // Unknown: assume focused (stay silent, never noisy).
  }
  return true;
}

interface NotificationCtor {
  new (title: string, options?: { body?: string }): unknown;
  permission?: unknown;
  requestPermission?: unknown;
}

function notificationCtor(source: unknown): NotificationCtor | null {
  if (typeof source !== "function") return null;
  return source as NotificationCtor;
}

/** Current Notification permission, or "unsupported" where gated off. */
export function replyNotificationPermission(
  source: unknown = globalOf("Notification"),
): string {
  const ctor = notificationCtor(source);
  if (!ctor) return "unsupported";
  try {
    return typeof ctor.permission === "string"
      ? ctor.permission
      : "unsupported";
  } catch {
    return "unsupported";
  }
}

/**
 * Ask for notification permission when undecided; resolves the
 * standing permission otherwise ("granted", "denied", "default",
 * "unsupported"). Never throws. Call from a user gesture (send).
 */
export async function ensureReplyNotificationPermission(
  source: unknown = globalOf("Notification"),
): Promise<string> {
  const ctor = notificationCtor(source);
  if (!ctor) return "unsupported";
  try {
    const current =
      typeof ctor.permission === "string" ? ctor.permission : "default";
    if (current === "granted" || current === "denied") return current;
    if (typeof ctor.requestPermission !== "function") return current;
    const next = await (ctor.requestPermission as () => Promise<unknown>)();
    if (typeof next === "string") return next;
    return typeof ctor.permission === "string" ? ctor.permission : "default";
  } catch {
    return "default";
  }
}

/**
 * Ping for a finished long reply while backgrounded. Silent (false)
 * when focused, short, unpermitted, or unsupported. Never throws.
 */
export function notifyReplyDone(
  title: string,
  body: string,
  input?: { notif?: unknown; hidden?: boolean; focused?: boolean },
): boolean {
  const source = input?.notif ?? globalOf("Notification");
  const ctor = notificationCtor(source);
  if (!ctor) return false;
  const permission = replyNotificationPermission(source);
  const hidden = input?.hidden ?? documentHiddenNow();
  const focused = input?.focused ?? windowFocusedNow();
  if (
    !shouldNotifyReplyDone({
      hidden,
      focused,
      permission,
      replyChars: body.length,
    })
  ) {
    return false;
  }
  try {
    new ctor(title, { body: body.slice(0, 160) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Mirror the pending reply onto the app icon badge (Android/Windows).
 * False where Badging is unsupported. Never throws.
 */
export function setStudyBadge(
  count = 1,
  nav: unknown = globalNavigator(),
): boolean {
  try {
    const n = nav as { setAppBadge?: unknown } | null;
    if (typeof n?.setAppBadge !== "function") return false;
    void (n.setAppBadge as (count?: number) => unknown)(count);
    return true;
  } catch {
    return false;
  }
}

/** Clear the reply badge (user is back). False where unsupported. */
export function clearStudyBadge(nav: unknown = globalNavigator()): boolean {
  try {
    const n = nav as { clearAppBadge?: unknown } | null;
    if (typeof n?.clearAppBadge !== "function") return false;
    void (n.clearAppBadge as () => unknown)();
    return true;
  } catch {
    return false;
  }
}

/** True when navigator.vibrate can tick in this runtime. */
export function vibrateSupported(nav: unknown = globalNavigator()): boolean {
  try {
    const n = nav as { vibrate?: unknown } | null;
    return typeof n?.vibrate === "function";
  } catch {
    return false;
  }
}

/**
 * One haptic tick (send/annotate). No-op false where unsupported.
 * Never throws — desktop browsers without the API simply skip.
 */
export function vibrateTick(
  pattern: number | number[] = 10,
  nav: unknown = globalNavigator(),
): boolean {
  try {
    const n = nav as { vibrate?: unknown } | null;
    if (typeof n?.vibrate !== "function") return false;
    (n.vibrate as (pattern: number | number[]) => unknown)(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Haptic beats: send taps, the first reply token rumbles, stream end thumps. */
export type HapticBeat = "send" | "first" | "done";

/**
 * Vibration pattern per beat: a short single tap on send, a longer
 * rumble as the reply starts arriving, a double thump when it is
 * fully in. Kept small — these fire on every message.
 */
const HAPTIC_PATTERNS: Record<HapticBeat, number[]> = {
  send: [20],
  first: [70],
  done: [35, 60, 110],
};

/**
 * Fire one haptic beat. False when the caller disabled vibration or
 * the runtime has no vibrator (desktops, browser preview without the
 * API). Never throws.
 */
export function hapticBeat(
  kind: HapticBeat,
  opts: { enabled?: boolean; nav?: unknown } = {},
): boolean {
  if (opts.enabled === false) return false;
  return vibrateTick(HAPTIC_PATTERNS[kind] ?? 10, opts.nav);
}

/** Structural slice of the Tauri haptics plugin (dynamic import). */
export interface NativeHaptics {
  vibrate?(duration: number): Promise<unknown>;
  impactFeedback?(style: string): Promise<unknown>;
  notificationFeedback?(type: string): Promise<unknown>;
  selectionFeedback?(): Promise<unknown>;
}

/**
 * Lazily load the haptics plugin. Dynamic so node/jsdom imports of
 * this module never touch Tauri; null outside the shell or when the
 * plugin is missing. Never throws.
 */
async function nativeHaptics(shell: boolean): Promise<NativeHaptics | null> {
  if (!shell) return null;
  try {
    const mod = (await import(
      "@tauri-apps/plugin-haptics"
    )) as unknown as Record<string, unknown>;
    if (
      typeof mod["vibrate"] !== "function" &&
      typeof mod["impactFeedback"] !== "function" &&
      typeof mod["notificationFeedback"] !== "function" &&
      typeof mod["selectionFeedback"] !== "function"
    )
      return null;
    return mod;
  } catch {
    return null;
  }
}

/**
 * Shell-aware haptic beat: the plugin drives the Taptic Engine on
 * iOS and the vibrator on Android (`navigator.vibrate` does not
 * exist on iPhones at all). Browser preview falls back to the Web
 * vibrator. False when disabled or unsupported. Never throws.
 */
export async function hapticBeatAsync(
  kind: HapticBeat,
  opts: {
    enabled?: boolean;
    nav?: unknown;
    shell?: boolean;
    plugin?: NativeHaptics | null;
  } = {},
): Promise<boolean> {
  if (opts.enabled === false) return false;
  if (opts.shell) {
    try {
      const haptics = opts.plugin ?? (await nativeHaptics(true));
      if (!haptics) return false;
      // Send taps light, the first token rumbles medium, arrival
      // thumps a success — the same three beats as the web patterns.
      if (kind === "send" && haptics.selectionFeedback) {
        await haptics.selectionFeedback();
        return true;
      }
      if (kind === "first" && haptics.impactFeedback) {
        await haptics.impactFeedback("medium");
        return true;
      }
      if (kind === "done" && haptics.notificationFeedback) {
        await haptics.notificationFeedback("success");
        return true;
      }
      if (haptics.vibrate) {
        await haptics.vibrate(kind === "send" ? 20 : kind === "first" ? 70 : 110);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return hapticBeat(kind, opts);
}

/** Structural slice of the Tauri notification plugin (dynamic import). */
export interface NativeNotifier {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<string>;
  sendNotification(opts: { title: string; body?: string }): unknown;
}

/**
 * Lazily load the notification plugin. Dynamic so node/jsdom imports
 * of this module never touch Tauri; null outside the shell or when
 * the plugin is missing. Never throws.
 */
async function nativeNotifier(shell: boolean): Promise<NativeNotifier | null> {
  if (!shell) return null;
  try {
    const mod = (await import(
      "@tauri-apps/plugin-notification"
    )) as unknown as Record<string, unknown>;
    if (
      typeof mod["isPermissionGranted"] !== "function" ||
      typeof mod["requestPermission"] !== "function" ||
      typeof mod["sendNotification"] !== "function"
    )
      return null;
    return mod as unknown as NativeNotifier;
  } catch {
    return null;
  }
}

/**
 * Shell-aware permission ask: the plugin request on Android pops the
 * OS notification prompt (the Web Notification ctor does not exist
 * in the WebView). Web ask everywhere else. Never throws — call from
 * a user gesture (send).
 */
export async function ensureReplyNotificationPermissionAsync(input?: {
  source?: unknown;
  shell?: boolean;
  plugin?: NativeNotifier | null;
}): Promise<string> {
  if (input?.shell) {
    try {
      const plugin = input?.plugin ?? (await nativeNotifier(true));
      if (!plugin) return "unsupported";
      if (await plugin.isPermissionGranted()) return "granted";
      const next = await plugin.requestPermission();
      return typeof next === "string" ? next : "default";
    } catch {
      return "default";
    }
  }
  return ensureReplyNotificationPermission(input?.source);
}

/**
 * Finished-reply ping that also works in the shell: native
 * notification first (the only channel inside the Android WebView),
 * Web Notification fallback (browser preview, desktop shell).
 * Silent (false) when foregrounded, short, unpermitted, or
 * unsupported. Never throws.
 */
export async function notifyReplyDoneAsync(
  title: string,
  body: string,
  input?: {
    notif?: unknown;
    hidden?: boolean;
    focused?: boolean;
    shell?: boolean;
    plugin?: NativeNotifier | null;
  },
): Promise<boolean> {
  const text = body.trim();
  const hidden = input?.hidden ?? documentHiddenNow();
  const focused = input?.focused ?? windowFocusedNow();
  if (!(hidden || !focused)) return false;
  if (text.length < LONG_REPLY_MIN_CHARS) return false;
  if (input?.shell) {
    try {
      const plugin = input?.plugin ?? (await nativeNotifier(true));
      if (plugin && (await plugin.isPermissionGranted())) {
        await plugin.sendNotification({ title, body: text.slice(0, 160) });
        return true;
      }
    } catch {
      // Fall through to the Web channel below.
    }
    return notifyReplyDone(title, body, input);
  }
  return notifyReplyDone(title, body, input);
}
