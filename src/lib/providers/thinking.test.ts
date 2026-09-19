import { describe, it, expect } from "vitest";
import { thinkingFor, resolveThinkingId, cycleThinkingId } from "./thinking";

describe("thinking", () => {
	it("offers the full effort dial on Muse Spark", () => {
		const support = thinkingFor("muse", "muse-spark-1.3-contributor");
		expect(support.native).toBe(true);
		expect(support.options.map((o) => o.id)).toEqual([
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh"
		]);
		expect(support.defaultId).toBe("medium");
		expect(support.wireFields("high")).toEqual({ reasoning_effort: "high" });
		expect(support.wireFields("bogus")).toEqual({});
		expect(support.promptHint("high")).toBe("");
	});

	it("offers off/high/max on DeepSeek v4", () => {
		const support = thinkingFor("deepseek", "deepseek-flash");
		expect(support.native).toBe(true);
		expect(support.options.map((o) => o.id)).toEqual(["off", "high", "max"]);
		expect(support.defaultId).toBe("high");
		expect(support.wireFields("max")).toEqual({
			thinking: { type: "enabled" },
			reasoning_effort: "max"
		});
		expect(support.wireFields("off")).toEqual({
			thinking: { type: "disabled" }
		});
		expect(support.wireFields("bogus")).toEqual({});
	});

	it("falls back to prompt hints for unknown providers and models", () => {
		const support = thinkingFor("whatever", "whatever-1");
		expect(support.native).toBe(false);
		expect(support.options.map((o) => o.id)).toEqual(["low", "medium", "high"]);
		expect(support.promptHint("low")).toBe(
			"Answer directly with minimal deliberation."
		);
		expect(support.promptHint("medium")).toBe("");
		expect(support.promptHint("high")).toBe(
			"Think carefully before answering."
		);
		expect(support.wireFields("high")).toEqual({});
		// A non-v4 DeepSeek model has no known knob either.
		expect(thinkingFor("deepseek", "deepseek-chat").native).toBe(false);
	});

	it("clamps unknown saved ids to the model's default", () => {
		const support = thinkingFor("muse", "muse-spark-1.3-contributor");
		expect(resolveThinkingId(support, "high")).toBe("high");
		expect(resolveThinkingId(support, "bogus")).toBe("medium");
		expect(resolveThinkingId(support, undefined)).toBe("medium");
	});

	it("cycles the dial and wraps around", () => {
		const support = thinkingFor("deepseek", "deepseek-v4-pro");
		expect(cycleThinkingId(support, "high", 1)).toBe("max");
		expect(cycleThinkingId(support, "max", 1)).toBe("off");
		expect(cycleThinkingId(support, "off", -1)).toBe("max");
		// Unknown starts from the default (high), then steps.
		expect(cycleThinkingId(support, "bogus", 1)).toBe("max");
	});
});
