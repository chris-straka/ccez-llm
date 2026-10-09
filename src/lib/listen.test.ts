import { describe, expect, it } from "vitest";
import {
	answerClip,
	availabilityLabel,
	channelLabel,
	clipContent,
	formatDuration,
	gradePrompt,
	listenErrorCopy,
	listenKeyAction,
	parseGrade,
	rankVideos,
	summarizeDrill,
	type ListenVideo
} from "./listen";

function video(id: string, audio: ListenVideo["audio"], captions = true): ListenVideo {
	return {
		id,
		title: id,
		channel: "C",
		channel_url: "u",
		duration: 60,
		thumbnail: "",
		original_lang: "en-US",
		audio,
		captions: captions && audio ? { key: "fr-orig", kind: "asr" } : null
	};
}
const dub = (id: string, auto = true): ListenVideo =>
	video(id, { kind: "dub", lang: "fr-FR", format_id: "139-4", ext: "m4a", auto });
const native = (id: string): ListenVideo =>
	video(id, { kind: "native", lang: "fr", format_id: "139", ext: "m4a", auto: false });

describe("labels", () => {
	it("says plainly when a language is missing", () => {
		expect(availabilityLabel(video("a", null), "French")).toBe("no French audio yet");
		expect(availabilityLabel(dub("b"), "French")).toBe("French auto-dub");
		expect(availabilityLabel(dub("b", false), "French")).toBe("French dub");
		expect(availabilityLabel(native("c"), "French")).toBe("French audio");
		expect(availabilityLabel(video("d", dub("d").audio, false), "French")).toBe("French audio, no transcript");
		expect(channelLabel([video("a", null)], "German")).toBe("no German audio yet");
		expect(channelLabel([video("a", null), dub("b")], "French")).toBe("French dubs");
		expect(channelLabel([dub("b"), native("c")], "French")).toBe("French audio");
	});

	it("ranks native audio over dubs, then unavailable last", () => {
		const rows = [{ id: "none" }, { id: "dub" }, { id: "native" }, { id: "unknown" }];
		const info = { none: video("none", null), dub: dub("dub"), native: native("native") };
		expect(rankVideos(rows, info).map((r) => r.id)).toEqual(["native", "dub", "unknown", "none"]);
	});

	it("formats durations and errors", () => {
		expect(formatDuration(521)).toBe("8:41");
		expect(formatDuration(3723)).toBe("1:02:03");
		expect(listenErrorCopy(new Error("listen-no-ytdlp"), "French")).toMatch(/brew install yt-dlp/);
		expect(listenErrorCopy(new Error("listen-no-track"), "German")).toBe("That video has no German audio.");
	});
});

describe("grading", () => {
	it("asks in the drill's language, with context, never the guess", () => {
		const p = gradePrompt("On partira pas.", "French", "Celui qui sera le dernier…");
		expect(p).toContain("learner of French");
		expect(p).toContain("«On partira pas.»");
		expect(p).toContain("context only");
		expect(gradePrompt("x", "Japanese", null)).not.toContain("context only");
	});

	it("parses JSON replies, fenced or chatty, and caps notes at three", () => {
		const reply =
			'Sure!\n```json\n{"translation": "We won\'t leave.", "notes": [' +
			'{"expr": "On partira pas", "meaning": "we won\'t leave"},' +
			'{"expr": "", "meaning": "x"}, {"expr": "a", "meaning": "b"}, {"expr": "c", "meaning": "d"}, {"expr": "e", "meaning": "f"}]}\n```';
		const g = parseGrade(reply);
		expect(g?.translation).toBe("We won't leave.");
		expect(g?.notes).toHaveLength(3);
		expect(g?.notes[0]).toEqual({ expr: "On partira pas", meaning: "we won't leave" });
		expect(parseGrade("no json here")).toBeNull();
		expect(parseGrade('{"notes": []}')).toBeNull();
		expect(parseGrade('{"translation": "Hi"}')?.notes).toEqual([]);
	});

	it("builds an annotatable body: transcript, translation, notes", () => {
		expect(clipContent("On partira pas.", { i: 0 })).toBe("On partira pas.");
		expect(
			clipContent("On partira pas.", {
				i: 0,
				translation: "We won't leave.",
				notes: [{ expr: "partira", meaning: "will leave" }]
			})
		).toBe("On partira pas.\n\n*We won't leave.*\n\n- **partira**: will leave");
	});
});

describe("answers and summary", () => {
	it("answering diffs instantly; a skip hears nothing", () => {
		const a = answerClip("On partira pas.", { i: 0, grade: "pending" }, "on partira pas", "fr");
		expect(a.heard).toBe(1);
		expect(a.skipped).toBe(false);
		expect(a.grade).toBe("pending");
		const s = answerClip("On partira pas.", { i: 1 }, null, "fr");
		expect(s.skipped).toBe(true);
		expect(s.heard).toBe(0);
		expect(s.guess).toBe("");
	});

	it("tallies heard words and lists the worst clips", () => {
		const states = [
			answerClip("un deux trois quatre", { i: 0 }, "un deux trois quatre", "fr"),
			answerClip("un deux trois quatre", { i: 1 }, "un", "fr"),
			answerClip("un deux", { i: 2 }, null, "fr"),
			answerClip("un deux trois quatre", { i: 3 }, "un deux trois", "fr"),
			{ i: 4 }
		];
		expect(summarizeDrill(states)).toEqual({
			answered: 4,
			got: 4 + 1 + 0 + 3,
			total: 4 + 4 + 2 + 4,
			perfect: 1,
			missed: [2, 1, 3]
		});
	});
});

describe("listenKeyAction", () => {
	const base = {
		key: " ",
		code: "Space",
		alt: false,
		meta: false,
		ctrl: false,
		inDrill: true,
		composerEmpty: true,
		inComposer: true,
		inOtherField: false
	};
	it("Space replays and ? reveals only with nothing typed", () => {
		expect(listenKeyAction(base)).toBe("play");
		expect(listenKeyAction({ ...base, composerEmpty: false })).toBe("pass");
		expect(listenKeyAction({ ...base, key: "?", code: "Slash" })).toBe("reveal");
		expect(listenKeyAction({ ...base, key: "?", code: "Slash", composerEmpty: false })).toBe("pass");
	});
	it("S slows outside the composer; a guess can start with s", () => {
		expect(listenKeyAction({ ...base, key: "s", code: "KeyS" })).toBe("pass");
		expect(listenKeyAction({ ...base, key: "s", code: "KeyS", inComposer: false })).toBe("slow");
	});
	it("⌥Space and ⌥S work mid-guess (matched on code: ⌥S types ß)", () => {
		expect(listenKeyAction({ ...base, alt: true, composerEmpty: false })).toBe("play");
		expect(listenKeyAction({ ...base, alt: true, key: "ß", code: "KeyS", composerEmpty: false })).toBe("slow");
		expect(listenKeyAction({ ...base, alt: true, key: "å", code: "KeyA" })).toBe("pass");
	});
	it("never fires outside a drill, in other fields, or with ⌘/Ctrl", () => {
		expect(listenKeyAction({ ...base, inDrill: false })).toBe("pass");
		expect(listenKeyAction({ ...base, inOtherField: true })).toBe("pass");
		expect(listenKeyAction({ ...base, meta: true })).toBe("pass");
		expect(listenKeyAction({ ...base, ctrl: true })).toBe("pass");
	});
});
