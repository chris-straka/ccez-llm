/**
 * Aid-mode text nodes: pinyin / furigana / dual render onto the real
 * markdown HTML (code and math blocks survive pinning), so only prose
 * text nodes convert. Code, math (rendered and raw TeX), ruby,
 * buttons, links, and annotation chrome never convert — readings
 * there are noise, and ruby-in-ruby nests. Pure over a DOM root;
 * jsdom-tested (layout-free: collection only).
 */

/** Ancestors that disqualify a text node from aid conversion. */
export const AID_SKIP_SELECTOR = [
	"pre",
	"code",
	"[data-math-index]",
	".katex",
	"ruby",
	"rt",
	"rp",
	"button",
	"a",
	"textarea",
	"select",
	".ccez-ann-badge",
	".ccez-ann-anchor",
	".ccez-code-output",
	".ccez-code-foldedlabel",
	".ccez-math-foldedlabel",
	"[data-code-output]",
	"script",
	"style"
].join(", ");

/**
 * Prose text nodes under `root` in document order, skipping blank
 * nodes and everything under the skip selector. Idempotent with
 * conversion: already-converted ruby (rt/rp) is skipped, so
 * re-stamps never double-annotate.
 */
export function aidTextNodes(root: Element): Text[] {
	const out: Text[] = [];
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node): number {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (parent.closest(AID_SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
			if ((node.textContent ?? "").trim() === "") return NodeFilter.FILTER_SKIP;
			return NodeFilter.FILTER_ACCEPT;
		}
	});
	let node = walker.nextNode();
	while (node) {
		out.push(node as Text);
		node = walker.nextNode();
	}
	return out;
}
