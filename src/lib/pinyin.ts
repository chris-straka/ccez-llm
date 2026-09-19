import { pinyin } from "pinyin-pro";
import { escapeHtml } from "./render";
import {
	classifyAidLine,
	codeAwareLines,
	RUBY_SCRIPT_RE,
	type LocalAid
} from "./reading";

/**
 * Pinyin readings for Chinese text: per-character readings (pinyin-pro
 * resolves polyphones from surrounding context) as native ruby. The
 * engine fits each base to its annotation exactly, so room appears
 * only where a reading overflows its Hanzi. Han characters keep their
 * tone-marked reading; everything else passes through escaped and
 * unannotated.
 */
/**
 * Hiragana + katakana: the unambiguous Japanese signal (same class as
 * the aid classifier's — kanji are Han in both languages, kana is not).
 */
const KANA_SEGMENT_RE = /[\u3040-\u309F\u30A0-\u30FF]/;

export function pinyinRuby(text: string): string {
	// Script-segment detection: any kana run makes this a Japanese
	// segment, and pinyin readings on Japanese kanji are wrong
	// readings (pinyin-pro happily returns Chinese for 読む's 読).
	// Callers gate by line already; this keeps the engine itself from
	// ever annotating Japanese words no matter who calls it next.
	if (KANA_SEGMENT_RE.test(text)) return escapeHtml(text);
	const syllables = pinyin(text, { toneType: "symbol", type: "array" });
	const chars = [...text];
	return chars
		.map((char, i) => {
			const reading = syllables[i];
			if (/\p{Script=Han}/u.test(char) && reading && reading !== char) {
				// Native ruby: the engine sizes each base to its own
				// annotation exactly — room appears only where a reading
				// overflows its Hanzi, and neighbors never collide. No
				// estimated padding: estimates spread every character
				// whether it needs room or not.
				return `<ruby>${escapeHtml(char)}<rt>${escapeHtml(reading)}</rt></ruby>`;
			}
			return escapeHtml(char);
		})
		.join("");
}

/**
 * One message's pinyin conversion, gated per line exactly like the
 * dual-aid path: lines the classifier owns convert, kana (Japanese)
 * lines pass through escaped — pinyin readings on Japanese kanji are
 * wrong readings. A reply-language preference moves kanji-only lines
 * to furigana ownership, so pinning pinyin there renders them bare,
 * exactly like pinning pinyin on a kana line already does. Line count
 * is preserved 1:1, so `plainParagraphs` source-text alignment is
 * unaffected.
 */
export function pinyinBlock(
	text: string,
	preferred: LocalAid | null = null
): string {
	// Fenced code never converts: readings inside code are noise, and
	// the buttons already ignore those lines at detection time.
	return codeAwareLines(text)
		.map(({ line, code }) =>
			!code && classifyAidLine(line, preferred) === "pinyin"
				? pinyinRuby(line)
				: escapeHtml(line)
		)
		.join("\n");
}

/**
 * Plain-text paragraphs (for aids mode, where markdown is set aside).
 * Mirrors the markdown renderer (`breaks: true`): blank lines separate
 * paragraphs, single newlines are soft breaks (`<br>`) inside one
 * paragraph. Per-line `<p>`s would add a paragraph margin per line and
 * grow the message when an aid pins — the exact shift this avoids.
 * Callers pass converter output whose only `\n` are line separators
 * (converter tags never span lines), so splitting here is safe.
 *
 * With `sourceText`, simple markdown lists survive: consecutive
 * `1.`/`-` lines group into `<ol>`/`<ul>` (with the list's start
 * number) instead of flattening to `1.` paragraphs — flattening moved
 * the numbers when an aid pinned. Detection runs on the source lines
 * (a trailing space the tokenizer ate must not decide), markers strip
 * from the converted lines only where the source classified them, so
 * `3.14` decimals never match. Tight flat lists only: nesting,
 * checkboxes, and loose lists fall back to paragraphs, exactly like
 * an unrecognized line always has.
 */
/**
 * Inline bold/italic for aids mode (markdown is set aside there, so
 * `**x**` would otherwise pin as literal asterisks — pinning furigana
 * visibly "broke" the model's bold). Runs may span converter tags: a
 * `*` never occurs inside generated markup, so every star in the line
 * is a text marker and `**` + ruby spans + `**` matches as one bold.
 * Opening runs must hug a non-space, so `2 * 3 * 4` math survives;
 * unmatched runs pass through untouched.
 */
function inlineEmphasis(html: string): string {
	return html
		.replace(/\*\*(\S[^*]*?\S|\S)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(\S[^*]*?\S|\S)\*/g, "<em>$1</em>");
}

export function plainParagraphs(
	htmlInner: string,
	sourceText?: string
): string {
	const converted = htmlInner.split("\n").map(inlineEmphasis);
	const sources = sourceText?.split("\n");
	const lines: { html: string; kind: "para" | "ol" | "ul"; start: number }[] =
		converted.map((html, i) => {
			const src =
				sources && sources.length === converted.length
					? (sources[i] ?? "")
					: html;
			const ordered = src.match(/^\s*(\d+)[.)]\s+\S/);
			if (ordered)
				return {
					html: html.replace(/^\s*\d+[.)]\s*/, ""),
					kind: "ol",
					start: Number(ordered[1])
				};
			if (/^\s*[-*+]\s+\S/.test(src))
				return { html: html.replace(/^\s*[-*+]\s*/, ""), kind: "ul", start: 1 };
			return { html, kind: "para", start: 1 };
		});
	// Same ruby-room mark as the markdown renderer: blocks that can
	// carry ruby reserve it, English ones stay tight (see aid-space).
	const cjk = (inner: string): string =>
		RUBY_SCRIPT_RE.test(inner.replace(/<[^>]*>/g, "")) ? ` class="cjk"` : "";
	const blocks: string[] = [];
	let current: string[] = [];
	let list: { kind: "ol" | "ul"; items: string[]; start: number } | null = null;
	const flushPara = (): void => {
		if (current.length) {
			const inner = current.join("<br>");
			// dir=auto like the markdown renderer: without it an Arabic
			// paragraph inherits the app's LTR the moment an aid pins,
			// visibly flipping its direction.
			blocks.push(`<p${cjk(inner)} dir="auto">${inner}</p>`);
			current = [];
		}
	};
	const flushList = (): void => {
		if (list) {
			const { kind, items, start } = list;
			const open =
				kind === "ol" && start !== 1 ? `<ol start="${start}">` : `<${kind}>`;
			blocks.push(
				open +
					items
						.map((item) => `<li${cjk(item)} dir="auto">${item}</li>`)
						.join("") +
					`</${kind}>`
			);
			list = null;
		}
	};
	for (const line of lines) {
		if (!line.html.trim()) {
			flushPara();
			flushList();
			continue;
		}
		if (line.kind === "para") {
			flushList();
			current.push(line.html);
			continue;
		}
		flushPara();
		if (!list || list.kind !== line.kind) {
			flushList();
			list = { kind: line.kind, items: [], start: line.start };
		}
		list.items.push(line.html);
	}
	flushPara();
	flushList();
	return blocks.join("");
}
