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
 * Levels are provider-native ids (Meta's `minimal…xhigh`, DeepSeek's
 * `off/high/max`), not a shared low/medium/high: only what the model
 * actually offers is ever shown or sent.
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
 * Muse Spark on the Meta Model API: top-level `reasoning_effort` from
 * `minimal` to `xhigh`. There is no off switch — `none` is a 400 —
 * so even Minimal still reasons.
 */
function metaSpark(): ThinkingSupport {
	const options = [
		{ id: "minimal", label: "Minimal" },
		{ id: "low", label: "Low" },
		{ id: "medium", label: "Medium" },
		{ id: "high", label: "High" },
		{ id: "xhigh", label: "Max" }
	];
	const ids = new Set(options.map((o) => o.id));
	return {
		options,
		defaultId: "medium",
		native: true,
		wireFields: (optionId) =>
			ids.has(optionId) ? { reasoning_effort: optionId } : {},
		promptHint: () => ""
	};
}

/**
 * DeepSeek (`deepseek-flash`, `deepseek-v4-*`): top-level `reasoning_effort` (`high`
 * the default, `max` for harder pushes) plus a `thinking` toggle. Effort
 * only spans two rungs, so Off/High/Max is the whole dial. Off fully
 * disables thinking rather than lowering it — the model then answers
 * without a reasoning pass.
 */
function deepseekV4(): ThinkingSupport {
	return {
		options: [
			{ id: "off", label: "Off" },
			{ id: "high", label: "High" },
			{ id: "max", label: "Max" }
		],
		defaultId: "high",
		native: true,
		wireFields: (optionId) => {
			if (optionId === "off") return { thinking: { type: "disabled" } };
			if (optionId === "high" || optionId === "max")
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
	if (providerId === "muse") return metaSpark();
	if (providerId === "deepseek" && /v4|flash/i.test(model)) return deepseekV4();
	return generic();
}

/** Clamp a saved id to what the model offers. */
export function resolveThinkingId(
	support: ThinkingSupport,
	saved: string | undefined
): string {
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
