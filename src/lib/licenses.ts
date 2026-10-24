/**
 * What Settings → Licenses lists: the app's own license, the data and
 * fonts it carries or downloads (written here, with their sources),
 * and every library it ships (scripts/licenses.ts generates that list
 * into licenses.generated.json; it loads only when the sheet opens).
 */

export interface DataCredit {
	name: string;
	/** What the app uses it for. */
	use: string;
	license: string;
	url: string;
}

/** The app's own license (LICENSE). */
export const APP_LICENSE = "MIT License, © 2026 Chris Straka";

/** Data and fonts, with where they come from. */
export const DATA_CREDITS: DataCredit[] = [
	{
		name: "Wiktionary, extracted by wiktextract via kaikki.org",
		use: "Dictionaries for every language but Japanese",
		license: "CC BY-SA 4.0 and GFDL",
		url: "https://kaikki.org/"
	},
	{
		name: "JMdict, Electronic Dictionary Research and Development Group",
		use: "Japanese dictionary",
		license: "CC BY-SA 4.0",
		url: "https://www.edrdg.org/jmdict/j_jmdict.html"
	},
	{
		name: "IPADIC, via Lindera",
		use: "Japanese word splitting and readings",
		license: "IPADIC License (BSD-style)",
		url: "https://github.com/lindera/lindera"
	},
	{
		name: "Unihan Database, Unicode Consortium",
		use: "Readings and strokes for Chinese characters",
		license: "Unicode License V3",
		url: "https://www.unicode.org/license.txt"
	},
	{
		name: "cjk-decomp, Aaron Madlon-Kay",
		use: "Character parts in Inspect",
		license: "MIT",
		url: "https://github.com/amake/cjk-decomp"
	},
	{
		name: "Tesseract language data",
		use: "Reading text from screenshots where the system can't",
		license: "Apache-2.0",
		url: "https://github.com/tesseract-ocr/tessdata_fast"
	},
	{
		name: "Fira Code",
		use: "Code font",
		license: "SIL Open Font License 1.1",
		url: "https://github.com/tonsky/FiraCode"
	}
];

/** The dictionary packs' sources, credited in the dictionary manager. */
export const DICTIONARY_CREDITS = DATA_CREDITS.slice(0, 2);

export interface Library {
	name: string;
	version: string;
	license: string;
	url?: string;
}

export interface Libraries {
	js: Library[];
	rust: Library[];
}

/** The generated library list, loaded on demand (about 100 KB). */
export async function loadLibraries(): Promise<Libraries> {
	return (await import("./licenses.generated.json")).default;
}

/** True when a library matches the filter by name or license. */
export function libraryMatches(l: Library, query: string): boolean {
	const q = query.trim().toLowerCase();
	return (
		!q ||
		l.name.toLowerCase().includes(q) ||
		l.license.toLowerCase().includes(q)
	);
}
