# cjk-decomp evaluation (U2 split-data source)

> SUPERSEDED in part Sep 2026: the 57 hand entries this report measures
> against are deleted — splits now come solely from the vendored subset
> (`src/lib/cjkdecomp-subset.generated.ts`, regen via the cjkdecomp-subset
> script). The license verdict (MIT), sizes, and Mainland-typeface caveat
> below still stand.

Prototype: `scripts/cjkdecomp.ts` (pure parser/expander) + `scripts/cjkdecomp-eval.ts` (CLI)

- `scripts/cjkdecomp.test.ts` (14 colocated Vitest tests, inline fixtures only).
  Reproduce (data file is NOT vendored):

```sh
git clone https://github.com/amake/cjk-decomp.git /tmp/cjk-decomp
bun scripts/cjkdecomp-eval.ts --data /tmp/cjk-decomp/cjk-decomp.txt
```

Upstream evaluated: `amake/cjk-decomp` at `c29b391` ("Note unmaintained status in readme",
2018). Data file `cjk-decomp.txt`: **85,238 records, 1,422,452 bytes UTF-8**.
Char-list fixtures: `scripts/fixtures/joyo.txt` (2136, via npm `joyo-kanji@0.2.1`, MIT,
origin x0213.org) and `scripts/fixtures/hanzi-common.txt` (top-2000 simplified by
frequency via `ruddfawcett/hanziDB.csv`, MIT, based on Jun Da's frequency list).

## 1. License verdict: YES, vendoring under MIT is permitted

The repo's `LICENSE` file contains only Apache-2.0 text, but the README's grant for
the _data file_ is an explicit choose-one-of-6 multi-license (README.md:8-21):

> "The data file is in UTF-8 encoding and was originally compiled by [Gavin Grover]
> ... It is distributed under 6 licenses, of which you only need choose one:"
> "- [MIT license](http://opensource.org/licenses/MIT)"

The six options are Apache-2.0, LGPL-3.0, CC BY-SA 3.0, MIT, ODC-By 1.0, and EPL.
So we may vendor a subset under MIT by shipping standard MIT text attributing the
original compiler (Gavin Grover) and the fork (Aaron Madlon-Kay / amake). This is
compatible with our own MIT `LICENSE`. No `src/` behavior changes are proposed here.

Caveats: (a) no MIT license _text file_ ships upstream — we add the standard text
ourselves; (b) the fork is unmaintained since 2018 and its README recommends
`cjkvi/cjkvi-ids` instead — but that data is GPL-licensed (per `src/lib/radicals.ts`)
and IDS-operator encoded, so it is worse for our use, not better.

## 2. Data format: `char:type(part,part)`

Each line is one record: the character, a colon, then a decomposition type code
with its constituents in parentheses. Three examples from the file:

```text
好:a(女,子)
語:a(言,吾)
漢:a(氵,37060)
```

- `a` = flows across, `d` = flows downwards (together 85.6% of records: 50,257 `a`
  - 22,666 `d`). Full layout vocabulary from the README: `c` (atomic component),
    `m.*` (modified, 1 child), `w.*` (contained within, 2), `ba|d`, `lock`, `s.*`
    (surround, 2 — e.g. 国 `s(囗,玉)`), `a`/`d` (2+), `r.*` (repeat/reflect, 1 child —
    e.g. 林 `ra(木)`, 森 `r3tr(木)`, 門 `rrefr(𠁣)`), each optionally suffixed
    `/t`/`/m`/`s`/`o` for the join (e.g. 心 `d/o(𠁼,㇃)`, 火 `a/t(48378,90011)`).
    Measured: **108 distinct type codes** in the file (34 singletons, incl. `built`).
- Constituents are either Unicode chars (Han, radicals, CJK strokes like ㇑) or
  **5-digit numeric keys** for ~10k intermediate decompositions not in Unicode
  (e.g. `37060` → `d(廿,99970)` → `99970` → `d/m(中,夫)`). Any consumer must
  resolve numerics recursively (the prototype's `resolveLevel`/`expandLeaves` do).
- Typeface is Mainland-Chinese: expect 飠 (not 食), 卄 (not 艹), 电 (simplified,
  in 電 `d(雨,电)`), and stroke-block codepoints (㇑ for 丨). The prototype
  normalizes six documented display variants (`VARIANT_MAP` in `scripts/cjkdecomp.ts`).

## 3. Prototype parses (23 chars, incl. multi-level splits)

`raw → L1 (numerics resolved, repeats expanded)`. Multi-level chains resolve, e.g.
漢 → 37060 → 99970 → 中+夫; 鳥's 37157 unfolds four levels to strokes.

| char | raw record         | L1 resolved       |
| ---- | ------------------ | ----------------- |
| 好   | `a(女,子)`         | 女 子             |
| 語   | `a(言,吾)`         | 言 吾             |
| 言   | `d(亠,37244)`      | 亠 二 口          |
| 漢   | `a(氵,37060)`      | 氵 廿 中 夫       |
| 国   | `s(囗,玉)`         | 囗 玉             |
| 聞   | `st(門,耳)`        | 門 耳             |
| 道   | `sbl(辶,首)`       | 辶 首             |
| 林   | `ra(木)`           | 木 木             |
| 森   | `r3tr(木)`         | 木 木 木          |
| 川   | `r3a(㇑)`          | ㇑ ㇑ ㇑          |
| 門   | `rrefr(𠁣)`        | 𠁣 𠁣             |
| 電   | `d(雨,电)`         | 雨 电             |
| 田   | `st(⺆,土)`        | ⺆ 土             |
| 車   | `w(37024,日)`      | 二 丨 日          |
| 愛   | `d(38462,夂)`      | ⺤ 冖 心 夊       |
| 鳥   | `str(37157,灬)`    | 匚 ㇐ ㇉ ㇔ ㇐ 灬 |
| 木   | `wb(十,八)`        | 十 八             |
| 心   | `d/o(𠁼,㇃)`       | 𠁼 ㇃             |
| 火   | `a/t(48378,90011)` | ㇓ ㇔ 冫          |
| 雪   | `d(雨,彐)`         | 雨 彐→ヨ          |
| 館   | `a(飠,官)`         | 飠→食 官          |
| 金   | `wb(全,丷)`        | 全 丷             |
| 水   | `w(㇚,37204)`      | ㇚ ㇇ 冫          |

## 4. Agreement vs the 57 hand entries in `src/lib/radicals.ts` TABLE

Order-sensitive, per char. `exact` = L1 strings identical; `resolved` = identical
after numeric resolution + repeat expansion + the six variant normalizations.

**Result: 26 exact + 10 resolved = 36/57 agree (63%); 21/57 mismatch (37%).**
Spot checks requested: 好=女+子 **exact agree** ✓; 語=言+吾 **exact agree** ✓.

| char                                                                          | hand                | data L1                        | verdict                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 好 明 休 体 信 語 話 読 認 酒 曜 時 駅 木 忍 国 園 病 痛 銀 鉄 問 聞 道 近 遠 | (identical)         | (identical)                    | 26 × exact                                                                                                |
| 館 飲 飯                                                                      | 食+…                | 飠+…                           | 3 × resolved (飠→食)                                                                                      |
| 花 草                                                                         | 艹+…                | 卄+…                           | 2 × resolved (卄→艹)                                                                                      |
| 林 森                                                                         | 木×2/×3             | ra/r3tr(木)                    | 2 × resolved (repeat-encoding)                                                                            |
| 山                                                                            | 丨 凵               | ㇑ 凵                          | resolved (㇑→丨)                                                                                          |
| 気                                                                            | 气 メ               | 气 乂                          | resolved (乂→メ)                                                                                          |
| 雪                                                                            | 雨 ヨ               | 雨 彐                          | resolved (彐→ヨ)                                                                                          |
| 海                                                                            | 毎+水 (`毎` U+6BCE) | 氵+`每` (U+6BCF)               | mismatch (codepoint-level variant)                                                                        |
| 漢                                                                            | 氵 堇               | 氵 廿 中 夫                    | mismatch (finer grain; and 堇=`d(廿,37304)`, 37304=`d/m(中,王)` ≠ 中+夫, so it disagrees even at depth 2) |
| 金                                                                            | 人 王 丷            | 全 丷                          | near-miss (全=`d(人,王)`; agrees one level deeper)                                                        |
| 足                                                                            | 口 止 龰            | 口 龰                          | mismatch (arity: data's 龰=`mb(止)` absorbs 止)                                                           |
| 門                                                                            | 丶 𠁣               | rrefr(𠁣)                      | mismatch (reflect-modeling vs 丶+𠁣)                                                                      |
| 川                                                                            | 丿 丨 丿            | r3a(㇑)→丨丨丨                 | mismatch (inner strokes)                                                                                  |
| 力                                                                            | 丿 乙               | ㇆ ㇓                          | mismatch (stroke codepoints)                                                                              |
| 電                                                                            | 日 乚 土            | 雨 电                          | mismatch (**simplified** 电 vs shinjitai — wrong for Japanese learners)                                   |
| 田                                                                            | 口 十               | ⺆ 土                          | mismatch (different analysis)                                                                             |
| 車                                                                            | 十 日 十            | 二 丨 日                       | mismatch (stroke-level vs component analysis)                                                             |
| 鳥                                                                            | 白 灬               | deep stroke split              | mismatch (白 never emerges)                                                                               |
| 魚                                                                            | 角 灬               | ⺈ 田 灬                       | mismatch                                                                                                  |
| 馬                                                                            | 一 灬 一            | deep numeric+灬                | mismatch                                                                                                  |
| 食                                                                            | 人 良               | 亽 艮                          | mismatch (艮 vs 良)                                                                                       |
| 言                                                                            | 一 口 二 ハ         | 亠 二 口                       | mismatch (亠 kept atomic)                                                                                 |
| 水 火 心 雨 耳 愛                                                             | (hand)              | stroke soup / alternate splits | 6 × mismatch (e.g. 水→㇚㇇冫, 火→㇓㇔冫, 愛→⺤冖心夊 vs 爫心夊)                                           |

Takeaway: the data is a _finer-grained, Mainland-typeface, stroke-level_ analysis;
the hand table is a _coarse, learner-oriented_ one. They coincide on simple
left-right/top-bottom compounds (言偏/人偏/日偏 families) and diverge on primitives
and enclosed structures.

## 5. Vendored-subset size (Joyo 2136 + top-2000 Hanzi = 3078-char union)

Coverage: **3078/3078 subset chars have records (100%)**. JSON artifacts measured
by the CLI (raw bytes + `gzipSync`):

| artifact                                        | raw          | gzip         |
| ----------------------------------------------- | ------------ | ------------ |
| subset raw records `{char: "type(p,…)"}` (3078) | **60,360 B** | **24,524 B** |
| subset resolved-L1 `{char: [comps]}` (3078)     | 65,204 B     | 23,104 B     |
| subset+component-closure raw records (3563)     | 69,991 B     | 28,607 B     |
| full raw records JSON (85,238)                  | 1,763,405 B  | 595,393 B    |

Against the ~300KB budget noted in `src/lib/radicals.ts`: the subset is ~1/5 of
budget raw (~60KB) and ~1/12 gzipped (~25KB); the full data (1.42MB txt, 1.76MB as
JSON, 595KB gzipped) exceeds it several times over.

## 6. Recommendation: vendor-subset (raw records + tiny expander), hand table wins

- **Vendor** the 3078-char raw-record subset as JSON + the ~30-line numeric/repeat
  expander (already prototyped) + an MIT attribution file (Grover/amake). ~60KB
  raw is deterministic, auditable, diffable, and offline — no runtime network.
- **Keep the 57 hand entries authoritative**: on conflict the hand split wins
  (fixes 電-with-电, 海 毎/每, and the coarse-primitive modeling for free).
- **Build-time-fetch rejected**: adds a network dependency to the build for data
  that changes never (upstream untouched since 2018) while hiding the 37%
  modeling divergence inside generated output.
- Follow-up (not this item): render-check that resolved leaves (strokes block,
  ⺆/⺤/𠁣) display in the app fonts; fall back to the honest "unavailable" entry
  where they do not.
