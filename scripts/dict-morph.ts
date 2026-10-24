/**
 * Where dictionary forms split, worked out when packs are built so a
 * word card shows its colored pieces before the model answers. Pure.
 *
 * Inflection comes from each headword's own tables: the stem is the
 * longest start of the headword that nearly all its forms share (habl
 * across hablar's), and a form splits into prefix, stem and ending
 * around it. Endings and prefixes are then counted per part of speech
 * and grammar tags across the whole language; a split whose ending is
 * rare for its tags is dropped, and a form that doesn't start with
 * the stem (pienso, Häuser, gegangen) splits on the usual ending for
 * its tags instead. Where a plural or comparative form's ending is
 * the plain form's with something in front (taloissa and talossa,
 * kleineren and kleinen), that piece is the plural or degree marker. Derivation comes from Wiktionary's etymology
 * templates (Krankenhaus = Kranker + -en- + Haus), kept only when the
 * pieces line up with the spelling.
 */

/** A form's pieces in order; joined they spell the form. */
export interface FormSplit {
	pre: string;
	stem: string;
	/**
	 * The comparative, superlative or plural marker (in that order of
	 * choice), when the ending holds one apart from the rest.
	 */
	num: string;
	end: string;
}

/** What a derivation piece does; the card's colors (word-card.ts). */
export type MorphKind = "core" | "voice" | "derive";

/** One derivation piece: its spelling in the headword, label, kind. */
export type Morpheme = [text: string, label: string, kind: MorphKind];

const fold = (s: string): string[] => [
	...s.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'")
];

/** A letter without its marks, for comparing first letters (Häus, Haus). */
const bareLetter = (c: string | undefined): string =>
	(c ?? "").normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Letters without their marks, one for one (a lone mark stays), so
 * stems match across accents (háblame has habl, Häuser has haus)
 * while cuts still count the form's own letters.
 */
const bare = (chars: string[]): string[] =>
	chars.map((c) => bareLetter(c) || c);

/** Tags that make a form a cell of its headword's tables. */
const INFLECTION = new Set([
	"nominative",
	"accusative",
	"dative",
	"genitive",
	"instrumental",
	"locative",
	"ablative",
	"vocative",
	"partitive",
	"prepositional",
	"inessive",
	"elative",
	"illative",
	"adessive",
	"allative",
	"essive",
	"translative",
	"abessive",
	"comitative",
	"instructive",
	"sublative",
	"delative",
	"superessive",
	"terminative",
	"causal-final",
	"singular",
	"plural",
	"dual",
	"first-person",
	"second-person",
	"third-person",
	"present",
	"past",
	"future",
	"imperfect",
	"perfect",
	"pluperfect",
	"preterite",
	"aorist",
	"indicative",
	"subjunctive",
	"conditional",
	"imperative",
	"infinitive",
	"participle",
	"gerund",
	"supine",
	"comparative",
	"superlative",
	"masculine",
	"feminine",
	"neuter"
]);

/** Tags of forms that aren't plain cells: other words, spellings, registers. */
const NOT_A_CELL = new Set([
	"diminutive",
	"augmentative",
	"alternative",
	"obsolete",
	"archaic",
	"dialectal",
	"nonstandard",
	"misspelling",
	"rare",
	"colloquial",
	"poetic",
	"abbreviation",
	"romanization"
]);

/** True when a form with these tags is one of its headword's inflections. */
export function isCell(tags: readonly string[]): boolean {
	return (
		tags.some((t) => INFLECTION.has(t)) && !tags.some((t) => NOT_A_CELL.has(t))
	);
}

/** Share of distinct forms holding a stem at their start, or after a short prefix once the stem has three letters (gemacht has mach). */
function stemShare(stem: string, all: string[]): number {
	const len = [...stem].length;
	return (
		all.filter((f) => {
			const at = f.indexOf(stem);
			return at === 0 || (at > 0 && at <= 3 && len >= 3);
		}).length / all.length
	);
}

/** A headword and its forms, folded with marks aside and deduplicated. */
function bareForms(lemma: string, forms: string[]): string[] {
	return [...new Set([lemma, ...forms].map((f) => bare(fold(f)).join("")))];
}

/**
 * The stem a regular headword's forms share: the longest start of
 * the headword (folded, marks aside) found in at least 90% of its
 * distinct forms, keeping all but four letters of it (aufmachen's
 * stem is never auf) and two at least. Null where the forms run on
 * more than one stem (pensar: pens-, piens-; sehen: seh-, sieh-, sah):
 * fallbackStem takes those once the regular ones are counted.
 */
export function paradigmStem(lemma: string, forms: string[]): string | null {
	const l = bare(fold(lemma));
	const all = bareForms(lemma, forms);
	if (all.length < 2) return null;
	const shortest = Math.max(Math.min(2, l.length), l.length - 4, 1);
	for (let n = l.length; n >= shortest; n--) {
		const p = l.slice(0, n).join("");
		if (stemShare(p, all) >= 0.9) return p;
	}
	return null;
}

