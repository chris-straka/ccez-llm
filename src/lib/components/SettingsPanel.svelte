<script lang="ts">
	import type { AppSettings } from "$lib/settings";
	import { hydrateSecrets, tauriBackendAvailable } from "$lib/secrets";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { onMount } from "svelte";
	import ProviderPanel from "./settings/ProviderPanel.svelte";
	import DefaultsPanel from "./settings/DefaultsPanel.svelte";
	import AppearancePanel from "./settings/AppearancePanel.svelte";
	import UpdatesPanel from "./settings/UpdatesPanel.svelte";
	import "./settings/panels.css";

	interface Props {
		settings: AppSettings;
		onClose: () => void;
		/** Field commits (key paste/blur) persist through the page. */
		onCommit: () => void;
		/** Opens the shortcuts modal (owned by the page). */
		onShortcuts: () => void;
		/** Active-chat token tally shown right of the heading. */
		tokensLabel?: string | null;
		/** Tooltip for the tally (exact total). */
		tokensTitle?: string | null;
		/** Phone UI: hover doesn't exist, so the hover toggles read as a note. */
		androidUI?: boolean;
		/** Double-tap the settings top: expand the window like the main
		top bar (the page owns the shell zoom). */
		onExpand?: (event: MouseEvent) => void;
		/** Update results ride the page toast (auto-dismiss, no layout
		shift) instead of an inline popup. Falls back to inline text
		when the page passes none. */
		onToast?: (message: string) => void;
	}

	let {
		settings,
		onClose,
		onCommit,
		onShortcuts,
		tokensLabel = null,
		tokensTitle = null,
		androidUI = false,
		onToast,
		onExpand
	}: Props = $props();
	const buildStamp = import.meta.env.VITE_BUILD_STAMP ?? "release";
	const appVersion = import.meta.env.VITE_APP_VERSION ?? "";
	const showStamp = !import.meta.env.DEV;
	onMount(() => {
		// Pull Keychain keys into memory (Tauri shell); no-op elsewhere.
		// hydrateSecrets mutates the shared proxy, which is already reactive.
		void hydrateSecrets(settings);
		// Browser voice-install guidance (no shell, so no inventory API
		// and no Rust opener): the OS-specific path below. Browsers
		// cannot install voices themselves.
		// Checkbox labels toggle on click — except when the click ends a
		// text selection: highlighting label text must not flip the box
		// (a plain click still toggles, including clicks straight on the
		// box itself, which never extend a selection). A vanilla capture
		// listener, so no per-label Svelte handler is needed.
		const keepSelectionWithoutToggle = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (!target.closest(".settings-panel label.check")) return;
			const selection = window.getSelection();
			if (selection && !selection.isCollapsed) event.preventDefault();
		};
		document.addEventListener("click", keepSelectionWithoutToggle, true);
		// Slider rows: the reset button is the row label's first
		// labelable descendant, so clicking the label text or row
		// would forward-activate the button and reset by accident.
		// Cancel that forwarded activation unless the click landed on
		// the button or slider itself (same capture pattern as above).
		const guardSliderLabel = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (!target.closest(".settings-panel label.slider-row")) return;
			if (target.closest("button, input")) return;
			event.preventDefault();
		};
		document.addEventListener("click", guardSliderLabel, true);
		return () => {
			document.removeEventListener("click", keepSelectionWithoutToggle, true);
			document.removeEventListener("click", guardSliderLabel, true);
		};
	});
	let headDown: { x: number; y: number } | null = null;
	function dragHead(event: MouseEvent): void {
		if (event.button !== 0) return;
		headDown = { x: event.screenX, y: event.screenY };
		if (!tauriBackendAvailable()) return;
		try {
			getCurrentWindow()
				.startDragging()
				.catch((error: unknown) => {
					console.warn(
						"Window drag failed:",
						error instanceof Error ? error.message : String(error)
					);
				});
		} catch (error) {
			console.warn(
				"Window drag failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}
	let headCloseTimer: ReturnType<typeof setTimeout> | null = null;
	function closeFromHead(event: MouseEvent): void {
		const down = headDown;
		headDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5)
			return;
		// Single click closes on a short fuse: a double-tap cancels the
		// close and expands instead (same gesture split the main top bar
		// uses between click-drag and double-click zoom).
		if (headCloseTimer) clearTimeout(headCloseTimer);
		headCloseTimer = setTimeout(() => {
			headCloseTimer = null;
			onClose();
		}, 220);
	}
	function expandFromHead(event: MouseEvent): void {
		if (headCloseTimer) {
			clearTimeout(headCloseTimer);
			headCloseTimer = null;
		}
		onExpand?.(event);
	}
</script>

<div
	class="panel-head"
	data-tauri-drag-region
	role="button"
	tabindex="0"
	aria-label="Close settings"
	title="Close settings"
	onmousedown={dragHead}
	onclick={closeFromHead}
	ondblclick={expandFromHead}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClose();
		}
	}}
>
	<h1>Settings</h1>
	{#if tokensLabel}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span
			class="head-tokens"
			title={tokensTitle}
			onclick={(event) => event.stopPropagation()}
		>
			{tokensLabel}
		</span>
	{/if}
</div>
<ProviderPanel {settings} {onCommit} />
<DefaultsPanel {settings} {androidUI} />
<AppearancePanel {settings} />
<div class="keys-updates">
	<section aria-labelledby="keys-heading">
		<h2 id="keys-heading">
			{androidUI ? "Touch gestures" : "Keyboard shortcuts"}
		</h2>
		<button type="button" onclick={onShortcuts}>
			{androidUI ? "Show all gestures" : "Shortcuts"}
		</button>
	</section>
	<UpdatesPanel {androidUI} {onToast} />
</div>
{#if showStamp}
	<p class="build-stamp">
		{appVersion
			? `v${appVersion} · build ${buildStamp}`
			: `build ${buildStamp}`}
	</p>
{/if}
