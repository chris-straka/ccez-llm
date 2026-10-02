# Port map: Tauri (`~/SWE/ccez-llm`) -> native Kotlin (this folder)

Source contract: README + `src/lib/*`, `src-tauri/src/*`, TODO standing decisions.

## Ships in v1
- Domain: `Chat`, `PasteFold`, search (tokenize/snippet/AND-rank/find),
  export Markdown + filename, attachments (vision/text token estimates,
  fit-dimensions, marker strip, text detection), paste folds/thresholds,
  annotations (bake/split/rewrite/redact/draft restore — Tauri block
  format), providers registry (muse / deepseek / keyless local-gemma),
  thinking levels, `visibleProviderIds` gating (local-gemma only on
  offline Android).
- State: create/append/edit/delete, branch-from-here, sending flags that never
  persist, `loadChats` healing, waypoint strip paging, Tauri-export import.
- Data: OpenAI-compatible SSE streaming client (thinking sent only when known)
  with the model-driven `fetch_url` tool loop (tools.ts/fetchPage.ts/fetch.rs/
  openai-compat.ts parity: tools on first stream, 3x3 serial fetch rounds,
  non-streaming follow-ups, answer streams last, one 400-fallback to plain).
  Page fetch is OkHttp (20s, 512KiB, UA parity); feeds via XXE-hardened DOM,
  HTML via jsoup with textContent line semantics.
  DataStore chat persistence (save debounced, restore on launch — verified
  across force-stop on emulator), Keystore/EncryptedSharedPreferences secrets
  (fail-closed, memory-only fallback), Tauri `ccez-llm-*` JSON migration
  (keys → secrets, baseUrl/model → configs). Biometric/device-credential
  gate before keys are read (on by default, once per process, silent
  skip when nothing enrolled; toggle in Settings).
- Device: real `AndroidSpeaker` (TTS + word ranges) and `AndroidDictator`
  (SpeechRecognizer) implemented; `OcrReader` (ML Kit Latin, live-verified)
  and `OnDeviceChat` (AICore/GenAI, fake-backed seam until S24 Ready path)
  implemented.
- UI: Compose M3 expressive + dynamic color, edge-to-edge, bottom-sheet chat
  list, waypoint strip, fold/delete/edit, collapsible pastes, retry/error slot,
  token hints, hide-until-tapped mode, light/dark/system, Ctrl+N / Ctrl+B
  hardware-keyboard shortcuts. Share-intent SEND + PROCESS_TEXT prefill in manifest.
  Screenshots verified on emulator: chat, settings, restart-restore.
- UI flows: annotation drafts (dialog → chips → baked on send, refs pills),
  in-chat find with jump, global search with jump-to-message, share-sheet
  export + clipboard fallback, Tauri chats/settings file import.
  Reading aids: per-message pinyin (platform ICU, tone-marked) and furigana
  (Kuromoji IPADIC, lazy dict + cache) pins with ruby rows, tashkeel toggle
  via the provider (Arabic lines splice back, memory-only revert, honest
  errors), dual-aid line ownership, code excluded from detection.
  Honest degradations: ICU pinyin has no polyphone context (pinyin-pro
  does); singleTop share-intent redelivery fixed.
- Attachments: image/file pickers, JPEG downscale (IMAGE_MAX_DIM, q85),
  vision image_url parts on the live request, text inline capped at
  100k chars, ML Kit Latin OCR into companion text (proven live:
  rendered "Hello OCR 123" reads back), 10-attachment cap, token sums.
  History keeps metadata + text (JPEG bytes are request-only).
  Composer mic dictation with runtime permission flow.
  PDF extraction (pdfbox-android, lazy asset init) + docx extraction
  (document.xml, no dep), both capped like text files; PDF round-trip
  runs on-device (Android statics).
- On-device Gemma: ML Kit GenAI Prompt API (beta3) over AICore with the
  Tauri recipe (mount probe, background download, MB progress, 12k-char
  cap), keyless routing in send, readiness + voice inventory in
  Settings, radio hidden where unsupported (probe: emulator reports
  Unsupported, no crash). Required Kotlin 2.3 + AGP 8.10 (same metadata
  wall Tauri documented). S24 device run still needed for Ready path.
