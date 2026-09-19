// Build-time generator: vendor a resolved-L1 subset of amake/cjk-decomp
// (MIT data choice) for component-split fallback. The hand TABLE in
// src/lib/radicals.ts stays authoritative; this covers the other ~3000
// common characters. Data file is NOT vendored — clone it to regenerate.
// Usage:
//   bun scripts/cjkdecomp-subset.ts --data /path/to/cjk-decomp.txt \
//     --out src/lib/cjkdecomp-subset.generated.ts
import { readFileSync, writeFileSync } from "node:fs";
import {
	normalizeVariant,
	parseRecord,
	resolveLevel,
	type DecompTable
} from "./cjkdecomp";

const DATA_REPO = "https://github.com/amake/cjk-decomp";
const DATA_COMMIT = "c29b391";

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	const v = i >= 0 ? process.argv[i + 1] : undefined;
	return v ?? fallback;
}

function loadChars(path: string): string[] {
	return [
		...new Set(
			readFileSync(path, "utf8")
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l !== "" && !l.startsWith("#"))
				.map((l) => [...l][0] ?? "")
		)
	].filter((c) => c !== "");
}

function main(): void {
	const candidates = [
		arg("data", ""),
		"./vendor/cjk-decomp.txt",
		"/tmp/cjk-decomp/cjk-decomp.txt"
	].filter((p) => p !== "");
	const dataPath = candidates.find((p) => {
		try {
			readFileSync(p);
			return true;
		} catch {
			return false;
		}
	});
	if (dataPath === undefined) {
		throw new Error(
			`cjk-decomp.txt not found. Clone ${DATA_REPO} and pass --data <path>/cjk-decomp.txt.`
		);
	}
	const table: DecompTable = new Map();
	for (const line of readFileSync(dataPath, "utf8").split("\n")) {
		const rec = parseRecord(line);
		if (rec !== null) table.set(rec.char, rec);
	}
	const subset = [
		...new Set([
			...loadChars("scripts/fixtures/joyo.txt"),
			...loadChars("scripts/fixtures/hanzi-common.txt")
		])
	];
	const rows: Array<[string, string[]]> = [];
	for (const ch of subset) {
		if (!table.has(ch)) {
			console.log(`NO RECORD: ${ch}`);
			continue;
		}
		// Normalize display variants at build time (飠→食, 卄→艹, …)
		// so the runtime stays a plain lookup.
		const resolved = resolveLevel(table, ch).map(normalizeVariant);
		if (resolved.length === 0) {
			console.log(`EMPTY: ${ch}`);
			continue;
		}
		rows.push([ch, resolved]);
	}
	rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
	const body = rows
		.map(
			([ch, comps]) =>
				`\t${JSON.stringify(ch)}:[${comps.map((c) => JSON.stringify(c)).join(",")}],`
		)
		.join("\n");
	const out = `/**
 * GENERATED — do not edit by hand. Regenerate with:
 *   bun scripts/cjkdecomp-subset.ts --data /path/to/cjk-decomp.txt --out src/lib/cjkdecomp-subset.generated.ts
 *
 * Resolved first-level component splits for Joyo + top-2000-Hanzi union
 * (${rows.length} chars) from ${DATA_REPO} at ${DATA_COMMIT}.
 *
 * Data compiled by Gavin Grover, fork by Aaron Madlon-Kay (amake), used
 * here under the MIT choice of the data file's six-license grant (see
 * docs/cjkdecomp-eval.md). This file carries no GPL obligations.
 *
 * Caveats (see docs/cjkdecomp-eval.md): Mainland-Chinese typeface
 * (expect 飠/卄/simplified parts on fallback chars); finer grain than
 * the hand TABLE, which stays authoritative on conflict. Strokes-block
 * leaves (㇑ etc.) need an app-font render check before calling them done.
 */
export const CJKDECOMP_SUBSET: Record<string, string[]> = {
${body}
};
`;
	writeFileSync(arg("out", "src/lib/cjkdecomp-subset.generated.ts"), out);
	console.log(
		`wrote ${rows.length} entries, ${Buffer.byteLength(out, "utf8")} B`
	);
}

main();
