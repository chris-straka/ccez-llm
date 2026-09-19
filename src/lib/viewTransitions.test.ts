// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
	viewTransitionsSupported,
	switchChatWithTransition,
	scopeMessagesTransition
} from "./viewTransitions";

afterEach(() => {
	vi.restoreAllMocks();
	delete (document as unknown as Record<string, unknown>).startViewTransition;
});

describe("view transitions for chat switching", () => {
	it("reports unsupported by default (instant cut)", () => {
		expect(viewTransitionsSupported()).toBe(false);
	});
	it("runs the mutation synchronously where unsupported", async () => {
		const mutate = vi.fn();
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
	it("routes the mutation through startViewTransition where supported", async () => {
		const mutate = vi.fn();
		(document as unknown as Record<string, unknown>).startViewTransition =
			vi.fn((opts: { update: () => void }) => {
				opts.update();
				return { finished: Promise.resolve() };
			});
		expect(viewTransitionsSupported()).toBe(true);
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
	it("scopes the snapshot name for the transition, then releases it", () => {
		const box = document.createElement("div");
		document.body.appendChild(box);
		const cleanup = scopeMessagesTransition(box);
		expect(box.style.getPropertyValue("view-transition-name")).toBe("messages");
		cleanup();
		expect(box.style.getPropertyValue("view-transition-name")).toBe("");
		// Idempotent: a double release never throws or re-adds.
		cleanup();
		expect(box.style.getPropertyValue("view-transition-name")).toBe("");
		box.remove();
	});
	it("scoping a missing list is a safe no-op", () => {
		expect(() => scopeMessagesTransition(null)()).not.toThrow();
	});
	it("falls back to a direct run when the transition throws", async () => {
		const mutate = vi.fn();
		(document as unknown as Record<string, unknown>).startViewTransition =
			vi.fn(() => {
				throw new Error("nope");
			});
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
	it("releases snapshot state at ready, ahead of finished", async () => {
		const mutate = vi.fn();
		const onSnapshot = vi.fn();
		let releaseReady!: () => void;
		let releaseFinished!: () => void;
		(document as unknown as Record<string, unknown>).startViewTransition =
			vi.fn((opts: { update: () => void }) => {
				opts.update();
				return {
					ready: new Promise<void>((resolve) => {
						releaseReady = resolve;
					}),
					finished: new Promise<void>((resolve) => {
						releaseFinished = resolve;
					})
				};
			});
		const done = switchChatWithTransition(mutate, onSnapshot);
		expect(mutate).toHaveBeenCalledTimes(1);
		// The animation phase hasn't run, but ready releases the scope.
		releaseReady();
		await Promise.resolve();
		expect(onSnapshot).toHaveBeenCalledTimes(1);
		// Finished re-fires as a guarantee (idempotent callbacks only).
		releaseFinished();
		await done;
		expect(onSnapshot).toHaveBeenCalledTimes(2);
	});
	it("releases snapshot state without a ready promise", async () => {
		const onSnapshot = vi.fn();
		(document as unknown as Record<string, unknown>).startViewTransition =
			vi.fn((opts: { update: () => void }) => {
				opts.update();
				return { finished: Promise.resolve() };
			});
		await switchChatWithTransition(vi.fn(), onSnapshot);
		expect(onSnapshot).toHaveBeenCalledTimes(1);
	});
});
