/**
 * Render math: LaTeX placeholder codec, previews, and KaTeX emission.
 *
 * Split out of `render.ts` (REFACTOR §7). The math cluster is
 * self-contained: placeholder codec (`extractMath` through the
 * restore regex), preview/copy text, LaTeX fence de-duping, and HTML
 * emission (`mathHtml`). It also owns the two emission helpers it
 * needs (`escapeHtml`, `CODE_COPY_GLYPH`) so the dependency runs one
 * way — `render.ts` imports from here, never the reverse. Tested in
 * `render-math.test.ts`, with the placeholder codec as the contract.
 */
import katex from "katex";

export interface MathEntry {
	/** Display (`$$…$$`) blocks get the code-style head; inline (`\(…\)`) too. */
	kind: "display" | "inline";
	/** Raw TeX between the delimiters (what Copy writes). */
	tex: string;
	/** Full source slice including delimiters (plain fallback rendering). */
	raw: string;
}
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
/**
 * Copy glyph for the in-block code copy button: the same line-icon as
 * the message-button copy control (1.6px rounded strokes, currentColor),
 * inlined because render output is a sanitized HTML string, not Svelte.
 */
export const CODE_COPY_GLYPH =
	`<svg class="action-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" ` +
	`stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
	`<rect x="6" y="6" width="7" height="7" rx="1.5" />` +
	`<path d="M9.5 6V4.2A1.2 1.2 0 0 0 8.3 3H4.2A1.2 1.2 0 0 0 3 4.2v4.1a1.2 1.2 0 0 0 1.2 1.2H6" />` +
	`</svg>`;
// Placeholder markers ride through marked inside private-use codepoints so
// ordinary text can never collide with them; the math HTML is spliced back
// after the markdown parse (marked would otherwise mangle the KaTeX tags).
const MATH_OPEN = "\uE000";
const MATH_CLOSE = "\uE001";
export const MATH_PLACEHOLDER_RE = /\uE000(\d+)\uE001/g;

export function mathPlaceholder(index: number): string {
	return `${MATH_OPEN}${index}${MATH_CLOSE}`;
}

/**
 * Pull math spans out of markdown source, skipping ``` fenced blocks and
 * backtick code spans. Pure and unit-tested. Returns the source with
 * placeholders plus the math entries in document order.
 */
