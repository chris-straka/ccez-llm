import { describe, expect, it } from "vitest";
import { DEFAULT_SEGMENT, joinTokens, parseJson3, segmentClips, type Token } from "./listenClips";

/** The opening of a real auto-dub's speech recognition (David Pakman,
 * ujQZH4qyEgQ, fr-orig): one seg per word, punctuation as its own seg,
 * line-break events in between. */
const ASR = JSON.stringify({
	events: [
		{ tStartMs: 0, dDurationMs: 3339 },
		{
			tStartMs: 100,
			dDurationMs: 4238,
			segs: [
				{ utf8: "Parlons" },
				{ utf8: " de", tOffsetMs: 846 },
				{ utf8: " la", tOffsetMs: 1164 },
				{ utf8: " peste", tOffsetMs: 1481 },
				{ utf8: ".", tOffsetMs: 2011 },
				{ utf8: " Donald", tOffsetMs: 2459 },
				{ utf8: " Trump", tOffsetMs: 2848 },
				{ utf8: " a", tOffsetMs: 3182 }
			]
		},
		{ tStartMs: 3338, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
		{
			tStartMs: 3394,
			dDurationMs: 3004,
			segs: [
				{ utf8: " été" },
				{ utf8: " interrogé", tOffsetMs: 334 },
				{ utf8: " sur", tOffsetMs: 946 },
				{ utf8: " la", tOffsetMs: 1169 },
				{ utf8: " possibilité", tOffsetMs: 1336 }
			]
		},
		{
			tStartMs: 5454,
			dDurationMs: 3060,
			segs: [
				{ utf8: " d'une" },
				{ utf8: " épidémie", tOffsetMs: 334 },
				{ utf8: " de", tOffsetMs: 946 },
				{ utf8: " peste", tOffsetMs: 1113 },
				{ utf8: " mortelle", tOffsetMs: 1448 },
				{ utf8: " en", tOffsetMs: 1949 }
			]
		},
		{
			tStartMs: 7570,
			dDurationMs: 2783,
			segs: [
				{ utf8: " Russie" },
				{ utf8: ".", tOffsetMs: 334 },
				{ utf8: " Nous", tOffsetMs: 550 },
				{ utf8: " couvrons", tOffsetMs: 796 },
				{ utf8: " ce", tOffsetMs: 1240 },
				{ utf8: " sujet", tOffsetMs: 1388 },
				{ utf8: " de", tOffsetMs: 1684 }
			]
		},
		{
			tStartMs: 9402,
			dDurationMs: 3290,
			segs: [{ utf8: " manière" }, { utf8: " approfondie", tOffsetMs: 444 }, { utf8: ".", tOffsetMs: 987 }]
		}
	]
});

/** Uploaded creator-dub subtitles (MrBeast, Af6i6ChAVTw, fr): styled
 * segs with zero-width padding, no offsets, every cue twice. */
const ZW = "​";
function cue(start: number, dur: number, ...lines: string[]): object {
	const segs = [{ utf8: ZW }, { utf8: ZW }];
	lines.forEach((line, k) => {
		if (k > 0) segs.push({ utf8: `${ZW}\n${ZW}` });
		segs.push({ utf8: `${ZW} ${ZW}${line}${ZW} ${ZW}` });
	});
	return { tStartMs: start, dDurationMs: dur, segs };
}
const UPLOADED = JSON.stringify({
	events: [
		cue(0, 2067, "Vous pouvez retirer vos bandeaux !"),
		cue(0, 2067, "Vous pouvez retirer vos bandeaux !"),
		cue(3000, 3467, "Celui qui sera le dernier ", "à quitter cette villa la gardera."),
		cue(3000, 3467, "Celui qui sera le dernier ", "à quitter cette villa la gardera."),
		cue(6534, 1000, "On partira pas."),
		cue(7601, 1333, "Moi ? Jamais."),
		cue(9000, 1434, "On va vite le découvrir."),
		cue(14200, 3401, "cette immense villa ", "d'une valeur d'un million de dollars…"),
		cue(17634, 3167, "… ne contient pas une, deux, ", "trois, quatre, cinq, six,"),
		cue(20868, 1432, "mais bien sept chambres.")
	]
});

describe("parseJson3", () => {
	it("reads word-timed recognition with punctuation attached", () => {
		const tokens = parseJson3(ASR);
		expect(tokens.slice(0, 5).map((t) => t.text)).toEqual(["Parlons", "de", "la", "peste.", "Donald"]);
		expect(tokens[0]?.start).toBeCloseTo(0.1);
		expect(tokens[3]?.start).toBeCloseTo(1.581);
		// A word ends before the next starts, and never runs absurdly long.
		for (const [k, t] of tokens.entries()) {
			expect(t.end).toBeGreaterThan(t.start);
			const next = tokens[k + 1];
			if (next) expect(t.end).toBeLessThanOrEqual(next.start + 1e-9);
		}
		expect(joinTokens(tokens)).toBe(
			"Parlons de la peste. Donald Trump a été interrogé sur la possibilité d'une épidémie de peste mortelle en Russie. Nous couvrons ce sujet de manière approfondie."
		);
	});

	it("reads uploaded cues: no zero-width junk, duplicates dropped, words spread", () => {
		const tokens = parseJson3(UPLOADED);
		const text = joinTokens(tokens);
		expect(text).not.toMatch(/​/);
		expect(text.match(/bandeaux/g)).toHaveLength(1);
		expect(text).toContain("Moi ? Jamais.");
		// The continuation "…" opening a cue is layout, not speech.
		expect(text).toContain("dollars… ne contient");
		const villa = tokens.find((t) => t.text === "Celui");
		expect(villa?.start).toBeCloseTo(3);
		// Words keep a natural pace inside a cue held on screen.
		const lastOfCue = tokens.find((t) => t.text === "gardera.");
		expect(lastOfCue && lastOfCue.end).toBeLessThanOrEqual(3 + 3.467 + 1e-9);
	});

	it("drops sound tags and survives junk", () => {
		const doc = JSON.stringify({
			events: [
				{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "[Musique]" }] },
				{ tStartMs: 1000, segs: [{ utf8: "Bonjour" }, { utf8: " [", tOffsetMs: 400 }, { utf8: "rires]", tOffsetMs: 500 }, { utf8: " tout", tOffsetMs: 900 }] }
			]
		});
		expect(joinTokens(parseJson3(doc))).toBe("Bonjour tout");
		expect(parseJson3("not json")).toEqual([]);
		expect(parseJson3("{}")).toEqual([]);
	});

	it("joins unspaced scripts without spaces", () => {
		const doc = JSON.stringify({
			events: [{ tStartMs: 0, segs: [{ utf8: "今日" }, { utf8: "は", tOffsetMs: 300 }, { utf8: "雨", tOffsetMs: 500 }, { utf8: "です", tOffsetMs: 700 }, { utf8: "。", tOffsetMs: 900 }] }]
		});
		expect(joinTokens(parseJson3(doc))).toBe("今日は雨です。");
	});
});

