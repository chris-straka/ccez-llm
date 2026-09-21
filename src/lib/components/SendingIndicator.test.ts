import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Sending status line renders in SendingIndicator.svelte; the page
 * keeps send/fetch state and labels. The fetch/waiting union used to
 * be an if/else-if chain in the page — the phase prop preserves its
 * priority (fetch first, then waiting, else nothing).
 */
function componentSource(): string {
	return readFileSync(new URL("./SendingIndicator.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

describe("sending indicator contract", () => {
	it("renders fetch, waiting, or nothing from one phase prop", () => {
		const source = componentSource();
		expect(source).toContain('phase: "fetch" | "waiting" | null');
		expect(source).toContain("{#if phase === ");
		expect(source).toContain('aria-label="Fetching a page"');
		expect(source).toContain('aria-label="Waiting for a reply"');
		expect(source).toContain("elapsed > 0");
	});

	it("keeps status dots colored per position", () => {
		const source = componentSource();
		expect(source).toContain(".sending .tdots span:nth-child(1)");
		expect(source).toContain("var(--thinking-2)");
		expect(source).toContain("var(--thinking-3)");
	});

	it("computes the phase from live send/fetch state in the page", () => {
		const page = pageSource();
		expect(page).toContain("<SendingIndicator");
		expect(page).toContain('? "fetch" :');
		expect(page).toContain('? "waiting" : null');
		expect(page).toContain("hasFetchActive(chatState, viewChat.id)");
		expect(page).toContain("hasReplyStarted(chatState, viewChat.id)");
		expect(page).toContain("waitingLabel={thinkingLabelFor(");
	});
});
