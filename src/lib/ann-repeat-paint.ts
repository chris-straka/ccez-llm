/**
 * Repeat-ink paint (see ann-repeats.ts): each message body registers
 * the ranges its ink underlines cover, and every highlight name is
 * rebuilt from all live bodies. Highlights move no DOM, so badges,
 * ruby, and a live selection stay exactly where they are; where the
 * API is missing nothing paints (repeat ink is an aid, not content).
 * Ranges cover message text nodes only (quoteTextNodes), so badge
 * digits and readings never take ink. Underlines leave the text
 * colour alone, so reading tints show through.
 *
 * Ranges are live: any DOM surgery under a body (badge re-stamps, the
 * DOM-mark wash and its fade, the shell's jump-flash marks, reading
 * tints) moves or collapses them, and a collapsed boundary can merge
 * into a neighbour and grow over plain text. So a body never trusts
 * its stored ranges: a MutationObserver re-inks it after any change,
 * every rebuild re-checks the other bodies' ranges against the text
 * they covered, and only names whose ranges really changed are
 * rewritten (then repainted: the shell's overlay ignores registry
 * writes until something forces a repaint).
 */
import {
	REPEAT_INK_COUNT,
	inkSpans,
	type InkMark,
	type RepeatInk
} from "./ann-repeats";
import { invalidateWashPaint, quoteTextNodes } from "./annotations-stamp";
import { clearAnnotationWash, highlightsSupported } from "./annHighlights";

/**
 * Highlight name for one ink: `ccez-rep-N` underlines annotated
 * quotes (solid), `ccez-rep-N-again` their repeats (dotted).
 */
export function repeatInkName(ink: number, again = false): string {
	return again ? `ccez-rep-${ink}-again` : `ccez-rep-${ink}`;
}

/** Below the wash and the jump flash (WASH_PRIORITY), annotated
quotes over repeats: overlapping highlights resolve by priority, and
engines otherwise fall back to registration order (WebKit then let an
ink win over the hover wash on part of a quote). Never negative:
WebKit paints nothing for a negative priority. */
const SOLID_PRIORITY = 1;
const AGAIN_PRIORITY = 0;

interface InkRange {
	name: string;
	range: Range;
	/** The text the range covered when made: a range whose text moved
	under it is stale. */
	text: string;
}

interface Body {
	inks: readonly RepeatInk[];
	marks: readonly InkMark[];
	ranges: InkRange[];
	observer: MutationObserver | null;
}

const bodies = new Map<HTMLElement, Body>();
/** Ranges last registered per name (the registry's own copy) and
the bodies they sat in. */
const painted = new Map<string, { ranges: Range[]; roots: HTMLElement[] }>();

function allNames(): string[] {
	const names: string[] = [];
	for (let ink = 0; ink < REPEAT_INK_COUNT; ink++)
		names.push(repeatInkName(ink), repeatInkName(ink, true));
	return names;
}

/** One range per text-node piece of each underline. */
function inkRanges(
	root: HTMLElement,
	inks: readonly RepeatInk[],
	marks: readonly InkMark[]
): InkRange[] {
	if (inks.length === 0) return [];
	const nodes = quoteTextNodes(root);
	const texts = nodes.map((node) => node.textContent ?? "");
	const out: InkRange[] = [];
	for (const { ink, again, loc } of inkSpans(texts, inks, marks)) {
		const name = repeatInkName(ink, again);
		for (let n = loc.startNode; n <= loc.endNode; n++) {
			const node = nodes[n];
			if (!node) continue;
			const start = n === loc.startNode ? loc.startOffset : 0;
			const end = n === loc.endNode ? loc.endOffset : node.length;
			if (end <= start) continue;
			const range = root.ownerDocument.createRange();
			range.setStart(node, start);
			range.setEnd(node, end);
			out.push({ name, range, text: node.data.slice(start, end) });
		}
	}
	return out;
}

