import { describe, expect, it } from "vitest";
import {
	answerClip,
	availabilityLabel,
	channelLabel,
	formatDuration,
	gradePrompt,
	listenErrorCopy,
	listenKeyAction,
	parseGrade,
	rankVideos,
	storyboardFrame,
	summarizeDrill,
	type ListenStoryboard,
	type ListenVideo
} from "./listen";

function video(
	id: string,
	audio: ListenVideo["audio"],
	captions = true
): ListenVideo {
	return {
		id,
		title: id,
		channel: "C",
		channel_url: "u",
		duration: 60,
		thumbnail: "",
		original_lang: "en-US",
		audio,
		captions: captions && audio ? { key: "a.fr", kind: "asr" } : null
	};
}
const dub = (id: string, auto = true): ListenVideo =>
	video(id, {
		kind: "dub",
		lang: "fr-FR",
		itag: 139,
		track: "fr-FR.10",
		mime: "audio/mp4",
		auto
	});
const native = (id: string): ListenVideo =>
	video(id, {
		kind: "native",
		lang: "fr",
		itag: 139,
		track: null,
		mime: "audio/mp4",
		auto: false
	});

describe("labels", () => {
	it("says plainly when a language is missing", () => {
		expect(availabilityLabel(video("a", null), "French")).toBe(
			"no French audio yet"
		);
		expect(availabilityLabel(dub("b"), "French")).toBe("French auto-dub");
		expect(availabilityLabel(dub("b", false), "French")).toBe("French dub");
		expect(availabilityLabel(native("c"), "French")).toBe("French audio");
		expect(availabilityLabel(video("d", dub("d").audio, false), "French")).toBe(
			"French audio, no transcript"
		);
		expect(channelLabel([video("a", null)], "German")).toBe(
			"no German audio yet"
		);
		expect(channelLabel([video("a", null), dub("b")], "French")).toBe(
			"French dubs"
		);
		expect(channelLabel([dub("b"), native("c")], "French")).toBe(
			"French audio"
		);
	});

	it("ranks native audio over dubs, then unavailable last", () => {
		const rows = [
			{ id: "none" },
			{ id: "dub" },
			{ id: "native" },
			{ id: "unknown" }
		];
		const info = {
			none: video("none", null),
			dub: dub("dub"),
			native: native("native")
		};
		expect(rankVideos(rows, info).map((r) => r.id)).toEqual([
			"native",
			"dub",
			"unknown",
			"none"
		]);
	});

	it("formats durations and errors", () => {
		expect(formatDuration(521)).toBe("8:41");
		expect(formatDuration(3723)).toBe("1:02:03");
		expect(listenErrorCopy(new Error("listen-needs-app"), "French")).toMatch(
			/runs in the app/
		);
		expect(listenErrorCopy(new Error("listen-network"), "French")).toMatch(
			/Can't reach YouTube/
		);
		expect(listenErrorCopy(new Error("listen-no-track"), "German")).toBe(
			"That video has no German audio."
		);
		expect(listenErrorCopy("listen-http-403", "French")).toBe(
			"That didn't load (listen-http-403). Try again."
		);
		expect(listenErrorCopy(new Error("boom"), "French")).toBe(
			"That didn't load. Try again."
		);
	});
});

describe("grading", () => {
	it("asks in the drill's language, with context, never the guess", () => {
		const p = gradePrompt(
			"On partira pas.",
			"French",
			"Celui qui sera le dernier…"
		);
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
		expect(g?.notes[0]).toEqual({
			expr: "On partira pas",
			meaning: "we won't leave"
		});
		expect(parseGrade("no json here")).toBeNull();
		expect(parseGrade('{"notes": []}')).toBeNull();
		expect(parseGrade('{"translation": "Hi"}')?.notes).toEqual([]);
	});
});

