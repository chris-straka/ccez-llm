import { describe, expect, it } from "vitest";

import { NotePrefetch, noteKey, wordsToPrefetch } from "./note-prefetch";
import type { AnnotationReply } from "./reading";

const reply = (answer: string): AnnotationReply => ({ answer });

describe("cards asked before the note", () => {
	it("A takes over a running answer, replaying what landed", async () => {
		const p = new NotePrefetch();
		let finish!: (r: AnnotationReply) => void;
		p.start("k", (_s, onPartial) => {
			onPartial(reply("dictionary"));
			return new Promise((resolve) => (finish = resolve));
		});
		const seen: string[] = [];
		const taken = p.take("k", (r) => seen.push(r.answer))!;
		expect(seen).toEqual(["dictionary"]);
		finish(reply("full"));
		expect((await taken).answer).toBe("full");
		expect(p.take("k")).toBeNull();
	});

	it("starts a word once, and nothing when not asked early", () => {
		const p = new NotePrefetch();
		let runs = 0;
		const run = () => {
			runs++;
			return new Promise<AnnotationReply>(() => undefined);
		};
		p.start("k", run);
		p.start("k", run);
		expect(runs).toBe(1);
		expect(p.take("other")).toBeNull();
	});

	it("gives up old ones", () => {
		let t = 0;
		const p = new NotePrefetch(() => t);
		let aborted = false;
		p.start("old", (signal) => {
			signal.addEventListener("abort", () => (aborted = true));
			return new Promise(() => undefined);
		});
		t = 11 * 60 * 1000;
		expect(p.take("old")).toBeNull();
		expect(aborted).toBe(true);
	});

	it("keys by language, word and paragraph", () => {
		expect(
			noteKey({
				quote: " Reculer ",
				context: "Le parti recule.",
				lang: "fr-FR"
			})
		).toBe("fr|reculer|Le parti recule.");
	});
	it("picks a reply's words: learning ones first, then long unknown ones", () => {
		const status = (w: string) =>
			({ lugubre: "learning", sinistre: "known" })[w.toLowerCase()] ?? null;
		const text =
			"Une ambiance sinistre et lugubre, vraiment inquiétante et menaçante, absolument terrifiante.";
		expect(wordsToPrefetch(text, "fr", status)).toEqual([
			"lugubre",
			"ambiance",
			"vraiment",
			"inquiétante"
		]);
		expect(wordsToPrefetch("駅はどこですか", "ja", () => null)).toEqual([]);
	});
});