/** A stored range still sits on the text it was made for. */
function intact(root: HTMLElement, { range, text }: InkRange): boolean {
	const node = range.startContainer;
	return (
		node instanceof Text &&
		node === range.endContainer &&
		root.contains(node) &&
		node.data.slice(range.startOffset, range.endOffset) === text
	);
}

function sameRanges(a: readonly Range[], b: readonly Range[]): boolean {
	return (
		a.length === b.length &&
		a.every((x, i) => {
			const y = b[i];
			return (
				y !== undefined &&
				x.startContainer === y.startContainer &&
				x.startOffset === y.startOffset &&
				x.endContainer === y.endContainer &&
				x.endOffset === y.endOffset
			);
		})
	);
}

function register(name: string, ranges: Range[]): void {
	if (ranges.length === 0) {
		clearAnnotationWash(name);
		return;
	}
	const Ctor = Highlight;
	const reg = CSS.highlights;
	if (typeof Ctor !== "function" || !reg) return;
	const highlight = new Ctor(...ranges);
	highlight.priority = name.endsWith("-again")
		? AGAIN_PRIORITY
		: SOLID_PRIORITY;
	reg.set(name, highlight);
}

/**
 * Re-check every body (re-inking any whose ranges went stale), then
 * rewrite the names whose ranges changed and repaint the bodies that
 * hold them.
 */
function rebuild(): void {
	for (const [root, body] of [...bodies]) {
		if (!root.isConnected) {
			body.observer?.disconnect();
			bodies.delete(root);
		} else if (!body.ranges.every((r) => intact(root, r))) {
			body.ranges = inkRanges(root, body.inks, body.marks);
		}
	}
	const touched = new Set<HTMLElement>();
	for (const name of allNames()) {
		const owners: HTMLElement[] = [];
		const ranges: Range[] = [];
		for (const [root, body] of bodies) {
			const mine = body.ranges.filter((r) => r.name === name);
			if (mine.length > 0) owners.push(root);
			for (const r of mine) ranges.push(r.range);
		}
		const before = painted.get(name);
		if (sameRanges(before?.ranges ?? [], ranges)) continue;
		// Bodies that lost this name repaint too: their old pixels
		// would otherwise stick in the shell.
		for (const root of [...(before?.roots ?? []), ...owners]) touched.add(root);
		painted.set(name, { ranges, roots: owners });
		register(name, ranges);
	}
	for (const root of touched) if (root.isConnected) invalidateWashPaint(root);
}

/** Re-ink a body after DOM changes under it (observer batches). */
function reink(root: HTMLElement): void {
	const body = bodies.get(root);
	if (!body) return;
	try {
		body.ranges = inkRanges(root, body.inks, body.marks);
		rebuild();
	} catch {
		// Cosmetic.
	}
}

function observe(root: HTMLElement): MutationObserver | null {
	if (typeof MutationObserver !== "function") return null;
	const observer = new MutationObserver(() => reink(root));
	observer.observe(root, {
		childList: true,
		characterData: true,
		subtree: true
	});
	return observer;
}

/**
 * Ink one body's quotes (replacing what it inked before): `marks` are
 * the quotes annotated in this body, drawn solid; other matches are
 * repeats, drawn dotted. Never throws.
 */
export function paintRepeatInks(
	root: HTMLElement,
	inks: readonly RepeatInk[],
	marks: readonly InkMark[] = []
): void {
	if (!highlightsSupported()) return;
	if (inks.length === 0) {
		clearRepeatInks(root);
		return;
	}
	try {
		const ranges = inkRanges(root, inks, marks);
		const body = bodies.get(root);
		if (body) Object.assign(body, { inks, marks, ranges });
		else bodies.set(root, { inks, marks, ranges, observer: observe(root) });
		rebuild();
	} catch {
		// Ink is cosmetic: never break the stamp.
	}
}

/** Drop one body's inks (unmount). Never throws. */
export function clearRepeatInks(root: HTMLElement): void {
	const body = bodies.get(root);
	if (!body) return;
	body.observer?.disconnect();
	bodies.delete(root);
	try {
		rebuild();
	} catch {
		// Cosmetic.
	}
}
