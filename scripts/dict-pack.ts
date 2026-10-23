/**
 * Dictionary packs: one file per language that the app downloads on
 * first use (src-tauri/src/dict.rs reads it). Pure: the binary layout,
 * and turning Wiktionary (kaikki.org) and JMdict records into entries
 * and the word forms that point at them.
 *
 * Layout, little-endian:
 *   "CCEZDIC1"
 *   u32 header length, header JSON (with `tags`, every tag string once)
 *   u32 key count, u32 entry count
 *   u32[keys + 1] key offsets, u32[keys + 1] value offsets,
 *   u32[entries + 1] entry offsets
 *   keys blob (sorted by bytes), values blob, entries blob
 * A key is a lowercased form; its value is a u8 hit count, then per
 * hit a u32 entry index and a u16 index into the header's tags; an
 * entry is JSON `{w, p, g?, r?, s}`.
 */

export const PACK_MAGIC = "CCEZDIC1";

export interface PackEntry {
	/** Headword. */
	w: string;
	/** Part of speech. */
	p: string;
	/** Gender (masculine, feminine, neuter), when the word has one. */
	g?: string;
	/** Reading (Japanese kana). */
	r?: string;
	/** Senses, most common first, each one short gloss line. */
	s: string[];
}

export interface PackHeader {
	lang: string;
	version: string;
	sources: Array<{ name: string; license: string; url: string }>;
}

/** The header as written: the tag table rides along. */
export interface PackHeaderFull extends PackHeader {
	tags: string[];
}

/** Fold a form to its lookup key: NFC, lowercase, curly apostrophes straight. */
export function packKey(form: string): string {
	return form.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'").trim();
}

/** Collects entries and the forms that reach them, then encodes. */
export class PackBuilder {
	readonly entries: PackEntry[] = [];
	private readonly keys = new Map<string, Array<[number, string]>>();

	addEntry(entry: PackEntry): number {
		this.entries.push(entry);
		return this.entries.length - 1;
	}

	/** Point a form at an entry, with the form's grammar tags. */
	addForm(form: string, entry: number, tags = ""): void {
		const key = packKey(form);
		if (!key || key.length > 64) return;
		let hits = this.keys.get(key);
		if (!hits) {
			hits = [];
			this.keys.set(key, hits);
		}
		if (hits.length >= 8) return;
		if (hits.some(([e, t]) => e === entry && t === tags)) return;
		hits.push([entry, tags]);
	}

	get keyCount(): number {
		return this.keys.size;
	}

	encode(header: PackHeader): Uint8Array {
		const enc = new TextEncoder();
		const sorted = [...this.keys.keys()]
			.map((k) => [k, enc.encode(k)] as const)
			.sort((a, b) => compareBytes(a[1], b[1]));
		const tags: string[] = [];
		const tagIds = new Map<string, number>();
		const tagId = (t: string): number => {
			let id = tagIds.get(t);
			if (id === undefined) {
				id = tags.length;
				if (id > 0xffff) throw new Error("too many tag strings");
				tags.push(t);
				tagIds.set(t, id);
			}
			return id;
		};
		const keyBlobs: Uint8Array[] = [];
		const valBlobs: Uint8Array[] = [];
		for (const [key, bytes] of sorted) {
			keyBlobs.push(bytes);
			const hits = this.keys.get(key)!;
			const v = new Uint8Array(1 + hits.length * 6);
			const view = new DataView(v.buffer);
			v[0] = hits.length;
			hits.forEach(([entry, t], i) => {
				view.setUint32(1 + i * 6, entry, true);
				view.setUint16(5 + i * 6, tagId(t), true);
			});
			valBlobs.push(v);
		}
		const entBlobs = this.entries.map((e) => enc.encode(JSON.stringify(e)));
		const full: PackHeaderFull = { ...header, tags };
		const head = enc.encode(JSON.stringify(full));
		const offsets = (blobs: Uint8Array[]): Uint32Array => {
			const out = new Uint32Array(blobs.length + 1);
			for (let i = 0; i < blobs.length; i++)
				out[i + 1] = out[i]! + blobs[i]!.length;
			return out;
		};
		const keyOffs = offsets(keyBlobs);
		const valOffs = offsets(valBlobs);
		const entOffs = offsets(entBlobs);
		const parts: Uint8Array[] = [
			enc.encode(PACK_MAGIC),
			u32(head.length),
			head,
			u32(sorted.length),
			u32(this.entries.length),
			le(keyOffs),
			le(valOffs),
			le(entOffs),
			...keyBlobs,
			...valBlobs,
			...entBlobs
		];
		const total = parts.reduce((n, p) => n + p.length, 0);
		const out = new Uint8Array(total);
		let at = 0;
		for (const p of parts) {
			out.set(p, at);
			at += p.length;
		}
		return out;
	}
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
	return a.length - b.length;
}

