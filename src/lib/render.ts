import { Marked, type Renderer, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { createHighlighter, type Highlighter } from "shiki";
import { RUBY_SCRIPT_RE } from "./reading";
import { runnerFor } from "./coderun";
import {
	ATTACH_TAG_RE,
	FILE_MARKER,
	IMAGE_MARKER,
	extractAttachmentTags,
	fileExcerpt,
	formatTokenCount,
	type AttachTagModel
} from "./attachments";
import {
	CODE_COPY_GLYPH,
	escapeHtml,
	extractMath,
	foldedCodeLabel,
	MATH_PLACEHOLDER_RE,
	mathHtml,
	mathPlaceholder,
	stripLatexFenceDupes,
	stripOuterDisplayDelimiters,
	type MathEntry
} from "./render-math";
export { escapeHtml } from "./render-math";

/**
 * Message rendering: markdown → sanitized HTML with code chrome, collapsed
 * model thoughts, and sources-section stripping. Code highlighting (Shiki)
 * runs as a separate async pass so streaming text renders instantly.
 */

const THINK_OPEN = /<think>/i;
const THINK_FULL = /<think>([\s\S]*?)<\/think>/gi;

/** Split `<think>…</think>` reasoning out of model output. Unclosed tags
 * (mid-stream) treat the rest of the message as thoughts. */
export function extractThoughts(markdown: string): { thoughts: string | null; body: string } {
	const full = [...markdown.matchAll(THINK_FULL)];
	if (full.length > 0) {
		const thoughts = full
			.map((m) => (m[1] ?? "").trim())
			.filter(Boolean)
			.join("\n\n");
		const body = markdown.replace(THINK_FULL, "").trim();
		return { thoughts: thoughts || null, body };
	}
	const open = markdown.search(THINK_OPEN);
	if (open >= 0) {
		const tag = markdown.match(THINK_OPEN)![0];
		const thoughts = markdown.slice(open + tag.length).trim();
		return { thoughts: thoughts || null, body: markdown.slice(0, open).trim() };
	}
	return { thoughts: null, body: markdown };
}

const SOURCES_HEADING = /^#{1,4}\s+sources(\s+(and|&)\s+citations)?\s*$/im;

/** Drop a trailing "Sources" section unless the user asked for sources. */
export function stripSourcesIfUnasked(body: string, sourcesAsked: boolean): string {
	if (sourcesAsked) return body;
	const match = body.search(SOURCES_HEADING);
	if (match < 0) return body;
	return body.slice(0, match).trimEnd();
}

/** True when any user text mentions sources (i.e. the user asked for them). */
export function sourcesAsked(userTexts: string[]): boolean {
	return userTexts.some((t) => /source/i.test(t));
}

/** Rough token estimate for plain text; defined beside the attachments
 * that consume it (re-exported here so existing import sites hold). */
export { estimateTextTokens } from "./attachments";

/** Copy body for a message: thoughts and unasked sources stripped for
 * assistants, raw content otherwise. */
export function plainBody(content: string, role: string, sourcesWanted: boolean): string {
	if (role !== "assistant") return content;
	const { body } = extractThoughts(content);
	return stripSourcesIfUnasked(body, sourcesWanted);
}



export interface RenderedMessage {
	html: string;
	/** Raw code per fenced block, in document order (for copy + highlight). */
	codes: Array<{ lang: string; code: string }>;
	/** Raw TeX per math block, in document order (for copy). Same shared
	 * index space as `codes` across thoughts and body. */
	maths: MathEntry[];
}

/**
 * Sent-message tag: collapsed it is the same blue fold button as
 * pasted content (body-size text, aligned with the line); expanded it
 * shows the card in place (thumbnail or excerpt, name and compact
 * token count, Copy plus OCR for images) framed by blue collapse
 * brackets — clicking the tag or either bracket toggles. History stays
 * read-only, so there is no remove button. No model (more literals
 * than attachments, e.g. hand-typed): the plain marker text. Pure and
 * unit-tested.
 */
export function attachTagHtml(model: AttachTagModel | null, kindLetter: string): string {
	const label = kindLetter === "f" ? FILE_MARKER : IMAGE_MARKER;
	if (!model) return escapeHtml(label);
	if (!model.open) {
		return (
			`<button type="button" class="paste-fold sent-fold" data-sent-toggle="${model.id}">` +
			`${escapeHtml(label)}</button>`
		);
	}
	const visual =
		model.kind === "image" && model.dataUrl?.startsWith("data:image/")
			? `<img class="sent-img" src="${model.dataUrl}" alt="">`
			: model.kind === "text" && model.text !== null
				? `<span class="sent-excerpt">${escapeHtml(fileExcerpt(model.text))}</span>`
				: "";
	if (!visual) return escapeHtml(label);
	const ocr =
		model.kind === "image"
			? `<button type="button" class="sent-btn" data-sent-action="ocr" data-attach-id="${model.id}">OCR</button>`
			: "";
	return (
		`<span class="sent-open">` +
		`<button type="button" class="paste-fold" data-sent-toggle="${model.id}" title="Collapse attachment">[</button>` +
		`<span class="sent-card">${visual}` +
		`<span class="sent-meta">${escapeHtml(model.name)} · ${formatTokenCount(model.tokens)} tokens</span>` +
		`<span class="sent-actions"><button type="button" class="sent-btn" data-sent-action="copy" data-attach-id="${model.id}">Copy</button>${ocr}</span>` +
		`</span>` +
		`<button type="button" class="paste-fold" data-sent-toggle="${model.id}" title="Collapse attachment">]</button>` +
		`</span>`
	);
}

/** Synchronous render: markdown → sanitized HTML with plain (unhighlighted)
 * code blocks. Safe to call on every streamed token. `attachModels`
 * rebuilds attachment-tag literals as preview links (paired by kind
 * order); omitted, literals render as plain text. */
export function renderMarkdown(
	markdownText: string,
	attachModels?: AttachTagModel[]
): RenderedMessage {
	const rendered: RenderedMessage = { html: "", codes: [], maths: [] };
	rendered.html = sanitize(
		renderInto(markdownText, rendered.codes, rendered.maths, attachModels)
	);
	return rendered;
}

/** Render a full assistant message: thoughts stripped, body only. */
export function renderMessage(
	markdownText: string,
	sourcesWanted: boolean,
	attachModels?: AttachTagModel[]
): RenderedMessage {
	// Thoughts never display; extraction still strips them (and unasked
	// sources) so only the answer renders. Copy uses the same strip.
	const { body } = extractThoughts(markdownText);
	const clean = stripSourcesIfUnasked(body, sourcesWanted);
	const rendered: RenderedMessage = { html: "", codes: [], maths: [] };
	rendered.html = sanitize(renderInto(clean, rendered.codes, rendered.maths, attachModels));
	return rendered;
}

/**
 * LaTeX math in MAIN CHAT messages only (never the composer prompt, which
 * stays plain CodeMirror text): display `$$…$$` and inline `\(…\)` / `$…$`
 * render via KaTeX (bundled, offline). Unknown/invalid math keeps its plain
 * source rendering, never fatal. Unclosed delimiters (mid-stream) stay
 * literal. Fenced code blocks and inline code spans never become math.
 */


/**
 * Shared-code-array render so `data-code-index` attributes stay unique even
 * when thoughts and body are rendered separately.
 */
/**
 * Blocks whose base direction follows their own text: without this an
 * Arabic paragraph inherits the app's LTR, so its first line starts at
 * the left and a top-right drag begins mid-text instead of at the
 * start. Code keeps its own direction (mixed-direction source must not
 * reorder); thoughts chrome is app UI, not message text.
 */
const DIR_AUTO_BLOCKS = /<(p|li|h[1-6]|blockquote|td|th)(?=[\s>])/g;

/**
 * Play triangle for the Code Run button: same 16px box as the copy
 * glyph, filled (a stroked triangle reads mushy at 1rem).
 */
const CODE_RUN_GLYPH =
	`<svg class="action-glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` +
	`<path d="M5 3.2v9.6L12.2 8z" />` +
	`</svg>`;

function renderInto(
	markdownText: string,
	codes: Array<{ lang: string; code: string }>,
	maths: MathEntry[],
	attachModels?: AttachTagModel[]
): string {
	// Attachment tags leave first (code fences/spans excluded there),
	// so marked never splits a literal and the preview HTML below never
	// passes through it — same extract-then-substitute shape as math.
	const extracted = extractAttachmentTags(markdownText);
	// A ```latex fence duplicating its neighboring `$$` block goes first
	// (the display block stays), so each equation renders exactly once.
	// Math leaves the source next (code fences/spans excluded there), so
	// marked never sees the delimiters and KaTeX tags never pass through it.
	const base = maths.length;
	const { stripped, maths: found } = extractMath(stripLatexFenceDupes(extracted.stripped));
	for (const entry of found) maths.push(entry);
	const instance = new Marked({ breaks: true });
	instance.use({
		renderer: {
			// Paragraphs that can carry ruby reserve its vertical room
			// (see aid-space): English paragraphs stay tight so their
			// selection highlight hugs the text. Lists get the same mark
			// on the item (body renders exactly like the default — task
			// checkboxes and loose-list wrapping untouched), or toggling
			// furigana jumps line-height normal-to-tall on every item.
			paragraph(this: Renderer, { tokens }: Tokens.Paragraph): string {
				// Block tokens arrive unparsed: inline markup (bold, code
				// spans) still needs the parser before detection.
				const inner = this.parser.parseInline(tokens);
				const bare = inner.replace(/<[^>]*>/g, "");
				const cls = RUBY_SCRIPT_RE.test(bare) ? ` class="cjk"` : "";
				return `<p${cls}>${inner}</p>\n`;
			},
			listitem(this: Renderer, item: Tokens.ListItem): string {
				// marked v18 default is `<li>${parse(tokens)}</li>`: same
				// body, plus the ruby-room mark the aid path already adds.
				const body = this.parser.parse(item.tokens);
				const bare = body.replace(/<[^>]*>/g, "");
				const cls = RUBY_SCRIPT_RE.test(bare) ? ` class="cjk"` : "";
				return `<li${cls}>${body}</li>\n`;
			},
			code({ text, lang }: { text: string; lang?: string }): string {
				const language = (lang ?? "").trim() || "text";
				// A lone ```latex fence is math, not code: it renders
				// through KaTeX like a display block (a fence sitting next
				// to an identical `$$` block was already dropped by
				// stripLatexFenceDupes, so each equation shows once).
				if (language === "latex") {
					maths.push({ kind: "display", tex: stripOuterDisplayDelimiters(text), raw: text });
					return mathPlaceholder(maths.length - 1 - base);
				}
				const index = codes.length;
				codes.push({ lang: language, code: text });
				// Headless code block: no fold bar, no copy-on-click —
				// the pre is a native selection surface (user-select and
				// I-beam come from the stylesheet), so drags never touch
				// the clipboard. Copy lives on the icon button alone
				// (clicks delegate in MessageBody); folding swaps the pre
				// for the collapsed label via `data-folded` (wired
				// elsewhere). Per-language logos stay out: no glyph set
				// exists and Shiki already colors blocks apart, so
				// artwork per language isn't cheap.
				const loc = text.split("\n").length;
				// Run lives only on runnable fences (runnerFor's allowlist):
				// prose, output samples, and unknown languages get copy
				// alone — never a button that only explains itself.
				const runButton =
					runnerFor(language) !== null
						? `<button type="button" class="ccez-code-run" data-code-run="${index}" data-code-lang="${escapeHtml(language)}" aria-label="Run code block" title="Run locally">${CODE_RUN_GLYPH}</button>`
						: "";
				return (
					`<div class="ccez-code" data-code-index="${index}">` +
					`<button type="button" class="ccez-code-copy" data-code-copy="${index}" ` +
					`aria-label="Copy code block" title="Copy">${CODE_COPY_GLYPH}</button>` +
					runButton +
					`<span class="ccez-code-foldedlabel">${escapeHtml(foldedCodeLabel(language, loc))}</span>` +
					`<pre><code data-code-index="${index}">${escapeHtml(text)}</code></pre></div>`
				);
			}
		}
	});
	const html = instance.parse(stripped) as string;
	const withMath = html.replace(MATH_PLACEHOLDER_RE, (_match, num: string) => {
		const index = base + Number(num);
		const entry = maths[index];
		// Placeholders are ours alone; a missing entry keeps the raw marker.
		if (!entry) return _match;
		return mathHtml(entry, index);
	});
	// Tag placeholders resolve against the message's attachments (Nth
	// of a kind to Nth of a kind); without models — or past the end
	// of them — the literal stays, exactly as before tags existed.
	const models = attachModels ?? [];
	const seen = { image: 0, text: 0 };
	const withTags = withMath.replace(ATTACH_TAG_RE, (_match, kind: string) => {
		const isFile = kind === "f";
		const index = isFile ? seen.text++ : seen.image++;
		const model =
			models.filter((m) => (isFile ? m.kind === "text" : m.kind === "image"))[index] ??
			null;
		return attachTagHtml(model, kind);
	});
	return withTags.replace(DIR_AUTO_BLOCKS, "<$1 dir=\"auto\"");
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

export function sanitize(dirty: string): string {
	if (typeof window === "undefined") {
		// Non-DOM context (SSR/prerender): escape everything, no markup.
		return `<p dir="auto">${escapeHtml(dirty)}</p>`;
	}
	purifier ??= DOMPurify(window);
	return purifier.sanitize(dirty, {
		ADD_TAGS: ["details", "summary", "button", "ruby", "rt", "rp"],
		ADD_ATTR: [
			"open",
			"class",
			"style",
			"aria-hidden",
			"aria-label",
			"aria-expanded",
			"data-code-copy",
			"data-code-run",
			"data-code-lang",
			"data-code-output",
			"data-code-index",
			"data-math-index",
			"data-paste-fold",
			"type",
			"dir"
		]
	});
}

/** One visible run: body text, a closed-fold marker button, or an
 * open fold's text (renderers frame it in collapse brackets). */
export type FoldSegment =
	| { kind: "text"; text: string }
	| { kind: "marker"; index: number; chars: number }
	| { kind: "open"; index: number; chars: number; text: string };

/** Marker button HTML (same label as the composer). Chars/index are numbers — nothing to escape. */
export function pasteFoldButton(index: number, chars: number): string {
	return `<button type="button" class="paste-fold" data-paste-fold="${index}">[paste ${chars} chars]</button>`;
}

/**
 * Split content into visible runs: open folds merge into the surrounding
 * text, closed folds become marker segments. Invalid or overlapping folds
 * are ignored, never fatal. Pure and unit-tested.
 */
export function foldSegments(
	content: string,
	folds: Array<{ start: number; end: number; chars: number; open?: boolean }> | undefined
): FoldSegment[] {
	if (!folds || folds.length === 0) return [{ kind: "text", text: content }];
	const ordered = folds
		.map((fold, index) => ({ ...fold, index }))
		.filter((fold) => fold.start >= 0 && fold.end <= content.length && fold.start < fold.end)
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const segments: FoldSegment[] = [];
	let run = "";
	let cursor = 0;
	const flush = () => {
		if (run) {
			segments.push({ kind: "text", text: run });
			run = "";
		}
	};
	for (const fold of ordered) {
		if (fold.start < cursor) continue; // overlapping: keep the earliest
		run += content.slice(cursor, fold.start);
		if (fold.open) {
			flush();
			segments.push({
				kind: "open",
				index: fold.index,
				chars: fold.chars,
				text: content.slice(fold.start, fold.end)
			});
		} else {
			flush();
			segments.push({ kind: "marker", index: fold.index, chars: fold.chars });
		}
		cursor = fold.end;
	}
	run += content.slice(cursor);
	flush();
	return segments;
}

/**
 * Collapse bracket for an expanded run (paste fold or attachment):
 * blue like the marker, clicking contracts back to the tag. Pure and
 * unit-tested.
 */
export function foldBracket(index: number, toggleAttr: string, bracket: "[" | "]"): string {
	return (
		`<button type="button" class="paste-fold" ${toggleAttr}="${index}" ` +
		`title="Collapse pasted content">${bracket}</button>`
	);
}

/**
 * Splice paste folds into display text: closed folds become a
 * `<button data-paste-fold>` marker carrying the composer's
 * `[paste N chars]` label; open folds render inline framed by blue
 * collapse brackets (clicking either contracts). Clicks delegate in
 * MessageBody like code-block buttons. Pure and unit-tested.
 */
export function applyPasteFolds(
	content: string,
	folds: Array<{ start: number; end: number; chars: number; open?: boolean }> | undefined
): string {
	return foldSegments(content, folds)
		.map((segment) => {
			if (segment.kind === "text") return segment.text;
			if (segment.kind === "marker") return pasteFoldButton(segment.index, segment.chars);
			return (
				foldBracket(segment.index, "data-paste-fold", "[") +
				segment.text +
				foldBracket(segment.index, "data-paste-fold", "]")
			);
		})
		.join("");
}

/** Plain-text copy of rendered HTML (for "copy as text"). */
export function htmlToText(html: string): string {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return html.replace(/<[^>]*>/g, "");
	}
	const el = document.createElement("div");
	el.innerHTML = html;
	return el.innerText ?? el.textContent ?? "";
}

// --- Shiki highlighting (async enhancement pass) ---

const PRELOAD_LANGS = [
	"javascript",
	"typescript",
	"tsx",
	"python",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"csharp",
	"bash",
	"sh",
	"json",
	"yaml",
	"toml",
	"markdown",
	"html",
	"css",
	"sql",
	"diff",
	"text",
	"plaintext"
];

let highlighterPromise: Promise<Highlighter> | null = null;

/** Lazily loaded singleton — Shiki's WASM/TextMate grammars are heavy. */
export function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		themes: ["github-light", "github-dark"],
		langs: PRELOAD_LANGS
	});
	return highlighterPromise;
}