/**
 * The stem of a headword whose forms run on several stems: the
 * headword less the usual ending for its own cell's tags (sehen less
 * the infinitive's -en is seh; Haus, whose nominative has none, is
 * Haus), as long as at least 30% of its forms hold it. Null otherwise
 * (sein).
 */
export function fallbackStem(
	lemma: string,
	pos: string,
	cells: Array<{ form: string; tags: string[] }>,
	counts: AffixCounts
): string | null {
	const l = bare(fold(lemma));
	const all = bareForms(
		lemma,
		cells.map((c) => c.form)
	);
	if (all.length < 2) return null;
	const own = cells.find((c) => bare(fold(c.form)).join("") === l.join(""));
	const endings = own ? counts.endings(tagKey(pos, own.tags)) : [];
	for (const e of [...endings, ""]) {
		const n = l.length - [...bare([...e])].length;
		if (n < 2 || l.slice(n).join("") !== bare([...e]).join("")) continue;
		const stem = l.slice(0, n).join("");
		if (stemShare(stem, all) >= 0.3) return stem;
	}
	return null;
}

/** Order-free key for a part of speech and its tag set. */
export function tagKey(pos: string, tags: readonly string[]): string {
	return `${pos}|${[...tags].sort().join(" ")}`;
}

/**
 * The split a form (folded letters) takes around its headword's stem
 * (bare letters, paradigmStem's), before any check.
 */
function aroundStem(form: string[], stem: string): FormSplit | null {
	const s = [...stem];
	const b = bare(form);
	for (let at = 0; at <= 3 && at + s.length <= form.length; at++) {
		if (b.slice(at, at + s.length).join("") !== stem) continue;
		return {
			pre: form.slice(0, at).join(""),
			stem: form.slice(at, at + s.length).join(""),
			num: "",
			end: form.slice(at + s.length).join("")
		};
	}
	return null;
}

/** Affix counts per tag set, and how many forms each tag set had. */
interface Tally {
	ends: Map<string, Map<string, number>>;
	pres: Map<string, Map<string, number>>;
	totals: Map<string, number>;
}

const newTally = (): Tally => ({
	ends: new Map(),
	pres: new Map(),
	totals: new Map()
});

/**
 * How often each ending and prefix closes forms with the same tags,
 * kept apart for regular headwords and the rest: strong verbs' -en
 * participles are few beside the weak verbs' -t, but most of their
 * own kind.
 */
export class AffixCounts {
	private readonly tallies: [Tally, Tally] = [newTally(), newTally()];
	private trustedEnds = new Map<string, string[]>();
	private trustedPres = new Map<string, string[]>();

	/** Count a headword's forms around its stem; `regular` says which tally. */
	observe(
		pos: string,
		stem: string | null,
		forms: Array<{ form: string; tags: string[] }>,
		regular = true
	): void {
		if (!stem) return;
		const t = this.tallies[regular ? 0 : 1];
		for (const { form, tags } of forms) {
			if (!isCell(tags)) continue;
			const split = aroundStem(fold(form), stem);
			if (!split) continue;
			const key = tagKey(pos, tags);
			t.totals.set(key, (t.totals.get(key) ?? 0) + 1);
			bump(t.ends, key, split.end);
			if (split.pre) bump(t.pres, key, split.pre);
		}
	}

	/**
	 * Settle which affixes to trust: seen at least five times and on
	 * at least 2% of the forms with those tags in either tally (German
	 * -er plurals are a few percent). Endings sort longest first, so
	 * Häuser takes -er over -r.
	 */
	settle(): void {
		const trusted = (pick: (t: Tally) => Map<string, Map<string, number>>) => {
			const out = new Map<string, string[]>();
			for (const t of this.tallies)
				for (const [key, byAffix] of pick(t)) {
					const total = t.totals.get(key) ?? 0;
					const kept = new Set(out.get(key) ?? []);
					for (const [a, n] of byAffix)
						if (n >= 5 && n / total >= 0.02) kept.add(a);
					out.set(
						key,
						[...kept].sort((a, b) => [...b].length - [...a].length)
					);
				}
			return out;
		};
		this.trustedEnds = trusted((t) => t.ends);
		this.trustedPres = trusted((t) => t.pres);
	}

	endings(key: string): string[] {
		return this.trustedEnds.get(key) ?? [];
	}

	prefixes(key: string): string[] {
		return this.trustedPres.get(key) ?? [];
	}
}

function bump(
	map: Map<string, Map<string, number>>,
	key: string,
	affix: string
): void {
	let inner = map.get(key);
	if (!inner) {
		inner = new Map();
		map.set(key, inner);
	}
	inner.set(affix, (inner.get(affix) ?? 0) + 1);
}

