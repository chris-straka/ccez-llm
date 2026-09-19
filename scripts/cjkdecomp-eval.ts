// Prototype evaluation CLI for amake/cjk-decomp (not shipped to the app).
// Usage:
//   bun scripts/cjkdecomp-eval.ts --data /path/to/cjk-decomp.txt \
//     [--table src/lib/radicals.ts] [--joyo scripts/fixtures/joyo.txt] \
//     [--hanzi scripts/fixtures/hanzi-common.txt]
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
	checkAgreement,
	expandLeaves,
	loadHandTable,
	parseRecord,
	resolveLevel,
	type DecompTable
} from "./cjkdecomp";

const DEMO = [
	"好",
	"語",
	"言",
	"漢",
	"国",
	"聞",
	"道",
	"林",
	"森",
	"川",
	"門",
	"電",
	"田",
	"車",
	"愛",
	"鳥",
	"木",
	"心",
	"火",
	"雪",
	"館",
	"金",
	"水"
];

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(`--${name}`);
	const v = i >= 0 ? process.argv[i + 1] : undefined;
	return v ?? fallback;
}

function loadRecords(path: string): DecompTable {
	const table: DecompTable = new Map();
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const rec = parseRecord(line);
		if (rec !== null) table.set(rec.char, rec);
	}
	return table;
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

function kb(n: number): string {
	return `${n.toLocaleString("en-US")} B`;
}

function sized(label: string, json: string): void {
	const raw = Buffer.byteLength(json, "utf8");
	const gz = gzipSync(Buffer.from(json, "utf8")).length;
	console.log(`${label}: ${kb(raw)} raw, ${kb(gz)} gzip`);
}

function main(): void {
	const dataPath = arg("data", "");
	if (dataPath === "")
		throw new Error(
			"Pass --data <cjk-decomp.txt> (file is not vendored; clone https://github.com/amake/cjk-decomp)."
		);
	const table = loadRecords(dataPath);
	console.log(`records: ${table.size.toLocaleString("en-US")}`);

	console.log("\n## demo parses (raw → L1 → resolved leaves)");
	for (const ch of DEMO) {
		const rec = table.get(ch);
		if (rec === undefined) {
			console.log(`${ch}: NO RECORD`);
			continue;
		}
		console.log(
			`${ch}:${rec.type}(${rec.parts.join(",")}) → [${resolveLevel(table, ch).join(" ")}] → [${expandLeaves(table, ch).join(" ")}]`
		);
	}

	let hand: Map<string, string[]>;
	try {
		hand = loadHandTable(
			readFileSync(arg("table", "src/lib/radicals.ts"), "utf8")
		);
	} catch {
		// The hand TABLE is deleted (splits come from the vendored
		// subset now); the agreement section below no-ops on empty.
		console.log("\n## agreement vs hand TABLE skipped (no TABLE in source)");
		hand = new Map();
	}
	console.log(`\n## agreement vs hand TABLE (${hand.size} entries)`);
	let exact = 0;
	let resolved = 0;
	const mismatches: string[] = [];
	for (const [char, comps] of hand) {
		const row = checkAgreement(table, char, comps);
		if (row.verdict === "exact") exact += 1;
		else if (row.verdict === "resolved-agree") resolved += 1;
		else
			mismatches.push(
				`${char} hand[${comps.join(" ")}] data[${row.l1.join(" ")}] resolved[${row.resolved.join(" ")}]`
			);
		console.log(
			`${row.verdict === "exact" ? "EXACT " : row.verdict === "resolved-agree" ? "RESOLV" : "DIFF  "} ${row.char} hand[${row.hand.join(" ")}] l1[${row.l1.join(" ")}] resolved[${row.resolved.join(" ")}]`
		);
	}
	console.log(
		`exact: ${exact}/${hand.size}, resolved-agree: ${resolved}/${hand.size}, mismatch: ${mismatches.length}/${hand.size}`
	);

	const joyo = loadChars(arg("joyo", "scripts/fixtures/joyo.txt"));
	const hanzi = loadChars(arg("hanzi", "scripts/fixtures/hanzi-common.txt"));
	const subset = [...new Set([...joyo, ...hanzi])];
	const covered = subset.filter((c) => table.has(c));
	console.log(
		`\n## subset: joyo=${joyo.length} hanzi=${hanzi.length} union=${subset.length} covered=${covered.length}`
	);

	const rawJson = JSON.stringify(
		Object.fromEntries(
			covered.map((c) => [
				c,
				`${table.get(c)?.type}(${table.get(c)?.parts.join(",")})`
			])
		)
	);
	sized("subset raw-records JSON", rawJson);
	const resolvedJson = JSON.stringify(
		Object.fromEntries(covered.map((c) => [c, resolveLevel(table, c)]))
	);
	sized("subset resolved-L1 JSON", resolvedJson);

	const closure = new Set(covered);
	for (const c of covered)
		for (const k of resolveLevel(table, c)) if (table.has(k)) closure.add(k);
	const closureJson = JSON.stringify(
		Object.fromEntries(
			[...closure].map((c) => [
				c,
				`${table.get(c)?.type}(${table.get(c)?.parts.join(",")})`
			])
		)
	);
	sized(`subset+closure raw-records JSON (${closure.size} chars)`, closureJson);

	const fullJson = JSON.stringify(
		Object.fromEntries(
			[...table].map(([c, r]) => [c, `${r.type}(${r.parts.join(",")})`])
		)
	);
	sized(`full raw-records JSON (${table.size} records)`, fullJson);
}

main();
