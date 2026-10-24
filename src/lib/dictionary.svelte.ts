/**
 * Dictionary packs at runtime (src-tauri/src/dict.rs): a word's hits
 * for its card, the on-demand download behind them, and the list
 * Settings shows. A language's pack downloads the first time a word
 * in it is annotated (when the setting allows and it wasn't removed)
 * and checks for a newer one once a session; until it lands, cards
 * come from the model alone. The web build has no backend and never
 * looks anything up.
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
 * Fetch (or update) a language's pack in the background; resolves
 * true once it's installed. Failures stay quiet: the card already
 * works without it, and the next session tries again.
 */
export function installDictionary(lang: string): Promise<boolean> {
	if (installing.has(lang) || dictPack(lang) !== lang)
		return Promise.resolve(false);
	installing.add(lang);
	checked.add(lang);
	dictDownloads[lang] = 0;
	return hookProgress()
		.then(() => invokeDict<string>("dict_install", { lang }))
		.then(() => {
			installed.set(lang, true);
			return true;
		})
		.catch(() => false)
		.finally(() => {
			installing.delete(lang);
			delete dictDownloads[lang];
		});
}

/** One installed pack and its size on disk. */
export interface InstalledDictionary {
	lang: string;
	version: string;
	bytes: number;
}

/** Installed packs (Settings); empty without a backend. */
export async function listDictionaries(): Promise<InstalledDictionary[]> {
	if (!tauriBackendAvailable()) return [];
	return invokeDict<InstalledDictionary[]>("dict_list", {}).catch(() => []);
}

/** Delete a language's pack; its cards go back to the model alone. */
export async function removeDictionary(lang: string): Promise<void> {
	installed.set(lang, false);
	await invokeDict("dict_remove", { lang }).catch(() => undefined);
}

/** A pack's size for people: "840 KB", "20 MB". */
export function dictSize(bytes: number): string {
	if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
	return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
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
 * which case a download starts when `enabled(lang)`).
 */
export function makeWordLookup(enabled: (lang: string) => boolean): WordLookup {
	return async (quote, cardLang) => {
		const lang = dictPack(cardLang);
		if (!tauriBackendAvailable() || !lang) return null;
		if (!(await isInstalled(lang))) {
			if (enabled(lang)) void installDictionary(lang);
			return null;
		}
		if (enabled(lang) && !checked.has(lang)) void installDictionary(lang);
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
		const form = forms[lists.indexOf(hits)];
		return hits.length > 0
			? { hits, japanese, ...(form ? { form } : {}) }
			: null;
	};
}
