# Owner feedback, 2026-10-13 (from ccez-keeps notes)

The owner wrote these as notes in ccez-keeps through 2026-10-13 and asked
for them to live here instead; the notes were trashed once copied. Work
them off like `TODO.md` items: delete a row when it ships (the commit is
the record). Screenshots the owner attached are in
`docs/feedback/2026-10-13/`. Wording is the owner's, lightly trimmed.

## Annotations (A, the overlay, badges)

- Right-clicking a highlight with several kanji: the tinted kanji read as
  dropped from the highlight (the tint colour replaces the selection
  colour on them; `right-click-kanji-furigana-overlap.jpg`). The popups
  no longer overlap (2026-10-14); only the tint look is open.
- 露軍: right-clicking the first kanji gives つゆ the first time and ろ
  every time after; annotating both gives つゆぐん, right-click gives
  ろぐん (correct here). Single-kanji readings use the standalone reading,
  not the reading the kanji has in this sentence. Owner is not sure of the
  best handling.
- Furigana splits compounds the best path cuts into single kanji (一歩
  shows いち|ほ instead of いっぽ over the whole word; same in
  ccez-lang's screenshot). ccez-lang fixed this 2026-10-14 by rejoining
  runs of single-kanji tokens with the N-best lattice's whole-span token
  (common words beat proper nouns: 一人 ひとり, not カズト), else the
  joined readings over the whole compound (露軍 ろぐん): port that fix
  here (`furigana.worker.ts` + `furiganaRuby.ts`), don't re-invent it.
- In the Korean/Japanese plural answer (`들` vs `たち`): right-clicking
  接尾辞 showed Chinese pinyin but read 접미 (Korean). Since 2026-10-14 the
  voice follows the panel (a pinyin panel reads Mandarin, wave dashes are
  never read); whether a Han-only word inside a Korean paragraph should
  show pinyin at all is still open.

## Annotations, round 2 (owner, 2026-10-14)

- Colour-code repeats: text later in a message that was already annotated
  above gets the same colour as its first annotation. The owner wants
  colour, not dimming or underlines ("dimming would make it harder to
  read"). Colours must stay readable in light and dark themes and must not
  clash with the reading colours (`docs/design/colors.md`).

## Selection and inspect

- Mouse selection of Chinese feels strange; the browser's own behaviour is
  better: a single hanzi can be selected on its own, double-click selects
  the word (什么, not 什 or 么). (Korean syllable blocks stopped snapping
  out to the eojeol on 2026-10-14; the Chinese part needs a repro from
  the Mac: double-click already picks the segmenter word, single-hanzi
  drags are not snapped.)
