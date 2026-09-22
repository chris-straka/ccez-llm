/**
 * Inspect: single-character Han (kanji/hanzi) lookup overlay.
 *
 * Fully offline, fully data-driven (no hand-curated entries): splits
 * from the generated cjk-decomp subset plus readings, definitions,
 * stroke counts, and Kangxi radicals from the generated Unihan bundle.
 * No fetch, no worker, no network at runtime.
 *
 * Follow-up (reported honestly, not shipped): full stroke-ORDER path
 * animation needs per-character vector data (KanjiVG, ~10MB unpacked
 * for full coverage) plus a path player. Until that lands, the overlay
 * shows a schematic stroke-step preview driven by the stroke count —
 * clearly labeled as such — alongside components, count, radical,
 * and definition.
 */
import { CJKDECOMP_SUBSET } from "./cjkdecomp-subset.generated";
import { hanOverlayLangFor, type HanOverlayLang } from "./reading";
import { UNIHAN } from "./unihan.generated";

/** One inspected character: everything the overlay shows. */
export interface InspectData {
	char: string;
	/** Immediate components (empty when the vendored subset lacks it). */
	components: string[];
	/** Total stroke count (Unihan kTotalStrokes), or null when missing. */
	strokeCount: number | null;
	/** Kangxi radical character (Unihan kRSUnicode), or null. */
	radical: string | null;
	/** Residual strokes after the radical (kRSUnicode), or null. */
	radicalRest: number | null;
	/**
	 * Short gloss (Unihan kDefinition), or null so the overlay says
	 * so instead of guessing.
	 */
	definition: string | null;
	/** Hanyu pinyin with tone marks (Unihan kMandarin), or null. */
	mandarin: string | null;
	/** Space-separated on readings (Unihan kJapaneseOn), or null. */
	japaneseOn: string | null;
	/** Space-separated kun readings (Unihan kJapaneseKun), or null. */
	japaneseKun: string | null;
	/**
	 * True when per-stroke vector paths are bundled for this character.
	 * Always false until the KanjiVG follow-up lands; the overlay then
	 * renders the schematic step preview instead of path animation.
	 */
	hasStrokePaths: false;
}

/** True when the trimmed text is exactly one Han character. */
export function isSingleHanChar(text: string): boolean {
	const trimmed = text.trim();
	if ([...trimmed].length !== 1) return false;
	return isHanChar(trimmed);
}

/**
 * Whether the Inspect button may appear for a highlight: the feature
 * toggle is on AND the highlight is a single Han character. Multi-char
 * or non-CJK highlights never qualify.
 */
export function shouldShowInspect(quote: string, enabled: boolean): boolean {
	if (!enabled) return false;
	return isSingleHanChar(quote);
}

/**
 * Inspect's predicted reading locale for one highlighted character.
 * The single char can never hold kana itself, so the guess reads the
 * paragraph it was picked from instead: kana present means Japanese,
 * else the Chinese default (the same rule as `hanOverlayLangFor`).
 * Empty context falls back to the quote alone — always Chinese for a
 * lone Han char, with the overlay toggle left to correct it.
 */
export function inspectLangFor(quote: string, context: string): HanOverlayLang {
	const text = context.trim() === "" ? quote : context;
	return hanOverlayLangFor(text);
}

/**
 * The 214 Kangxi radicals in number order (1-indexed): index 0 is
 * radical 1 (一), index 213 is radical 214 (龠). Static reference data,
 * not analysis — pinned by cross-check tests below against Unihan
 * kRSUnicode values.
 */
const KANGXI_RADICALS =
	"一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠";

/** True for a Han (CJK unified / extension A) character. */
export function isHanChar(ch: string): boolean {
	return /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/u.test(ch);
}

/** One character and its immediate components. */
export interface ComponentEntry {
	char: string;
	components: string[];
}

/**
 * Immediate components for one character, or null when unknown.
 * Splits come solely from the vendored cjk-decomp subset (~3000 Joyo +
 * top-Hanzi chars, Mainland-Chinese typeface).
 */
export function decomposeChar(ch: string): ComponentEntry | null {
	const data = CJKDECOMP_SUBSET[ch];
	if (data && data.length > 0) return { char: ch, components: [...data] };
	return null;
}

/** One node of a recursive decomposition tree (depth-capped). */
export interface DecompNode {
	char: string;
	/** Empty for leaves (no split, or depth cap reached). */
	children: DecompNode[];
}

/**
 * Recursive decomposition up to `depth` levels (default 2, like the
 * mdbg.net word panel: 通 → 辶 + 甬 → 用 + …). Single-child and cyclic
 * splits stop as leaves so the tree always terminates. Pure and
 * unit-tested.
 */
