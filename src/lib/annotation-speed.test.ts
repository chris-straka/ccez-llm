import { describe, expect, it } from "vitest";

import {
	messageText,
	type ChatMessage,
	type ChatProvider,
	type ChatOptions
} from "./providers/types";
import {
	annotationAnswer,
	cleanQuickMeaning,
	senseMatch,
	type AnnotationReply
} from "./reading";

/** A provider answering the quick question fast and the card slowly. */
function provider(
	card: string,
	cardMs = 50
): ChatProvider & { aborted: boolean } {
	const p = {
		id: "muse",
		aborted: false,
		chat(messages: ChatMessage[], opts: ChatOptions = {}) {
			const quick = messageText(messages[0]?.content ?? "").startsWith(
				"Say what the quoted words mean"
			);
			return new Promise((resolve, reject) => {
				const t = setTimeout(
					() => resolve({ content: quick ? "to retreat" : card }),
					quick ? 5 : cardMs
				);
				opts.signal?.addEventListener("abort", () => {
					clearTimeout(t);
					if (!quick) p.aborted = true;
					reject(new DOMException("aborted", "AbortError"));
				});
			});
		},
		stream() {
			throw new Error("not used");
		}
	};
	return p as never;
}

const card = JSON.stringify({
	meaning: "to move back, to retreat",
	parts: [],
	facts: []
});
const q = {
	quote: "reculer",
	question: "",
	context: "Le parti a vu ses voix reculer.",
	lang: "fr"
};

describe("faster notes", () => {
	it("shows the quick meaning first, then the card, which keeps the sense", async () => {
		const partials: AnnotationReply[] = [];
		const reply = await annotationAnswer(provider(card), q, undefined, {
			lang: "fr",
			quickThinking: "minimal",
			onPartial: (r) => partials.push(r)
		});
		expect(partials.at(-1)?.card?.meaning).toBe("to retreat");
		expect(partials.at(-1)?.card?.partial).toBe(true);
		expect(reply.card?.meaning).toBe("to move back, to retreat");
		expect(reply.card?.sense).toBe("to retreat");
	});

	it("a card from before in the same sense stands, and the slow request ends", async () => {
		const p = provider(card, 5000);
		const earlier: AnnotationReply = {
			answer: "to move back",
			card: {
				meaning: "to move back",
				parts: [],
				facts: [],
				sense: "retreat, move back",
				lang: "fr"
			}
		};
		const t = Date.now();
		const reply = await annotationAnswer(p, q, undefined, {
			lang: "fr",
			quickThinking: "minimal",
			sameSense: (lang, sense) =>
				lang === "fr" && senseMatch(sense, "retreat, move back")
					? earlier
					: null
		});
		expect(Date.now() - t).toBeLessThan(1000);
		expect(reply.answer).toBe("to move back");
		expect(reply.card?.sense).toBe("to retreat");
		expect(p.aborted).toBe(true);
	});

	it("matches senses by their words, little words aside", () => {
		expect(senseMatch("to retreat", "retreat, move back")).toBe(true);
		expect(senseMatch("lose ground", "lose seats")).toBe(false);
		expect(senseMatch("calling into question", "questioning")).toBe(false);
		expect(senseMatch("", "x")).toBe(false);
	});

	it("keeps a quick answer to one short line", () => {
		expect(cleanQuickMeaning('"lose ground."\nmore')).toBe("lose ground");
		expect(cleanQuickMeaning("   ")).toBeNull();
	});
});
