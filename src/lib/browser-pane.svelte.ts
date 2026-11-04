/**
 * The browser pane's state and its native pages (docs/design/browser-pane.md).
 * Each tab is a native child webview (src-tauri/src/browser.rs) laid over
 * the box the pane's HTML leaves for it. Native views draw above the
 * app's HTML, so while anything of the app's sits over the page
 * (`covered`) a still snapshot of it stands in and the page hides.
 * Desktop shell only: `available` is false everywhere else.
 */

import {
	BROWSER_KEY,
	PANE_SHARE_DEFAULT,
	afterClose,
	clampShare,
	moveTab,
	newTab,
	readKept,
	stepTab,
	type BrowserTab
} from "./browser";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface BrowserPaneDeps {
	/** The desktop shell (not phones, not the web build). */
	available: () => boolean;
	/** The app shows dark: a new page's ground before it paints. */
	dark: () => boolean;
	/** A short note for the user (a finished download). */
	note: (text: string) => void;
}

/** How often the active page is asked where it is (its URL follows single-page sites). */
const POLL_MS = 600;
/** A load still going after this long, with the engine idle, has failed. */
const LOAD_GIVE_UP_MS = 15_000;

let seq = 0;
const tabId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

export class BrowserPane {
	open = $state(false);
	/** The pane takes the whole window (the chat hidden). */
	expanded = $state(false);
	/** The pane's share of the room beside the chat list. */
	share = $state(PANE_SHARE_DEFAULT);
	tabs = $state<BrowserTab[]>([]);
	active = $state<string | null>(null);
	/** Something of the app's is over the page: its snapshot stands in. */
	covered = $state(false);
	/** The divider is moving: the snapshot stands in so the page never tears. */
	resizing = $state(false);
	/** The active page's snapshot (an object URL), while it stands in. */
	still = $state<string | null>(null);
	/** The page has the keyboard (a click in it), not the app. */
	focused = $state(false);
	/** Asks the address bar to take the keyboard (⌘L, a new tab). */
	locate = $state(0);
	/** Asks for the find bar (⌘F while the page has the keyboard). */
	finding = $state(0);

	private invoke: Invoke | null = null;
	private box: Box | null = null;
	/** Tabs whose native page exists, and whether each shows now (bookkeeping, never drawn). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private made = new Map<string, boolean>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private zooms = new Map<string, number>();
	private poll: ReturnType<typeof setInterval> | null = null;
	private placing = 0;
	/** When each tab's load began: one that never ends fails after a while. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private since = new Map<string, number>();
	private wantCovered = false;
	/** Open when the app was last closed: reopened by start(), once the shell is known. */
	private wasOpen = false;