function u32(n: number): Uint8Array {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n, true);
	return b;
}

function le(a: Uint32Array): Uint8Array {
	const b = new Uint8Array(a.length * 4);
	const view = new DataView(b.buffer);
	for (let i = 0; i < a.length; i++) view.setUint32(i * 4, a[i]!, true);
	return b;
}

/** Look a form up in an encoded pack (tests; the app reads in Rust). */
export function lookupPack(
	pack: Uint8Array,
	form: string
): Array<{ entry: PackEntry; tags: string }> {
	const dec = new TextDecoder();
	const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
	let at = PACK_MAGIC.length;
	const headLen = view.getUint32(at, true);
	const header = JSON.parse(
		dec.decode(pack.subarray(at + 4, at + 4 + headLen))
	) as PackHeaderFull;
	at += 4 + headLen;
	const nKeys = view.getUint32(at, true);
	const nEntries = view.getUint32(at + 4, true);
	at += 8;
	const arr = (n: number): number[] => {
		const out: number[] = [];
		for (let i = 0; i < n; i++) out.push(view.getUint32(at + i * 4, true));
		at += n * 4;
		return out;
	};
	const keyOffs = arr(nKeys + 1);
	const valOffs = arr(nKeys + 1);
	const entOffs = arr(nEntries + 1);
	const keysAt = at;
	const valsAt = keysAt + keyOffs[nKeys]!;
	const entsAt = valsAt + valOffs[nKeys]!;
	const target = new TextEncoder().encode(packKey(form));
	let lo = 0;
	let hi = nKeys;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const key = pack.subarray(
			keysAt + keyOffs[mid]!,
			keysAt + keyOffs[mid + 1]!
		);
		const c = compareBytes(key, target);
		if (c === 0) {
			const v = valsAt + valOffs[mid]!;
			const hits: Array<[number, string]> = [];
			for (let i = 0; i < pack[v]!; i++)
				hits.push([
					view.getUint32(v + 1 + i * 6, true),
					header.tags[view.getUint16(v + 5 + i * 6, true)] ?? ""
				]);
			return hits.map(([e, tags]) => ({
				entry: JSON.parse(
					dec.decode(
						pack.subarray(entsAt + entOffs[e]!, entsAt + entOffs[e + 1]!)
					)
				) as PackEntry,
				tags
			}));
		}
		if (c < 0) lo = mid + 1;
		else hi = mid;
	}
	return [];
}

/* ---------- Wiktionary (kaikki.org wiktextract JSONL) ---------- */

interface KaikkiSense {
	glosses?: string[];
	tags?: string[];
	form_of?: Array<{ word: string }>;
}

export interface KaikkiRecord {
	word: string;
	pos: string;
	senses?: KaikkiSense[];
	forms?: Array<{ form: string; tags?: string[] }>;
	head_templates?: Array<{ args?: Record<string, string> }>;
}

/** Tags that describe the table, not the form. */
const SKIP_FORM_TAGS = new Set([
	"table-tags",
	"inflection-template",
	"multiword-construction",
	"romanization",
	"class",
	"auxiliary"
]);

/** Tags kept on a form: what it is, not where it came from. */
const NOISE_TAGS = new Set([
	"form-of",
	"alt-of",
	"abbreviation",
	"error-unknown-tag"
]);

const SKIP_POS = new Set(["name", "proverb", "phrase", "symbol", "character"]);

function cleanGloss(g: string): string {
	const t = g.replace(/\s+/g, " ").trim();
	return t.length > 140 ? `${t.slice(0, 139).trimEnd()}…` : t;
}

const GENDERS: Record<string, string> = {
	m: "masculine",
	f: "feminine",
	n: "neuter",
	mf: "masculine or feminine"
};

/** A noun's gender: from its first sense, else its headword template. */
function genderOf(r: KaikkiRecord): string | undefined {
	if (r.pos !== "noun") return undefined;
	const first = r.senses?.[0]?.tags ?? [];
	const found = ["masculine", "feminine", "neuter"].filter((g) =>
		first.includes(g)
	);
	if (found.length === 1) return found[0];
	if (found.length > 1) return found.join(" or ");
	for (const h of r.head_templates ?? []) {
		const raw = h.args?.g ?? h.args?.["1"];
		const code = raw?.split(/[-,]/)[0];
		if (code && GENDERS[code]) return GENDERS[code];
	}
	return undefined;
}

/** True when every sense only points at another word (an inflected form). */
export function isFormOnly(r: KaikkiRecord): boolean {
	const senses = r.senses ?? [];
	return (
		senses.length > 0 &&
		senses.every(
			(s) => (s.tags ?? []).includes("form-of") && (s.form_of?.length ?? 0) > 0
		)
	);
}

