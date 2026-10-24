/**
 * The dictionary manager's model: which pack each menu language reads,
 * the packs grouped like the language menus, and each pack's tile
 * (downloaded, downloading, or on offer) with the size to show. Pure;
 * the runtime side is dictionary.svelte.ts.
 */
import { LANGUAGE_MENUS, replyLanguageFor } from "./languages";

/** Languages the dictionaries release carries a pack for: every one in the language menus. */
export const DICT_LANGS: ReadonlySet<string> = new Set(
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

/** A pack's size for people: "840 KB", "4.2 MB", "24 MB". */
export function dictSize(bytes: number): string {
	if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
	return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/** One installed pack and its size on disk. */
export interface InstalledDictionary {
	lang: string;
	version: string;
	bytes: number;
}

/** One pack the release offers (the shell's `dict_catalog`). */
export interface OfferedDictionary {
	/** Download size. */
	bytes: number;
	/** Size on disk once installed. */
	unpacked: number;
	version: string;
}

export interface DictLanguage {
	lang: string;
	name: string;
	/** Endonym ("Deutsch"), when it differs from the name. */
	native?: string;
}

export interface DictGroup {
	label: string;
	langs: DictLanguage[];
}

/**
 * Every pack, grouped and ordered like the language menus (Europe,
 * Asia, Africa, Classics); a pack two menu languages share is listed
 * once, under the first.
 */
export function dictGroups(): DictGroup[] {
	const seen = new Set<string>();
	return LANGUAGE_MENUS.map((menu) => ({
		label: menu.label,
		langs: menu.languages.flatMap((l): DictLanguage[] => {
			const pack = dictPack(l.code);
			if (!pack || seen.has(pack)) return [];
			seen.add(pack);
			const own = replyLanguageFor(pack) ?? l;
			return [
				{
					lang: pack,
					name: own.name,
					...(own.native && own.native !== own.name
						? { native: own.native }
						: {})
				}
			];
		})
	})).filter((g) => g.langs.length > 0);
}

export type DictState = "installed" | "outdated" | "downloading" | "available";

export interface DictTile extends DictLanguage {
	state: DictState;
	/** Size on disk, the download's progress, or the download size. */
	size: string;
	/** Download progress, 0 to 1, while downloading. */
	progress?: number;
}

/** A language's tile from what's installed, downloading and on offer. */
export function dictTile(
	l: DictLanguage,
	installed: readonly InstalledDictionary[],
	downloads: Readonly<Record<string, number>>,
	catalog: Readonly<Record<string, OfferedDictionary>> | null
): DictTile {
	const progress = downloads[l.lang];
	if (progress !== undefined)
		return {
			...l,
			state: "downloading",
			size: `${Math.round(progress * 100)}%`,
			progress
		};
	const have = installed.find((d) => d.lang === l.lang);
	const offer = catalog?.[l.lang];
	if (have)
		return {
			...l,
			// The release has a newer pack than the one on disk.
			state: offer && offer.version !== have.version ? "outdated" : "installed",
			size: dictSize(have.bytes)
		};
	return {
		...l,
		state: "available",
		size: offer ? dictSize(offer.bytes) : ""
	};
}

/** True when a language matches the filter by name, endonym or code. */
export function dictMatches(l: DictLanguage, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [l.name, l.native ?? "", l.lang].some((s) =>
		s.toLowerCase().includes(q)
	);
}

/** How many installed packs the release has a newer version of. */
export function dictOutdated(
	installed: readonly InstalledDictionary[],
	catalog: Readonly<Record<string, OfferedDictionary>> | null
): string[] {
	return installed
		.filter((d) => {
			const offer = catalog?.[d.lang];
			return offer !== undefined && offer.version !== d.version;
		})
		.map((d) => d.lang);
}

/** "7 of 49 downloaded · 419 MB" or "None downloaded yet". */
export function dictSummary(
	installed: readonly InstalledDictionary[],
	total: number
): string {
	if (installed.length === 0) return "None downloaded yet";
	const bytes = installed.reduce((n, d) => n + d.bytes, 0);
	return `${installed.length} of ${total} downloaded · ${dictSize(bytes)}`;
}
