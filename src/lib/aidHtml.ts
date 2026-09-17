/**
 * Aid ruby on rendered HTML: pinyin / furigana / dual convert prose
 * text nodes in place, so code and math blocks survive pinning (the
 * old text-only aid path set markdown aside and equations came back
 * as raw TeX). Conversion rides `aidTextNodes` — code, math, chrome,
 * and existing ruby never convert — and each node classifies on its
 * own text, exactly like the line classifier the text path used.
 *
 * Context cost: pinyin-pro resolves polyphones per call, so a node
 * split mid-word (bold runs) converts with less context than the
 * whole line had. Blocks intact beats perfect polyphones.
 */
import { aidTextNodes } from "./aidNodes";
import { pinyinRuby } from "./pinyin";
import { furiganaLine } from "./furigana";
import { classifyAidLine, type LocalAid } from "./reading";
import { sanitize } from "./render";

export type AidHtmlMode = "pinyin" | "furigana" | "dual";

/**
 * Converted HTML for one eligible node, or null when it stays bare
 * (wrong script for the mode, or nothing to annotate). Pure apart
 * from the furigana worker call.
 */
export async function convertAidNode(
	text: string,
	mode: AidHtmlMode,
	preferred: LocalAid | null
): Promise<string | null> {
	if (mode === "pinyin") {
		if (classifyAidLine(text, preferred) !== "pinyin") return null;
		return pinyinRuby(text);
	}
	const kind = classifyAidLine(text, preferred);
	if (mode === "furigana") {
		if (kind !== "furigana") return null;
		return sanitize(await furiganaLine(text, preferred));
	}
	if (kind === "furigana") return sanitize(await furiganaLine(text, preferred));
	if (kind === "pinyin") return pinyinRuby(text);
	return null;
}

/**
 * Rendered HTML with aid ruby stamped onto its prose text nodes
 * (async: furigana nodes convert in the worker). The input stays
 * untouched — conversion runs on a detached host, so a stale run
 * never flashes half-converted markup.
 */
export async function aidHtml(
	dirtyHtml: string,
	mode: AidHtmlMode,
	preferred: LocalAid | null
): Promise<string> {
	const host = document.createElement("div");
	host.innerHTML = dirtyHtml;
	const nodes = aidTextNodes(host);
	await Promise.all(
		nodes.map(async (node) => {
			const converted = await convertAidNode(node.textContent ?? "", mode, preferred);
			if (converted === null) return;
			const span = host.ownerDocument.createElement("span");
			span.innerHTML = converted;
			node.replaceWith(span);
		})
	);
	return host.innerHTML;
}

/**
 * Sync pinyin-only variant (no worker involved): same walk, same
 * replacement, no promise. The component uses this on its hot path
 * so pinning pinyin never suspends on a microtask.
 */
export function aidPinyinHtml(dirtyHtml: string, preferred: LocalAid | null): string {
	const host = document.createElement("div");
	host.innerHTML = dirtyHtml;
	for (const node of aidTextNodes(host)) {
		const text = node.textContent ?? "";
		if (classifyAidLine(text, preferred) !== "pinyin") continue;
		const span = host.ownerDocument.createElement("span");
		span.innerHTML = pinyinRuby(text);
		node.replaceWith(span);
	}
	return host.innerHTML;
}
