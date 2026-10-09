import { describe, expect, it } from "vitest";
import { handsFreeNext } from "./handsFree";

describe("handsFreeNext", () => {
	it("toggles between idle and listening", () => {
		expect(handsFreeNext("idle", { type: "toggle" })).toEqual({
			phase: "listening",
			effects: ["startListening"]
		});
		expect(handsFreeNext("listening", { type: "toggle" })).toEqual({
			phase: "idle",
			effects: ["stopListening"]
		});
	});

	it("sends a captured utterance, then speaks the reply, then re-listens", () => {
		expect(
			handsFreeNext("listening", { type: "utterance", text: "Bonjour" })
		).toEqual({
			phase: "sending",
			effects: ["stopListening", "send"]
		});
		expect(handsFreeNext("sending", { type: "replyDone" })).toEqual({
			phase: "speaking",
			effects: ["readback"]
		});
		// The speaking → listening hand-off: the mic re-arms only
		// after the utterance ends, never over the app's own voice.
		expect(handsFreeNext("speaking", { type: "speakDone" })).toEqual({
			phase: "listening",
			effects: ["startListening"]
		});
	});

	it("re-arms the mic on silence instead of sending", () => {
		expect(
			handsFreeNext("listening", { type: "utterance", text: "  " })
		).toEqual({
			phase: "listening",
			effects: ["startListening"]
		});
	});

	it("stops everything from sending or speaking", () => {
		expect(handsFreeNext("sending", { type: "toggle" })).toEqual({
			phase: "idle",
			effects: ["stopAll"]
		});
		expect(handsFreeNext("speaking", { type: "toggle" })).toEqual({
			phase: "idle",
			effects: ["stopAll"]
		});
	});

	it("fails safe from every live phase", () => {
		expect(handsFreeNext("listening", { type: "failed" })).toEqual({
			phase: "idle",
			effects: ["stopListening"]
		});
		expect(handsFreeNext("sending", { type: "failed" })).toEqual({
			phase: "idle",
			effects: ["stopAll"]
		});
		expect(handsFreeNext("speaking", { type: "failed" })).toEqual({
			phase: "idle",
			effects: ["stopAll"]
		});
	});

	it("re-listens when the send is refused instead of stranding", () => {
		expect(handsFreeNext("sending", { type: "sendBlocked" })).toEqual({
			phase: "listening",
			effects: ["startListening"]
		});
		// Stray anywhere else: no phase, no effects.
		expect(handsFreeNext("idle", { type: "sendBlocked" })).toEqual({
			phase: "idle",
			effects: []
		});
		expect(handsFreeNext("listening", { type: "sendBlocked" })).toEqual({
			phase: "listening",
			effects: []
		});
		expect(handsFreeNext("speaking", { type: "sendBlocked" })).toEqual({
			phase: "speaking",
			effects: []
		});
	});

	it("ignores stray events without effects", () => {
		// A late reply after a stop must not start a readback.
		expect(handsFreeNext("idle", { type: "replyDone" })).toEqual({
			phase: "idle",
			effects: []
		});
		expect(handsFreeNext("idle", { type: "speakDone" })).toEqual({
			phase: "idle",
			effects: []
		});
		// Cross-phase echoes (double taps, racing ends) hold still.
		expect(handsFreeNext("listening", { type: "replyDone" })).toEqual({
			phase: "listening",
			effects: []
		});
		expect(handsFreeNext("sending", { type: "speakDone" })).toEqual({
			phase: "sending",
			effects: []
		});
		expect(handsFreeNext("speaking", { type: "replyDone" })).toEqual({
			phase: "speaking",
			effects: []
		});
		expect(
			handsFreeNext("sending", { type: "utterance", text: "late" })
		).toEqual({ phase: "sending", effects: [] });
	});
});
