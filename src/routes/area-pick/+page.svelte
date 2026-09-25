<!-- Set-area overlay (the ⇧⌘U chord): a transparent maximized window
on every Space, fullscreen game included (FullScreenAuxiliary — plain
maximized windows never leave the app Space). Drag to save the square
the capture chord reuses (device pixels, display scale applied);
press-release without moving takes the whole display; Esc cancels
silently. Clear drops a saved square. Outside the shell the submit
fails and a note renders instead — same three-runtime degrade as
every backend call. -->
<script lang="ts">
	import { invoke } from "@tauri-apps/api/core";
	import { onMount } from "svelte";
	import { requestAreaPhoto } from "$lib/desktop";
	import { scaleRectToDevice } from "$lib/nativeCapture";

	interface DeviceRect {
		x: number;
		y: number;
		width: number;
		height: number;
	}

	let start = $state<{ x: number; y: number } | null>(null);
	let current = $state<{ x: number; y: number } | null>(null);
	let failed = $state(false);
	/** Frozen fullscreen frame (the ⇧⌘U photo flow): the square is
	drawn on the photo, never on a live overlay fighting the game
	Space. Null renders the live transparent overlay (browser
	preview, or the photo arriving too late). */
	let photo = $state<string | null>(null);
	/** Natural photo width (device pixels): the scale divides at
	submit time, never at load — the window may still be settling
	into maximized while the data-URL image resolves instantly, and
	a stale load-time width inflates every square off screen. The
	photo is same-display fullscreen, so one uniform scale covers
	both axes. */
	let photoNaturalWidth = $state(0);

	onMount(() => {
		void requestAreaPhoto().then((dataUrl) => {
			photo = dataUrl;
		});
	});

	function onPhotoLoad(image: HTMLImageElement): void {
		// Broken frame: fall back to the live overlay rather than
		// mapping against a zero size.
		if (!image.naturalWidth) {
			photo = null;
			return;
		}
		photoNaturalWidth = image.naturalWidth;
	}

	const selecting = $derived(
		start !== null && current !== null
			? {
					x: Math.min(start.x, current.x),
					y: Math.min(start.y, current.y),
					width: Math.abs(current.x - start.x),
					height: Math.abs(current.y - start.y)
				}
			: null
	);

	async function submit(pick: {
		rect: DeviceRect | null;
		clear: boolean;
	}): Promise<void> {
		try {
			await invoke("submit_area_rect", { pick });
		} catch {
			failed = true;
		}
	}

	function currentScale(): number {
		if (photo === null || !window.innerWidth)
			return window.devicePixelRatio || 1;
		return photoNaturalWidth / window.innerWidth;
	}

	function toDevice(rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}): DeviceRect {
		return scaleRectToDevice(rect, currentScale());
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.button !== 0 || event.isPrimary === false) return;
		if ((event.target as Element | null)?.closest("button")) return;
		start = { x: event.clientX, y: event.clientY };
		current = { x: event.clientX, y: event.clientY };
	}

	function onPointerMove(event: PointerEvent): void {
		if (start === null || event.isPrimary === false) return;
		current = { x: event.clientX, y: event.clientY };
	}

	function onPointerUp(event: PointerEvent): void {
		if (start === null || event.isPrimary === false) return;
		const done = selecting;
		start = null;
		current = null;
		if (!done) return;
		// Press-release without moving takes the whole display.
		if (done.width < 5 && done.height < 5) {
			const scale = currentScale();
			void submit({
				rect: {
					x: 0,
					y: 0,
					width: Math.round(window.innerWidth * scale),
					height: Math.round(window.innerHeight * scale)
				},
				clear: false
			});
			return;
		}
		void submit({ rect: toDevice(done), clear: false });
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (event.key === "Escape") void submit({ rect: null, clear: false });
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="area-pick"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
>
	{#if photo}
		<img
			class="area-photo"
			src={photo}
			alt=""
			draggable={false}
			onload={(event) => onPhotoLoad(event.currentTarget as HTMLImageElement)}
		/>
	{/if}
	{#if selecting && (selecting.width >= 1 || selecting.height >= 1)}
		<div
			class="area-rect"
			style="left: {selecting.x}px; top: {selecting.y}px; width: {selecting.width}px; height: {selecting.height}px;"
		></div>
	{/if}
	<div class="area-hint">
		{#if failed}
			<span>Area picking needs the desktop app.</span>
		{:else}
			<span>Drag to set the square · Click for fullscreen · Esc cancels</span>
			<button
				type="button"
				onclick={() => void submit({ rect: null, clear: true })}
			>
				Clear saved area
			</button>
		{/if}
	</div>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: transparent;
	}
	.area-pick {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		cursor: crosshair;
		user-select: none;
		-webkit-user-select: none;
		touch-action: none;
	}
	.area-photo {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: fill;
		pointer-events: none;
	}
	.area-rect {
		position: absolute;
		border: 2px solid #fff;
		background: rgba(255, 255, 255, 0.08);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}
	.area-hint {
		position: absolute;
		left: 50%;
		bottom: 2rem;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.5rem 0.9rem;
		border-radius: 10px;
		background: rgba(20, 20, 22, 0.85);
		color: #fff;
		font:
			0.85rem/1.4 -apple-system,
			"Segoe UI",
			sans-serif;
		white-space: nowrap;
		cursor: default;
	}
	.area-hint button {
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 999px;
		background: none;
		color: #fff;
		font: inherit;
		font-size: 0.8rem;
		padding: 0.2rem 0.7rem;
		cursor: pointer;
	}
</style>
