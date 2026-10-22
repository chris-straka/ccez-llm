/**
 * The word sounding in a drill clip, marked on its transcript through
 * the CSS Custom Highlight API: no DOM changes, so annotation marks,
 * selection, and re-renders never notice it. Runtimes without the API
 * (jsdom, old webviews) just show no mark.
 */

/** The highlight's name in CSS (`::highlight(clip-word)`). */
export const CLIP_WORD = "clip-word";

/** Text nodes under `root` with their start in the joined text. */
function textRuns(root: Node): { node: Text; at: number }[] {
	const runs: { node: Text; at: number }[] = [];
	const doc = root.ownerDocument ?? document;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let at = 0;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const node = n as Text;
		runs.push({ node, at });
		at += node.data.length;
	}
	return runs;
}

/** The node and offset holding character `pos` of the joined text. */
function locate(
	runs: readonly { node: Text; at: number }[],
	pos: number,
	end: boolean
): { node: Text; offset: number } | null {
	for (const run of runs) {
		const len = run.node.data.length;
		const inside = end
			? pos > run.at && pos <= run.at + len
			: pos >= run.at && pos < run.at + len;
		if (inside) return { node: run.node, offset: pos - run.at };
	}
	return null;
}

/**
 * Ranges for `words` in `root`'s text, found in order (each search
 * starts after the last hit). A word missing from the text (rendered
 * differently) gets null and the search carries on past it.
 */
export function wordRanges(
	root: Node,
	words: readonly string[]
): (Range | null)[] {
	const runs = textRuns(root);
	const text = runs.map((r) => r.node.data).join("");
	const doc = root.ownerDocument ?? document;
	let from = 0;
	return words.map((word) => {
		const at = text.indexOf(word, from);
		if (at < 0 || !word) return null;
		const start = locate(runs, at, false);
		const end = locate(runs, at + word.length, true);
		if (!start || !end) return null;
		from = at + word.length;
		const range = doc.createRange();
		range.setStart(start.node, start.offset);
		range.setEnd(end.node, end.offset);
		return range;
	});
}

/** Index of the word sounding at `t` (the last one started), or -1. */
export function wordAt(starts: readonly number[], t: number): number {
	let k = -1;
	for (const [i, s] of starts.entries()) {
		if (s <= t + 1e-3) k = i;
		else break;
	}
	return k;
}

interface HighlightRegistry {
	set: (name: string, value: unknown) => void;
	delete: (name: string) => void;
}

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	const ctor = (globalThis as { Highlight?: unknown }).Highlight;
	return css?.highlights && typeof ctor === "function" ? css.highlights : null;
}

/** Mark `range` as the sounding word (null clears the mark). */
export function markWord(range: Range | null): void {
	const reg = registry();
	if (!reg) return;
	if (!range) {
		reg.delete(CLIP_WORD);
		return;
	}
	const Ctor = (
		globalThis as unknown as { Highlight: new (r: Range) => unknown }
	).Highlight;
	reg.set(CLIP_WORD, new Ctor(range));
}
