/**
 * Repeat-ink paint (see ann-repeats.ts): each message body registers
 * the ranges its inked quotes cover, and every ink name's Custom
 * Highlight is rebuilt from all live bodies. Highlights move no DOM,
 * so badges, ruby, and a live selection stay exactly where they are;
 * where the API is missing nothing paints (repeat ink is an aid, not
 * content). Ranges cover message text nodes only (quoteTextNodes), so
 * badge digits and readings never take ink, and skip kanji under a
 * selection-reading tint: a highlight's colour beats the element's, so
 * inked text would hide the tint that links it to its reading panel.
 */
import { REPEAT_INK_COUNT, type RepeatInk } from "./ann-repeats";
import { quoteTextNodes } from "./annotations-stamp";
import {
	clearAnnotationWash,
	highlightsSupported,
	paintAnnotationWash
} from "./annHighlights";
import { locateQuoteRepeats } from "./quote-match";

/** Highlight name for one ink (styled as `::highlight(ccez-rep-N)`). */
export function repeatInkName(ink: number): string {
	return `ccez-rep-${ink}`;
}

/** Selection-reading tint spans (selTint.ts). */
const TINT_SELECTOR = ".frbt0, .frbt1, .frbt2, .frbt3";

const bodies = new Map<
	HTMLElement,
	{ inks: readonly RepeatInk[]; ranges: Range[][] }
>();

function rebuild(): void {
	for (const root of [...bodies.keys()]) {
		if (!root.isConnected) bodies.delete(root);
	}
	for (let ink = 0; ink < REPEAT_INK_COUNT; ink++) {
		const ranges = [...bodies.values()].flatMap(
			(body) => body.ranges[ink] ?? []
		);
		if (ranges.length === 0) clearAnnotationWash(repeatInkName(ink));
		else paintAnnotationWash(ranges, repeatInkName(ink));
	}
}

/** One range per text-node piece of each inked match. */
function inkRanges(root: HTMLElement, inks: readonly RepeatInk[]): Range[][] {
	const byInk: Range[][] = Array.from({ length: REPEAT_INK_COUNT }, () => []);
	if (inks.length === 0) return byInk;
	const nodes = quoteTextNodes(root);
	const texts = nodes.map((node) => node.textContent ?? "");
	for (const { quote, ink, from } of inks) {
		const into = byInk[ink];
		if (!into) continue;
		for (const loc of locateQuoteRepeats(texts, quote, from)) {
			for (let n = loc.startNode; n <= loc.endNode; n++) {
				const node = nodes[n];
				if (!node || node.parentElement?.closest(TINT_SELECTOR)) continue;
				const start = n === loc.startNode ? loc.startOffset : 0;
				const end = n === loc.endNode ? loc.endOffset : node.length;
				if (end <= start) continue;
				const range = root.ownerDocument.createRange();
				range.setStart(node, start);
				range.setEnd(node, end);
				into.push(range);
			}
		}
	}
	return byInk;
}

/** Ink one body's quotes (replacing what it inked before). Never throws. */
export function paintRepeatInks(
	root: HTMLElement,
	inks: readonly RepeatInk[]
): void {
	if (!highlightsSupported()) return;
	if (inks.length === 0 && !bodies.has(root)) return;
	try {
		bodies.set(root, { inks, ranges: inkRanges(root, inks) });
		rebuild();
	} catch {
		// Ink is cosmetic: never break the stamp.
	}
}

/**
 * Re-ink every body from its current inks: tint surgery (wrapping and
 * unwrapping kanji) moves the text nodes the ranges point at.
 */
export function refreshRepeatInks(): void {
	if (bodies.size === 0) return;
	try {
		for (const [root, body] of bodies)
			if (root.isConnected) body.ranges = inkRanges(root, body.inks);
		rebuild();
	} catch {
		// Cosmetic.
	}
}

/** Drop one body's inks (unmount). Never throws. */
export function clearRepeatInks(root: HTMLElement): void {
	if (!bodies.delete(root)) return;
	try {
		rebuild();
	} catch {
		// Cosmetic.
	}
}