export function extractMath(markdownText: string): {
	stripped: string;
	maths: MathEntry[];
} {
	const maths: MathEntry[] = [];
	let out = "";
	let i = 0;
	const len = markdownText.length;
	const lineStart = (pos: number): boolean =>
		pos === 0 || markdownText[pos - 1] === "\n";
	while (i < len) {
		// Fenced code block: skip whole lines from opener to closer (or EOF).
		if (lineStart(i) && markdownText.startsWith("```", i)) {
			const openEnd = markdownText.indexOf("\n", i);
			const bodyStart = openEnd === -1 ? len : openEnd + 1;
			let close = bodyStart;
			let closeEnd = -1;
			while (close < len) {
				const nl = markdownText.indexOf("\n", close);
				const lineEnd = nl === -1 ? len : nl;
				const line = markdownText.slice(close, lineEnd);
				if (/^\s*```\s*$/.test(line)) {
					closeEnd = nl === -1 ? len : nl + 1;
					break;
				}
				close = lineEnd + 1;
			}
			const end = closeEnd === -1 ? len : closeEnd;
			out += markdownText.slice(i, end);
			i = end;
			continue;
		}
		const ch = markdownText[i];
		// Backslash escapes: `\\` stays a literal backslash, `\(` never
		// opens math, and `\X` never reaches marked as an opener.
		if (ch === "\\") {
			const next = markdownText[i + 1];
			if (next === "(") {
				const close = markdownText.indexOf("\\)", i + 2);
				if (close !== -1) {
					const tex = markdownText.slice(i + 2, close);
					const raw = markdownText.slice(i, close + 2);
					maths.push({ kind: "inline", tex, raw });
					out += mathPlaceholder(maths.length - 1);
					i = close + 2;
					continue;
				}
			}
			out += markdownText.slice(i, Math.min(i + 2, len));
			i += next === undefined ? 1 : 2;
			continue;
		}
		// Inline code span: skip to the matching run on the same line.
		if (ch === "`") {
			let run = 1;
			while (markdownText[i + run] === "`") run++;
			const nl = markdownText.indexOf("\n", i);
			const lineEnd = nl === -1 ? len : nl;
			const ticks = "`".repeat(run);
			const close = markdownText.indexOf(ticks, i + run);
			if (close !== -1 && close < lineEnd) {
				out += markdownText.slice(i, close + run);
				i = close + run;
				continue;
			}
			out += markdownText.slice(i, i + run);
			i += run;
			continue;
		}
		// Display math: `$$…$$`, possibly across lines.
		if (ch === "$" && markdownText[i + 1] === "$") {
			const close = markdownText.indexOf("$$", i + 2);
			if (close !== -1) {
				const tex = markdownText.slice(i + 2, close);
				const raw = markdownText.slice(i, close + 2);
				maths.push({ kind: "display", tex, raw });
				out += mathPlaceholder(maths.length - 1);
				i = close + 2;
				continue;
			}
			out += "$$";
			i += 2;
			continue;
		}
		// Inline math: `$…$`. Guards against the classic false
		// positives — `$5 and $10` prices, `a$b` mid-word joins, and
		// `$ x$` padded pairs all stay literal. Escaped `\$` never
		// reaches here (consumed as a pair above); a `\$` inside the
		// scan is skipped, never a closer.
		if (ch === "$") {
			const prev = i === 0 ? "" : markdownText[i - 1];
			const next = markdownText[i + 1];
			if (
				next !== undefined &&
				!/\s/.test(next) &&
				!/[A-Za-z0-9]/.test(prev ?? "")
			) {
				let j = i + 1;
				let close = -1;
				while (j < len) {
					if (markdownText[j] === "\\") {
						j += 2;
						continue;
					}
					if (markdownText[j] === "$") {
						// `$$` is display territory, never an inline closer.
						if (markdownText[j + 1] === "$") {
							j += 2;
							continue;
						}
						// A closer followed by a letter/digit is a price
						// join (`a$b`), not an ending.
						if (
							!/\s/.test(markdownText[j - 1] ?? " ") &&
							!/[A-Za-z0-9]/.test(markdownText[j + 1] ?? "")
						) {
							close = j;
							break;
						}
					}
					j++;
				}
				if (close !== -1) {
					const tex = markdownText.slice(i + 1, close);
					// A bare `$` inside the span means the pairing crossed
					// prices or joins (`$5 … $10`); real TeX never holds
					// one. Escaped `\$` is fine — KaTeX renders it.
					if (!tex.replace(/\\\$/g, "").includes("$")) {
						const raw = markdownText.slice(i, close + 1);
						maths.push({ kind: "inline", tex, raw });
						out += mathPlaceholder(maths.length - 1);
						i = close + 1;
						continue;
					}
				}
			}
			out += "$";
			i++;
			continue;
		}
		out += ch;
		i++;
	}
	return { stripped: out, maths };
}

/**
 * Short TeX preview for a collapsed equation label (single line,
 * truncated). Kept for label use; the render output itself carries no
 * fold bar — display math is body-only (folding rides `data-folded`,
 * wired elsewhere).
 */
/**
 * Grapheme-safe cut with an ellipsis marker: slice() counts UTF-16
 * units and splits astral characters (emoji, CJK Ext-B) into lone
 * surrogates — Array.from counts code points instead, so Japanese,
 * Ukrainian, and emoji previews cut cleanly. BMP text cuts exactly
 * where slice would.
 */
export function cutPreview(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

export function mathTexPreview(tex: string, max = 48): string {
	const flat = tex.replace(/\s+/g, " ").trim();
	return cutPreview(flat, max);
}

/**
 * TeX inside a first line that opens math, or null for plain text.
 * Same-line `$$…$$` / `\[…\]` / `$…$` strip their delimiters; a bare
 * opening `$$` / `\[` line reads the next line (multiline display
 * blocks). An unclosed inline `$` reads to end of line.
 */
function mathPreviewInner(lines: string[]): string | null {
	const first = (lines[0] ?? "").trim();
	for (const [open, close] of [
		["$$", "$$"],
		["\\[", "\\]"]
	] as const) {
		if (first.startsWith(open)) {
			let inner = first.slice(open.length);
			if (inner.endsWith(close)) inner = inner.slice(0, -close.length);
			if (inner.trim() === "") {
				const next = (lines[1] ?? "").trim();
				inner = next.endsWith(close) ? next.slice(0, -close.length) : next;
			}
			return inner;
		}
	}
	if (first.startsWith("$") && !first.startsWith("$$")) {
		const close = first.indexOf("$", 1);
		return close < 0 ? first.slice(1) : first.slice(1, close);
	}
	return null;
}

/**
 * Boundaries before this many characters never end a folded preview:
 * a leading "Mr." or "はい。" is an abbreviation or a stub, not a
 * sentence — scanning continues to the next terminator instead.
 */
const MIN_SENTENCE_CHARS = 8;

/**
 * First-sentence head of a line (through its terminator), or null
 * when the line holds no boundary. CJK marks (。！？．) always
 * terminate; western . ! ? terminate only before whitespace or end
 * of line, so decimals never cut. Boundary characters are BMP, so
 * slicing at a match can never split a surrogate pair.
 */
function firstSentence(line: string): string | null {
	const pattern = /[。！？．]|[.!?](?=\s|$)/g;
	for (
		let match = pattern.exec(line);
		match !== null;
		match = pattern.exec(line)
	) {
		const end = match.index + match[0].length;
		if (Array.from(line.slice(0, end)).length < MIN_SENTENCE_CHARS) continue;
		return line.slice(0, end);
	}
	return null;
}

/**
 * Folded-message preview text: the override wins (refs-only quotes),
 * else the first sentence (not the whole first line). Math folds
 * into its TeX wrapped in `\\(…\\)` so a folded equation still reads
 * as latex — and the preview button keeps it clickable. Pure and
 * unit-tested.
 */
export function foldPreviewText(
	content: string,
	override: string | null
): string {
	if (override !== null) return override;
	const lines = content.split("\n");
	const tex = mathPreviewInner(lines);
	if (tex !== null) return `\\(${mathTexPreview(tex, 120)}\\)`;
	// Folds land on the first sentence: a long opener previews to its
	// first 。/．/. and earns the marker, instead of spanning the
	// whole first line. A one-sentence first line falls through to the
	// length rules below (short line + more below still reads cut).
	const first = lines[0] ?? "";
	const sentence = firstSentence(first);
	if (sentence !== null && sentence !== first) return `${sentence}…`;
	// Long first lines cut with the ellipsis marker (never a silent
	// crop): length reads bounded in every script. A short first line
	// with more below still earns the marker — otherwise a folded
	// multi-line message reads complete when it is not.
	const cut = cutPreview(first, 140);
	if (cut === first && lines.slice(1).join("\n").trim() !== "")
		return `${first}…`;
	return cut;
}

/**
 * Collapsed label for a folded code block (`python · 13 LOC`): folding
 * swaps the pre for this text instead of hiding the block outright, so
 * the fold still reads as code. Pure and unit-tested.
 */
export function foldedCodeLabel(lang: string, loc: number): string {
	return `${lang} · ${loc} LOC`;
}

/**
 * Clipboard text for a math run: the TeX wrapped in its own
 * delimiters (`$$` display, `$` inline), so a paste recompiles to the
 * same equation. Pure and unit-tested.
 */
export function mathCopyText(
	tex: string,
	kind: "display" | "inline" = "display"
): string {
	return kind === "inline" ? `$${tex}$` : `$$${tex}$$`;
}

/** Outer `$$…$$` delimiters off a fenced-latex body, when present. */
export function stripOuterDisplayDelimiters(text: string): string {
	const t = text.trim();
	if (t.startsWith("$$") && t.endsWith("$$") && t.length >= 4)
		return t.slice(2, -2).trim();
	return text;
}

/** Equality key for duplicate latex: delimiters and whitespace aside. */
function normMathSrc(text: string): string {
	return stripOuterDisplayDelimiters(text).replace(/\s+/g, " ").trim();
}

/**
 * Drop a ```latex fence when an identical `$$` display block sits right
 * next to it (either order): models often emit both, and the pair reads
 * as the same equation twice. The display block stays — it renders —
 * so each equation shows exactly once. Pure and unit-tested.
 */
export function stripLatexFenceDupes(source: string): string {
	const fenceThenDisplay =
		/^```latex[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*(?:\n[ \t]*)*\n(\$\$[\s\S]*?\$\$)/gm;
	const displayThenFence =
		/(\$\$[\s\S]*?\$\$)(?:\n[ \t]*)*\n```latex[^\S\n]*\n([\s\S]*?)\n```/gm;
	const dropFence = (_match: string, fence: string, display: string): string =>
		normMathSrc(fence) === normMathSrc(display) ? display : _match;
	const dropFenceAfter = (
		_match: string,
		display: string,
		fence: string
	): string => (normMathSrc(fence) === normMathSrc(display) ? display : _match);
	return source
		.replace(fenceThenDisplay, dropFence)
		.replace(displayThenFence, dropFenceAfter);
}

/** KaTeX HTML for one math entry, or its escaped plain source on failure. */
export function mathHtml(entry: MathEntry, index: number): string {
	let inner: string;
	try {
		if (!entry.tex.trim()) throw new Error("empty math");
		inner = katex.renderToString(entry.tex, {
			displayMode: entry.kind === "display",
			throwOnError: true,
			output: "html",
			strict: false,
			trust: false
		});
	} catch {
		// Unknown/invalid math keeps plain rendering, never fatal.
		return escapeHtml(entry.raw);
	}
	// Display math carries centered top chrome: a `$` toggle and copy
	// button side by side over the equation's middle, flipping
	// rendered/raw, plus a `latex · N LOC` folded label (folding rides
	// `data-folded`, wired elsewhere). Chrome never sizes off the
	// equation's width, so buttons sit still across renders. A body
	// click still copies the TeX with its `$$` delimiters (see
	// mathCopyText). Inline math carries the same `$`/copy pair,
	// sized to the line so the sentence keeps its rhythm (its copy
	// wraps `$` delimiters, not `$$`). `.ccez-math-body` and
	// `data-math-index` are the annotation contract (see
	// equationBodyOf) and stay put. KaTeX is never colorized here —
	// it inherits the theme ink, which keeps equations readable in
	// both themes without a second palette to maintain.
	if (entry.kind === "display") {
		const loc = entry.raw.split("\n").length;
		return (
			`<div class="ccez-math" data-math-index="${index}">` +
			`<button type="button" class="ccez-math-tex" ` +
			`aria-label="Show math source" title="Show source">$</button>` +
			`<button type="button" class="ccez-math-copy" ` +
			`aria-label="Copy equation" title="Copy">${CODE_COPY_GLYPH}</button>` +
			`<span class="ccez-math-foldedlabel">${escapeHtml(foldedCodeLabel("latex", loc))}</span>` +
			`<div class="ccez-math-body">${inner}</div>` +
			`<pre class="ccez-math-raw">${escapeHtml(entry.raw)}</pre></div>`
		);
	}
	// Inline chrome trails the equation: the raw source sits before
	// the buttons, so `$`/copy ride the same (right) side in both
	// rendered and raw views instead of swapping ends on toggle.
	return (
		`<span class="ccez-math-inline" data-math-index="${index}">` +
		`<span class="ccez-math-body">${inner}</span>` +
		`<span class="ccez-math-raw">${escapeHtml(entry.raw)}</span>` +
		`<button type="button" class="ccez-math-tex" ` +
		`aria-label="Show math source" title="Show source">$</button>` +
		`<button type="button" class="ccez-math-copy" ` +
		`aria-label="Copy equation" title="Copy">${CODE_COPY_GLYPH}</button></span>`
	);
}
