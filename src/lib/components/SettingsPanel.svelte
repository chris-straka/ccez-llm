<script lang="ts">
	import { licensesView } from "$lib/overlays.svelte";
	import { activeProviderSettings, type AppSettings } from "$lib/settings";
	import { getProviderDef } from "$lib/providers/registry";
	import type { VoiceLangFollow } from "$lib/voiceTiers";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { onMount } from "svelte";
	import ProviderPanel from "./settings/ProviderPanel.svelte";
	import DefaultsPanel from "./settings/DefaultsPanel.svelte";
	import AppearancePanel from "./settings/AppearancePanel.svelte";
	import ReadingPanel from "./settings/ReadingPanel.svelte";
	import SettingsSample from "./settings/SettingsSample.svelte";
	import VoiceSection from "./settings/VoiceSection.svelte";
	import LayoutPanel from "./settings/LayoutPanel.svelte";
	import UpdatesPanel from "./settings/UpdatesPanel.svelte";
	import "./settings/panels.css";

	interface Props {
		settings: AppSettings;
		/** Drawer open: an opening with no usable key lands on Model. */
		open?: boolean;
		onClose: () => void;
		/** Field commits (key paste/blur) persist through the page. */
		onCommit: () => void;
		/** Opens the shortcuts modal (owned by the page). */
		onShortcuts: () => void;
		/** Game-line overlay toggle (page opens/closes the window). */
		onGameLineToggle: () => void;
		/** Phone UI: hover doesn't exist, so the hover toggles read as a note. */
		androidUI?: boolean;
		/** Follow-chat voice target (page pill state); omitted in
		unit renders, where the voice panel falls back. */
		followVoice?: VoiceLangFollow | null;
		/** Double-tap the settings top: expand the window like the main
		top bar (the page owns the shell zoom). */
		onExpand?: (event: MouseEvent) => void;
		/** Desktop window: the groups list down the left and the live
		sample pinned over the scroll. */
		windowed?: boolean;
		/** Update results ride the page toast (auto-dismiss, no layout
		shift) instead of an inline popup. Falls back to inline text
		when the page passes none. */
		onToast?: (message: string) => void;
	}

	let {
		settings = $bindable(),
		open = false,
		onClose,
		onCommit,
		onShortcuts,
		onGameLineToggle,
		androidUI = false,
		followVoice = null,
		onToast,
		onExpand,
		windowed = false
	}: Props = $props();
	let sampleEl: HTMLElement | undefined = $state();
	/** What covers the top of the scroller: the pinned sample in the
	window, the jump bar on the sheet. */
	const coverHeight = (): number =>
		(windowed ? sampleEl?.offsetHeight : navEl?.offsetHeight) ?? 0;
	const buildStamp = import.meta.env.VITE_BUILD_STAMP ?? "release";
	const appVersion = import.meta.env.VITE_APP_VERSION ?? "";
	const showStamp = !import.meta.env.DEV;
	onMount(() => {
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
		return () => {
			document.removeEventListener("click", keepSelectionWithoutToggle, true);
		};
	});
	/** Section jump bar: every group stays in one scroll (search by
	eye still works), the bar jumps between them and marks where
	you are. */
	const SECTIONS = [
		["reading", "Reading"],
		["voice", "Voice"],
		["layout", "Layout"],
		["look", "Look"],
		["chat", "Chat"],
		["model", "Model"]
	] as const;
	type SectionId = (typeof SECTIONS)[number][0];
	let navEl: HTMLElement | undefined = $state();
	let current = $state<SectionId>("reading");
	function scroller(): HTMLElement | null {
		return navEl?.closest<HTMLElement>(".settings-panel") ?? null;
	}
	function jump(id: SectionId, instant = false): void {
		const target = document.getElementById(`settings-${id}`);
		const box = scroller();
		if (!target || !box || !navEl) return;
		current = id;
		const top =
			target.getBoundingClientRect().top -
			box.getBoundingClientRect().top +
			box.scrollTop -
			coverHeight();
		const reduce = window.matchMedia?.(
			"(prefers-reduced-motion: reduce)"
		).matches;
		box.scrollTo({ top, behavior: reduce || instant ? "auto" : "smooth" });
	}
	/** Nothing sends without a key, so an opening that lacks one
	starts on the key field instead of Reading. */
	let wasOpen = false;
	$effect(() => {
		const opening = open && !wasOpen;
		wasOpen = open;
		if (!opening) return;
		const def = getProviderDef(
			settings.activeProviderId,
			settings.customProviders
		);
		if (!activeProviderSettings(settings).apiKey.trim() && !def.publicModels)
			jump("model", true);
	});
	$effect(() => {
		const box = scroller();
		if (!box || !navEl) return;
		const nav = navEl;
		const spy = (): void => {
			const line = windowed
				? box.getBoundingClientRect().top + coverHeight() + 12
				: nav.getBoundingClientRect().bottom + 12;
			let seen: SectionId = SECTIONS[0][0];
			for (const [id] of SECTIONS) {
				const el = document.getElementById(`settings-${id}`);
				if (el && el.getBoundingClientRect().top <= line) seen = id;
			}
			// Scrolled to the end: the last group wins even if short.
			if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2)
				seen = SECTIONS[SECTIONS.length - 1]![0];
			current = seen;
		};
		box.addEventListener("scroll", spy, { passive: true });
		return () => box.removeEventListener("scroll", spy);
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
></div>
<nav class="settings-nav" bind:this={navEl} aria-label="Settings sections">
	{#if windowed}
		<button
			type="button"
			class="settings-close"
			aria-label="Close settings"
			onclick={onClose}
			><svg viewBox="0 0 16 16" aria-hidden="true"
				><path d="M4 4l8 8M12 4l-8 8" /></svg
			></button
		>
	{/if}
	{#each SECTIONS as [id, label] (id)}
		<button
			type="button"
			class:current={current === id}
			aria-current={current === id ? "true" : undefined}
			onclick={() => jump(id)}>{label}</button
		>
	{/each}
</nav>
{#if windowed}
	<!-- The live sample stays in view while any group scrolls under
	it: every change shows at once, even with the chat covered. -->
	<div class="settings-sample" bind:this={sampleEl}>
		<SettingsSample {settings} />
	</div>
{/if}
<ReadingPanel bind:settings sample={!windowed} />
<VoiceSection bind:settings {androidUI} {followVoice} />
<LayoutPanel bind:settings {androidUI} />
<AppearancePanel bind:settings />
<DefaultsPanel bind:settings {androidUI} gameLineToggle={onGameLineToggle} />
<ProviderPanel bind:settings {onCommit} />
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
	<section aria-labelledby="licenses-heading">
		<h2 id="licenses-heading">Licenses</h2>
		<button type="button" onclick={() => (licensesView.open = true)}>
			Licenses
		</button>
	</section>
</div>
{#if showStamp}
	<p class="build-stamp">
		{appVersion
			? `v${appVersion} · build ${buildStamp}`
			: `build ${buildStamp}`}
	</p>
{/if}
