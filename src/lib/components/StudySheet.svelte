<!-- Print-only study sheet: hidden on screen, the sole visible node
under `@media print` (File → Print Study Sheet…, or Save as PDF from
that dialog — see app.css). Plain text on purpose — the PDF is a study
artifact, not a theme snapshot. Renders no wrapper: the section stays
a direct `.app` child so the print rule keeps matching. -->
<script lang="ts">
	import type { ChatMsg } from "$lib/chat";

	interface Props {
		title: string;
		messages: ChatMsg[];
	}

	let { title, messages }: Props = $props();
</script>

<section id="study-sheet-print" aria-hidden="true">
	<h1>{title}</h1>
	<p class="sheet-sub">
		Ccez LLM study sheet — {messages.length} message{messages.length === 1
			? ""
			: "s"}.
	</p>
	{#each messages as msg (msg.id)}
		<h2>{msg.role === "user" ? "You" : "Ccez"}</h2>
		<p>{msg.content}</p>
	{/each}
</section>

<style>
	/* Screen hide lives with the markup (moved from the page); the
	print show/hide rules stay global in app.css, keyed off .app. */
	#study-sheet-print {
		display: none;
	}
</style>
