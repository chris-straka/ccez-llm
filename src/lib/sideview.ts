import type { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import type { Webview } from "@tauri-apps/api/webview";
import { tauriBackendAvailable } from "./secrets";
import { SIDEVIEW_WIDTH_MAX, SIDEVIEW_WIDTH_MIN } from "./settings";

/**
 * Browser side panel (single tab): Cmd+T docks a second OS webview
 * on the right of the same Tauri window — a plain browser, no
 * Translate framing. Exactly one tab is ever open; the address bar
 * navigates that same webview. Outside the Tauri shell (plain
 * `vite dev`, Vitest) there is no webview host, so the bridge
 * reports false and the page renders a DOM fallback strip instead
 * of crashing.
 *
 * Pure helpers (home/search resolve, URL gate, toggle, layout,
 * width clamp) are unit-tested; the `*Sideview` bridge below runs
 * only inside the desktop shell — shell-creation/resize behavior is
 * NOT covered by automated tests (unverified in the Tauri shell;
 * exercise Cmd+T there by hand).
 */

/**
 * Webview label for the single browser tab. Kept from the
 * research-panel days on purpose: renaming it would orphan the
 * previous tab as an invisible always-hidden webview on upgrade.
 */
export const SIDE_VIEW_LABEL = "research-sideview";

/** Dock width in logical px on desktop-width windows. */
export const SIDE_VIEW_DOCK_WIDTH = 420;

/** Below this viewport width the panel overlays instead of splitting. */
export const SIDE_VIEW_OVERLAY_BELOW = 640;

/** Home page for a fresh browser tab (plain search, no Translate framing). */
export const BROWSER_HOME_URL = "https://duckduckgo.com/";

/** Search prefix: non-URL address input becomes a search for the raw text. */
export const BROWSER_SEARCH_PREFIX = "https://duckduckgo.com/?q=";

/** Bare input that looks like a host/path (no spaces): treat as a URL. */
const BARE_HOST_RE = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/;

/**
 * Resolve address-bar input to the single tab's URL. Empty input
 * opens home; http(s) URLs (scheme optional for bare hosts) load
 * as-is; anything else becomes a web search for the raw text. The
 * result always passes {@link isSideviewUrlAllowed}.
 */
export function resolveBrowserUrl(raw: string): string {
	const input = raw.trim();
	if (!input) return BROWSER_HOME_URL;
	if (!/\s/.test(input)) {
		const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) ? input : `https://${input}`;
		try {
			const parsed = new URL(withScheme);
			if (
				(parsed.protocol === "http:" || parsed.protocol === "https:") &&
				(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input) || BARE_HOST_RE.test(input))
			) {
				return parsed.toString();
			}
		} catch {
			// Not a URL below; fall through to search.
		}
	}
	return BROWSER_SEARCH_PREFIX + encodeURIComponent(input);
}

/**
 * URL gate for the browser tab: only remote http(s) pages may load.
 * Rejects javascript:/data:/file:/blob: and unparseable input so a
 * bad address can never script or file-read through the panel.
 */
