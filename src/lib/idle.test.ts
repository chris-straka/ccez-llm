import { describe, it, expect } from "vitest";
import {
	idleTapAction,
	shouldHideForAlways,
	shouldIdleHide,
	type AlwaysHideFacts,
	type IdleHideFacts,
	type IdleTapFacts
} from "./idle";

const alwaysBase: AlwaysHideFacts = {
	alwaysMode: true,
	inPrompt: false,
	emptyChat: false
};

describe("shouldHideForAlways", () => {
	it("hides on focus-out in always mode, however short the thread", () => {
		expect(shouldHideForAlways(alwaysBase)).toBe(true);
	});

	// No short-thread exemption: always-hide means always (the old
	// fitsViewport guard kept the composer up on short threads against
	// the explicit setting). Only an empty chat keeps the composer —
	// with nothing to read, hiding strands it for good.
	it("keeps the prompt for mode, focus, and empty chats", () => {
		expect(shouldHideForAlways({ ...alwaysBase, alwaysMode: false })).toBe(
			false
		);
		expect(shouldHideForAlways({ ...alwaysBase, inPrompt: true })).toBe(false);
		expect(shouldHideForAlways({ ...alwaysBase, emptyChat: true })).toBe(false);
	});
});

const hideBase: IdleHideFacts = {
	emptyChat: false,
	alreadyIdle: false
};

describe("shouldIdleHide", () => {
	it("hides threads once, however short", () => {
		expect(shouldIdleHide(hideBase)).toBe(true);
	});

	it("never hides empty or already-hidden prompts", () => {
		expect(shouldIdleHide({ ...hideBase, emptyChat: true })).toBe(false);
		expect(shouldIdleHide({ ...hideBase, alreadyIdle: true })).toBe(false);
	});
});

const tapBase: IdleTapFacts = {
	downControl: false,
	downVisible: false,
	downHadSel: false,
	traveled: false,
	inMath: false,
	inClickControl: false,
	inOverlay: false
};

describe("idleTapAction", () => {
	it("summons on a clean tap, quietly behind overlays", () => {
		expect(idleTapAction(tapBase)).toBe("summon");
		expect(idleTapAction({ ...tapBase, inOverlay: true })).toBe("summon-quiet");
	});

	it("ignores control presses, dismissals, drags, and owned targets", () => {
		expect(idleTapAction({ ...tapBase, downControl: true })).toBe(null);
		expect(idleTapAction({ ...tapBase, downVisible: true })).toBe(null);
		expect(idleTapAction({ ...tapBase, downHadSel: true })).toBe(null);
		expect(idleTapAction({ ...tapBase, traveled: true })).toBe(null);
		expect(idleTapAction({ ...tapBase, inMath: true })).toBe(null);
		expect(idleTapAction({ ...tapBase, inClickControl: true })).toBe(null);
	});
});
