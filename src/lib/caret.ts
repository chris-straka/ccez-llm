/**
 * Caret math over a rendered text block (tap-to-select engine).
 *
 * The helpers walk the block's text nodes with a TreeWalker, so they
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

/**
 * Base text of a block: its text nodes in order, minus those inside
 * `skip` (ruby readings, badge chrome), with each node's start in the
 * flat text. Pinyin ruby puts every hanzi in its own node, so word
 * segmentation has to run over this joined text, never one node.
 */
export interface BaseText {
	text: string;
	nodes: Array<{ node: Text; start: number }>;
}

export function blockBaseText(
	doc: Document,
	block: Element,
	skip: string
): BaseText {
	const nodes: BaseText["nodes"] = [];
	let text = "";
	const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		if (n.nodeType !== Node.TEXT_NODE) continue;
		if (n.parentElement?.closest(skip)) continue;
		const value = n.textContent ?? "";
		if (value === "") continue;
		nodes.push({ node: n as Text, start: text.length });
		text += value;
	}
	return { text, nodes };
}

/** Flat offset of (node, offset) in the base text; null when the node
 * is skipped chrome or outside the block. */
export function baseCaret(
	base: BaseText,
	node: Node,
	offset: number
): number | null {
	for (const entry of base.nodes) {
		if (entry.node !== node) continue;
		const length = entry.node.textContent?.length ?? 0;
		return entry.start + Math.max(0, Math.min(offset, length));
	}
	return null;
}

/**
 * Range points for a flat [start, end) span of the base text. The
 * start resolves forward into the node holding the span's first char
 * and the end backward into the node holding its last, so a span that
 * begins or ends on a node seam never reaches over the reading parked
 * in that seam. Null for an empty or out-of-bounds span.
 */
export function baseSpanPoints(
	base: BaseText,
	start: number,
	end: number
): {
	start: { node: Text; offset: number };
	end: { node: Text; offset: number };
} | null {
	if (end <= start || start < 0 || end > base.text.length) return null;
	let from: { node: Text; offset: number } | null = null;
	let to: { node: Text; offset: number } | null = null;
	for (const { node, start: at } of base.nodes) {
		const length = node.textContent?.length ?? 0;
		if (!from && start < at + length) from = { node, offset: start - at };
		if (!to && end <= at + length) to = { node, offset: end - at };
		if (from && to) break;
	}
	return from && to ? { start: from, end: to } : null;
}
