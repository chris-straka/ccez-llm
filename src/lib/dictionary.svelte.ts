/**
 * Dictionary packs at runtime (src-tauri/src/dict.rs): a word's hits
 * for its card, and the on-demand download behind them. A language's
 * pack downloads the first time a word in it is annotated (when the
 * setting allows) and checks for a newer one once a session; until it
 * lands, cards come from the model alone. The web build has no
 * backend and never looks anything up.
 */
import { toHiragana } from "wanakana";
import {
	firstHits,
	lookupForms,
	type DictHit,
	type JaPiece
} from "./dict-card";
import type { WordLookup } from "./reading";
import { tauriBackendAvailable } from "./secrets";

/** Languages the dictionaries release carries a pack for: every one in the language menus. */
const DICT_LANGS: ReadonlySet<string> = new Set(
	`fr de es pt it ro ru uk pl cs sk bg sr el hu fi nl sv da no is zh yue ko
	vi th id ms tl hi ur pa bn ta fa ar he hy tr sw am la grc sa non ang sux
	akk ja`.split(/\s+/)
);

/** Wiktionary files Literary Chinese under Chinese and Biblical Hebrew under Hebrew. */
const SHARED_PACK: Record<string, string> = { lzh: "zh", hbo: "he" };

/** The pack a language's words come from, or null when there is none. */
export function dictPack(lang: string): string | null {
	const pack = SHARED_PACK[lang] ?? lang;
	return DICT_LANGS.has(pack) ? pack : null;
}

/** Download progress per language (0 to 1), while a pack downloads. */
export const dictDownloads: Record<string, number> = $state({});

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
const installed = new Map<string, boolean>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
const checked = new Set<string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never rendered.
const installing = new Set<string>();

async function invokeDict<T>(
	cmd: string,
	args: Record<string, unknown>
): Promise<T> {
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(cmd, args);
}

async function isInstalled(lang: string): Promise<boolean> {
	const known = installed.get(lang);
	if (known !== undefined) return known;
	const version = await invokeDict<string | null>("dict_installed", {
		lang
	}).catch(() => null);
	installed.set(lang, version !== null);
	return version !== null;
}

let progressHooked = false;
async function hookProgress(): Promise<void> {
	if (progressHooked) return;
	progressHooked = true;
	const { listen } = await import("@tauri-apps/api/event");
	await listen<{ lang: string; received: number; total: number | null }>(
		"dict-progress",
		({ payload }) => {
			if (!installing.has(payload.lang)) return;
			dictDownloads[payload.lang] = payload.total
				? Math.min(1, payload.received / payload.total)
				: 0;
		}
	);
}

/**
 * Fetch (or update) a language's pack in the background. Failures
 * stay quiet: the card already works without it, and the next
 * session tries again.
 */
export function installDictionary(lang: string): void {
	if (installing.has(lang) || dictPack(lang) !== lang) return;
	installing.add(lang);
	checked.add(lang);
	void hookProgress()
		.then(() => invokeDict<string>("dict_install", { lang }))
		.then(() => installed.set(lang, true))
		.catch(() => undefined)
		.finally(() => {
			installing.delete(lang);
			delete dictDownloads[lang];
		});
}

async function japanesePieces(word: string): Promise<JaPiece[]> {
	const { japaneseTokens } = await import("./furigana");
	const tokens = await japaneseTokens(word);
	return tokens
		.filter((t) => t.surface)
		.map((t) => ({
			surface: t.surface,
			pos: t.pos,
			sub: t.sub,
			base: t.base,
			...(t.reading ? { reading: toHiragana(t.reading) } : {})
		}));
}

/**
 * The lookup word cards use: hits from the installed pack, or null
 * (no backend, no pack for the language, or not downloaded yet, in
 * which case a download starts when `enabled()`).
 */
export function makeWordLookup(enabled: () => boolean): WordLookup {
	return async (quote, cardLang) => {
		const lang = dictPack(cardLang);
		if (!tauriBackendAvailable() || !lang) return null;
		if (!(await isInstalled(lang))) {
			if (enabled()) installDictionary(lang);
			return null;
		}
		if (enabled() && !checked.has(lang)) installDictionary(lang);
		const forms = lookupForms(quote, lang);
		const word = forms[0];
		if (!word) return null;
		let japanese: JaPiece[] = [];
		if (lang === "ja") {
			japanese = await japanesePieces(word).catch(() => []);
			const { japaneseHead } = await import("./dict-card");
			const head = japaneseHead(japanese);
			if (head && head !== word) forms.push(head);
		}
		const lists = await invokeDict<DictHit[][] | null>("dict_lookup", {
			lang,
			forms
		});
		if (!lists) {
			installed.set(lang, false);
			return null;
		}
		const hits = firstHits(lists);
		return hits.length > 0 ? { hits, japanese } : null;
	};
}