function words(spec: string, gap = 0.1, per = 0.3): Token[] {
	let at = 0;
	return spec.split(" ").map((text) => {
		const t: Token = { text, start: at, end: at + per, space: true };
		at += per + (text.endsWith("|") ? 1.5 : gap);
		t.text = text.replace("|", "");
		return t;
	});
}

describe("segmentClips", () => {
	it("cuts real recognition at sentence ends, with short sentences riding along", () => {
		const clips = segmentClips(parseJson3(ASR));
		expect(clips.map((c) => c.text)).toEqual([
			// 1.5 s opener joins the next sentence (8 s cap holds).
			"Parlons de la peste. Donald Trump a été interrogé sur la possibilité d'une épidémie de peste mortelle en Russie.",
			"Nous couvrons ce sujet de manière approfondie."
		]);
		expect(clips.map((c) => c.i)).toEqual([0, 1]);
	});

	it("keeps every clip within bounds and in order, without overlaps", () => {
		const clips = segmentClips(parseJson3(UPLOADED));
		for (const [k, c] of clips.entries()) {
			expect(c.end - c.start).toBeLessThanOrEqual(DEFAULT_SEGMENT.maxSec + 1.5);
			const next = clips[k + 1];
			if (next) expect(c.end).toBeLessThanOrEqual(next.start + 1e-9);
		}
		expect(clips.map((c) => c.text).join(" ")).toBe(joinTokens(parseJson3(UPLOADED)));
	});

	it("splits a long run at its best clause boundary", () => {
		// 30 words at 0.4 s each (12 s), one comma in the middle.
		const spec = Array.from({ length: 30 }, (_, k) => (k === 13 ? "mot," : k === 29 ? "fin." : "mot")).join(" ");
		const clips = segmentClips(words(spec));
		expect(clips.length).toBe(2);
		expect(clips[0]?.text.endsWith("mot,")).toBe(true);
		expect(clips[0]?.text.split(" ")).toHaveLength(14);
	});

	it("cuts at a long pause when recognition has no punctuation", () => {
		const clips = segmentClips(words("un deux trois quatre cinq six sept| huit neuf dix onze douze treize"));
		expect(clips.map((c) => c.text)).toEqual(["un deux trois quatre cinq six sept", "huit neuf dix onze douze treize"]);
	});

	it("pads clips without crossing into the neighbor's words", () => {
		const clips = segmentClips(words("Un deux trois quatre cinq six sept huit.| Neuf dix onze douze treize quatorze quinze."));
		const [a, b] = clips;
		expect(a?.start).toBe(0);
		expect(a && b && a.end <= b.start).toBe(true);
		expect(b && b.start < 0.4 * 8 + 1.5).toBe(true);
	});

	it("merges a too-short tail into the clip before", () => {
		const clips = segmentClips(words("Un deux trois quatre cinq six sept huit. Oui."));
		expect(clips).toHaveLength(1);
		expect(clips[0]?.text).toBe("Un deux trois quatre cinq six sept huit. Oui.");
	});

	it("returns nothing for nothing", () => {
		expect(segmentClips([])).toEqual([]);
	});
});