export function decomposeTree(
	ch: string,
	depth = 2,
	seen: string[] = []
): DecompNode {
	if (depth <= 0 || seen.includes(ch)) return { char: ch, children: [] };
	const entry = decomposeChar(ch);
	if (!entry || entry.components.length < 2) return { char: ch, children: [] };
	const next = [...seen, ch];
	return {
		char: ch,
		children: entry.components.map((c) => decomposeTree(c, depth - 1, next))
	};
}

/** Lowercased comma-joined readings ("ICHI ITSU" → "ichi,itsu"). */
function joinReadings(raw: string | null): string {
	if (!raw) return "";
	return raw
		.split(/\s+/)
		.filter((r) => r.length > 0)
		.map((r) => r.toLowerCase())
		.join(",");
}

/**
 * One-line on/kun row ("On/Kun: ichi,itsu | hitor..."), or null when the
 * subset holds neither. Pure and unit-tested.
 */
export function onKunLine(
	data: Pick<InspectData, "japaneseOn" | "japaneseKun">
): string | null {
	const parts = [
		joinReadings(data.japaneseOn),
		joinReadings(data.japaneseKun)
	].filter((part) => part.length > 0);
	if (parts.length === 0) return null;
	return `On/Kun: ${parts.join(" | ")}`;
}

/**
 * Decompose the Han characters in a text selection, in order, deduped.
 * Non-Han characters are skipped. Unknown Han characters are reported
 * with an empty component list so the overlay can say so honestly.
 */
export function decomposeText(text: string): ComponentEntry[] {
	const seen = new Set<string>();
	const out: ComponentEntry[] = [];
	for (const ch of text) {
		if (!isHanChar(ch) || seen.has(ch)) continue;
		seen.add(ch);
		const hit = decomposeChar(ch);
		out.push(hit ?? { char: ch, components: [] });
	}
	return out;
}

/**
 * Display forms for Kangxi radicals whose standard codepoint is not
 * the familiar shape: 辵 (162, the dictionary form) renders as 辶,
 * the walking-radical shape learners actually recognize — the same
 * reason splits normalize 飠→食 at build time.
 */
const RADICAL_DISPLAY: Record<string, string> = { 辵: "辶" };

/**
 * Parse a Unihan kRSUnicode value ("149.7") into its radical number
 * and residual stroke count. Anything else yields nulls.
 */
export function parseKangxi(
	rs: string | undefined
): { radical: string; rest: number } | null {
	if (rs === undefined) return null;
	const dot = rs.indexOf(".");
	if (dot < 0) return null;
	const num = Number.parseInt(rs.slice(0, dot), 10);
	const rest = Number.parseInt(rs.slice(dot + 1), 10);
	if (!Number.isInteger(num) || !Number.isInteger(rest)) return null;
	const raw = KANGXI_RADICALS[num - 1];
	if (raw === undefined) return null;
	return { radical: RADICAL_DISPLAY[raw] ?? raw, rest };
}

/** Offline lookup for one character (components + count + radical + definition + readings). */
export function getInspectData(char: string): InspectData {
	const trimmed = char.trim();
	const unihan = UNIHAN[trimmed];
	const entry = decomposeChar(trimmed);
	const strokes =
		unihan?.t === undefined ? null : Number.parseInt(unihan.t, 10);
	const kangxi = parseKangxi(unihan?.rs);
	return {
		char: trimmed,
		components: entry?.components ?? [],
		strokeCount: strokes !== null && Number.isInteger(strokes) ? strokes : null,
		radical: kangxi?.radical ?? null,
		radicalRest: kangxi?.rest ?? null,
		definition: unihan?.d ?? null,
		mandarin: unihan?.m ?? null,
		japaneseOn: unihan?.on ?? null,
		japaneseKun: unihan?.kun ?? null,
		hasStrokePaths: false
	};
}

/**
 * Step the stroke preview (REFACTOR §6): clamped to 1..total,
 * never wraps. The caller feeds the stroke count or the data
 * fallback; unknown totals still pin at 1.
 */
export function clampStrokeStep(
	current: number,
	delta: number,
	total: number
): number {
	const top = Math.max(total, 1);
	return Math.min(Math.max(current + delta, 1), top);
}

/**
 * Whether a selection speaks Japanese (REFACTOR §6): kanji present
 * and the sentence probe reads Japanese. Such fragments speak
 * their sentence reading, never the raw quote.
 * Page call-site deferred while the selection-pinyin E2E flake is
 * diagnosed (probe slice reverted to the original page wiring).
 */
export function speaksJapaneseSelection(quote: string, probe: string): boolean {
	return (
		[...quote].some((ch) => isHanChar(ch)) && hanOverlayLangFor(probe) === "ja"
	);
}
