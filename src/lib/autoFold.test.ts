import { describe, expect, it } from "vitest";
import { autoFoldPlan } from "./autoFold";

const thread = [
	{ id: "u1", role: "user" },
	{ id: "a1", role: "assistant" },
	{ id: "u2", role: "user" },
	{ id: "a2", role: "assistant" }
];
const none = new Set<string>();

describe("autoFoldPlan", () => {
	it("folds every AI reply but the newest", () => {
		const plan = autoFoldPlan(
			thread,
			{ user: false, assistant: true },
			none,
			none,
			none
		);
		expect(plan.fold).toEqual(["a1"]);
	});

	it("folds my older messages when that role is on", () => {
		const plan = autoFoldPlan(
			thread,
			{ user: true, assistant: true },
			none,
			none,
			none
		);
		expect(plan.fold).toEqual(["u1", "a1"]);
	});

	it("folds nothing with both off", () => {
		expect(
			autoFoldPlan(thread, { user: false, assistant: false }, none, none, none)
				.fold
		).toEqual([]);
	});

	it("leaves a message unfolded by hand alone", () => {
		const first = autoFoldPlan(
			thread,
			{ user: false, assistant: true },
			none,
			none,
			none
		);
		// The reader reopened a1: it is seen, so the next pass skips it.
		const again = autoFoldPlan(
			thread,
			{ user: false, assistant: true },
			first.seen,
			new Set(["a1"]),
			none
		);
		expect(again.fold).toEqual([]);
	});

	it("folds a message reopened by hand again at the next send", () => {
		const roles = { user: true, assistant: true };
		const first = autoFoldPlan(thread, roles, none, none, none);
		// The reader reopened a1; the effect reruns before any send.
		const folded = new Set(["u1"]);
		const still = autoFoldPlan(
			thread,
			roles,
			first.seen,
			new Set(["u1", "a1"]),
			folded,
			first.round
		);
		expect(still.fold).toEqual([]);
		// Sending u3 starts a round: a1 folds again, u2 and a2 fold too.
		const sent = [
			...thread,
			{ id: "u3", role: "user" },
			{ id: "a3", role: "assistant" }
		];
		const next = autoFoldPlan(
			sent,
			roles,
			still.seen,
			new Set(["u1", "a1"]),
			folded,
			still.round
		);
		expect(next.fold).toEqual(["a1", "u2", "a2"]);
	});

	it("keeps a message open while a note on it waits for its answer", () => {
		const roles = { user: false, assistant: true };
		const first = autoFoldPlan(thread, roles, none, none, none);
		const sent = [
			...thread,
			{ id: "u3", role: "user" },
			{ id: "a3", role: "assistant" }
		];
		const waiting = autoFoldPlan(
			sent,
			roles,
			first.seen,
			new Set(["a1"]),
			new Set(["a1"]),
			first.round,
			new Set(["a2"])
		);
		expect(waiting.fold).toEqual([]);
		// The answer lands mid-round: the message stays put under the reader.
		const answered = autoFoldPlan(
			sent,
			roles,
			waiting.seen,
			new Set(["a1"]),
			new Set(["a1"]),
			waiting.round
		);
		expect(answered.fold).toEqual([]);
		// The next send folds it.
		const later = [
			...sent,
			{ id: "u4", role: "user" },
			{ id: "a4", role: "assistant" }
		];
		expect(
			autoFoldPlan(
				later,
				roles,
				answered.seen,
				new Set(["a1"]),
				new Set(["a1"]),
				answered.round
			).fold
		).toEqual(["a2", "a3"]);
	});

	it("folds the previous reply once a new one arrives", () => {
		const first = autoFoldPlan(
			thread,
			{ user: false, assistant: true },
			none,
			none,
			none
		);
		const grown = [
			...thread,
			{ id: "u3", role: "user" },
			{ id: "a3", role: "assistant" }
		];
		const next = autoFoldPlan(
			grown,
			{ user: false, assistant: true },
			first.seen,
			new Set(["a1"]),
			new Set(["a1"])
		);
		expect(next.fold).toEqual(["a2"]);
	});

	it("gives back what it folded when its role switches off", () => {
		const first = autoFoldPlan(
			thread,
			{ user: false, assistant: true },
			none,
			none,
			none
		);
		const off = autoFoldPlan(
			thread,
			{ user: false, assistant: false },
			first.seen,
			new Set(["a1"]),
			new Set(["a1"])
		);
		expect(off.release).toEqual(["a1"]);
		expect(off.seen.has("a1")).toBe(false);
	});

	it("skips messages that rest folded on their own", () => {
		const withOpener = [{ id: "n", role: "user", selfFolded: true }, ...thread];
		const plan = autoFoldPlan(
			withOpener,
			{ user: true, assistant: false },
			none,
			none,
			none
		);
		expect(plan.fold).toEqual(["u1"]);
	});
});
