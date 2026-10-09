import { describe, expect, it } from "vitest";
import {
	activeChat,
	buildApiMessages,
	createChatState,
	drillContextBlock,
	type ChatMsgId
} from "./chat";
import type { ListenSession } from "./listen";
import {
	advanceDrill,
	answerDrillClip,
	drillStates,
	landGrade,
	markGrading,
	nextClipIndex,
	openClip,
	peekDrillClip,
	startDrill
} from "./listenChat";
import type { KeyValueStore } from "./settings";

const session: ListenSession = {
	videoId: "ujQZH4qyEgQ",
	lang: "fr",
	title: "Trump says the UNTHINKABLE about DEADLY PLAGUE",
	channel: "David Pakman",
	channelUrl: "https://www.youtube.com/channel/UCvixJtaXuNdMPUGdOPcY8Ag",
	thumbnail: "",
	audio: "dub",
	clips: [
		{ i: 0, start: 0, end: 8, text: "Parlons de la peste." },
		{
			i: 1,
			start: 8,
			end: 10.7,
			text: "Nous couvrons ce sujet de manière approfondie."
		}
	]
};

function fresh() {
	const data = new Map<string, string>();
	const store: KeyValueStore = {
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v)
	};
	const state = createChatState(store);
	const chat = activeChat(state);
	return { state, chat, store };
}

describe("drill chat", () => {
	it("starts on clip 1 with the video's title and the drill's language", () => {
		const { state, chat, store } = fresh();
		const id = startDrill(state, chat.id, session, store);
		const c = activeChat(state);
		expect(c.title).toBe(session.title);
		expect(c.replyLang).toBe("fr");
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]?.id).toBe(id);
		expect(openClip(c)?.clip?.i).toBe(0);
		// Nothing is revealed before the guess.
		expect(c.messages[0]?.content).toBe("");
	});

	it("answering reveals the transcript at once; the next clip follows", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		if (!first) throw new Error("no clip");
		const before = activeChat(state).messages[0];
		const clip = answerDrillClip(state, chat.id, first, "parlons de la", store);
		expect(clip?.heard).toBeCloseTo(3 / 4);
		const after = activeChat(state).messages[0];
		// Replaced, not mutated.
		expect(after).not.toBe(before);
		expect(after?.content).toBe("Parlons de la peste.");
		// A second answer to the same clip is ignored.
		expect(answerDrillClip(state, chat.id, first, "x", store)).toBeNull();
		advanceDrill(state, chat.id, store);
		expect(openClip(activeChat(state))?.clip?.i).toBe(1);
		expect(nextClipIndex(activeChat(state))).toBe(2);
	});

	it("grading lands on its own clip, after or before the answer", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		if (!first) throw new Error("no clip");
		advanceDrill(state, chat.id, store);
		// Clip 2 graded early (prefetch) stays hidden until answered.
		markGrading(state, chat.id, 1, store);
		landGrade(
			state,
			chat.id,
			1,
			{ translation: "We cover it in depth.", notes: [] },
			store
		);
		expect(activeChat(state).messages[1]?.content).toBe("");
		expect(activeChat(state).messages[1]?.clip?.grade).toBe("done");
		// Clip 1: answered, then graded.
		answerDrillClip(state, chat.id, first, null, store);
		landGrade(
			state,
			chat.id,
			0,
			{
				translation: "Let's talk about the plague.",
				notes: [{ expr: "Parlons de", meaning: "let's talk about" }]
			},
			store
		);
		// The body stays the transcript; the English rides the clip.
		const graded = activeChat(state).messages[0];
		expect(graded?.content).toBe("Parlons de la peste.");
		expect(graded?.clip?.translation).toBe("Let's talk about the plague.");
		expect(graded?.clip?.notes).toEqual([
			{ expr: "Parlons de", meaning: "let's talk about" }
		]);
		landGrade(state, chat.id, 0, null, store);
		expect(activeChat(state).messages[0]?.clip?.grade).toBe("error");
	});

	it("ends with one tally row after the last clip", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		if (!first) throw new Error("no clip");
		answerDrillClip(state, chat.id, first, "parlons de la peste", store);
		const second = advanceDrill(state, chat.id, store);
		if (!second) throw new Error("no clip 2");
		answerDrillClip(state, chat.id, second, "", store);
		const end = advanceDrill(state, chat.id, store);
		const c = activeChat(state);
		expect(c.messages.at(-1)?.id).toBe(end);
		expect(c.messages.at(-1)?.drillEnd).toBe(true);
		expect(openClip(c)).toBeNull();
		expect(advanceDrill(state, chat.id, store)).toBeNull();
		expect(drillStates(c).map((s) => s.heard)).toEqual([1, 0]);
	});

	it("an empty clip list never starts", () => {
		const { state, chat, store } = fresh();
		expect(
			startDrill(state, chat.id, { ...session, clips: [] }, store)
		).toBeNull();
		expect(activeChat(state).listen).toBeUndefined();
	});
});

describe("drill chat as a conversation", () => {
	it("Show text reveals the waiting clip without answering it", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		if (!first) throw new Error("no clip");
		const shown = peekDrillClip(state, chat.id, first, store);
		const c = activeChat(state);
		expect(shown?.peeked).toBe(true);
		expect(c.messages[0]?.content).toBe("Parlons de la peste.");
		expect(openClip(c)?.id).toBe(first);
	});

	it("the waiting clip stays waiting under questions and replies", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		const c = activeChat(state);
		c.messages = [
			...c.messages,
			{
				id: "q" as ChatMsgId,
				role: "user",
				content: "why?",
				usage: null,
				error: null
			},
			{
				id: "r" as ChatMsgId,
				role: "assistant",
				content: "Because.",
				usage: null,
				error: null
			}
		];
		expect(openClip(activeChat(state))?.id).toBe(first);
	});

	it("questions read against the heard clips, never the clip rows", () => {
		const { state, chat, store } = fresh();
		const first = startDrill(state, chat.id, session, store);
		if (!first) throw new Error("no clip");
		answerDrillClip(state, chat.id, first, "parlons", store);
		advanceDrill(state, chat.id, store);
		const c = activeChat(state);
		c.messages = [
			...c.messages,
			{
				id: "q" as ChatMsgId,
				role: "user",
				content: "what's peste?",
				usage: null,
				error: null
			}
		];
		const block = drillContextBlock(c) ?? "";
		expect(block).toContain(session.title);
		expect(block).toContain("- Parlons de la peste.");
		// Clip 2 still waits: never spoiled.
		expect(block).not.toContain("Nous couvrons");
		const api = buildApiMessages(c, "sys");
		expect(api.map((m) => m.role)).toEqual(["system", "system", "user"]);
		expect(api.at(-1)?.content).toBe("what's peste?");
		expect(drillContextBlock(activeChat(createChatState()))).toBeNull();
	});
});
