/**
 * Build dictionary packs from their sources (see dict-pack.ts):
 *
 *   bun scripts/dict-build.ts fr de ja    (or `all`)
 *   bun scripts/dict-build.ts --fetch     (download every source only)
 *
 * Sources download into .dict-cache/ (gitignored) on first run:
 * Wiktionary extracts from kaikki.org for most languages, JMdict for
 * Japanese. Packs land in .dict-cache/out/ as <lang>.dict.gz with a
 * manifest.json beside them; dict-publish.ts uploads both.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync
} from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import {
	addKaikkiFormsOf,
	addKaikkiRecord,
	PackBuilder,
	parseJmdictEntry,
	unescapeXml,
	type KaikkiRecord,
	type PackHeader
} from "./dict-pack";

const CACHE = ".dict-cache";
const OUT = `${CACHE}/out`;

const WIKTIONARY = {
	name: "Wiktionary (English), extracted by wiktextract via kaikki.org",
	license: "CC BY-SA 4.0 and GFDL",
	url: "https://kaikki.org/"
};

/**
 * Languages built from the English Wiktionary extract, by kaikki.org's
 * language names. Cantonese words mostly live under Chinese there, so
 * its pack reads both.
 */
export const KAIKKI: Record<string, string[]> = {
	fr: ["French"],
	de: ["German"],
	es: ["Spanish"],
	pt: ["Portuguese"],
	it: ["Italian"],
	ro: ["Romanian"],
	ru: ["Russian"],
	uk: ["Ukrainian"],
	pl: ["Polish"],
	cs: ["Czech"],
	sk: ["Slovak"],
	bg: ["Bulgarian"],
	sr: ["Serbo-Croatian"],
	el: ["Greek"],
	hu: ["Hungarian"],
	fi: ["Finnish"],
	nl: ["Dutch"],
	sv: ["Swedish"],
	da: ["Danish"],
	no: ["Norwegian Bokmål"],
	is: ["Icelandic"],
	zh: ["Chinese"],
	yue: ["Cantonese", "Chinese"],
	ko: ["Korean"],
	vi: ["Vietnamese"],
	th: ["Thai"],
	id: ["Indonesian"],
	ms: ["Malay"],
	tl: ["Tagalog"],
	hi: ["Hindi"],
	ur: ["Urdu"],
	pa: ["Punjabi"],
	bn: ["Bengali"],
	ta: ["Tamil"],
	fa: ["Persian"],
	ar: ["Arabic"],
	he: ["Hebrew"],
	hy: ["Armenian"],
	tr: ["Turkish"],
	sw: ["Swahili"],
	am: ["Amharic"],
	la: ["Latin"],
	grc: ["Ancient Greek"],
	sa: ["Sanskrit"],
	non: ["Old Norse"],
	ang: ["Old English"],
	sux: ["Sumerian"],
	akk: ["Akkadian"]
};

/** Where a kaikki language's extract lives, and its cache file. */
export function kaikkiSource(name: string): { url: string; path: string } {
	const file = `kaikki.org-dictionary-${name.replace(/[ -]/g, "")}.jsonl`;
	return {
		url: `https://kaikki.org/dictionary/${encodeURIComponent(name)}/${encodeURIComponent(file)}`,
		path: `${CACHE}/${file}`
	};
}

async function download(url: string, path: string): Promise<void> {
	if (existsSync(path)) return;
	console.log(`downloading ${url}`);
	// curl streams to disk; buffering a gigabyte through fetch stalled.
	execFileSync("curl", ["-sSfL", "-o", `${path}.part`, url], {
		stdio: "inherit"
	});
	renameSync(`${path}.part`, path);
}

async function* lines(path: string): AsyncGenerator<string> {
	const decoder = new TextDecoder();
	let rest = "";
	for await (const chunk of Bun.file(path).stream()) {
		rest += decoder.decode(chunk, { stream: true });
		let nl: number;
		while ((nl = rest.indexOf("\n")) !== -1) {
			yield rest.slice(0, nl);
			rest = rest.slice(nl + 1);
		}
	}
	if (rest) yield rest;
}

