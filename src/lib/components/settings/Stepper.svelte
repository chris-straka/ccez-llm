<!-- One stepped setting: name on the left, a large − value + control
on the right. Each press moves one rung of the ladder, so a stray
click changes the value by one visible step and never by a drag's
worth; the value is shown once, inside the control. Arrow keys,
Page keys, Home and End work on the focused value. -->
<script lang="ts">
	import { canStep, stepLadder } from "$lib/settingSteps";

	interface Props {
		/** Visible name. */
		label: string;
		/** Accessible name of the value (spinbutton). */
		ariaLabel: string;
		value: number;
		ladder: readonly number[];
		/** Maps values onto an increasing scale (non-numeric ladders). */
		rank?: (value: number) => number;
		format: (value: number) => string;
		defaultValue: number;
		/** Tooltip on the Reset link. */
		resetTitle: string;
		onChange: (value: number) => void;
	}

	let {
		label,
		ariaLabel,
		value,
		ladder,
		rank = (v: number) => v,
		format,
		defaultValue,
		resetTitle,
		onChange
	}: Props = $props();

	const canDown = $derived(canStep(ladder, value, -1, rank));
	const canUp = $derived(canStep(ladder, value, 1, rank));
	const isDefault = $derived(Math.abs(rank(value) - rank(defaultValue)) < 1e-6);

	function step(dir: 1 | -1, times = 1): void {
		let next = value;
		for (let i = 0; i < times; i++) next = stepLadder(ladder, next, dir, rank);
		if (next !== value) onChange(next);
	}

	function onKey(event: KeyboardEvent): void {
		const keys: Record<string, () => void> = {
			ArrowUp: () => step(1),
			ArrowRight: () => step(1),
			ArrowDown: () => step(-1),
			ArrowLeft: () => step(-1),
			PageUp: () => step(1, 3),
			PageDown: () => step(-1, 3),
			Home: () => {
				const first = ladder[0];
				if (first !== undefined && first !== value) onChange(first);
			},
			End: () => {
				const last = ladder.at(-1);
				if (last !== undefined && last !== value) onChange(last);
			}
		};
		const run = keys[event.key];
		if (!run || event.metaKey || event.ctrlKey || event.altKey) return;
		event.preventDefault();
		event.stopPropagation();
		run();
	}
</script>

<div class="setting stepper-setting">
	<div class="setting-name">
		<span class="setting-label">{label}</span>
		{#if !isDefault}
			<button
				type="button"
				class="setting-reset"
				title={resetTitle}
				onclick={() => onChange(defaultValue)}>Reset</button
			>
		{/if}
	</div>
	<div class="stepper">
		<button
			type="button"
			class="step-btn"
			tabindex="-1"
			aria-label="Decrease {label.toLowerCase()}"
			disabled={!canDown}
			onclick={() => step(-1)}
			><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" /></svg
			></button
		>
		<span
			class="step-value"
			role="spinbutton"
			tabindex="0"
			aria-label={ariaLabel}
			aria-valuenow={value}
			aria-valuemin={ladder[0]}
			aria-valuemax={ladder.at(-1)}
			aria-valuetext={format(value)}
			onkeydown={onKey}>{format(value)}</span
		>
		<button
			type="button"
			class="step-btn"
			tabindex="-1"
			aria-label="Increase {label.toLowerCase()}"
			disabled={!canUp}
			onclick={() => step(1)}
			><svg viewBox="0 0 16 16" aria-hidden="true"
				><path d="M3.5 8h9M8 3.5v9" /></svg
			></button
		>
	</div>
</div>
