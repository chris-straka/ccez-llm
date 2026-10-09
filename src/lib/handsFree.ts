/**
 * Hands-free conversation loop (learner chats): listen → send →
 * speak the reply → listen, until the button or Esc stops it. Pure
 * state machine over explicit events; the page executes the returned
 * effects (dictation, send, TTS) and feeds outcomes back as events.
 * A stopped or failed turn always lands on `idle` with everything
 * halted — the loop never half-runs. Speech and listening never
 * overlap: the speaking → listening hand-off fires only on the
 * utterance's natural end, so the mic never hears the app's own
 * voice.
 */

/** Converse phases: idle, capturing an utterance, awaiting the model, speaking the reply. */
export type HandsFreePhase = "idle" | "listening" | "sending" | "speaking";

export type HandsFreeEvent =
	| { type: "toggle" }
	| { type: "utterance"; text: string }
	| { type: "replyDone" }
	| { type: "speakDone" }
	| { type: "sendBlocked" }
	| { type: "failed" };

export type HandsFreeEffect =
	"startListening" | "stopListening" | "send" | "readback" | "stopAll";

/**
 * One machine step: the next phase plus the effects the page must
 * run, in order. Stray events (a late reply after a stop, a second
 * toggle echo) resolve to no effects, never a surprise phase.
 */
export function handsFreeNext(
	phase: HandsFreePhase,
	event: HandsFreeEvent
): { phase: HandsFreePhase; effects: HandsFreeEffect[] } {
	switch (phase) {
		case "idle":
			if (event.type === "toggle")
				return { phase: "listening", effects: ["startListening"] };
			return { phase, effects: [] };
		case "listening":
			if (event.type === "toggle")
				return { phase: "idle", effects: ["stopListening"] };
			if (event.type === "utterance") {
				// Silence re-arms the mic (dictation backends report
				// hard failures as errors, so this only loops on
				// genuine quiet — and the button always stops it).
				if (!event.text.trim()) return { phase, effects: ["startListening"] };
				return { phase: "sending", effects: ["stopListening", "send"] };
			}
			if (event.type === "failed")
				return { phase: "idle", effects: ["stopListening"] };
			return { phase, effects: [] };
		case "sending":
			if (event.type === "toggle" || event.type === "failed")
				return { phase: "idle", effects: ["stopAll"] };
			if (event.type === "replyDone")
				return { phase: "speaking", effects: ["readback"] };
			// The send was refused (busy, locked, popup, guard): the
			// words stay in the composer and the loop listens again.
			if (event.type === "sendBlocked")
				return { phase: "listening", effects: ["startListening"] };
			return { phase, effects: [] };
		case "speaking":
			if (event.type === "toggle" || event.type === "failed")
				return { phase: "idle", effects: ["stopAll"] };
			if (event.type === "speakDone")
				return { phase: "listening", effects: ["startListening"] };
			return { phase, effects: [] };
	}
}