/**
 * Where one form splits, in its own spelling, or null when no split
 * holds up. Around the stem first, when the ending it leaves is a
 * usual one for the form's tags and not nothing (franchi is franch +
 * i, not franchi with no ending); else on the usual prefix and ending
 * for those tags, as long as the stem left over starts with the
 * headword's letter and has three letters (suis and est from être
 * don't split; gestaltet keeps its ge, since staltet doesn't start
 * with gestalten's g).
 */
export function splitForm(
	form: string,
	lemma: string,
	stem: string | null,
	key: string,
	counts: AffixCounts
): FormSplit | null {
	const original = [...form.normalize("NFC")];
	const f = fold(form);
	// Lowercasing that changes the length (İ) would misplace the cuts.
	if (f.length !== original.length) return null;
	const endings = counts.endings(key);
	let found: FormSplit | null = null;
	const around = stem ? aroundStem(f, stem) : null;
	if (
		around &&
		(around.end || around.pre) &&
		endings.includes(around.end) &&
		(!around.pre || counts.prefixes(key).includes(around.pre))
	)
		found = around;
	if (!found) {
		const l = fold(lemma);
		// Prefixes first: gegangen is ge + gang + en, not gegang + en.
		for (const pre of [...counts.prefixes(key), ""]) {
			const p = [...pre];
			if (pre && f.slice(0, p.length).join("") !== pre) continue;
			const rest = f.slice(p.length);
			const end = endings.find(
				(e) =>
					e && rest.length - [...e].length >= 3 && rest.join("").endsWith(e)
			);
			if (!end) continue;
			const s = rest.slice(0, rest.length - [...end].length);
			if (bareLetter(s[0]) !== bareLetter(l[0])) continue;
			found = { pre, stem: s.join(""), num: "", end };
			break;
		}
	}
	if (!found) return null;
	// Back to the form's own letters (Häuser, not häuser).
	const cut = (from: number, len: number): string =>
		original.slice(from, from + len).join("");
	const a = [...found.pre].length;
	const b = [...found.stem].length;
	return {
		pre: cut(0, a),
		stem: cut(a, b),
		num: "",
		end: cut(a + b, original.length - a - b)
	};
}

/** Marker tags, in the order a form's marker is looked for. */
export const MARKERS = ["comparative", "superlative", "plural"] as const;

/**
 * Pull markers out of endings: where the plain form with the same
 * other tags (the singular, the positive degree) ends in a proper
 * tail of this form's ending around the same stem (talo + ssa against
 * talo + i + ssa, klein + en against klein + er + en), the rest of
 * the ending is the marker; verbs' person endings stay whole. Splits
 * are keyed by tagKey.
 */
export function separateMarkers(
	pos: string,
	splits: Map<string, { split: FormSplit; tags: string[] }>
): void {
	for (const { split, tags } of splits.values()) {
		const marker = MARKERS.find((m) => tags.includes(m));
		if (!marker || split.num) continue;
		// A verb's plural person ending is one piece (finissons).
		if (marker === "plural" && tags.some((t) => t.endsWith("-person")))
			continue;
		const others = tags.filter((t) => t !== marker);
		const single =
			(marker === "plural"
				? splits.get(tagKey(pos, [...others, "singular"]))?.split
				: undefined) ?? splits.get(tagKey(pos, others))?.split;
		if (!single || !single.end || single.pre !== split.pre) continue;
		if (single.stem.toLowerCase() !== split.stem.toLowerCase()) continue;
		const end = [...split.end];
		const tail = [...single.end];
		if (end.length <= tail.length) continue;
		if (end.slice(end.length - tail.length).join("") !== single.end) continue;
		split.num = end.slice(0, end.length - tail.length).join("");
		split.end = single.end;
	}
}

/* ---------- Derivation (Wiktionary etymology templates) ---------- */

export interface EtymologyTemplate {
	name: string;
	args?: Record<string, string>;
}

const AFFIX_TEMPLATES = new Set(["af", "affix", "compound", "com"]);

/** A template's pieces in order, affixes marked with hyphens, and their glosses. */
function templatePieces(
	t: EtymologyTemplate
): Array<{ text: string; gloss: string }> | null {
	const args = t.args ?? {};
	const numbered: Array<{ text: string; gloss: string }> = [];
	for (let i = 2; args[String(i)] !== undefined; i++) {
		const text = args[String(i)]!.trim();
		if (text)
			numbered.push({
				text,
				gloss: (args[`t${i - 1}`] ?? args[`gloss${i - 1}`] ?? "").trim()
			});
	}
	if (AFFIX_TEMPLATES.has(t.name)) return numbered;
	const [a, b, c] = numbered;
	if ((t.name === "suffix" || t.name === "suf") && a && b)
		return [a, { ...b, text: `-${b.text.replace(/^-/, "")}` }];
	if ((t.name === "prefix" || t.name === "pre") && a && b)
		return [{ ...a, text: `${a.text.replace(/-$/, "")}-` }, b];
	if ((t.name === "confix" || t.name === "con") && a && b) {
		const pre = { ...a, text: `${a.text.replace(/-$/, "")}-` };
		const suf = (p: { text: string; gloss: string }) => ({
			...p,
			text: `-${p.text.replace(/^-/, "")}`
		});
		return c ? [pre, b, suf(c)] : [pre, suf(b)];
	}
	return null;
}

