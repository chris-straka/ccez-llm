// Pure parser/expander for amake/cjk-decomp records (prototype evaluation).
// Kept side-effect free so it stays unit-testable (see cjkdecomp.test.ts).
// Data file is NOT vendored: pass --data <cjk-decomp.txt> to the eval CLI.

export interface DecompRecord {
	char: string;
	type: string;
	parts: string[];
}

/** Split "a(女,子)" into { type: "a", parts: ["女", "子"] }. */
export function parseDecompBody(body: string): {
	type: string;
	parts: string[];
} {
	const open = body.indexOf("(");
	const close = body.lastIndexOf(")");
	if (open < 0 || close < 0 || close < open)
		throw new Error(`Bad record body: ${body}`);
	const type = body.slice(0, open);
	const inner = body.slice(open + 1, close);
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of inner) {
		if (ch === "," && depth === 0) {
			parts.push(cur);
			cur = "";
		} else {
			if (ch === "(") depth += 1;
			else if (ch === ")") depth -= 1;
			cur += ch;
		}
	}
	parts.push(cur);
	return { type, parts };
}

/** Parse one "char:type(part,part)" line; null for blank lines. */
export function parseRecord(line: string): DecompRecord | null {
	const trimmed = line.trim();
	if (trimmed === "") return null;
	const colon = trimmed.indexOf(":");
	if (colon < 0) throw new Error(`Bad record (no colon): ${trimmed}`);
	const char = trimmed.slice(0, colon);
	const { type, parts } = parseDecompBody(trimmed.slice(colon + 1));
	return { char, type, parts };
}

/** True for intermediate numeric keys (e.g. "37060"), not real characters. */
export function isIntermediateKey(key: string): boolean {
	return /^[0-9]+$/.test(key);
}

const BASE_TYPE_REPEAT: Record<string, number> = {
	ra: 2, // repeat across (林 = ra(木))
	r3a: 3, // repeat 3 across (川 = r3a(㇑))
	r3d: 3, // repeat 3 downwards
	r3tr: 3, // repeat 3 in a triangle (森 = r3tr(木))
	rrefr: 2, // repeat with reflection rightwards (門 = rrefr(𠁣))
	rrefl: 2 // repeat with reflection leftwards
};

/** Copies implied by a repeat/reflect type code; null = keep single child. */
export function repeatCount(type: string): number | null {
	const base = type.split("/")[0] ?? "";
	if (base === "") return null;
	if (base === "c") return 0;
	const known = BASE_TYPE_REPEAT[base];
	if (known !== undefined) return known;
	if (base.startsWith("r")) return 1; // refh/rot/rst/…: one (mirrored) child
	if (base.startsWith("m")) return 1; // me/msp/mo/ml: one modified child
	return null;
}

/**
 * Display-variant normalization (documented, minimal): the data uses
 * Mainland-Chinese typeface forms where the hand table in
 * src/lib/radicals.ts uses the Japanese display form.
 */
export const VARIANT_MAP: Record<string, string> = {
	飠: "食", // food radical, full vs compressed form
	卄: "艹", // grass radical, "twenty" form vs grass form
	乂: "メ", // same stroke shape, different codepoint
	彐: "ヨ", // same stroke shape, different codepoint
	"㇑": "丨", // CJK-stroke vs CJK-unified vertical stroke
	夂: "夊" // winter vs go, same component role
};

export function normalizeVariant(ch: string): string {
	return VARIANT_MAP[ch] ?? ch;
}

export type DecompTable = Map<string, DecompRecord>;

/** Expand one character to displayable leaf components (numeric keys resolved). */
export function expandLeaves(
	table: DecompTable,
	char: string,
	seen?: Set<string>
): string[] {
	const active = seen ?? new Set<string>();
	if (active.has(char)) return [char]; // cycle guard, keep opaque
	const rec = table.get(char);
	if (rec === undefined) return [char]; // no record: leaf (real char or stroke)
	if (isIntermediateKey(char)) active.add(char);
	const count = repeatCount(rec.type);
	const kids =
		count === 0
			? []
			: count === null
				? rec.parts
				: rec.parts.flatMap((p) => Array(count).fill(p));
	return kids.flatMap((k) =>
		table.has(k) && isIntermediateKey(k) ? expandLeaves(table, k, active) : [k]
	);
}

/** One-level children with numeric intermediates resolved (grouping kept). */
export function resolveLevel(table: DecompTable, char: string): string[] {
	const rec = table.get(char);
	if (rec === undefined) return [];
	const count = repeatCount(rec.type);
	const kids =
		count === 0
			? []
			: count === null
				? rec.parts
				: rec.parts.flatMap((p) => Array(count).fill(p));
	return kids.flatMap((k) =>
		isIntermediateKey(k) ? expandLeaves(table, k) : [k]
	);
}

/** Parse the hand-curated TABLE block out of src/lib/radicals.ts source. */
export function loadHandTable(source: string): Map<string, string[]> {
	const block = /const TABLE[^=]*=\s*\{(.*?)\};/s.exec(source)?.[1];
	if (block === undefined) throw new Error("TABLE block not found");
	const out = new Map<string, string[]>();
	for (const m of block.matchAll(/^\s*(\S):\s*\{\s*c:\s*\[(.*?)\]/gm)) {
		const char = m[1] ?? "";
		const comps = [...(m[2] ?? "").matchAll(/"([^"]+)"/g)].map(
			(g) => g[1] ?? ""
		);
		if (char !== "" && comps.length > 0) out.set(char, comps);
	}
	return out;
}

export type Verdict = "exact" | "resolved-agree" | "mismatch";

export interface AgreementRow {
	char: string;
	hand: string[];
	l1: string[];
	resolved: string[];
	verdict: Verdict;
}

function sameList(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Agreement of one hand entry against the data (order-sensitive). */
export function checkAgreement(
	table: DecompTable,
	char: string,
	hand: string[]
): AgreementRow {
	const l1 = table.get(char)?.parts ?? [];
	const resolved = resolveLevel(table, char).map(normalizeVariant);
	const handNorm = hand.map(normalizeVariant);
	const verdict: Verdict = sameList(l1, hand)
		? "exact"
		: sameList(resolved, handNorm)
			? "resolved-agree"
			: "mismatch";
	return { char, hand, l1, resolved, verdict };
}
