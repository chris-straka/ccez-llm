import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

/**
 * Deleting the message that's playing stops its audio: every delete
 * path routes through stopAudioForMessage, which gates on the
 * speaking state (unit-pinned in voice.test.ts). The browser proof
 * lives in e2e/delete-stops-audio.e2e.ts.
 */
describe("delete stops audio", () => {
	it("gates the stop on the speaking state", () => {
		expect(pageSource()).toContain(
			"if (isMessageSpeaking(id, speakingId, speakingSelection)) stopVoice();"
		);
	});

	it("routes cut, clear-refs, touch, and both keyboard deletes through it", () => {
		const source = pageSource();
		// Cut ( clipboard write settles, then files the delete).
		expect(source).toContain("stopAudioForMessage(target.id);");
		// Clear-refs delete branch.
		expect(source).toContain("stopAudioForMessage(msg.id);");
		// Touch row delete.
		expect(source).toMatch(
			/function dropMessage\(index: number\): void \{[\s\S]*?stopAudioForMessage\(doomed\.id\);/
		);
		// Chrome delete-message hotkey.
		expect(source).toMatch(
			/if \(chrome === "delete-message"\) \{[\s\S]*?stopAudioForMessage\(target\.id\);/
		);
		// Shift+D hovered delete.
		expect(source).toMatch(
			/if \(msgAction === "delete-hovered"\) \{[\s\S]*?stopAudioForMessage\(doomed\.id\);/
		);
	});
});