/**
 * First pass: a record with any sense of its own becomes an entry,
 * reached by its headword and every form in its tables. Form-only
 * records come back for the second pass, once their lemmas exist.
 */
export function addKaikkiRecord(
	b: PackBuilder,
	r: KaikkiRecord,
	lemmas: Map<string, number[]>
): KaikkiRecord | null {
	if (SKIP_POS.has(r.pos) || !r.word) return null;
	if (isFormOnly(r)) return r;
	const senses: string[] = [];
	for (const s of r.senses ?? []) {
		if ((s.tags ?? []).includes("form-of")) continue;
		const g = s.glosses?.[s.glosses.length - 1];
		if (g) senses.push(cleanGloss(g));
		if (senses.length === 5) break;
	}
	if (senses.length === 0) return null;
	const gender = genderOf(r);
	const id = b.addEntry({
		w: r.word,
		p: r.pos,
		...(gender ? { g: gender } : {}),
		s: senses
	});
	b.addForm(r.word, id);
	const key = packKey(r.word);
	lemmas.set(key, [...(lemmas.get(key) ?? []), id]);
	for (const f of r.forms ?? []) {
		const tags = f.tags ?? [];
		if (!f.form || f.form.includes(" ") || f.form.includes("+")) continue;
		if (tags.some((t) => SKIP_FORM_TAGS.has(t))) continue;
		b.addForm(f.form, id, tags.filter((t) => !NOISE_TAGS.has(t)).join(" "));
	}
	return null;
}

/** Second pass: a form-only record points at its lemmas' entries. */
export function addKaikkiFormOf(
	b: PackBuilder,
	r: KaikkiRecord,
	lemmas: Map<string, number[]>
): void {
	for (const s of r.senses ?? []) {
		const tags = (s.tags ?? []).filter((t) => !NOISE_TAGS.has(t)).join(" ");
		for (const target of s.form_of ?? []) {
			for (const id of lemmas.get(packKey(target.word)) ?? [])
				b.addForm(r.word, id, tags);
		}
	}
}

/* ---------- JMdict (Japanese–English, EDRDG XML) ---------- */

const JMDICT_POS: Record<string, string> = {
	n: "noun",
	"adj-i": "i-adjective",
	"adj-na": "na-adjective",
	"adj-no": "no-adjective",
	"adj-pn": "pre-noun adjectival",
	adv: "adverb",
	"adv-to": "adverb taking と",
	exp: "expression",
	int: "interjection",
	prt: "particle",
	conj: "conjunction",
	pn: "pronoun",
	ctr: "counter",
	suf: "suffix",
	pref: "prefix",
	aux: "auxiliary",
	"aux-v": "auxiliary verb",
	"aux-adj": "auxiliary adjective",
	cop: "copula",
	v1: "ichidan verb",
	"vs-i": "suru verb",
	vs: "noun taking する",
	vk: "kuru verb",
	vi: "intransitive verb",
	vt: "transitive verb"
};

function jmPos(code: string): string {
	if (JMDICT_POS[code]) return JMDICT_POS[code];
	if (code.startsWith("v5")) return "godan verb";
	if (code.startsWith("v1")) return "ichidan verb";
	if (code.startsWith("vs")) return "suru verb";
	return code;
}

/** One JMdict <entry>: its writings, readings, part of speech and glosses. */
export function parseJmdictEntry(xml: string): {
	kebs: string[];
	rebs: string[];
	pos: string;
	senses: string[];
	common: boolean;
} {
	const all = (tag: string): string[] =>
		[...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map(
			(m) => m[1]!
		);
	const senses: string[] = [];
	let pos = "";
	for (const sense of xml.split("<sense>").slice(1)) {
		const p = [...sense.matchAll(/<pos>&([^;]+);<\/pos>/g)].map((m) => m[1]!);
		if (!pos && p[0])
			pos =
				p.filter((c) => c !== "vi" && c !== "vt").map(jmPos)[0] ?? jmPos(p[0]);
		const glosses = [...sense.matchAll(/<gloss[^>]*>([^<]*)<\/gloss>/g)].map(
			(m) => m[1]!
		);
		if (glosses.length > 0 && senses.length < 5)
			senses.push(cleanGloss(glosses.slice(0, 4).join("; ")));
	}
	return {
		kebs: all("keb"),
		rebs: all("reb"),
		pos: pos || "word",
		senses,
		common: /<(ke|re)_pri>(news1|ichi1|spec1|spec2|gai1)<\//.test(xml)
	};
}

/** Decode the few XML entities JMdict glosses use. */
export function unescapeXml(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}
