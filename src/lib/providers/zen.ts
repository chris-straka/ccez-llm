/**
 * OpenCode Zen (https://opencode.ai/docs/zen): one key, many vendors'
 * models behind https://opencode.ai/zen/v1. Zen serves each model on
 * its vendor's own wire format — `/chat/completions` (OpenAI-compatible,
 * beta on Zen), `/responses` (GPT, Grok, Muse Spark), `/messages`
 * (Claude, most Qwen), `/models/{id}` (Gemini), `/systemone` (Jev) —
 * and `/zen/v1/models` lists ids only, with no endpoint or price.
 * This app speaks `/chat/completions` alone, so the families below
 * (from the docs' endpoint table, 2026-10-07) decide which listed
 * models it offers; an unknown family stays hidden rather than fail
 * on the wrong endpoint.
 */

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";

/** Families Zen serves on `/chat/completions`. */
const CHAT_FAMILIES =
	/^(deepseek|glm|minimax|kimi|mistral|big-pickle|space-bunny|longcat|exo|fledge|mimo|ling|nemotron)(-|$)/;

/** One-off chat models from families that otherwise live elsewhere. */
const CHAT_EXCEPTIONS = new Set(["qwen3.8-max"]);

/** Whether Zen serves this model on `/chat/completions`. */
export function zenChatModel(id: string): boolean {
	return CHAT_FAMILIES.test(id) || CHAT_EXCEPTIONS.has(id);
}

/** Free models: a `-free` suffix, plus Big Pickle (free without one). */
export function zenFreeModel(id: string): boolean {
	return id.endsWith("-free") || id === "big-pickle";
}

/** The picker's list: chat models only, free ones first, each run sorted. */
export function zenModelList(ids: readonly string[]): string[] {
	const chat = [...new Set(ids)].filter(zenChatModel).sort();
	return [
		...chat.filter(zenFreeModel),
		...chat.filter((id) => !zenFreeModel(id))
	];
}