async function buildKaikki(
	lang: string
): Promise<{ b: PackBuilder; header: PackHeader }> {
	const paths: string[] = [];
	for (const name of KAIKKI[lang]!) {
		const { url, path } = kaikkiSource(name);
		await download(url, path);
		paths.push(path);
	}
	const b = new PackBuilder(lang);
	const lemmas = new Map<string, number[]>();
	const formOnly: KaikkiRecord[] = [];
	for (const path of paths)
		for await (const line of lines(path)) {
			if (!line) continue;
			const r = JSON.parse(line) as KaikkiRecord;
			const later = addKaikkiRecord(b, r, lemmas);
			if (later)
				formOnly.push({
					word: later.word,
					pos: later.pos,
					senses: later.senses ?? []
				});
		}
	addKaikkiFormsOf(b, formOnly, lemmas);
	return { b, header: { lang, version: today(), sources: [WIKTIONARY] } };
}

async function buildJmdict(): Promise<{ b: PackBuilder; header: PackHeader }> {
	const path = `${CACHE}/JMdict_e.gz`;
	await download("https://www.edrdg.org/pub/Nihongo/JMdict_e.gz", path);
	const xml = gunzipSync(readFileSync(path)).toString("utf8");
	const parsed = xml
		.split("<entry>")
		.slice(1)
		.map((chunk) => parseJmdictEntry(chunk.slice(0, chunk.indexOf("</entry>"))))
		.filter((e) => e.senses.length > 0);
	// Common words first, so a shared reading lists them before rare ones.
	parsed.sort((a, b) => Number(b.common) - Number(a.common));
	const b = new PackBuilder();
	for (const e of parsed) {
		const reading = e.rebs[0];
		const id = b.addEntry({
			w: e.kebs[0] ?? reading ?? "",
			p: e.pos,
			...(e.kebs.length > 0 && reading ? { r: reading } : {}),
			s: e.senses.map(unescapeXml)
		});
		for (const k of e.kebs) b.addForm(k, id);
		for (const r of e.rebs) b.addForm(r, id);
	}
	return {
		b,
		header: {
			lang: "ja",
			version: today(),
			sources: [
				{
					name: "JMdict, Electronic Dictionary Research and Development Group",
					license: "CC BY-SA 4.0",
					url: "https://www.edrdg.org/jmdict/j_jmdict.html"
				}
			]
		}
	};
}

function today(): string {
	return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}

interface ManifestPack {
	file: string;
	version: string;
	bytes: number;
	unpacked: number;
	sha256: string;
	sources: PackHeader["sources"];
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const langs = args[0] === "all" ? [...Object.keys(KAIKKI), "ja"] : args;
	if (langs.length === 0)
		throw new Error("usage: bun scripts/dict-build.ts fr de ja");
	mkdirSync(OUT, { recursive: true });
	const manifestPath = `${OUT}/manifest.json`;
	const manifest: { v: 1; packs: Record<string, ManifestPack> } = existsSync(
		manifestPath
	)
		? (JSON.parse(readFileSync(manifestPath, "utf8")) as {
				v: 1;
				packs: Record<string, ManifestPack>;
			})
		: { v: 1, packs: {} };
	for (const lang of langs) {
		const { b, header } =
			lang === "ja"
				? await buildJmdict()
				: KAIKKI[lang]
					? await buildKaikki(lang)
					: (() => {
							throw new Error(`no source for ${lang}`);
						})();
		const raw = b.encode(header);
		const packed = gzipSync(raw, { level: 9 });
		const file = `${lang}.dict.gz`;
		writeFileSync(`${OUT}/${file}`, packed);
		manifest.packs[lang] = {
			file,
			version: header.version,
			bytes: packed.length,
			unpacked: raw.length,
			sha256: createHash("sha256").update(packed).digest("hex"),
			sources: header.sources
		};
		console.log(
			`${lang}: ${b.entries.length} entries, ${b.keyCount} forms, ` +
				`${(raw.length / 1e6).toFixed(1)} MB, ${(statSync(`${OUT}/${file}`).size / 1e6).toFixed(1)} MB gzipped`
		);
	}
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
}

if (process.argv[2] === "--fetch") {
	// Download every source without building, so builds can run offline.
	mkdirSync(CACHE, { recursive: true });
	for (const name of new Set(Object.values(KAIKKI).flat())) {
		const { url, path } = kaikkiSource(name);
		await download(url, path);
	}
} else await main();
