import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Per-message action row renders in MessageActions.svelte; the page
 * owns voice/aid/selection state and every behavior behind computed
 * props plus a MessageActionsActions object. Row-reveal, hover,
 * speaking, aid-loading, and hide-messages seating move with the row
 * (paged main/article ancestors stay global); shared .error and
 * .tdots surfaces stay paged globals for their other consumers.
 */
function componentSource(): string {
	return readFileSync(new URL("./MessageActions.svelte", import.meta.url), "utf8");
}

function pageSource(): string {
	return readFileSync(new URL("../../routes/+page.svelte", import.meta.url), "utf8");
}

describe("message actions contract", () => {
	it("reads computed voice/aid state as plain props", () => {
		const source = componentSource();
		for (const prop of [
			"foldTitle: string",
			"deleteTitle: string",
			"speaking: boolean",
			"speakable: boolean",
			"speakLabel: string",
			"aidId: string | null",
			"aidModelPinned: boolean",
			"localKinds: LocalAid[]",
			"pinnedKinds: LocalAid[]",
			"aidBusy: boolean"
		]) {
			expect(source).toContain(prop);
		}
		// No tip() calls, voice maps, or aid stores cross the boundary
		// (data-tip attributes carry precomputed labels instead).
		expect(source).not.toContain("tip(isMac");
		expect(source).not.toContain("tip(\n");
		expect(source).not.toContain("aidModelPin.has");
		expect(source).not.toContain("vocalizing.has");
	});

	it("routes every row press through the actions object", () => {
		const source = componentSource();
		for (const call of [
			"actions.toggleFold()",
			"actions.copy()",
			"actions.branch()",
			"actions.drop()",
			"actions.stopVoice()",
			"actions.speak()",
			"actions.unpinModelAid()",
			"actions.runModelAid(aidId)",
			"actions.unpinLocalAid(localKind)",
			"actions.pinLocalAid(localKind)",
			"actions.peekAid(localKind)",
			"actions.unpeekAid()",
			"actions.commitEdit()",
			"actions.edit()",
			"actions.rerun()",
			"actions.retry()"
		]) {
			expect(source).toContain(call);
		}
	});

	it("keeps paged reveal ancestors global", () => {
		const source = componentSource();
		expect(source).toContain(":global(main.hover-user)");
		expect(source).toContain(":global(article.user)");
		expect(source).toContain(":global(main.hide-messages)");
		expect(source).toContain(":global(.app[data-android])");
		expect(source).toContain(":global(main.scale-actions)");
	});

	it("feeds the row from the page behind its visibility gate", () => {
		const page = pageSource();
		expect(page).toContain("<MessageActions");
		expect(page).toContain("speaking={messageSpeaking(msg)}");
		expect(page).toContain("aidModelPinned={aidModelPin.has(msg.id)}");
		expect(page).toContain("pinnedKinds={pinnedKinds(msg.id)}");
		expect(page).toContain("copy: () => copyText(msg.content, msg.role)");
		expect(page).toContain("stopVoice,");
		expect(page).toContain("releaseRowFocus,");
	});
});
