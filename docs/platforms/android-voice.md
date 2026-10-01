# Voice on Android (filed 2026-09-09)

## Findings (physical S24, SM-S921W, Android 16)

- Inspect console on `http://tauri.localhost/`:
  `typeof speechSynthesis` → **ReferenceError, not defined**.
- WebView UA: `Chrome/151.0.7922.199` — modern, yet `window.speechSynthesis`
  is entirely absent (not just an empty voice list).
- Conclusion: web speech is a dead end in this shell. No permission prompt
  is involved — TTS needs no permission; the engine object itself is gone.

## Fixes already shipped (did not help — engine absent, not slow)

- `voiceschanged` listener + reactive inventory bump
  (`webVoiceVersion` in `src/routes/+page.svelte`): speak gates re-render
  when voices arrive instead of staying disabled forever.
- Speak-failure error now distinguishes "no voices on device" from a
  thrown speak. Phones never auto-read selections (toggle removed).

## Real fix (built 2026-09-09, NOT yet device-tested): native TTS bridge

- `src-tauri/gen/android/.../studio/ccez/app/Tts.kt` (new): UI-thread
  `TextToSpeech` driver — speak/stop/voices/supported + completion
  callbacks. `MainActivity.onCreate` calls `Tts.init`.
- `src-tauri/src/tts_android.rs` (new): JNI (0.21, matching wry — NOT
  ndk-context, which nothing initializes here) implementing the same
  `tts_speak` / `tts_stop` / `tts_voices` / `tts_supported` commands and
  forwarding completion as `tts-done` events. No new frontend contract:
  the Mac path's invokes and events drive it unchanged.
- `SettingsPanel.svelte`: the premium-voice quality gate is desktop-only
  (Android voices never pass it, which forced web).
- Verified: `cargo check` on aarch64-linux-android clean, host build
  clean, `bun run check`/`test`/eslint clean. Kotlin compiles only under
  Gradle — first `tauri android dev` after this will prove it.
- To use on device: settings → Voice engine → System voices (default
  stays web until switched), then tap a speaker.
- Mic dictation still needs `RECORD_AUDIO` + a native `SpeechRecognizer`
  bridge — Web SpeechRecognition never exists in WebViews, and the app
  deliberately hides mic buttons in-shell
  (`canMic = micAvailable() && !tauriBackendAvailable()`).
- Until then: the GBoard mic button is the dictation workaround.