function commonStart(a: string[], b: string[]): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n] === b[n]) n++;
	return n;
}

/** A content piece's spelling in the word is close to its headword (Krank for Kranker). */
function closeTo(span: string[], piece: string[]): boolean {
	return (
		span.length >= 2 &&
		commonStart(span, piece) >= Math.min(3, piece.length, span.length) &&
		Math.abs(span.length - piece.length) <= 2
	);
}

/**
 * Line a template's pieces up with the word's letters: affixes must
 * appear exactly, a content piece may differ at its end (Kranker in
 * Krankenhaus, happy in happiness). Each piece's span, or null.
 */
function alignPieces(word: string[], pieces: string[]): number[] | null {
	const spans: number[] = [];
	let at = 0;
	for (let i = 0; i < pieces.length; i++) {
		const raw = pieces[i]!;
		const affix = raw.startsWith("-") || raw.endsWith("-");
		const text = fold(raw.replace(/^-|-$/g, ""));
		if (text.length === 0) return null;
		if (affix) {
			if (word.slice(at, at + text.length).join("") !== text.join(""))
				return null;
			spans.push(text.length);
			at += text.length;
			continue;
		}
		const next = pieces[i + 1];
		if (next === undefined) {
			if (!closeTo(word.slice(at), text)) return null;
			spans.push(word.length - at);
			at = word.length;
			continue;
		}
		const nextText = fold(next.replace(/^-|-$/g, ""));
		const nextAffix = next.startsWith("-") || next.endsWith("-");
		// The next piece's start, nearest the length this piece has alone.
		let best = -1;
		for (let k = at + 2; k < word.length; k++) {
			const starts = nextAffix
				? word.slice(k, k + nextText.length).join("") === nextText.join("")
				: commonStart(word.slice(k), nextText) >= Math.min(2, nextText.length);
			if (!starts || !closeTo(word.slice(at, k), text)) continue;
			if (
				best === -1 ||
				Math.abs(k - at - text.length) < Math.abs(best - at - text.length)
			)
				best = k;
		}
		if (best === -1) return null;
		spans.push(best - at);
		at = best;
	}
	return at === word.length ? spans : null;
}

const MAKES: Record<string, string> = {
	noun: "makes a noun",
	adj: "makes an adjective",
	adv: "makes an adverb",
	verb: "makes a verb"
};

/**
 * A headword's derivation pieces from its first affix, compound or
 * confix template, in the headword's own letters; undefined when
 * there is none or its pieces don't line up with the spelling.
 */
export function wordMorphemes(
	word: string,
	pos: string,
	templates: EtymologyTemplate[] | undefined
): Morpheme[] | undefined {
	const t = templates?.find((x) => templatePieces(x));
	const pieces = t ? templatePieces(t) : null;
	if (!pieces || pieces.length < 2) return undefined;
	// Pieces from other languages or with markup can't line up.
	if (pieces.some((p) => /[:<>[\]{}|]/.test(p.text))) return undefined;
	const original = [...word.normalize("NFC")];
	const w = fold(word);
	if (w.length !== original.length) return undefined;
	const spans = alignPieces(
		w,
		pieces.map((p) => p.text)
	);
	if (!spans) return undefined;
	let at = 0;
	return pieces.map((p, i) => {
		const text = original.slice(at, at + spans[i]!).join("");
		at += spans[i]!;
		// A piece glossed as an affix is one (af|de|frei|heit, "-hood").
		const prefix =
			(p.text.endsWith("-") && !p.text.startsWith("-")) ||
			(i === 0 && /^\p{L}.*-$/u.test(p.gloss));
		const suffix =
			(p.text.startsWith("-") && !p.text.endsWith("-")) ||
			(i > 0 && /^-.*\p{L}$/u.test(p.gloss));
		if (prefix) return [text, p.gloss, pos === "verb" ? "voice" : "derive"];
		if (suffix)
			return [
				text,
				p.gloss || (i === pieces.length - 1 ? (MAKES[pos] ?? "") : ""),
				"derive"
			];
		if (p.text.startsWith("-")) return [text, "", "derive"];
		return [text, p.text, "core"];
	});
}
