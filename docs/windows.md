# Windows installer (NSIS)

> Status: **UNTESTED on Windows hardware** — config schema-verified only.
> The first `v*` tag CI run is the real test.

The Windows build produces **NSIS `.exe` installers** (one per architecture)
on GitHub Actions only. There is no Microsoft Store (MSIX) package and no
supported local Windows build — maintainers develop on macOS.

## What CI builds

Workflow: the `release-windows-*` jobs in [.github/workflows/release.yml](../.github/workflows/release.yml).
They run in that file's strict `needs` chain (one writer at a time) and
attach their artifacts to the same draft GitHub Release.

| Arch  | Runner           | Rust target               |
| ----- | ---------------- | ------------------------- |
| x64   | `windows-latest` | `x86_64-pc-windows-msvc`  |
| ARM64 | `windows-11-arm` | `aarch64-pc-windows-msvc` |

Only the NSIS bundle is built (`--bundles nsis`); the WiX `.msi` is skipped —
MSI distribution is out of scope. NSIS itself is provisioned on the runner by
`tauri-apps/tauri-action`; no manual `choco install nsis` step is needed.

ARM64 needs the `windows-11-arm` runner (native build; cross-linking ARM64
from an x64 runner is not trivial). That label is GA for **public**
repositories only — if this repo ever goes private, delete the ARM64 matrix
entry; x64 is unaffected.

## Installer configuration

NSIS options live in `src-tauri/tauri.conf.json` under `bundle.windows`:

- `nsis.installerIcon: icons/icon.ico` — the installer (and uninstaller
  fallback) art. The file already ships in `src-tauri/icons/`.
- `installMode: currentUser` — installs without Administrator rights,
  metadata under `HKCU`. (`perMachine` would force a UAC prompt; `both`
  forces one even for per-user installs.)
- `languages: ["English"]`, `displayLanguageSelector: false` — single
  language, no picker dialog.
- `compression: lzma` — best ratio, the NSIS default made explicit.
- `startMenuFolder: "Ccez LLM"` — groups the Start Menu shortcut.

## WebView2 notes

Tauri renders with the system **WebView2** runtime. The configured mode is
`downloadBootstrapper` (silent): the installer stays small and downloads the
WebView2 bootstrapper at install time, so **installing requires an internet
connection**. The alternatives, cheapest first:

- `embedBootstrapper` — bundles the ~1.8 MB bootstrapper (still needs
  internet at install, better Windows 7 support).
- `offlineInstaller` — bundles the full ~127 MB runtime; works offline.
- `skip` — install nothing; the app fails on machines without WebView2
  (practically all Windows 10 1803+ / 11 ship it, but do not rely on this).

To switch, change `bundle.windows.webviewInstallMode.type` in
`src-tauri/tauri.conf.json`. Note the updater bundle always uses
`downloadBootstrapper` regardless of this setting.

## Secrets — none new

The in-app updater artifacts (`*.nsis.zip` + `*.nsis.zip.sig`) are signed
with the **same** secrets as `release.yml`:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

If those secrets are absent the build still succeeds but no `.sig` files are
produced and the in-app updater cannot verify Windows updates.

## What to expect on first install

The `.exe` is **not Authenticode-signed** (no code-signing certificate is
configured), so Windows SmartScreen shows an "Unknown publisher" warning and
users must click "More info → Run anyway". This is unrelated to the updater
signature above. Buying/configuring an EV cert (or Store listing) is a future
option, not part of this setup.

## Cutting a release

```sh
git tag v0.1.0 && git push origin v0.1.0
```

then check the draft Release on GitHub: it should contain the macOS, Android,
Linux, and Windows (`*-setup.exe`, `*.nsis.zip`, `*.nsis.zip.sig`) assets.
Publish the draft when all platform jobs are green.

## Static quirk-hunt notes (2026-09-10, Mac host, no Windows hardware)

Research-only sweep; each item names file:line evidence, severity, and
whether a `v*` CI runner is needed to prove it.

