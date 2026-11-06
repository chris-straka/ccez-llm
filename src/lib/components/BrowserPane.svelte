<!-- The browser pane beside the chat (docs/design/browser-pane.md): tabs,
the address bar and the divider are this markup; the page is a native
view laid over `.page`, which this component measures every frame and
reports to the controller. While the page hides (the divider moving,
something of the app's over it), its snapshot fills `.page`. -->
<script lang="ts">
	import { onDestroy } from "svelte";
	import type { BrowserPane } from "$lib/browser-pane.svelte";
	import {
		paneWidth,
		resolveBrowserUrl,
		shareFor,
		shownUrl,
		tabLabel
	} from "$lib/browser";

	interface Props {
		pane: BrowserPane;
		/** The window's own drag (empty tab-strip space moves the window). */
		dragWindow: (event: MouseEvent) => void;
		/** A double-click on empty strip space zooms the window, as a title bar does. */
		zoomWindow: (event: MouseEvent) => void;
		/** The traffic lights sit over the pane's top left (expanded on macOS). */
		lights: boolean;
		/** Annotate what's selected in the page, in the chat. */
		annotate: () => void;
		/** The key for it, for its hold label ("⇧⌘A"). */
		annotateKey: string;
	}

	let { pane, dragWindow, zoomWindow, lights, annotate, annotateKey }: Props =
		$props();

	let el: HTMLElement | undefined = $state();
	let pageEl: HTMLElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let strip: HTMLElement | undefined = $state();
	/** The room beside the chat list: the chat and the pane together. */
	let room = $state(0);
	/** The divider's width while it's dragged (null: from the share). */
	let dragged = $state<number | null>(null);
	let editing = $state(false);
	/** More tabs than fit: the strip scrolls, and fades at its edge to say so. */
	let more = $state(false);
	let draft = $state("");
	/** Find in page (⌘F while the page has the keyboard): in the address field's place. */
	let finding = $state(false);
	let findText = $state("");
	let findMiss = $state(false);
	let findInput: HTMLInputElement | undefined = $state();
	/** The snapshot's width at the screen's scale (it's taken in device pixels). */
	let stillWidth = $state(0);
	function stillLoaded(img: HTMLImageElement): void {
		stillWidth = img.naturalWidth / (window.devicePixelRatio || 1);
	}

	const fit = $derived(paneWidth(pane.share, room));
	// Until the room is measured it isn't "too narrow": the first frame
	// laid the pane over the whole window, and its page was made there.
	const measured = $derived(room > 0);
	const expanded = $derived(pane.expanded || (measured && fit.expanded));
	const width = $derived(expanded ? room : (dragged ?? fit.width));
	const tab = $derived(pane.tab);
	const url = $derived(tab ? shownUrl(tab.url) : null);
	const blank = $derived(!tab || tab.url === "about:blank");

	// The page's box, every frame: anything that moves it (the divider,
	// the chat list sliding, the window resizing) moves the page with it.
	let frame = 0;
	let last = "";
	function track(): void {
		frame = requestAnimationFrame(track);
		if (!el || !pageEl) return;
		// The room from the chat's left edge to the window's right: the
		// pane's own width (gone from the flow when expanded) never counts,
		// or expanding would double it and flip back every frame.
		const main = el.previousElementSibling as HTMLElement | null;
		const app = el.parentElement;
		const nextRoom = Math.round(
			(app?.getBoundingClientRect().right ?? 0) -
				(main?.getBoundingClientRect().left ?? 0)
		);
		if (nextRoom !== room) {
			room = nextRoom;
			// Laid out again at its width next frame: its box is reported then.
			return;
		}
		if (strip) {
			const over = strip.scrollWidth > strip.clientWidth + 1;
			if (over !== more) more = over;
		}
		const box = pageEl.getBoundingClientRect();
		// The screen's density too: moved to another display, the same
		// box is a different size in the engine's own pixels.
		const key = `${box.left},${box.top},${box.width},${box.height},${devicePixelRatio}`;
		if (key !== last) {
			last = key;
			pane.setBox(box);
		}
	}
	$effect(() => {
		frame = requestAnimationFrame(track);
		return () => cancelAnimationFrame(frame);
	});
	onDestroy(() => pane.setBox(null));

	// ⌘L, a new blank tab: the address bar takes the keyboard.
	$effect(() => {
		if (pane.locate === 0) return;
		requestAnimationFrame(() => {
			edit();
		});
	});

	$effect(() => {
		if (pane.finding === 0) return;
		finding = true;
		requestAnimationFrame(() => {
			findInput?.focus();
			findInput?.select();
		});
	});

	async function findNext(back = false): Promise<void> {
		findMiss = findText !== "" && !(await pane.find(findText, back));
	}

	function findKey(event: KeyboardEvent): void {
		if (event.key === "Enter") {
			event.preventDefault();
			void findNext(event.shiftKey);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			finding = false;
			findMiss = false;
			pane.focusPage();
		}
	}

	// Another tab: the address bar shows its place (a blank one asks for one).
	let shownTab: string | null = null;
	$effect(() => {
		const id = pane.active;
		if (id === shownTab) return;
		shownTab = id;
		finding = false;
		if (blank) requestAnimationFrame(() => edit());
		else if (editing) {
			editing = false;
			input?.blur();
		}
	});

	// The active tab stays in sight in a strip that scrolls.
	$effect(() => {
		const id = pane.active;
		if (!strip || !id) return;
		strip
			.querySelector<HTMLElement>(`[data-tab="${id}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	});

	function edit(): void {
		// Already being typed in (the field took the keyboard first, and
		// a new tab's own call came a frame later): what's typed stays.
		const typed = editing && draft !== "";
		if (!typed) {
			draft = tab && tab.url !== "about:blank" ? tab.url : "";
			// Set here, not only through the binding: a value typed before
			// stayed in the field after it was sent.
			if (input) input.value = draft;
		}
		editing = true;
		requestAnimationFrame(() => {
			input?.focus();
			if (!typed) input?.select();
		});
	}

	function submit(event: SubmitEvent): void {
		event.preventDefault();
		pane.go(resolveBrowserUrl(draft, pane.lang));
		editing = false;
		input?.blur();
		pane.focusPage();
	}

	function addressKey(event: KeyboardEvent): void {
		if (event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		editing = false;
		input?.blur();
		pane.focusPage();
	}

	// ── The divider ─────────────────────────────────────────────────
	let from: { x: number; width: number } | null = null;

	function dividerDown(event: PointerEvent): void {
		if (event.button !== 0 || expanded) return;
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		from = { x: event.clientX, width };
		dragged = width;
		void pane.setResizing(true);
	}

	function dividerMove(event: PointerEvent): void {
		if (!from) return;
		const want = from.width + (from.x - event.clientX);
		dragged = paneWidth(want / Math.max(1, room), room).width;
	}

	function dividerUp(): void {
		if (!from) return;
		from = null;
		if (dragged !== null) pane.setShare(shareFor(dragged, room));
		dragged = null;
		void pane.setResizing(false);
	}

	function dividerKey(event: KeyboardEvent): void {
		const by =
			event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
		if (!by) return;
		event.preventDefault();
		pane.setShare((width + by) / Math.max(1, room));
	}

	// ── Tabs: click picks, a drag reorders, the middle button closes ─
	let pressed: { id: string; x: number; moved: boolean } | null = null;

	function tabDown(event: PointerEvent, id: string): void {
		if (event.button !== 0) return;
		if ((event.target as HTMLElement).closest(".x")) return;
		pressed = { id, x: event.clientX, moved: false };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		pane.activate(id);
	}

	function tabMove(event: PointerEvent): void {
		if (!pressed || !strip) return;
		if (!pressed.moved && Math.abs(event.clientX - pressed.x) < 6) return;
		pressed.moved = true;
		const tabs = [...strip.querySelectorAll<HTMLElement>("[data-tab]")];
		const to = tabs.findIndex((t) => {
			const r = t.getBoundingClientRect();
			return event.clientX < r.left + r.width / 2;
		});
		const at = pane.tabs.findIndex((t) => t.id === pressed!.id);
		const target = to < 0 ? tabs.length - 1 : to > at ? to - 1 : to;
		if (target !== at) pane.move(pressed.id, target);
	}

	function tabUp(): void {
		pressed = null;
	}

	function stripDown(event: MouseEvent): void {
		if ((event.target as HTMLElement).closest("button, [data-tab]")) return;
		dragWindow(event);
	}

	const icons: Record<string, string> = {
		back: "M15 6l-6 6 6 6",
		forward: "M9 6l6 6-6 6",
		reload: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
		stop: "M6 6l12 12M18 6L6 18",
		plus: "M12 5v14M5 12h14",
		close: "M7 7l10 10M17 7L7 17",
		expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
		shrink: "M10 4v6H4M14 20v-6h6M4 10l7-7M20 14l-7 7",
		globe:
			"M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5M12 3.5C9.6 5.8 8.4 8.6 8.4 12s1.2 6.2 3.6 8.5",
		up: "M6 15l6-6 6 6",
		down: "M6 9l6 6 6-6",
		// A pen over a line: annotate what's selected.
		annotate: "M4 20h16M14.5 4.5l3 3L9 16H6v-3z"
	};
</script>

{#snippet icon(name: string)}
	<svg viewBox="0 0 24 24" aria-hidden="true"><path d={icons[name]} /></svg>
{/snippet}

<aside
	class="browser"
	class:expanded
	class:lights={lights && expanded}
	class:dragging={dragged !== null}
	style:width="{width}px"
	bind:this={el}
	aria-label="Browser"
>
	{#if !expanded}
		<!-- A window splitter: a focusable separator (arrows move it). -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class="divider"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the browser"
			aria-valuenow={Math.round((width / Math.max(1, room)) * 100)}
			tabindex="0"
			onpointerdown={dividerDown}
			onpointermove={dividerMove}
			onpointerup={dividerUp}
			onpointercancel={dividerUp}
			ondblclick={() => pane.setShare(0.5)}
			onkeydown={dividerKey}
		></div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="strip"
		onmousedown={stripDown}
		ondblclick={(e) =>
			!(e.target as HTMLElement).closest("button, [data-tab]") && zoomWindow(e)}
	>
		<div class="tabs" class:more role="tablist" bind:this={strip}>
			{#each pane.tabs as t (t.id)}
				<!-- svelte-ignore a11y_interactive_supports_focus -->
				<div
					class="tab"
					class:on={t.id === pane.active}
					data-tab={t.id}
					role="tab"
					aria-selected={t.id === pane.active}
					title={t.url === "about:blank" ? "New tab" : t.url}
					onpointerdown={(e) => tabDown(e, t.id)}
					onpointermove={tabMove}
					onpointerup={tabUp}
					onauxclick={(e) => {
						if (e.button !== 1) return;
						// The app's own middle-click (the shortcuts) never sees it.
						e.preventDefault();
						e.stopPropagation();
						pane.closeTab(t.id);
					}}
				>
					{#if t.loading}
						<span class="spin" aria-hidden="true"></span>
					{:else if t.icon}
						<img
							class="fav"
							src={t.icon}
							alt=""
							onerror={(e) =>
								((e.currentTarget as HTMLImageElement).style.visibility =
									"hidden")}
						/>
					{:else}
						<span class="fav none" aria-hidden="true"
							>{@render icon("globe")}</span
						>
					{/if}
					<span class="name">{tabLabel(t)}</span>
					<button
						type="button"
						class="x"
						aria-label="Close tab"
						onclick={() => pane.closeTab(t.id)}>{@render icon("close")}</button
					>
				</div>
			{/each}
		</div>
		<!-- Outside the scrolling tabs: always in reach, however many there are. -->
		<button
			type="button"
			class="plus"
			aria-label="New tab"
			onclick={() => pane.newTab()}>{@render icon("plus")}</button
		>
		<button
			type="button"
			class="tool"
			aria-label={expanded ? "Show the chat" : "Expand the browser"}
			title={expanded ? "Show the chat" : "Expand"}
			onclick={() =>
				// Too narrow for both: the chat comes back by closing the pane (its tabs stay).
				fit.expanded ? pane.close() : pane.setExpanded(!pane.expanded)}
			>{@render icon(expanded ? "shrink" : "expand")}</button
		>
		<button
			type="button"
			class="tool"
			aria-label="Close the browser"
			title="Close"
			onclick={() => pane.close()}>{@render icon("close")}</button
		>
	</div>

	<form class="address" onsubmit={submit}>
		<button
			type="button"
			class="tool"
			aria-label="Back"
			disabled={!tab?.back}
			onclick={() => pane.back()}>{@render icon("back")}</button
		>
		<button
			type="button"
			class="tool"
			aria-label="Forward"
			disabled={!tab?.forward}
			onclick={() => pane.forward()}>{@render icon("forward")}</button
		>
		<button
			type="button"
			class="tool"
			aria-label={tab?.loading ? "Stop" : "Reload"}
			disabled={blank}
			onclick={() => pane.reload()}
			>{@render icon(tab?.loading ? "stop" : "reload")}</button
		>
		{#if finding}
			<label class="url find editing">
				<input
					bind:this={findInput}
					type="search"
					spellcheck="false"
					aria-label="Find in page"
					placeholder="Find in page"
					bind:value={findText}
					oninput={() => void findNext()}
					onkeydown={findKey}
				/>
				{#if findMiss}<span class="miss">Not found</span>{/if}
			</label>
			<button
				type="button"
				class="tool"
				aria-label="Previous match"
				onclick={() => void findNext(true)}>{@render icon("up")}</button
			>
			<button
				type="button"
				class="tool"
				aria-label="Next match"
				onclick={() => void findNext()}>{@render icon("down")}</button
			>
			<button
				type="button"
				class="tool"
				aria-label="Close find"
				onclick={() => {
					finding = false;
					findMiss = false;
					pane.focusPage();
				}}>{@render icon("close")}</button
			>
		{:else}
			<label class="url" class:editing>
				{#if !editing && url && !blank}
					<span class="shown" aria-hidden="true">
						{#if url.insecure}<span class="warn">Not secure</span>{/if}
						<span class="host">{url.host}</span><span class="rest"
							>{url.rest}</span
						>
					</span>
				{/if}
				<input
					bind:this={input}
					type="text"
					spellcheck="false"
					autocomplete="off"
					aria-label="Address"
					placeholder={editing || blank ? "Search or address" : ""}
					value={editing ? draft : ""}
					oninput={(e) => (draft = e.currentTarget.value)}
					onfocus={() => !editing && edit()}
					onblur={() => (editing = false)}
					onkeydown={addressKey}
				/>
			</label>
			<button
				type="button"
				class="tool"
				aria-label="Annotate the selection"
				title="Annotate the selection ({annotateKey})"
				disabled={blank}
				onclick={annotate}>{@render icon("annotate")}</button
			>
		{/if}
		<span
			class="progress"
			class:on={!!tab?.loading && !blank}
			aria-hidden="true"
		></span>
	</form>

	<div
		class="page"
		bind:this={pageEl}
		style:background={pane.still && tab?.bg ? tab.bg : null}
	>
		{#if tab?.failed}
			<div class="failed">
				<p>Couldn't open {url?.host || "this page"}</p>
				<button
					type="button"
					class="again"
					onclick={() => tab && pane.go(tab.url)}>Try again</button
				>
			</div>
		{:else if pane.still}
			<img
				class="still"
				src={pane.still}
				alt=""
				draggable="false"
				style:width={stillWidth ? `${stillWidth}px` : null}
				onload={(e) => stillLoaded(e.currentTarget as HTMLImageElement)}
			/>
		{/if}
	</div>
</aside>

<style>
	.browser {
		position: relative;
		flex: none;
		display: flex;
		flex-direction: column;
		min-width: 0;
		height: 100%;
		background: var(--bg);
		border-left: 1px solid var(--line-soft);
	}
	.browser.expanded {
		position: fixed;
		inset: 0;
		width: auto !important;
		/* Over the title strip (35), under the app's sheets and menus (50+). */
		z-index: 45;
		border-left: none;
	}
	/* The divider: a hairline in an 8px grab area over the pane's edge. */
	.divider {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -5px;
		width: 9px;
		cursor: col-resize;
		z-index: 2;
		touch-action: none;
	}
	.divider::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: 4px;
		width: 1px;
		background: transparent;
		transition:
			background-color 0.15s ease,
			width 0.15s ease;
	}
	.divider:hover::after,
	.dragging .divider::after,
	.divider:focus-visible::after {
		left: 3px;
		width: 3px;
		background: var(--focus);
		opacity: 0.55;
	}
	.divider:focus-visible {
		outline: none;
	}
	.dragging {
		cursor: col-resize;
		user-select: none;
	}

	.strip {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 2.4rem;
		padding: 0 0.4rem 0 0.5rem;
		flex: none;
		user-select: none;
		-webkit-user-select: none;
	}
	.lights .strip {
		padding-left: 5rem;
	}
	.tabs {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 0 1 13rem;
		min-width: 5.5rem;
		height: 1.95rem;
		padding: 0 0.3rem 0 0.6rem;
		border-radius: 0.55rem 0.55rem 0 0;
		color: var(--muted);
		font-size: 0.8rem;
		cursor: default;
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}
	.tab:hover {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.tab.on {
		background: var(--panel);
		color: var(--ink);
		box-shadow: 0 0 0 1px var(--line-soft);
		clip-path: inset(-1px -1px 0 -1px);
	}
	.fav {
		width: 1rem;
		height: 1rem;
		flex: none;
		border-radius: 0.2rem;
	}
	.fav.none {
		display: grid;
		place-items: center;
		opacity: 0.6;
	}
	.fav.none svg {
		width: 0.9rem;
		height: 0.9rem;
		stroke-width: 1.6;
	}
	.tabs.more {
		mask-image: linear-gradient(to right, #000 calc(100% - 2rem), transparent);
	}
	.spin {
		width: 0.85rem;
		height: 0.85rem;
		flex: none;
		margin: 0 0.075rem;
		border-radius: 50%;
		border: 1.6px solid var(--line);
		border-top-color: var(--ink);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		/* Faded out, never cut with an ellipsis. */
		mask-image: linear-gradient(to right, #000 80%, transparent);
	}
	.x {
		flex: none;
		opacity: 0;
		transition: opacity 0.12s ease;
	}
	.tab.on .x,
	.tab:hover .x {
		opacity: 1;
	}
	button {
		display: grid;
		place-items: center;
		border: none;
		background: none;
		color: inherit;
		padding: 0;
		cursor: pointer;
		border-radius: 0.4rem;
	}
	.x,
	.plus {
		width: 1.35rem;
		height: 1.35rem;
	}
	.plus {
		align-self: center;
		margin: 0.25rem 0 0 0.2rem;
		color: var(--muted);
		flex: none;
	}
	.x:hover,
	.plus:hover,
	.tool:hover:not(:disabled) {
		background: var(--hover-wash);
		color: var(--ink);
	}
	.tool {
		width: 1.9rem;
		height: 1.9rem;
		flex: none;
		color: var(--muted);
	}
	.strip > .tool {
		align-self: center;
		margin-top: 0.3rem;
	}
	.tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
	svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.x svg {
		width: 0.8rem;
		height: 0.8rem;
	}

	.address {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.15rem;
		height: 2.6rem;
		padding: 0 0.5rem;
		flex: none;
		background: var(--panel);
		border-top: 1px solid var(--line-soft);
		border-bottom: 1px solid var(--line-soft);
	}
	.url {
		position: relative;
		flex: 1;
		min-width: 0;
		height: 1.85rem;
		margin-left: 0.3rem;
		border-radius: 0.55rem;
		background: var(--hover-wash);
		cursor: text;
		transition:
			box-shadow 0.12s ease,
			background-color 0.12s ease;
	}
	.url.editing {
		background: var(--bg);
		box-shadow: 0 0 0 1.5px var(--focus);
	}
	.url:not(.editing) input {
		/* At rest the shown URL reads instead: the field's own text never shows under it. */
		color: transparent;
		caret-color: transparent;
	}
	.url input {
		position: absolute;
		inset: 0;
		width: 100%;
		padding: 0 0.75rem;
		border: none;
		outline: none;
		background: transparent;
		color: var(--ink);
		font: inherit;
		font-size: 0.85rem;
	}
	.shown {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.75rem;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		pointer-events: none;
	}
	.host {
		color: var(--ink);
	}
	.rest {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		margin-left: -0.4rem;
	}
	.warn {
		color: #c0392b;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.find input {
		padding-right: 5.5rem;
	}
	.miss {
		position: absolute;
		right: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: #c0392b;
		font-size: 0.75rem;
		pointer-events: none;
	}
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		overflow: hidden;
		opacity: 0;
		transition: opacity 0.2s ease;
	}
	.progress.on {
		opacity: 1;
	}
	.progress::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		width: 35%;
		background: var(--focus);
		animation: sweep 1.1s ease-in-out infinite;
	}
	@keyframes sweep {
		from {
			left: -35%;
		}
		to {
			left: 100%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spin,
		.progress::after {
			animation-duration: 3s;
		}
	}

	/* The page's box: the native view lies over it; its snapshot fills it while the page hides. */
	.page {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		background: var(--bg);
	}
	.failed {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 0.9rem;
		color: var(--muted);
		font-size: 0.95rem;
	}
	.failed p {
		margin: 0;
	}
	.again {
		padding: 0.45rem 1rem;
		border-radius: 999px;
		background: var(--hover-wash);
		color: var(--ink);
		font-size: 0.85rem;
	}
	.again:hover {
		background: var(--line-soft);
	}
	.still {
		position: absolute;
		top: 0;
		left: 0;
		width: auto;
		max-width: none;
		height: auto;
		pointer-events: none;
		user-select: none;
	}
</style>