export function isSideviewUrlAllowed(raw: string): boolean {
	try {
		const parsed = new URL(raw.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/** Next open state for the toggle (Cmd+T and Esc share it; shortcut-only, no button). */
export function toggleSideviewOpen(open: boolean): boolean {
	return !open;
}

/**
 * Committed-URL history for the embedded fallback view (the DOM
 * browser behind the fallback strip): typing alone never
 * navigates — only a committed URL lands in the viewport, so
 * back/forward step through committed URLs only.
 */
export interface BrowserHistoryState {
	entries: string[];
	index: number;
}

/** Cap on committed entries (a single tab never needs more). */
export const BROWSER_HISTORY_MAX = 100;

/** Commit a URL: append (dropping any forward entries), cap, point at it. */
export function pushBrowserHistory(
	prev: BrowserHistoryState,
	url: string,
	max = BROWSER_HISTORY_MAX
): BrowserHistoryState {
	const entries = prev.entries.slice(0, prev.index + 1);
	const last = entries[entries.length - 1];
	// Re-committing the current page (e.g. a reload via Enter)
	// must not fork a duplicate history entry.
	if (last !== url) entries.push(url);
	const capped = entries.slice(-Math.max(1, max));
	return { entries: capped, index: capped.length - 1 };
}

/** Step back (-1) or forward (+1); clamps at both ends, never throws. */
export function stepBrowserHistory(
	prev: BrowserHistoryState,
	delta: -1 | 1
): BrowserHistoryState {
	if (prev.entries.length === 0) return { entries: [], index: -1 };
	const index = Math.min(
		prev.entries.length - 1,
		Math.max(0, prev.index + delta)
	);
	return { entries: prev.entries, index };
}

/**
 * Clamp a dragged panel width into the memorized range (whole px).
 * Non-numbers reset to the dock default via the settings loader —
 * this only clamps real input.
 */
export function clampSideviewWidth(px: number): number {
	return Math.min(SIDEVIEW_WIDTH_MAX, Math.max(SIDEVIEW_WIDTH_MIN, Math.round(px)));
}

export interface SideviewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SideviewLayout {
	main: SideviewBounds;
	side: SideviewBounds;
	/** True when the panel overlays (small viewport) instead of splitting. */
	overlay: boolean;
}

/**
 * Dock geometry in logical px (= CSS px). Wide windows split: the
 * main webview keeps the left, the panel docks right at
 * `SIDE_VIEW_DOCK_WIDTH`. Narrow windows overlay full-viewport so the
 * main view is never squeezed to zero. Never emits negative sizes.
 */
export function sideviewLayout(
	viewportWidth: number,
	viewportHeight: number,
	dockWidth = SIDE_VIEW_DOCK_WIDTH
): SideviewLayout {
	const width = Math.max(0, Math.floor(viewportWidth));
	const height = Math.max(0, Math.floor(viewportHeight));
	if (width < SIDE_VIEW_OVERLAY_BELOW) {
		const full: SideviewBounds = { x: 0, y: 0, width, height };
		return { main: full, side: { ...full }, overlay: true };
	}
	const sideWidth = Math.min(dockWidth, Math.max(280, width - 320));
	const mainWidth = Math.max(0, width - sideWidth);
	return {
		main: { x: 0, y: 0, width: mainWidth, height },
		side: { x: mainWidth, y: 0, width: sideWidth, height },
		overlay: false
	};
}

/**
 * Narrow handle to the single browser tab (shell-only; the dynamic
 * imports below carry the real types, so no casts are needed).
 */
type SideviewHandle = Pick<Webview, "close" | "hide" | "setPosition" | "setSize" | "show">;

/** Cached handle to the single browser tab (null until created). */
let sideviewRef: SideviewHandle | null = null;

async function bridge(): Promise<{
	Webview: typeof Webview;
	getCurrentWebview: () => SideviewHandle;
	getCurrentWindow: () => Webview["window"];
	LogicalPosition: typeof LogicalPosition;
	LogicalSize: typeof LogicalSize;
} | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		const webview = await import("@tauri-apps/api/webview");
		const windowApi = await import("@tauri-apps/api/window");
		const dpi = await import("@tauri-apps/api/dpi");
		return {
			Webview: webview.Webview,
			getCurrentWebview: webview.getCurrentWebview,
			getCurrentWindow: windowApi.getCurrentWindow,
			LogicalPosition: dpi.LogicalPosition,
			LogicalSize: dpi.LogicalSize
		};
	} catch {
		return null;
	}
}

/**
 * Open (or reveal) the single browser tab and dock it beside the
 * main webview. False outside the shell or when the shell refuses —
 * callers fall back to the DOM strip. Never throws.
 */
export async function openSideview(url: string, layout: SideviewLayout): Promise<boolean> {
	const api = await bridge();
	if (!api || !isSideviewUrlAllowed(url)) return false;
	try {
		const existing = sideviewRef ?? (await api.Webview.getByLabel(SIDE_VIEW_LABEL));
		if (existing) {
			sideviewRef = existing;
			await existing.setPosition(new api.LogicalPosition(layout.side.x, layout.side.y));
			await existing.setSize(new api.LogicalSize(layout.side.width, layout.side.height));
			await existing.show();
		} else {
			sideviewRef = new api.Webview(api.getCurrentWindow(), SIDE_VIEW_LABEL, {
				url,
				x: layout.side.x,
				y: layout.side.y,
				width: layout.side.width,
				height: layout.side.height
			});
		}
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(layout.main.x, layout.main.y));
		await main.setSize(new api.LogicalSize(layout.main.width, layout.main.height));
		return true;
	} catch {
		return false;
	}
}

