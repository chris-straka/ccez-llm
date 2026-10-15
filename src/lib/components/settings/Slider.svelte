<!-- One continuous setting (volume, width): name and value on one
line, a full-width track below. Only a press on the thumb moves it:
a click or tap elsewhere on the track does nothing (no jumps), and
it never listens to the wheel, so scrolling past leaves it alone.
Arrow keys step it when the thumb has focus. -->
<script lang="ts">
	import {
		pressGrabsThumb,
		sliderFraction,
		sliderValueAt
	} from "$lib/settingSteps";

	interface Props {
		label: string;
		/** Accessible name of the thumb (slider). */
		ariaLabel: string;
		value: number;
		min: number;
		max: number;
		step: number;
		format: (value: number) => string;
		defaultValue: number;
		resetTitle: string;
		onChange: (value: number) => void;
	}

	let {
		label,
		ariaLabel,
		value,
		min,
		max,
		step,
		format,
		defaultValue,
		resetTitle,
		onChange
	}: Props = $props();

	let trackEl: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	/** Press offset from the thumb center, so grabbing never jumps. */
	let grabOffset = 0;
	const fraction = $derived(sliderFraction(value, min, max));
	const isDefault = $derived(Math.abs(value - defaultValue) < 1e-6);

	function set(next: number): void {
		const clamped = Number(Math.min(max, Math.max(min, next)).toFixed(6));
		if (clamped !== value) onChange(clamped);
	}

	function down(event: PointerEvent): void {
		if (!trackEl || event.button !== 0) return;
		const rect = trackEl.getBoundingClientRect();
		const center = rect.left + fraction * rect.width;
		if (!pressGrabsThumb(event.clientX, center)) return;
		event.preventDefault();
		grabOffset = event.clientX - center;
		dragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		(event.currentTarget as HTMLElement)
			.querySelector<HTMLElement>(".thumb")
			?.focus({ preventScroll: true });
	}

	function move(event: PointerEvent): void {
		if (!dragging || !trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		set(
			sliderValueAt(
				event.clientX - grabOffset,
				rect.left,
				rect.width,
				min,
				max,
				step
			)
		);
	}

	function up(): void {
		dragging = false;
	}

	function onKey(event: KeyboardEvent): void {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const big = Math.max(step, (max - min) / 10);
		const moves: Record<string, number> = {
			ArrowUp: value + step,
			ArrowRight: value + step,
			ArrowDown: value - step,
			ArrowLeft: value - step,
			PageUp: value + big,
			PageDown: value - big,
			Home: min,
			End: max
		};
		const next = moves[event.key];
		if (next === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		set(Math.round((next - min) / step) * step + min);
	}
</script>

<div class="setting slider-setting">
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
		<span class="slider-value" aria-hidden="true">{format(value)}</span>
	</div>
	<div
		class="slider-hit"
		class:dragging
		role="presentation"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onlostpointercapture={up}
	>
		<div class="slider-track" bind:this={trackEl}>
			<span
				class="thumb"
				role="slider"
				tabindex="0"
				aria-label={ariaLabel}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				aria-valuetext={format(value)}
				style="left: {fraction * 100}%"
				onkeydown={onKey}
			></span>
		</div>
	</div>
</div>
