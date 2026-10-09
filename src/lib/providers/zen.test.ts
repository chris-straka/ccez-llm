import { describe, expect, it } from "vitest";
import { zenChatModel, zenFreeModel, zenModelList } from "./zen";

/** `/zen/v1/models` ids as served on 2026-10-07 (public endpoint). */
const LISTED = [
	"claude-opus-5-5",
	"claude-haiku-4-5",
	"gemini-3.8-flash",
	"gpt-6-sol",
	"gpt-5.4-mini",
	"grok-4.7",
	"muse-spark-1.3",
	"mistral-large-4",
	"deepseek-v4.1-flash",
	"deepseek-v4-pro",
	"glm-5.3",
	"minimax-m3",
	"kimi-k3",
	"qwen3.8-flash",
	"qwen3.6-plus",
	"qwen3.8-max",
	"jev-1.13",
	"big-pickle",
	"jev-1.13-free",
	"exo-free",
	"muse-spark-1.3-contributor-free",
	"mimo-v2.6-flash-free",
	"space-bunny-free",
	"longcat-2.5-preview-free",
	"ling-3.0-flash-fin-free",
	"nemotron-3-ultra-free",
	"fledge-alpha-free",
	"ling-3.1-flash-free"
];

describe("OpenCode Zen models", () => {
	it("offers only models Zen serves on /chat/completions", () => {
		for (const id of [
			"deepseek-v4-pro",
			"glm-5.3",
			"minimax-m3",
			"kimi-k3",
			"mistral-large-4",
			"qwen3.8-max",
			"big-pickle",
			"exo-free"
		])
			expect(zenChatModel(id), id).toBe(true);
		// /responses, /messages, /models/{id}, /systemone, and unknowns.
		for (const id of [
			"gpt-6-sol",
			"grok-4.7",
			"muse-spark-1.3",
			"muse-spark-1.3-contributor-free",
			"claude-opus-5-5",
			"qwen3.8-flash",
			"qwen3.6-plus",
			"gemini-3.8-flash",
			"jev-1.13-free",
			"new-family-x"
		])
			expect(zenChatModel(id), id).toBe(false);
	});

	it("marks the free models", () => {
		expect(zenFreeModel("big-pickle")).toBe(true);
		expect(zenFreeModel("nemotron-3-ultra-free")).toBe(true);
		expect(zenFreeModel("deepseek-v4-pro")).toBe(false);
	});

	it("lists free chat models first, then paid, each sorted, deduped", () => {
		expect(zenModelList([...LISTED, "big-pickle"])).toEqual([
			"big-pickle",
			"exo-free",
			"fledge-alpha-free",
			"ling-3.0-flash-fin-free",
			"ling-3.1-flash-free",
			"longcat-2.5-preview-free",
			"mimo-v2.6-flash-free",
			"nemotron-3-ultra-free",
			"space-bunny-free",
			"deepseek-v4-pro",
			"deepseek-v4.1-flash",
			"glm-5.3",
			"kimi-k3",
			"minimax-m3",
			"mistral-large-4",
			"qwen3.8-max"
		]);
	});
});
