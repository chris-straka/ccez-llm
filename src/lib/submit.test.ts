import { describe, it, expect } from "vitest";
import {
	submitAction,
	sendAction,
	composerLocked,
	editMessageAction,
	commitEditTarget,
	shouldRumbleOnFirstToken
} from "./submit";

describe("composerLocked", () => {
	it("locks a keyed provider with a blank key", () => {
		expect(
			composerLocked({ mock: false, keyless: false, apiKey: "" })
		).toBe(true);
		expect(
			composerLocked({ mock: false, keyless: false, apiKey: "   " })
		).toBe(true);
	});
	it("leaves a stored key alone", () => {
		expect(
			composerLocked({ mock: false, keyless: false, apiKey: "sk-x" })
		).toBe(false);
	});
	it("exempts the mock provider and keyless endpoints", () => {
		expect(composerLocked({ mock: true, keyless: false, apiKey: "" })).toBe(
			false
		);
		expect(composerLocked({ mock: false, keyless: true, apiKey: "" })).toBe(
			false
		);
	});
});

describe("submitAction", () => {
	it("lets the annotation pill own Enter over everything", () => {
		expect(
			submitAction({
				annPopOpen: true,
				annEdit: false,
				canSubmit: true,
				sendGuardTripped: false,
				kind: "send"
			})
		).toBe("ignore");
		expect(
			submitAction({
				annPopOpen: true,
				annEdit: false,
				canSubmit: false,
				sendGuardTripped: false,
				kind: "stage"
			})
		).toBe("ignore");
	});

	it("holds the draft while a reply streams", () => {
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: false,
				canSubmit: false,
				sendGuardTripped: false,
				kind: "send"
			})
		).toBe("ignore");
	});

	it("files an in-prompt note edit through the streaming gate", () => {
		// Mid-stream arrow files the note (doSend commits it, never
		// a chat turn) instead of buzzing denial.
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: true,
				canSubmit: false,
				sendGuardTripped: false,
				kind: "send"
			})
		).toBe("send");
		// Alt+Enter files too — staging never steals the note.
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: true,
				canSubmit: false,
				sendGuardTripped: false,
				kind: "stage"
			})
		).toBe("send");
		// The pill still wins its corner: both open at once keeps
		// Enter with the pill (unreachable by construction — the
		// edit nulls the pill on entry and annotate commits the
		// edit before summoning).
		expect(
			submitAction({
				annPopOpen: true,
				annEdit: true,
				canSubmit: false,
				sendGuardTripped: false,
				kind: "send"
			})
		).toBe("ignore");
	});

	it("eats a bare double-Enter but never a stage", () => {
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: false,
				canSubmit: true,
				sendGuardTripped: true,
				kind: "send"
			})
		).toBe("ignore");
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: false,
				canSubmit: true,
				sendGuardTripped: true,
				kind: "stage"
			})
		).toBe("stage");
	});

	it("sends on a clean press and stages on Alt", () => {
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: false,
				canSubmit: true,
				sendGuardTripped: false,
				kind: "send"
			})
		).toBe("send");
		expect(
			submitAction({
				annPopOpen: false,
				annEdit: false,
				canSubmit: true,
				sendGuardTripped: false,
				kind: "stage"
			})
		).toBe("stage");
	});
});

describe("sendAction", () => {
	it("drops gated sends even mid-edit", () => {
		expect(sendAction({ canSubmit: false, editing: true })).toBe("ignore");
		expect(sendAction({ canSubmit: false, editing: false })).toBe("ignore");
	});

	it("commits an open edit before resolving a provider", () => {
		expect(sendAction({ canSubmit: true, editing: true })).toBe("commit-edit");
		expect(sendAction({ canSubmit: true, editing: false })).toBe(
			"resolve-provider"
		);
	});
});

describe("editMessageAction", () => {
	const user = { role: "user", id: "u1" };
	const assistant = { role: "assistant", id: "a1" };

	it("no-ops mid-send over everything", () => {
		expect(
			editMessageAction([user], 0, { sending: true, editingId: null })
		).toBe("ignore-sending");
		expect(
			editMessageAction([user], 0, { sending: true, editingId: "u1" })
		).toBe("ignore-sending");
	});

	it("rejects missing and non-user targets", () => {
		expect(
			editMessageAction([user], 3, { sending: false, editingId: null })
		).toBe("ignore-not-user");
		expect(
			editMessageAction([assistant], 0, { sending: false, editingId: null })
		).toBe("ignore-not-user");
	});

	it("toggles the already-open message shut", () => {
		expect(
			editMessageAction([user], 0, { sending: false, editingId: "u1" })
		).toBe("toggle-off");
	});

	it("opens any other user message", () => {
		expect(
			editMessageAction([user], 0, { sending: false, editingId: null })
		).toBe("open");
		expect(
			editMessageAction([user], 0, { sending: false, editingId: "u9" })
		).toBe("open");
	});
});

describe("commitEditTarget", () => {
	const messages = [
		{ role: "user", id: "u1" },
		{ role: "assistant", id: "a1" }
	];

	it("resolves the edited user message by id", () => {
		expect(commitEditTarget(messages, "u1")).toBe(0);
	});

	it("vanishes cleanly for null, missing, and non-user ids", () => {
		expect(commitEditTarget(messages, null)).toBeNull();
		expect(commitEditTarget(messages, undefined)).toBeNull();
		expect(commitEditTarget(messages, "gone")).toBeNull();
		expect(commitEditTarget(messages, "a1")).toBeNull();
	});
});

describe("shouldRumbleOnFirstToken", () => {
	it("rumbles while the sent-from chat is still open", () => {
		expect(shouldRumbleOnFirstToken("c1", "c1", true)).toBe(true);
	});

	it("stays silent after a mid-stream chat switch", () => {
		expect(shouldRumbleOnFirstToken("c2", "c1", true)).toBe(false);
	});

	it("stays silent while backgrounded even on the same chat", () => {
		expect(shouldRumbleOnFirstToken("c1", "c1", false)).toBe(false);
	});
});
