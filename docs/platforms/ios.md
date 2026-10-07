# iOS (iPhone and iPad)

> Status: **builds and runs in the iOS Simulator on GitHub Actions**
> (`.github/workflows/preview.yml`, `build (ios-simulator)`, 2026-10-07):
> first launch, settings by edge swipe, adding a custom provider with its
> key saved to the Keychain, the share-extension URL prefilling a prompt,
> and the Share extension registered with the system. Not signed, not on
> TestFlight: that waits on an Apple Developer account. No device run yet.

The iOS app is the same Tauri 2 + Svelte build as Android. iOS can only be
built on macOS, and the owner's Mac is reserved for game dev, so every iOS
build runs on a GitHub-hosted macOS runner.

## How CI builds and checks it

- `check.yml` → `rust-ios`: `cargo check --target aarch64-apple-ios` on
  every push to main and every PR, so iOS-only `cfg` paths can't rot.
- `preview.yml` → `build (ios-simulator)` on `preview/**` and
  `release-refresh-*` branches (or manual dispatch):
  1. `xcodegen generate` from `src-tauri/gen/apple/project.yml` (the
     source of truth for targets and Info.plist keys).
  2. `tauri ios build --target aarch64-sim --debug`: an unsigned
     Simulator app. The Simulator runs unsigned apps, so no certificate,
     profile or Apple account is involved.
  3. Fails unless `CcezLLMShare.appex` (the Share extension) is inside the
     app.
  4. `scripts/ios-sim-flows.sh` boots an iPhone Simulator, installs the
     app, and saves one screenshot per flow plus the share-extension
     registration and the app log. Download them from the run's
     `preview-ios-simulator` artifact. Taps go through idb: system alerts
     by accessibility label, WebView controls by hit-testing
     (`idb ui describe-point`), since WKWebView content is missing from
     the flat accessibility dump. A chat runs against
     `scripts/mock-llm.ts` on the runner's loopback.

The Xcode project in `src-tauri/gen/apple` was regenerated with
`tauri ios init` on a runner (the old one predated the crate rename and
Tauri refused it). Edit `project.yml`, not the `.pbxproj`; CI regenerates
the project from it on every build.

## Parity with Android

Android is the reference mobile build. "Same" means the shared web code
covers it on both.

| Feature | Android | iOS |
| --- | --- | --- |
| Share text in from other apps | `ACTION_SEND` share target (`MainActivity.handleSend`) | **Share extension** "Ccez LLM" (`gen/apple/ShareExtension`): opens `ccez-llm://send?text=…`, which prefills a new prompt through the same `annotate-external` path |
| Select text in another app → Annotate / Speak / Inspect | `PROCESS_TEXT` aliases | **No OS equivalent.** iOS has no third-party entries in other apps' text menus. Select → Share → Ccez LLM sends the text instead (it lands as a prompt, like Android's shares from other apps) |
| Deep links | Notification taps only | `ccez-llm://new`, `chat/<id>`, `send/annotate/speak/inspect?text=` (URL type in Info.plist, deep-link plugin). Links from outside an app show iOS's "Open in Ccez LLM?" prompt |
| Layout, gestures, text size, sheets | Shared web UI (`androidUI`) | Same: iOS takes the touch UI; iOS-specific: docked Annotate button (Apple's callout can't be hidden), two-finger double-tap toggles the sidebar |
| Orientation | Portrait | iPhone portrait; iPad all four |
| Safe areas / keyboard | Edge-to-edge + IME padding bridge | `viewport-fit=cover` + `env(safe-area-*)`; visualViewport keyboard pin |
| Read aloud (native voices) | `Tts.kt` | AVSpeechSynthesizer (`tts.rs`). Saving speech to a file is macOS/Android only |
| Dictation | `Dictation.kt` | Web Speech in WKWebView where iOS offers it; no native recognizer yet (gap) |
| OCR (images, captures) | Tesseract WASM | Tesseract WASM (same) |
| API keys | Android Keystore | iOS Keychain (`keyring` apple-native), debug builds too |
| Page fetch (`fetch_url`) TLS | System CA dirs loaded into BoringSSL | Mozilla roots bundled (`webpki-root-certs`), since iOS exposes no CA files |
| Background replies | Foreground service keeps a reply running | Runs while the app is open; iOS suspends it about 30 s after backgrounding, and the turn resumes or shows as interrupted on return (gap: no background task claim yet) |
| "Reply ready" notification | Notification channel, tap opens the chat | Notification plugin sends it; the permission prompt shows at first launch, as on Android (iOS guidance prefers asking in context); tap-to-open-chat not wired (gap) |
| In-app update | APK download + installer | None: iOS updates through the App Store / TestFlight. The panel hides the update route |
| Haptics | Haptics plugin | Haptics plugin (Taptic Engine) |
| On-device model | Gemini Nano (ML Kit) | None (Apple Foundation Models would be a separate provider) |
| Hardware keyboard | Android keyboards: desktop chords | iPad keyboards: the same chords with ⌘ (WKWebView reports a Mac platform) |

## What still needs an Apple account

Signing, TestFlight upload, Universal Links (`https://` links opening the
app) and an App Group (for a share extension that queues text without
opening the app) all need the owner's Apple Developer membership. None of
it blocks the Simulator pipeline.
