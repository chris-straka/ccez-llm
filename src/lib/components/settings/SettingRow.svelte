<!-- One settings row: the name, then its control on the same line
(inline) or under it (stacked); `below` adds a full-width line under
both. The row reads as a group named by its name. Every grouped
setting goes through this, so the phone sheet and the desktop window
share one markup and one set of row styles (panels.css). -->
<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		name: string;
		layout?: "inline" | "stacked";
		/** Row-specific classes (stepper-setting, toggles, …). */
		class?: string;
		/** The name's id, for controls that point at it themselves. */
		labelId?: string;
		children: Snippet;
		below?: Snippet;
	}

	let {
		name,
		layout = "inline",
		class: extra = "",
		labelId,
		children,
		below
	}: Props = $props();
	const uid = $props.id();
	const nameId = $derived(labelId ?? `${uid}-name`);
</script>

<div
	class="setting {extra}"
	data-layout={layout}
	role="group"
	aria-labelledby={nameId}
>
	<span class="setting-label" id={nameId}>{name}</span>
	<div class="setting-control">{@render children()}</div>
	{#if below}<div class="setting-below">{@render below()}</div>{/if}
</div>
