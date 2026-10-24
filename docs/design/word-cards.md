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
- The card's shape (owner sketch, 2026-10-24): the split, with
  "irregular" under the stem of an irregular verb (from the pack);
  beside it, the multi-word form the word belongs to in this sentence,
  its name, its words and a word-for-word gloss ("perfect tense / sind
  … gegangen / are … gone"); last, the phrase it sits in and what that
  means ("sind … spazieren gegangen → went for a walk"). No Here line,
  no fact pills beyond a noun's gender, Watch only for a real trap, no
  base line a piece's label already names.
- What a pack can't give is left to the model: irregular forms
  (gegangen splits, ging doesn't), ending chains finer than one plural
  or degree marker, and the sense the sentence gives the word.

## Storage

Packs download per language on first use (Settings → Dictionaries:
"Download for word cards as you read"). Settings shows a one-line
summary and "Manage dictionaries", which opens the manager: a sheet
most of the window wide (the whole screen on phones; the settings panel
itself stays narrow so the chat stays visible beside it), every pack as
a tile grouped like the language menus, with its size on disk or its
download size, a filter, download ahead, remove, and remove all behind
a confirm. A removed language doesn't download again on its own.