- TTS wired (Speak/stop-toggle, baked blocks redacted); per-chat
  reply-lang + voice override dialog; user/assistant bubbles, key-hint
  empty state, monochrome icon. Screenshots: light, dark, ruby, sheet,
  search, composer.
- Message Copy in the ⋯ menu (raw markdown), Ctrl+P opens search,
  screen-on during TTS read-aloud, vibrate tick on send, offline
  auto-park on Gemma with reconnect restore (live-verified: radios
  unselect while offline, Muse restores after).
- Word-tap speech (long-press a word reads it in its script locale —
  web right-click parity), in-message quote marks for draft + baked
  annotations (applyMarks parity, static tint: no hover on touch),
  jump-landing card flash on search/waypoint landings (blink parity).
- Deliberately desktop-only, not ported: tray/global summon, traffic
  lights, desktop menu, auto-updater, local code execution (coderun —
  no sandbox on Android), KanjiVG stroke inspector (needs vector
  assets; no WebView by decision), word-tap-to-speak popup.
- v0.4.14 touch parity: two-finger double-tap jumps to the thread
  bottom, message double-tap lands that message, three-finger tap
  deletes the tapped message, three-finger still-hold (600ms) wipes
  all chats, mid-screen swipe right summons nothing (the list opens
  from the 64dp left-edge zone only), empty-composer send-hold swaps
  the reply language per chat (toast + tick), haptics renamed to the
  Disable-haptic-feedback toggle with legacy `vibration` migration,
  delete paths share the triple thump, folded previews land on the
  first sentence, message swipe toggles the fold either way (never
  summons), drawer capped at 340dp. M3's own drawer drag is off:
  it opened the list on mid-screen strokes, against the contract —
  the content swipe owns edge-open (fresh callbacks, no stale panel
  reads) and the sheet owns leftward-close. Triple/quadruple-tap text
  selection stays WebView-only (native keeps the long-press word
  gesture — no SelectionContainer by decision); the two-finger-hold
  chat-switcher overlay has no native equivalent (the drawer serves).
- Drawer chrome: 8dp breathing room between the + and Settings
  buttons; the settings version stamp sits centered at the menu
  bottom (both pinned by connected tests).
- Tests: 193 JVM unit tests green (`:app:testDebugUnitTest`); 28 connected
  tests green on Pixel_8a API 36 emulator (`:app:connectedDebugAndroidTest`,
  incl. real DataStore + Keystore round-trips, search navigation,
  device-verified ICU tones + Kuromoji, live ML Kit OCR, the PDF
  round-trip, the Inspect overlay with stepper, mid-screen-swipe
  never opens the list, edge-swipe opens it, sheet-swipe folds it,
  drawer button gap, and centered version stamp).
- Character Inspect overlay: single-Han-char entry from the annotate
  dialog, offline Unihan facts (components, count, radical, gloss,
  pinyin, on/kun) from bundled tables, KanjiVG stroke vectors fetched
  on demand with a manual ‹ n / total › stepper and CC BY-SA 3.0
  credit, JP/中文 toggle for ambiguous Han.
  Screenshots verified: chat, settings, sheet, search, ruby pinyin.
  Note: UI tests need Espresso 3.7.0+ / ext:junit 1.3.0+ on API 36
  (older Espresso crashes in `onIdle` via removed `InputManager.getInstance`).

## Explicitly left out (desktop-only)
Tray, global summon shortcut, traffic lights/window chrome, desktop menu,
auto-updater (self-sign APK per release.yml instead), macOS/Win/Linux
dictation + voices inventory, j/k/u/d desktop scroll physics.

## Next to wire iteratively
1. `EncryptedSharedPreferences` Keystore impl + DataStore persistence + migration
   from Tauri localStorage JSON.
2. Real `Speaker` (TextToSpeech + utterance ranges), `Dictator`
   (SpeechRecognizer), ML Kit OCR attach flow, AICore Gemma `status()`/`chat()`
   with mount probe + MB-downloaded note.
3. Language aids full port: pinyin / furigana / tashkeel spans, annotate
   highlight menu, readings popup, per-sentence voice matching.
4. Attachments (image+text, OCR ingest), chat search, export, fetch_url tool,
   code-run sandbox equivalent.
5. Emulator/S24 pass: bottom-sheet, edge swipes, long-press Annotate menu,
   tap-to-reveal, themes, TTS ear-check.
