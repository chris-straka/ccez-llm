/**
 * Fenced code blocks in the prompt composer: pure document parser behind
 * the CodeMirror fence widgets in `editor.ts` (same split as the paste
 * spans — pure here, decorations there).
 *
 * A fence opens on a ```lang line and closes on the next bare ``` line.
 * Only backtick fences count; body rows are never rewritten by the
 * parser, so the cursor and IME always sit on real text (the parked
 * block-widget bugs came from replacing body rows — only the two fence
 * bar lines ever become widgets).
 */

export interface FenceBlock {
	/** 0-based opening fence line. */
	openLine: number;
	/** 0-based closing fence line, or -1 when the fence never closes. */
	closeLine: number;
	/** Language tag after the opening backticks ("" when bare). */
	lang: string;
	/** Doc offset where the opening fence line starts. */
	openFrom: number;
	/** Doc offset where the body starts (first body line start). */
	bodyFrom: number;
	/** Doc offset where the body ends (closing fence line start, or EOF). */
	bodyTo: number;
	/** Doc offset where the fence ends (closing line end, or EOF). */
	closeTo: number;
}

const OPEN_RE = /^```([A-Za-z0-9_+-]*)\s*$/;
const CLOSE_RE = /^\s*```\s*$/;

/** Shift+Enter outcomes on the cursor line (decided pure, executed in `editor.ts`). */
export type ShiftEnterAction = { kind: "newline" } | { kind: "close" } | { kind: "exit" };

/**
 * What Shift+Enter does at `cursor`: on an unclosed opener it closes
 * the fence; on an empty body line it exits past the fence (so
 * open-Shift+Enter, Shift+Enter lands outside — the spec's triple
 * collapsed to two, since an empty body holds nothing to keep); anywhere
 * else it stays a plain newline.
 */
export function shiftEnterAction(doc: string, cursor: number): ShiftEnterAction {
	const lines = doc.split("\n");
	let offset = 0;
	let lineNo = 0;
	for (; lineNo < lines.length; lineNo++) {
		const len = (lines[lineNo] ?? "").length;
		if (cursor <= offset + len) break;
		offset += len + 1;
	}
	const line = lines[lineNo] ?? "";
	if (OPEN_RE.test(line)) {
		const opener = parseFences(doc).find((f) => f.openLine === lineNo);
		if (!opener || opener.closeLine === -1) return { kind: "close" };
		return { kind: "newline" };
	}
	const fences = parseFences(doc);
	const fence = fenceAtOffset(fences, cursor);
	if (fence && cursor >= fence.bodyFrom && cursor <= fence.bodyTo) {
		if (fenceBody(doc, fence).trim() === "") return { kind: "exit" };
	}
	return { kind: "newline" };
}

/** Locate every fenced block in a plain-text document. Never throws. */
export function parseFences(doc: string): FenceBlock[] {
	const out: FenceBlock[] = [];
	if (!doc.includes("```")) return out;
	const lines = doc.split("\n");
	// Line start offsets: line i starts at starts[i].
	const starts: number[] = new Array<number>(lines.length);
	let offset = 0;
	for (let i = 0; i < lines.length; i++) {
		starts[i] = offset;
		offset += (lines[i] ?? "").length + 1;
	}
	let i = 0;
	while (i < lines.length) {
		const open = OPEN_RE.exec(lines[i] ?? "");
		if (!open) {
			i++;
			continue;
		}
		const openLine = i;
		const lang = open[1] ?? "";
		const openFrom = starts[i] ?? 0;
		const bodyFrom = starts[i + 1] ?? doc.length;
		let closeLine = -1;
		let j = i + 1;
		while (j < lines.length) {
			if (CLOSE_RE.test(lines[j] ?? "")) {
				closeLine = j;
				break;
			}
			j++;
		}
		const bodyTo = closeLine === -1 ? doc.length : (starts[closeLine] ?? doc.length);
		const closeTo =
			closeLine === -1 ? doc.length : bodyTo + (lines[closeLine] ?? "").length;
		out.push({ openLine, closeLine, lang, openFrom, bodyFrom, bodyTo, closeTo });
		i = closeLine === -1 ? lines.length : closeLine + 1;
	}
	return out;
}

/** Body text of a fence (what Copy writes and send keeps verbatim). */
export function fenceBody(doc: string, fence: FenceBlock): string {
	return doc.slice(fence.bodyFrom, fence.bodyTo);
}

/** Fence holding a doc offset (bars included), or null outside fences. */
export function fenceAtOffset(fences: FenceBlock[], offset: number): FenceBlock | null {
	for (const fence of fences) {
		if (offset >= fence.openFrom && offset <= fence.closeTo) return fence;
	}
	return null;
}
