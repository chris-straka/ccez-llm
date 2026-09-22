/**
 * Caret math over a rendered text block (tap-to-select engine).
 *
 * Both helpers walk the block's text nodes with a TreeWalker, so they
 * take the owning Document instead of reaching for the global — the
 * component passes `document`, tests pass jsdom's.
 */

/** Caret offset of (node, offset) within the block's text. */
export function caretOffsetInBlock(
	doc: Document,
	block: Element,
	node: Node,
	offset: number
): number {
	let at = 0;
	const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let current = walker.nextNode();
	while (current) {
		if (current === node)
			return at + Math.min(offset, current.textContent?.length ?? 0);
		at += current.textContent?.length ?? 0;
		current = walker.nextNode();
	}
	return at;
}

/** (node, sub-offset) owning a block-text offset. */
export function nodeAtBlockOffset(
	doc: Document,
	block: Element,
	offset: number
): { node: Node; offset: number } | null {
	const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	let at = 0;
	let current = walker.nextNode();
	let last: Node | null = null;
	let lastLength = 0;
	while (current) {
		const length = current.textContent?.length ?? 0;
		if (offset <= at + length) return { node: current, offset: offset - at };
		at += length;
		last = current;
		lastLength = length;
		current = walker.nextNode();
	}
	return last ? { node: last, offset: lastLength } : null;
}
