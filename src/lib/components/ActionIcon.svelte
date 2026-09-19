<script lang="ts">
	/**
	 * Line-icon set for the per-message actions, drawn in the trash/branch
	 * style (1.6px rounded strokes, currentColor so light/dark/hover follow
	 * the button color for free).
	 */

	export type ActionKind = "fold" | "copy" | "branch" | "speak" | "delete" | "rerun" | "close" | "mic" | "attach" | "paste" | "pencil" | "jump" | "mark" | "export" | "check";

	interface Props {
		kind: ActionKind;
	}

	let { kind }: Props = $props();
</script>

<svg
	class="action-glyph"
	viewBox="0 0 16 16"
	fill="none"
	stroke="currentColor"
	stroke-width="1.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if kind === "fold"}
		<path d="M4 6l4 4 4-4" />
	{:else if kind === "copy"}
		<rect x="6" y="6" width="7" height="7" rx="1.5" />
		<path d="M9.5 6V4.2A1.2 1.2 0 0 0 8.3 3H4.2A1.2 1.2 0 0 0 3 4.2v4.1a1.2 1.2 0 0 0 1.2 1.2H6" />
	{:else if kind === "branch"}
		<path d="M2.5 12.5h7v-6" />
		<path d="M6.8 6.7L9.5 4l2.7 2.7" />
	{:else if kind === "speak"}
		<path d="M2.5 6v4h2.3L9 13.3V2.7L4.8 6H2.5z" />
		<path d="M11 6.2a3 3 0 0 1 0 3.6" />
		<path d="M12.8 4.4a5.6 5.6 0 0 1 0 7.2" />
	{:else if kind === "delete"}
		<path d="M2.5 4.5h11" />
		<path d="M6.5 4.5V2.8h3v1.7" />
		<path d="M4 4.5l.75 7.9a1.5 1.5 0 0 0 1.5 1.3h3.5a1.5 1.5 0 0 0 1.5-1.3L12 4.5" />
		<path d="M6.8 7.2v3.6M9.2 7.2v3.6" />
	{:else if kind === "rerun"}
		<path d="M13.5 8a5.5 5.5 0 1 1-1.7-4" />
		<path d="M13.7 1.4v3.1h-3.1" />
	{:else if kind === "close"}
		<path d="M4 4l8 8M12 4l-8 8" />
	{:else if kind === "mic"}
		<rect x="6" y="1.5" width="4" height="7" rx="2" />
		<path d="M4 8.5a4 4 0 0 0 8 0" />
		<path d="M8 12.5v2" />
		<path d="M6 14.5h4" />
	{:else if kind === "attach"}
		<path d="M14.3 7.4l-6.1 6.1a4 4 0 0 1-5.7-5.7l5.7-5.7a2.7 2.7 0 0 1 3.8 3.8l-5.7 5.7a1.3 1.3 0 0 1-1.9-1.9l5.7-5.6" />
	{:else if kind === "paste"}
		<rect x="4.5" y="4.5" width="8.5" height="9.5" rx="1.5" />
		<path d="M6 4.5V3.2A1.2 1.2 0 0 1 7.2 2h3.6a1.2 1.2 0 0 1 1.2 1.2v1.3" />
		<path d="M6.5 8.5h4M6.5 11h2.5" />
	{:else if kind === "pencil"}
		<path d="M11.3 2.2a1.9 1.9 0 0 1 2.7 2.7L5.2 13.7 2 14.2l.5-3.2L11.3 2.2z" />
		<path d="M9.8 3.7l2.7 2.7" />
	{:else if kind === "jump"}
		<path d="M8 14.2S3.8 9.9 3.8 6.4a4.2 4.2 0 0 1 8.4 0c0 3.5-4.2 7.8-4.2 7.8z" />
		<circle cx="8" cy="6.2" r="1.5" />
	{:else if kind === "mark"}
		<path d="M9.7 2.3l4 4L7.2 12.8l-4.4 1.2 1.2-4.4 6.7-7.3z" />
		<path d="M8.2 3.8l4 4" />
	{:else if kind === "export"}
		<path d="M8 2v8.5" />
		<path d="M5 7.2L8 10.2l3-3" />
		<path d="M2.5 11.5v1.3a1.2 1.2 0 0 0 1.2 1.2h8.6a1.2 1.2 0 0 0 1.2-1.2v-1.3" />
	{:else if kind === "check"}
		<path d="M3 8.5l3.5 3.5L13 4.5" />
	{/if}
</svg>

<style>
	.action-glyph {
		display: block;
		height: 1.05rem;
		width: auto;
	}
</style>
