# Word cards

A one-word annotation is a word card: the literal meaning, the word in
colored pieces, a few facts, one line on the word in its sentence.

## Dictionary first (owner, 2026-10-24)

Front-load as much of the card as the downloaded dictionary can give,
and keep cards small.

- The pack's data shows at once and stays: meaning, base word, gender,
  and the split. Packs store each form's split when they're built
  (`scripts/dict-morph.ts`: stems from each headword's tables, endings
  counted per grammar tag set, derivation from Wiktionary's etymology
  templates), so the colored pieces aren't a guess.
- When the pack knows the split, the model is asked only for notes
  (`knownParts`), and its card keeps the pack's pieces. Scripts whose
  pieces want readings (Arabic vowels, pinyin) still ask the model;
  Japanese takes its pieces from the tokenizer.
- Notes stay short: Here at most ten words, at most two facts of a few
  words, Watch only for a real trap, no base line a piece's label
  already names.
- What a pack can't give is left to the model: irregular forms
  (gegangen splits, ging doesn't), ending chains finer than one plural
  or degree marker, and the sense the sentence gives the word.

## Storage

Packs download per language on first use (Settings: "Download
dictionaries for word cards") and Settings lists them with their size
and a Remove button. A removed language doesn't download again until
Download is pressed there.
