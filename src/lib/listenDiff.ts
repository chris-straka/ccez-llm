/**
 * Guess vs transcript for listening drills: align what the learner
 * typed against what was said, word by word. Pure.
 *
 * Words compare without case or punctuation. Accents, apostrophes and
 * hyphens only ("a"/"à", "dune"/"d'une") count as `near`: heard right,
 * spelled loosely. Chinese and Japanese compare per character, since
 * nobody types their word breaks the same way twice.
 */

export type DiffKind = "ok" | "near" | "wrong" | "missed" | "extra";

export interface DiffOp {
	kind: DiffKind;
	/** The transcript word (absent for `extra`). */
	ref?: string;
	/** The learner's word (absent for `missed`). */
	guess?: string;
}

export interface GuessDiff {
	ops: DiffOp[];
	/** Transcript words heard (`ok` + `near`). */
	got: number;
	/** Transcript words in all. */
	total: number;
}

/** Languages diffed per character. */
const PER_CHAR = new Set(["zh", "ja", "yue", "lzh"]);
const LETTERS = /[\p{L}\p{N}\p{M}]/u;

function baseLang(lang: string): string {
	return lang.split(/[-_]/)[0]?.toLowerCase() ?? "";
}

/** Comparison form: case-folded, punctuation gone (inner apostrophes
 * and hyphens stay for `strict`). */
function strict(word: string): string {
	return word
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[’ʼ`´]/g, "'")
		.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/** Loose form: no accents, apostrophes, or hyphens either. */
function loose(word: string): string {
	return strict(word)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/['-]/g, "")
		.replace(/ß/g, "ss")
		.replace(/[œ]/g, "oe")
		.replace(/[æ]/g, "ae");
}

/** Display words of `text`: words as written, punctuation stuck on. */
export function diffWords(text: string, lang: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (PER_CHAR.has(baseLang(lang))) {
		return [...trimmed].filter((ch) => LETTERS.test(ch));
	}
	// Spaced scripts split on whitespace; Thai and friends lean on the
	// platform's word segmenter.
	if (/\s/.test(trimmed) || typeof Intl.Segmenter !== "function") {
		return trimmed.split(/\s+/).filter((w) => LETTERS.test(w));
	}
	const seg = new Intl.Segmenter(baseLang(lang) || undefined, {
		granularity: "word"
	});
	return [...seg.segment(trimmed)]
		.filter((s) => s.isWordLike)
		.map((s) => s.segment);
}

function editDistance(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
	for (let i = 1; i <= x.length; i++) {
		const row = [i];
		for (let j = 1; j <= y.length; j++) {
			const cost = x[i - 1] === y[j - 1] ? 0 : 1;
			row.push(
				Math.min(
					(prev[j] ?? 0) + 1,
					(row[j - 1] ?? 0) + 1,
					(prev[j - 1] ?? 0) + cost
				)
			);
		}
		prev = row;
	}
	return prev[y.length] ?? 0;
}

/** Substitution cost of guess word g for transcript word r. */
function subCost(r: string, g: string): { cost: number; kind: DiffKind } {
	if (strict(r) === strict(g)) return { cost: 0, kind: "ok" };
	if (loose(r) === loose(g)) return { cost: 0.2, kind: "near" };
	const a = loose(r);
	const b = loose(g);
	const longest = Math.max([...a].length, [...b].length, 1);
	// Close spellings align as a mishearing of that word; unrelated
	// words cost the same as a skip plus an extra, so the alignment
	// prefers pairing words that sound alike.
	const similar = editDistance(a, b) / longest <= 0.5;
	return { cost: similar ? 0.8 : 1.6, kind: "wrong" };
}

/**
 * Align `guess` against `reference`. Minimum-cost edit alignment:
 * skip a transcript word (missed) 1, an extra guess word 1, a
 * substitution by `subCost`.
 */
export function diffGuess(
	reference: string,
	guess: string,
	lang: string
): GuessDiff {
	const ref = diffWords(reference, lang);
	const hyp = diffWords(guess, lang);
	const n = ref.length;
	const m = hyp.length;
	// cost[i][j]: best alignment of ref[i..] with hyp[j..].
	const cost: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0)
	);
	for (let i = n; i >= 0; i--) {
		for (let j = m; j >= 0; j--) {
			const row = cost[i];
			if (!row) continue;
			if (i === n && j === m) {
				row[j] = 0;
				continue;
			}
			let best = Infinity;
			if (i < n) best = Math.min(best, 1 + (cost[i + 1]?.[j] ?? 0));
			if (j < m) best = Math.min(best, 1 + (row[j + 1] ?? 0));
			if (i < n && j < m) {
				best = Math.min(
					best,
					subCost(ref[i] ?? "", hyp[j] ?? "").cost + (cost[i + 1]?.[j + 1] ?? 0)
				);
			}
			row[j] = best;
		}
	}
	const ops: DiffOp[] = [];
	let i = 0;
	let j = 0;
	const eps = 1e-9;
	while (i < n || j < m) {
		const here = cost[i]?.[j] ?? 0;
		const r = ref[i];
		const g = hyp[j];
		if (r !== undefined && g !== undefined) {
			const sub = subCost(r, g);
			if (Math.abs(here - (sub.cost + (cost[i + 1]?.[j + 1] ?? 0))) < eps) {
				ops.push(
					sub.kind === "ok"
						? { kind: "ok", ref: r, guess: g }
						: { kind: sub.kind, ref: r, guess: g }
				);
				i++;
				j++;
				continue;
			}
		}
		if (
			r !== undefined &&
			Math.abs(here - (1 + (cost[i + 1]?.[j] ?? 0))) < eps
		) {
			ops.push({ kind: "missed", ref: r });
			i++;
			continue;
		}
		if (g !== undefined) {
			ops.push({ kind: "extra", guess: g });
			j++;
			continue;
		}
		// Unreachable with a consistent table; never loop forever.
		if (r !== undefined) ops.push({ kind: "missed", ref: r });
		i++;
	}
	const got = ops.filter((o) => o.kind === "ok" || o.kind === "near").length;
	return { ops, got, total: n };
}

/** Share of the transcript heard, 0..1 (1 for an empty transcript). */
export function heardShare(diff: GuessDiff): number {
	return diff.total === 0 ? 1 : diff.got / diff.total;
}