/**
 * Replace each `code[data-code-index]` body with Shiki-highlighted HTML
 * (dual light/dark CSS variables; the stylesheet picks by media query).
 * Unknown languages keep their plain rendering.
 */
export async function highlightRendered(rendered: RenderedMessage): Promise<string> {
	if (rendered.codes.length === 0) return rendered.html;
	let highlighter: Highlighter;
	try {
		highlighter = await getHighlighter();
	} catch {
		return rendered.html;
	}
	const loaded = new Set(highlighter.getLoadedLanguages());
	// Synchronous throughout (codeToHtml is not async): no Promise.all.
	const highlighted = rendered.codes.map(({ lang, code }) => {
		const language = loaded.has(lang) ? lang : "plaintext";
		try {
			const full = highlighter.codeToHtml(code, {
				lang: language,
				themes: { light: "github-light", dark: "github-dark" }
			});
			const match = full.match(/<pre[^>]*>([\s\S]*)<\/pre>/);
			return match ? (match[1] ?? "").replace(/^<code[^>]*>|<\/code>$/g, "") : null;
		} catch {
			return null;
		}
	});
	if (typeof document === "undefined") return rendered.html;
	const template = document.createElement("template");
	template.innerHTML = rendered.html;
	template.content.querySelectorAll("code[data-code-index]").forEach((el) => {
		const fragment = highlighted[Number(el.getAttribute("data-code-index"))];
		// The `shiki` class anchors the dark-mode CSS-variable override
		// (the original pre.shiki wrapper is not carried over).
		if (fragment) {
			el.innerHTML = fragment;
			el.classList.add("shiki");
		}
	});
	const wrapper = document.createElement("div");
	wrapper.append(template.content.cloneNode(true));
	return wrapper.innerHTML;
}
