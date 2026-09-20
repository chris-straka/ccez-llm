import type { NativeVoice } from "./nativeTts";

/**
 * Whether any installed voice is worth picking the System-voices engine
 * for: premium (quality 3) or enhanced (quality 2). Default-tier voices
 * (quality 0/1, including Siri personas) are always reachable through
 * Auto, so they don't count.
 */
export function hasQualityVoices(voices: NativeVoice[]): boolean {
	return voices.some((voice) => voice.quality >= 2);
}

/** Display tier for one installed voice (drives the picker's option labels). */
export function tierLabel(voice: NativeVoice): string {
	if (voice.quality >= 3) return "premium";
	if (voice.quality === 2) return "enhanced";
	if (voice.id.includes(".eloquence.")) return "Siri";
	return "default";
}

export interface VoiceOption {
	id: string;
	name: string;
	lang: string;
	tier: string;
}

function toOption(voice: NativeVoice): VoiceOption {
	return {
		id: voice.id,
		name: voice.name,
		lang: voice.lang,
		tier: tierLabel(voice)
	};
}

/**
 * The voice Auto would actually use for `lang`: the saved pick when it
 * matches the language family, else the best installed voice (exact
 * locale first, then quality, then name). Mirrors the Rust auto-pick
 * closely enough for a picker label — the bridge stays authoritative at
 * speak time (System Voice id, registry order, and eloquence tie-breaks
 * live there). Pure and unit-tested.
 */
export function autoVoiceForLang(
	voices: NativeVoice[],
	lang: string,
	savedId: string | null
): VoiceOption | null {
	const exactTag = lang.trim().toLowerCase();
	const primary = exactTag.split(/[-_]/)[0] ?? "";
	const family = (tag: string): boolean =>
		tag.toLowerCase().split(/[-_]/)[0] === primary;
	const saved = savedId
		? voices.find((voice) => voice.id === savedId)
		: undefined;
	if (saved && family(saved.lang)) return toOption(saved);
	let best: NativeVoice | null = null;
	let bestScore = Number.MIN_SAFE_INTEGER;
	for (const voice of voices) {
		const exact = voice.lang.toLowerCase() === exactTag;
		if (!exact && !family(voice.lang)) continue;
		const score = voice.quality + (exact ? 10 : 0);
		if (
			best === null ||
			score > bestScore ||
			(score === bestScore && voice.name < best.name)
		) {
			best = voice;
			bestScore = score;
		}
	}
	return best ? toOption(best) : null;
}

function byName(a: VoiceOption, b: VoiceOption): number {
	return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Installed voices for the settings picker: the current language —
 * exact locale first (en-US), then the same primary language (en-GB's
 * Jamie is an English voice for en-US purposes) — premium and enhanced
 * only, sorted by name within each group. Default-tier voices (compact,
 * novelty, Siri personas) are always reachable through Auto, so listing
 * them only adds noise — and unrelated languages resolve through
 * auto-pick at speak time. Pure and unit-tested.
 */
export function voicesForLang(
	voices: NativeVoice[],
	lang: string
): VoiceOption[] {
	return groupByLang(voices, lang, 2);
}

/**
 * Installed voices for the Android settings picker: same exact-locale-
 * then-language grouping, but no quality gate — Android has no
 * premium/enhanced tiers, so the gate would hide every voice.
 */
export function allVoicesForLang(
	voices: NativeVoice[],
	lang: string
): VoiceOption[] {
	return groupByLang(voices, lang, 0);
}

/**
 * Distinct installed language tags for the Android language picker
 * (en-US, ja-JP, …): exact tags as the engine reports them, sorted,
 * blanks dropped. Pure and unit-tested.
 */
export function installedLangs(voices: NativeVoice[]): string[] {
	const seen = new Set<string>();
	for (const voice of voices) {
		const tag = voice.lang.trim();
		if (tag) seen.add(tag);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

function groupByLang(
	voices: NativeVoice[],
	lang: string,
	minQuality: number
): VoiceOption[] {
	const exactTag = lang.trim().toLowerCase();
	const primary = exactTag.split(/[-_]/)[0] ?? "";
	const exact: VoiceOption[] = [];
	const related: VoiceOption[] = [];
	for (const voice of voices) {
		if (voice.quality < minQuality) continue;
		const tag = voice.lang.toLowerCase();
		if (tag === exactTag) exact.push(toOption(voice));
		else if (tag.split(/[-_]/)[0] === primary) related.push(toOption(voice));
	}
	exact.sort(byName);
	related.sort(byName);
	return [...exact, ...related];
}
