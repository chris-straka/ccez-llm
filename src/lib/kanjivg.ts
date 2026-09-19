/**
 * KanjiVG stroke vector paths, fetched on demand per character.
 *
 * The KanjiVG project publishes one SVG per character at
 * `kanji/{5-digit-lowercase-hex-codepoint}.svg` (e.g. 04e00.svg for
 * 一). Each file's stroke paths carry ids ending `-sN` (1-based stroke
 * order). Nothing is bundled: a small in-memory cache holds what the
 * Inspect overlay asked for, and misses fall back to the schematic
 * stepper. CC BY-SA 3.0 (KanjiVG) — attribution lives in the overlay.
 */

/** In-memory cache: character → stroke path `d` list (null = fetch failed). */
const strokeCache = new Map<string, string[] | null>();

/** KanjiVG file URL for one character (5-digit lowercase hex codepoint). */
export function kanjiSvgUrl(ch: string): string {
	const code = (ch.codePointAt(0) ?? 0).toString(16).padStart(5, "0");
	return `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${code}.svg`;
}

/**
 * Stroke path data in `-sN` order, or null when the file is missing or
 * unparseable. Pure over the SVG text, so the parser is unit-tested
 * against a fixture without network.
 */
export function extractStrokePaths(svg: string): string[] | null {
	const paths: Array<{ n: number; d: string }> = [];
	const re =
		/<path[^>]*\bid="[^"]*-s(\d+)"[^>]*\bd="([^"]+)"|<path[^>]*\bd="([^"]+)"[^>]*\bid="[^"]*-s(\d+)"/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(svg)) !== null) {
		const n = Number(match[1] ?? match[4]);
		const d = match[2] ?? match[3] ?? "";
		if (Number.isFinite(n) && d.length > 0) paths.push({ n, d });
	}
	if (paths.length === 0) return null;
	return paths.sort((a, b) => a.n - b.n).map((p) => p.d);
}

/**
 * Fetch (cached) stroke paths for one character. Never throws: misses
 * resolve null and the overlay keeps its schematic preview.
 */
export async function fetchStrokePaths(ch: string): Promise<string[] | null> {
	const hit = strokeCache.get(ch);
	if (hit !== undefined) return hit;
	let paths: string[] | null = null;
	try {
		const res = await fetch(kanjiSvgUrl(ch));
		if (res.ok) paths = extractStrokePaths(await res.text());
	} catch {
		paths = null;
	}
	strokeCache.set(ch, paths);
	return paths;
}

/** Test hook: clear the fetch cache. */
export function clearStrokeCache(): void {
	strokeCache.clear();
}