1. **`keyring` has no platform features — mock store everywhere
   (breaks runtime, confirmed).** `src-tauri/Cargo.toml:24` declares
   `keyring = "3"` with no `features`, and keyring 3.6.3 documents
   "no default features … you must specify explicitly" with a
   mock-store fallback (`~/.cargo/…/keyring-3.6.3/src/lib.rs:60-77,
:293-299`). `src-tauri/Cargo.lock` lists keyring's deps as only
   `log` + `zeroize` (the `security-framework` hits are via
   `rustls-native-certs`, unrelated), and
   `cargo tree -e features -i keyring` shows only feature `default`.
   So `keychain_get/set` (`src-tauri/src/lib.rs:22-49`) keep API keys
   in process memory on Windows AND macOS — they do not persist
   across restarts. Proposed patch:
   `keyring = { version = "3", features = ["apple-native", "windows-native"] }`.
   Provable on macOS locally (restart loses the key); Windows
   Credential Manager persistence needs a `v*` runner.
2. **`open_voice_settings` errors on Windows (cosmetic, confirmed).**
   `src-tauri/src/lib.rs:71-74` returns
   `"opening System Settings requires macOS"`. The frontend
   (`SettingsPanel.svelte:230-241`) keeps the text readable, so this
   is graceful. Optional patch: a `cfg(target_os = "windows")` arm
   running `cmd /C start ms-settings:speech` — URI choice needs a
   runner to confirm.
3. **Windows TTS stubs fail over to web voices (cosmetic,
   confirmed).** `src-tauri/src/tts.rs:639-640,661-665,675-679,705-709`
   return `Err("native TTS requires macOS or iOS")`; the frontend
   gates on `tts_supported` (`nativeTts.ts:61-72`) so WebView2/SAPI
   web voices take over. Minor wording quirk:
   `friendlyNativeError` (`nativeTts.ts:115-117`) tells a Windows
   shell user "System voices need the Mac app". Widen that branch to
   mention the Windows app. No runner needed.
4. **`current_input_source` stub returns `None` off-macOS (no-op,
   confirmed).** `src-tauri/src/keyboard.rs:46-50`; the frontend
   leaves the voice language unchanged. No patch.
5. **`titleBarStyle: Overlay` + `trafficLightPosition` are macOS-only
   (no-op, confirmed via schema).** The bundled
   `@tauri-apps/cli/config.schema.json` describes them as "the style
   of the macOS title bar" / "window controls on macOS" — Windows
   ignores them. No patch.
6. **NSIS + WebView2 config is schema-valid (confirmed on macOS).**
   `bundle.windows` keys (`webviewInstallMode.downloadBootstrapper`
   silent, `nsis.installMode/compression/languages/
displayLanguageSelector/startMenuFolder/installerIcon`) all match
   `definitions.WindowsConfig/NsisConfig/WebviewInstallMode`, and
   `src-tauri/icons/icon.ico` ships. Only a `v*` run can prove the
   installer builds, the bootstrapper downloads at install time, and
   the SmartScreen "Unknown publisher" path.
7. **No other shell-outs or hardcoded separators (confirmed).** The
   sole `Command::new` is the macOS-gated `open`
   (`src-tauri/src/lib.rs:61`). No `C:\`, `cmd.exe`, `/tmp/`,
   `~/Library` literals in `src`/`src-tauri`. `\n` splits tolerate
   pasted CRLF (`trimPasteTail` strips `\r\n`, marker compares use
   `trim()`); `scripts/release.ts:58-63` splits on `"\n"` with an
   end-anchored version regex, so it assumes LF checkouts — fine for
   the macOS-run release flow, no `.gitattributes` needed now.
8. **Mic hidden in all shells incl. Windows WebView2 (cosmetic,
   confirmed).** `src/routes/+page.svelte:3735` sets
   `canMic = micAvailable() && !tauriBackendAvailable()` for the
   WKWebView service block; WebView2 may support recognition, but
   un-hiding it there needs on-device proof. No patch proposed.