/**
 * Address-bar go: the JS Webview API exposes no navigate, so the
 * single tab is recreated at the new URL (still exactly one tab).
 * False when the shell refuses; never throws.
 */
export async function navigateSideview(url: string, layout: SideviewLayout): Promise<boolean> {
	const api = await bridge();
	if (!api || !isSideviewUrlAllowed(url)) return false;
	try {
		const existing = sideviewRef ?? (await api.Webview.getByLabel(SIDE_VIEW_LABEL));
		if (existing) {
			try {
				await existing.close();
			} catch {
				// Already gone; recreate below.
			}
		}
		sideviewRef = new api.Webview(api.getCurrentWindow(), SIDE_VIEW_LABEL, {
			url,
			x: layout.side.x,
			y: layout.side.y,
			width: layout.side.width,
			height: layout.side.height
		});
		return true;
	} catch {
		sideviewRef = null;
		return false;
	}
}

/** Re-dock both webviews after a window resize. Never throws. */
export async function layoutSideviewViews(layout: SideviewLayout): Promise<void> {
	const api = await bridge();
	if (!api) return;
	try {
		if (sideviewRef) {
			await sideviewRef.setPosition(new api.LogicalPosition(layout.side.x, layout.side.y));
			await sideviewRef.setSize(new api.LogicalSize(layout.side.width, layout.side.height));
		}
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(layout.main.x, layout.main.y));
		await main.setSize(new api.LogicalSize(layout.main.width, layout.main.height));
	} catch {
		// Transient mid-resize failure: the next resize re-applies.
	}
}

/**
 * Hide the tab and restore the main webview to full-window. The tab
 * keeps its page (reopen is instant). Never throws.
 */
export async function hideSideview(fullWidth: number, fullHeight: number): Promise<void> {
	const api = await bridge();
	if (!api) return;
	try {
		if (sideviewRef) await sideviewRef.hide();
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(0, 0));
		await main.setSize(new api.LogicalSize(Math.max(0, fullWidth), Math.max(0, fullHeight)));
	} catch {
		// Best effort; reopen re-applies the dock.
	}
}

/**
 * Panel UI state: the open flag, address-bar text, shell-refusal
 * error, hosted/fallback flags, and edge-drag state live in one plain
 * object (never a class in `$state`). Shell orchestration above reads
 * and transitions it; viewport caches stay in the component.
 */
export interface SideviewDrag {
	startX: number;
	startW: number;
}

export interface SideviewState {
	open: boolean;
	address: string;
	error: string | null;
	hosted: boolean;
	fallback: boolean;
	drag: SideviewDrag | null;
}

/** Closed panel with cleared address, error, flags, and drag. */
export function emptySideview(): SideviewState {
	return { open: false, address: "", error: null, hosted: false, fallback: false, drag: null };
}

/**
 * Edge-dragged width from the grab point: moving left of it widens the
 * panel. The body clamps the result into settings.
 */
export function draggedWidth(drag: SideviewDrag, clientX: number): number {
	return drag.startW + (drag.startX - clientX);
}

