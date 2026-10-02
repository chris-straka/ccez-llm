# TODO — candidate features + refactors (for review, not committed to)

## Suggested features (not in the Tauri app)
1. **Per-chat biometric re-lock** — today unlock is per-process. Optional
   "lock on background" (Application lifecycle observer resets
   `keysUnlocked` on stop) for stricter posture.
2. **Auth-bound Keystore keys** — `setUserAuthenticationRequired(true)` on
   the master key so decryption itself needs presence, not just the app
   gate. Heavier (auth-per-use crypto object); evaluate UX first.
3. **On-device OCR languages** — ML Kit Latin only today; add
   Chinese/Japanese/Korean/Arabic script packs behind the reply-lang.
4. **Widget + shortcut** — home-screen "New chat" shortcut and a
   PROCESS_TEXT / share-target review pass on S24.

## Done since (removed from the list above)
- **Persist AppSettings to DataStore** — shipped: `settings_json` prefs
  key with versioned migration (`Persistence.loadSettings/saveSettings`,
  wired in `MainActivity`).
- **Fetch progress UI** — shipped: "Fetching \<host>…" chip while web
  reads run.
- **Selection speech** — shipped: the selection menu has Speak and
  readings land below the bubble.

## Refactors worth doing
- **ProviderClient split** — `ProviderClient.kt` now holds wire model,
  SSE parsing, non-stream POST, and the tool loop (~400 lines). Split
  parsers (`ChatWire.kt`) from transport when the next protocol knob
  lands.
- **`renderJson` replacement** — the hand-rolled JSON renderer predates
  kotlinx.serialization usage in the file; the parsers already use
  kotlinx.serialization. Render requests with it too and delete ~30
  lines of escape code.
- **ChatViewModel split** — send/aids/search/settings in one ~500-line
  VM. Extract `AidController` (pinyin/furigana/tashkeel state) first;
  it has the most self-contained state.
- **Toast channel rename** — `_aidError` now carries non-aid notices
  (biometric denial). Rename to `_notice` + `consumeNotice()`.

## Deliberately not ported (desktop-only)
Tray/global summon, traffic lights, desktop menu, auto-updater,
macOS/Win/Linux dictation + voice inventory, j/k/u/d desktop scroll
physics, local code execution sandbox (no Android equivalent).