describe("answers and summary", () => {
	it("answering diffs instantly; a skip hears nothing", () => {
		const a = answerClip(
			"On partira pas.",
			{ i: 0, grade: "pending" },
			"on partira pas",
			"fr"
		);
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
			answerClip(
				"un deux trois quatre",
				{ i: 0 },
				"un deux trois quatre",
				"fr"
			),
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
		inOtherField: false,
		hovered: false,
		selection: false
	};
	it("Space replays and ? reveals only with nothing typed", () => {
		expect(listenKeyAction(base)).toBe("play");
		expect(listenKeyAction({ ...base, composerEmpty: false })).toBe("pass");
		expect(listenKeyAction({ ...base, key: "?", code: "Slash" })).toBe(
			"reveal"
		);
		expect(
			listenKeyAction({
				...base,
				key: "?",
				code: "Slash",
				composerEmpty: false
			})
		).toBe("pass");
	});
	it("⌘Enter / Ctrl+Enter reveals, typed or not", () => {
		const enter = { ...base, key: "Enter", code: "Enter" };
		expect(listenKeyAction({ ...enter, meta: true })).toBe("reveal");
		expect(
			listenKeyAction({ ...enter, ctrl: true, composerEmpty: false })
		).toBe("reveal");
		expect(listenKeyAction({ ...enter, meta: true, alt: true })).toBe("pass");
		expect(listenKeyAction(enter)).toBe("pass");
	});

	it("A reveals outside the composer, unless a message is hovered or text selected", () => {
		const a = { ...base, key: "a", code: "KeyA", inComposer: false };
		expect(listenKeyAction(a)).toBe("reveal");
		expect(listenKeyAction({ ...a, inComposer: true })).toBe("pass");
		expect(listenKeyAction({ ...a, hovered: true })).toBe("pass");
		expect(listenKeyAction({ ...a, selection: true })).toBe("pass");
	});

	it("S slows outside the composer; a guess can start with s", () => {
		expect(listenKeyAction({ ...base, key: "s", code: "KeyS" })).toBe("pass");
		expect(
			listenKeyAction({ ...base, key: "s", code: "KeyS", inComposer: false })
		).toBe("slow");
	});
	it("⌥Space and ⌥S work mid-guess (matched on code: ⌥S types ß)", () => {
		expect(listenKeyAction({ ...base, alt: true, composerEmpty: false })).toBe(
			"play"
		);
		expect(
			listenKeyAction({
				...base,
				alt: true,
				key: "ß",
				code: "KeyS",
				composerEmpty: false
			})
		).toBe("slow");
		expect(
			listenKeyAction({ ...base, alt: true, key: "å", code: "KeyA" })
		).toBe("pass");
	});
	it("never fires outside a drill, in other fields, or with ⌘/Ctrl", () => {
		expect(listenKeyAction({ ...base, inDrill: false })).toBe("pass");
		expect(listenKeyAction({ ...base, inOtherField: true })).toBe("pass");
		expect(listenKeyAction({ ...base, meta: true })).toBe("pass");
		expect(
			listenKeyAction({
				...base,
				meta: true,
				key: "Enter",
				code: "Enter",
				inDrill: false
			})
		).toBe("pass");
		expect(listenKeyAction({ ...base, ctrl: true })).toBe("pass");
	});
});

describe("storyboardFrame", () => {
	// The Pakman video's sb0: 3x3 sheets, a frame every ~4.9 s.
	const board: ListenStoryboard = {
		width: 320,
		height: 180,
		rows: 3,
		columns: 3,
		fps: 0.2034548944337812,
		sheets: [
			{ url: "https://i.ytimg.com/sb/x/M0.jpg", duration: 44.2 },
			{ url: "https://i.ytimg.com/sb/x/M1.jpg", duration: 44.2 }
		]
	};

	it("finds the sheet and cell for a time", () => {
		expect(storyboardFrame(board, 0)).toEqual({
			url: "https://i.ytimg.com/sb/x/M0.jpg",
			col: 0,
			row: 0
		});
		// 5 s → frame 1; 20 s → frame 4 (middle cell).
		expect(storyboardFrame(board, 5)).toEqual({
			url: "https://i.ytimg.com/sb/x/M0.jpg",
			col: 1,
			row: 0
		});
		expect(storyboardFrame(board, 20)).toEqual({
			url: "https://i.ytimg.com/sb/x/M0.jpg",
			col: 1,
			row: 1
		});
		// 45 s → frame 9: the next sheet's first cell.
		expect(storyboardFrame(board, 45)).toEqual({
			url: "https://i.ytimg.com/sb/x/M1.jpg",
			col: 0,
			row: 0
		});
	});

	it("holds the last frame past the end and has none without sheets", () => {
		expect(storyboardFrame(board, 9999)).toEqual({
			url: "https://i.ytimg.com/sb/x/M1.jpg",
			col: 2,
			row: 2
		});
		expect(storyboardFrame({ ...board, sheets: [] }, 3)).toBeNull();
	});
});
