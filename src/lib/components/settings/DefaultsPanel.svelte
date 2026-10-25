<script lang="ts">
	import { activeProviderSettings, type AppSettings } from "$lib/settings";
	import { thinkingFor, resolveThinkingId } from "$lib/providers/thinking";
	import { currentPlatform, micButtonsShown } from "$lib/platform";
	import { tauriBackendAvailable } from "$lib/secrets";
	import { micAvailable } from "$lib/voice";
	import DictionariesSection from "./DictionariesSection.svelte";
	import "./panels.css";

	interface Props {
		settings: AppSettings;
		androidUI: boolean;
		/** Game-line toggle (page opens/closes the window). */
		gameLineToggle: () => void;
	}

	let { settings = $bindable(), androidUI, gameLineToggle }: Props = $props();

	// Desktop rows only where the feature exists: window capture (and
	// the game line it feeds) is macOS-only, and Windows/Linux shells
	// have no dictation backend unless the webview brings one.
	const desktopOs = currentPlatform();
	const captureRows = desktopOs.isMac;
	const micRow = micButtonsShown(
		micAvailable(),
		tauriBackendAvailable(),
		desktopOs.isMac,
		false,
		false
	);
	// Packs need the native backend; the web build never downloads one.
	const dictionaries = tauriBackendAvailable();
	const active = $derived(activeProviderSettings(settings));
	/** This model's thinking dial (native knob or prompt hints); hidden
	 * when a single level exists. Recomputes from the model field, so a
	 * newer/cheaper model id picks up its own dial as soon as it is typed. */
	const thinkingSupport = $derived(
		thinkingFor(settings.activeProviderId, active.model)
	);
	const thinkingId = $derived(
		resolveThinkingId(
			thinkingSupport,
			settings.thinking[settings.activeProviderId]
		)
	);
	function setThinking(id: string) {
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: id
		};
	}
</script>

<section id="settings-chat" aria-labelledby="defaults-heading">
	<h2 id="defaults-heading">Chat</h2>
	<label>
		System prompt
		<textarea rows="2" bind:value={settings.systemPrompt} spellcheck="false"
		></textarea>
	</label>
	{#if thinkingSupport.options.length > 1}
		<fieldset>
			<legend>Thinking level</legend>
			<div
				class="segmented thinking"
				role="radiogroup"
				aria-label="Thinking level"
			>
				{#each thinkingSupport.options as option (option.id)}
					<button
						type="button"
						role="radio"
						aria-checked={thinkingId === option.id}
						class:selected={thinkingId === option.id}
						onclick={() => setThinking(option.id)}>{option.label}</button
					>
				{/each}
			</div>
		</fieldset>
	{/if}
	<!-- Older messages fold as newer ones arrive; a fold opened by
	hand stays open. Both off by default. -->
	<fieldset class="hover-row">
		<legend>Fold older messages automatically</legend>
		<label class="check">
			<input type="checkbox" bind:checked={settings.autoFoldOwn} />
			<span>My messages</span>
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.autoFoldAssistant} />
			<span>AI replies</span>
		</label>
	</fieldset>
	{#if androidUI}
		<fieldset>
			<legend>Messages</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hideButtons} />
				<span>Show message buttons only when tapped</span>
			</label>
			<label class="check">
				<input
					type="checkbox"
					bind:checked={settings.annotationAnswersInPassageLang}
				/>
				<span>Answer annotations in the passage's language</span>
			</label>
		</fieldset>
		{#if dictionaries}
			<DictionariesSection bind:settings />
		{/if}
		<!-- On/off features under one "Enable" legend, two columns where
		the panel has room (one when narrow or zoomed). -->
		<fieldset class="toggles">
			<legend>Enable</legend>
			<div class="toggle-grid">
				<label class="check">
					<input type="checkbox" bind:checked={settings.foldOnSwipe} />
					<span>Fold on swipe</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.showMessageButtons} />
					<span>Message buttons</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.inspectEnabled} />
					<span>Inspect for han characters</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.flashcardsEnabled} />
					<span>Flashcards</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.aiTitles} />
					<span>AI chat titles</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.hapticsEnabled} />
					<span>Haptic feedback</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.replyNotifications} />
					<span>Notifications</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.micEnabled} />
					<span>Microphone dictation</span>
				</label>
			</div>
		</fieldset>
	{:else}
		<!-- One row for both hover toggles: the label names the behavior once,
		each box names whose buttons it covers. Desktop-only (this branch). -->
		<fieldset class="hover-row">
			<legend>Show message buttons on hover</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverUserActions} />
				<span>My messages</span>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverAssistantActions} />
				<span>LLM messages</span>
			</label>
		</fieldset>
		<fieldset class="toggles">
			<legend>Enable</legend>
			<div class="toggle-grid">
				<label class="check">
					<input type="checkbox" bind:checked={settings.showMessageButtons} />
					<span>Message buttons</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.inspectEnabled} />
					<span>Inspect for han characters</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.flashcardsEnabled} />
					<span>Flashcards</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.aiTitles} />
					<span>AI chat titles</span>
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={settings.replyNotifications} />
					<span>Notifications</span>
				</label>
				{#if micRow}
					<label class="check">
						<input type="checkbox" bind:checked={settings.micEnabled} />
						<span>Microphone dictation</span>
					</label>
				{/if}
				{#if captureRows}
					<label class="check">
						<input type="checkbox" bind:checked={settings.captureEnabled} />
						<span>Screen-capture OCR</span>
					</label>
					<label class="check">
						<input
							type="checkbox"
							bind:checked={settings.gameLine}
							onchange={() => gameLineToggle()}
						/>
						<span>Game line overlay</span>
					</label>
				{/if}
			</div>
		</fieldset>
		<label class="check">
			<input
				type="checkbox"
				bind:checked={settings.annotationAnswersInPassageLang}
			/>
			<span>Answer annotations in the passage's language</span>
		</label>
		{#if dictionaries}
			<DictionariesSection bind:settings />
		{/if}
	{/if}
</section>