	constructor(private deps: BrowserPaneDeps) {
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(BROWSER_KEY);
		} catch {
			// Storage blocked: start fresh.
		}
		const kept = readKept(raw);
		this.tabs = kept.tabs.map((t) => ({
			...newTab(t.id, t.url),
			title: t.title,
			icon: t.icon
		}));
		this.active = kept.active;
		this.share = kept.share;
		this.expanded = kept.expanded;
		this.wasOpen = kept.open;
	}

	get available(): boolean {
		return this.deps.available();
	}

	get tab(): BrowserTab | null {
		return this.tabs.find((t) => t.id === this.active) ?? null;
	}

	/** Hooks up the shell's page events; call once on mount. */
	async start(): Promise<() => void> {
		if (!this.available) return () => {};
		const [{ invoke }, { listen }] = await Promise.all([
			import("@tauri-apps/api/core"),
			import("@tauri-apps/api/event")
		]);
		this.invoke = invoke;
		const stops = await Promise.all([
			listen<{ id: string; url: string; done: boolean }>(
				"browser-load",
				({ payload }) => {
					this.patch(payload.id, {
						url: payload.url,
						// A blank page never spins.
						loading: !payload.done && payload.url !== "about:blank",
						failed: false
					});
					if (payload.done) {
						void this.refresh(payload.id);
						if (payload.id === this.active)
							setTimeout(() => void this.snap(), 400);
					}
				}
			),
			listen<{ id: string; title: string }>("browser-title", ({ payload }) => {
				this.patch(payload.id, { title: payload.title });
			}),
			listen<{ id: string; url: string }>("browser-new-tab", ({ payload }) => {
				this.newTab(payload.url, { after: payload.id });
			}),
			listen<{ id: string; name: string; ok: boolean }>(
				"browser-download",
				({ payload }) => {
					this.deps.note(
						payload.ok
							? `Downloaded ${payload.name || "the file"}`
							: "Download failed"
					);
				}
			)
		]);
		this.open = this.wasOpen;
		this.poll = setInterval(() => {
			if (this.open && this.active && !this.covered && !document.hidden)
				void this.refresh(this.active);
		}, POLL_MS);
		this.place();
		return () => {
			for (const stop of stops) stop();
			if (this.poll) clearInterval(this.poll);
		};
	}

	// ── Opening, closing ────────────────────────────────────────────

	toggle(): void {
		if (this.open) this.close();
		else this.show();
	}

	/** Opens the pane: its tabs as they were, else a new tab ready for an address. */
	show(url?: string): void {
		if (!this.available) return;
		this.open = true;
		if (url) this.newTab(url);
		else if (!this.tabs.length) this.newTab();
		this.persist();
		this.place();
	}

	/** Closes the pane; its tabs stay for next time. */
	close(): void {
		this.open = false;
		this.focused = false;
		this.persist();
		this.place();
	}

	setExpanded(on: boolean): void {
		this.expanded = on;
		this.persist();
	}

	setShare(share: number): void {
		this.share = clampShare(share);
		this.persist();
	}

	// ── Tabs ────────────────────────────────────────────────────────

	/** A new tab (after `after`, else at the end), active; blank ones ask for an address. */
	newTab(
		url = "about:blank",
		opts: { after?: string | undefined; background?: boolean } = {}
	): string {
		const tab = newTab(tabId(), url);
		const at = opts.after
			? this.tabs.findIndex((t) => t.id === opts.after)
			: -1;
		const tabs = [...this.tabs];
		tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
		this.tabs = tabs;
		if (!opts.background) this.activate(tab.id);
		if (!this.open) this.open = true;
		if (url === "about:blank") this.locate++;
		this.persist();
		this.place();
		return tab.id;
	}

	activate(id: string): void {
		if (!this.tabs.some((t) => t.id === id)) return;
		this.active = id;
		this.release();
		this.persist();
		this.place();
	}

	closeTab(id = this.active): void {
		if (!id) return;
		const next = afterClose(this.tabs, id);
		this.tabs = this.tabs.filter((t) => t.id !== id);
		if (this.made.has(id)) {
			this.made.delete(id);
			void this.call("browser_close", { id });
		}
		this.zooms.delete(id);
		if (this.active === id) this.active = next;
		if (!this.tabs.length) this.close();
		this.release();
		this.persist();
		this.place();
	}

	step(by: number): void {
		const next = stepTab(this.tabs, this.active, by);
		if (next) this.activate(next);
	}

	move(id: string, to: number): void {
		this.tabs = moveTab(this.tabs, id, to);
		this.persist();
	}

	// ── The page ────────────────────────────────────────────────────

	go(url: string): void {
		const tab = this.tab;
		if (!tab) {
			this.newTab(url);
			return;
		}
		this.patch(tab.id, { url, loading: url !== "about:blank", failed: false });
		if (this.made.has(tab.id))
			void this.call("browser_navigate", { id: tab.id, url });
		else this.place();
		this.persist();
	}

	back(): void {
		if (this.active)
			void this.call("browser_go", { id: this.active, to: "back" });
	}

	forward(): void {
		if (this.active)
			void this.call("browser_go", { id: this.active, to: "forward" });
	}

	reload(): void {
		const tab = this.tab;
		if (!tab) return;
		void this.call("browser_go", {
			id: tab.id,
			to: tab.loading ? "stop" : "reload"
		});
	}

	/** ⌘= / ⌘- / ⌘0 while the page has the keyboard: the page's zoom, not the app's text. */
	zoom(by: number | null): void {
		const id = this.active;
		if (!id) return;
		const now = this.zooms.get(id) ?? 1;
		const next =
			by === null
				? 1
				: Math.round(Math.min(3, Math.max(0.5, now + by)) * 100) / 100;
		this.zooms.set(id, next);
		void this.call("browser_zoom", { id, factor: next });
	}

	/** Find `text` in the page: whether it's there. */
	async find(text: string, back = false): Promise<boolean> {
		if (!this.active || !text) return false;
		return (
			(await this.call<boolean>("browser_find", {
				id: this.active,
				text,
				back
			})) ?? false
		);
	}

	/** Gives the page the keyboard. */
	focusPage(): void {
		if (this.active && this.made.has(this.active))
			void this.call("browser_focus", { id: this.active });
	}

	// ── Where the page sits ─────────────────────────────────────────

	/** The box the pane's HTML leaves for the page, in window coordinates (null: none shows). */
	setBox(rect: DOMRect | null): void {
		this.box =
			rect && rect.width > 0 && rect.height > 0
				? { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
				: null;
		this.place();
	}

	/**
	 * Something of the app's goes over the page (true) or leaves (false).
	 * The page's snapshot is taken first, so what stands in is what was there.
	 */
	async setCovered(on: boolean): Promise<void> {
		this.wantCovered = on;
		if (on === this.covered) return;
		if (on) {
			await this.snap();
			// Gone again while the snapshot was taken.
			if (!this.wantCovered) return;
		}
		this.covered = on;
		this.place();
		if (!on) this.release();
	}

	/** The divider starts (true) or stops (false) moving. */
	async setResizing(on: boolean): Promise<void> {
		if (on) await this.snap();
		this.resizing = on;
		this.place();
		if (!on) setTimeout(() => this.release(), 120);
	}

	/** A fresh snapshot of the active page, kept to stand in when it hides. */
	async snap(): Promise<void> {
		const id = this.active;
		if (!id || !this.made.get(id)) return;
		const bytes = await this.call<ArrayBuffer>("browser_snapshot", { id });
		if (!bytes || id !== this.active) return;
		const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
		if (this.still) URL.revokeObjectURL(this.still);
		this.still = url;
	}

	/** The page shows itself again: its stand-in goes. */
	private release(): void {
		if (this.covered || this.resizing) return;
		if (this.still) URL.revokeObjectURL(this.still);
		this.still = null;
	}

	/** Puts every made page where it belongs now, once a frame. */
	private place(): void {
		if (this.placing) return;
		this.placing = requestAnimationFrame(() => {
			this.placing = 0;
			void this.placeNow();
		});
	}

	private async placeNow(): Promise<void> {
		if (!this.invoke) return;
		const box = this.box;
		// A page that failed hides: the pane says so in its place.
		const showing =
			this.open &&
			!this.covered &&
			!this.resizing &&
			box !== null &&
			!this.tab?.failed;
		for (const [id, visible] of this.made) {
			const want = showing && id === this.active;
			if (want !== visible) {
				this.made.set(id, want);
				void this.call("browser_visible", { id, visible: want });
			}
		}
		const tab = this.tab;
		if (!showing || !tab || !box) return;
		if (!this.made.has(tab.id)) {
			this.made.set(tab.id, true);
			if (tab.url !== "about:blank") this.patch(tab.id, { loading: true });
			await this.call("browser_open", {
				id: tab.id,
				url: tab.url,
				...box,
				dark: this.deps.dark()
			});
		} else {
			void this.call("browser_bounds", { id: tab.id, ...box });
		}
	}

	/** Asks the page where it is; the tab follows (single-page sites change their URL quietly). */
	private async refresh(id: string): Promise<void> {
		if (!this.made.get(id)) return;
		const s = await this.call<{
			url: string;
			title: string;
			back: boolean | null;
			forward: boolean | null;
			icon: string;
			loading: boolean;
			bg?: string;
		}>("browser_state", { id });
		const was = this.tabs.find((t) => t.id === id);
		// A failed load's page answers nothing at all (the engine drops
		// the script): still loading past the limit with no answer, it failed.
		if (!s || typeof s.url !== "string") {
			if (!was?.loading) return;
			const began = this.since.get(id) ?? Date.now();
			this.since.set(id, began);
			if (Date.now() - began > LOAD_GIVE_UP_MS) {
				this.since.delete(id);
				this.patch(id, { loading: false, failed: true });
				this.place();
			}
			return;
		}
		// A load that never finished (no network, a name that doesn't
		// resolve: the engine stays on the page before) fails after a
		// while instead of spinning for good.
		if (was?.loading) {
			const began = this.since.get(id) ?? Date.now();
			this.since.set(id, began);
			if (!s.loading && Date.now() - began > LOAD_GIVE_UP_MS) {
				this.since.delete(id);
				this.patch(id, {
					loading: false,
					failed: s.url === "about:blank" || s.url !== was.url
				});
				this.place();
				return;
			}
		} else this.since.delete(id);
		this.patch(id, {
			url: s.url,
			title: s.title || was?.title || "",
			icon: s.icon,
			// Engines without the Navigation API: both always on.
			back: s.back ?? true,
			forward: s.forward ?? true,
			bg: typeof s.bg === "string" && /^rgba?\(/.test(s.bg) ? s.bg : ""
		});
		if (was && was.url !== s.url) this.persist();
	}

	private patch(id: string, change: Partial<BrowserTab>): void {
		this.tabs = this.tabs.map((t) => (t.id === id ? { ...t, ...change } : t));
	}

	private async call<T>(
		cmd: string,
		args: Record<string, unknown>
	): Promise<T | null> {
		if (!this.invoke) return null;
		try {
			return await this.invoke<T>(cmd, args);
		} catch (error) {
			console.warn(`browser: ${cmd}`, error);
			return null;
		}
	}

	private persist(): void {
		try {
			localStorage.setItem(
				BROWSER_KEY,
				JSON.stringify({
					open: this.open,
					expanded: this.expanded,
					share: this.share,
					active: this.active,
					tabs: this.tabs.map((t) => ({
						id: t.id,
						url: t.url,
						title: t.title,
						icon: t.icon
					}))
				})
			);
		} catch {
			// Storage full or blocked: it's only the tabs for next time.
		}
	}
}
