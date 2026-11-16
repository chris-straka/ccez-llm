import { describe, it, expect } from "vitest";
import {
	thinkingFor,
	resolveThinkingId,
	cycleThinkingId,
	LOWEST_THINKING
} from "./thinking";

describe("thinking", () => {
	it("offers DeepSeek's real levels on every DeepSeek route", () => {
		for (const id of ["deepseek", "deepseek-login", "deepseek-mac"]) {
			const support = thinkingFor(id, "deepseek-flash");
			expect(support.native, id).toBe(true);
			expect(support.options.map((o) => o.id)).toEqual([
				"off",
				"low",
				"high",
				"max"
			]);
			// The chat starts at low; quick work always goes off.
			expect(support.defaultId).toBe("low");
			expect(support.quickId).toBe("off");
		}
		const support = thinkingFor("deepseek", "deepseek-flash");
		expect(support.wireFields("low")).toEqual({
			thinking: { type: "enabled" },
			reasoning_effort: "low"
		});
		expect(support.wireFields("max")).toEqual({
			thinking: { type: "enabled" },
			reasoning_effort: "max"
		});
		expect(support.wireFields("off")).toEqual({
			thinking: { type: "disabled" }
		});
		expect(support.wireFields("bogus")).toEqual({});
		expect(support.promptHint("high")).toBe("");
		// The model id may change; DeepSeek still takes the fields.
		expect(thinkingFor("deepseek", "deepseek-v4-pro").native).toBe(true);
	});

	it("never leaves DeepSeek's thinking unset: unknown saves resolve to low", () => {
		const support = thinkingFor("deepseek-mac", "deepseek-flash");
		expect(resolveThinkingId(support, undefined)).toBe("low");
		// An old save's Muse level means nothing here.
		expect(resolveThinkingId(support, "xhigh")).toBe("low");
		expect(support.wireFields(resolveThinkingId(support, "minimal"))).toEqual({
			thinking: { type: "enabled" },
			reasoning_effort: "low"
		});
	});

	it("falls back to prompt hints for unknown providers and models", () => {
		const support = thinkingFor("whatever", "whatever-1");
		expect(support.native).toBe(false);
		expect(support.quickId).toBeUndefined();
		expect(support.options.map((o) => o.id)).toEqual(["low", "medium", "high"]);
		expect(support.promptHint("low")).toBe(
			"Answer directly with minimal deliberation."
		);
		expect(support.promptHint("medium")).toBe("");
		expect(support.promptHint("high")).toBe(
			"Think carefully before answering."
		);
		expect(support.wireFields("high")).toEqual({});
	});

	it("clamps unknown saved ids to the model's default", () => {
		const support = thinkingFor("deepseek", "deepseek-flash");
		expect(resolveThinkingId(support, "high")).toBe("high");
		expect(resolveThinkingId(support, "bogus")).toBe("low");
		expect(resolveThinkingId(support, undefined)).toBe("low");
	});

	it("cycles the dial and wraps around", () => {
		const support = thinkingFor("deepseek", "deepseek-flash");
		expect(cycleThinkingId(support, "high", 1)).toBe("max");
		expect(cycleThinkingId(support, "max", 1)).toBe("off");
		expect(cycleThinkingId(support, "off", -1)).toBe("max");
		expect(cycleThinkingId(support, "off", 1)).toBe("low");
		// Unknown starts from the default (low), then steps.
		expect(cycleThinkingId(support, "bogus", 1)).toBe("high");
	});
});

describe("lowest thinking", () => {
	it("maps to each provider's bottom rung", () => {
		expect(
			resolveThinkingId(
				thinkingFor("deepseek", "deepseek-flash"),
				LOWEST_THINKING
			)
		).toBe("off");
		expect(
			resolveThinkingId(thinkingFor("custom:x", "any"), LOWEST_THINKING)
		).toBe("low");
	});
});
