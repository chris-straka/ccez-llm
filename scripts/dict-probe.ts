/**
 * Print what a built pack knows about some words, splits and all:
 *
 *   bun scripts/dict-probe.ts fr franchi mangeons maisons
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { lookupPack } from "./dict-pack";

const [lang, ...words] = process.argv.slice(2);
const pack = new Uint8Array(
	gunzipSync(readFileSync(`.dict-cache/out/${lang}.dict.gz`))
);
for (const word of words) {
	const hits = lookupPack(pack, word);
	const lines = hits
		.slice(0, Number(process.env.N ?? 3))
		.map(({ entry, tags, split }) => {
			const chars = [...word];
			const cut = split
				? [
						chars.slice(0, split[0]),
						chars.slice(split[0], split[0] + split[1]),
						chars.slice(split[0] + split[1], split[0] + split[1] + split[2]),
						chars.slice(split[0] + split[1] + split[2])
					]
						.map((c) => c.join(""))
						.filter(Boolean)
						.join(" + ")
				: entry.m && tags === ""
					? entry.m.map(([t, l]) => `${t}(${l})`).join(" + ")
					: "-";
			return `${entry.w} [${tags || "headword"}] ${cut}`;
		});
	console.log(`${word}: ${lines.join(" | ") || "no hits"}`);
}
