import { isDeepSeekProvider } from "./deepseek";

/**
 * Native thinking controls, per provider and model.
 *
 * A "native knob" is the provider's own API parameter for reasoning depth
 * (a JSON field on `/chat/completions`), as opposed to a prose hint in the
 * system prompt. Each provider names it differently and offers different
 * levels, so the settings UI and the request body both read from these
 * tables: a future model slots in by adding a matcher here, with no UI
 * or plumbing changes.
 *
 * Levels are provider-native ids (DeepSeek's `off/low/high/max`), not a
 * shared low/medium/high: only what the model actually offers is ever
 * shown or sent.
 */
export interface ThinkingOption {
	id: string;
	label: string;
}

export interface ThinkingSupport {
	/** Levels the model actually offers, in dial order. */
	options: ThinkingOption[];
	/** Used when the saved id is missing or unknown. */
	defaultId: string;
	/** The level quick work (notes, titles, summaries) always sends,
	 * whatever the chat's dial says; absent: the call's own level. */
	quickId?: string;
	/** True when levels go out as API parameters; false when they only
	 * become system-prompt hints (generic providers). */
	native: boolean;
	/** Extra `/chat/completions` body fields for an option. Total:
	 * unknown ids send nothing. */
	wireFields(optionId: string): Record<string, unknown>;
	/** System-prompt hint for an option; "" when the wire does the work. */
	promptHint(optionId: string): string;
}

/** Prose hints for providers with no native knob (the old behavior). */
const GENERIC_HINTS: Record<string, string> = {
	low: "Answer directly with minimal deliberation.",
	medium: "",
	high: "Think carefully before answering."
};

function generic(): ThinkingSupport {
	const options = [
		{ id: "low", label: "Low" },
		{ id: "medium", label: "Medium" },
		{ id: "high", label: "High" }
	];
	return {
		options,
		defaultId: "medium",
		native: false,
		wireFields: () => ({}),
		promptHint: (optionId) => GENERIC_HINTS[optionId] ?? ""
	};
}

/**
 * DeepSeek: a `thinking` toggle plus top-level `reasoning_effort`
 * (`low`, `high`, `max`; DeepSeek maps any other level onto those).
 * Thinking is ON at high when the fields are left out, so every
 * request names its level: Off sends `{"type": "disabled"}` and the
 * model answers without a reasoning pass. Quick work (notes, titles,
 * summaries, translation) always goes Off; the chat starts at Low.
 */
function deepseek(): ThinkingSupport {
	return {
		options: [
			{ id: "off", label: "Off" },
			{ id: "low", label: "Low" },
			{ id: "high", label: "High" },
			{ id: "max", label: "Max" }
		],
		defaultId: "low",
		quickId: "off",
		native: true,
		wireFields: (optionId) => {
			if (optionId === "off") return { thinking: { type: "disabled" } };
			if (optionId === "low" || optionId === "high" || optionId === "max")
				return { thinking: { type: "enabled" }, reasoning_effort: optionId };
			return {};
		},
		promptHint: () => ""
	};
}

/**
 * Thinking support for a provider id + model id. Unknown providers and
 * models fall back to generic prompt hints, so custom endpoints keep
 * working with no wire changes.
 */
export function thinkingFor(
	providerId: string,
	model: string
): ThinkingSupport {
	// Every DeepSeek model takes these fields; the model id may change.
	void model;
	if (isDeepSeekProvider(providerId)) return deepseek();
	return generic();
}

/** Clamp a saved id to what the model offers. */
/** Request-only id: the provider's bottom rung (Off where one exists,
else Minimal / Low). Never saved as a setting. */
export const LOWEST_THINKING = "lowest";

export function resolveThinkingId(
	support: ThinkingSupport,
	saved: string | undefined
): string {
	if (saved === LOWEST_THINKING)
		return support.options[0]?.id ?? support.defaultId;
	if (saved !== undefined && support.options.some((o) => o.id === saved))
		return saved;
	return support.defaultId;
}

/** Step the dial one rung, wrapping around. */
export function cycleThinkingId(
	support: ThinkingSupport,
	current: string,
	direction: 1 | -1
): string {
	const ids = support.options.map((o) => o.id);
	const at = ids.indexOf(current);
	const from = at < 0 ? ids.indexOf(support.defaultId) : at;
	const next = (from + direction + ids.length) % ids.length;
	return ids[next] ?? support.defaultId;
}
