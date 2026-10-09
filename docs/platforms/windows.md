# Windows

> Status: **x64 verified in a Windows 11 VM** (2026-10-07: clean
> install, reinstall over v0.15.1, uninstall, first run, a streamed chat,
> deep links, Ctrl+Alt+Space from Notepad, shortcuts, F11, 125% scaling,
> Snap, remembered window state, and the in-app update from 0.15.2 to
> v0.16.0). ARM64 builds and signs in CI (first shipped in v0.16.0) but has
> not run on ARM hardware.

## What CI builds

`.github/workflows/release.yml` builds two NSIS installers on the
`windows-latest` (x64) runner, each with its updater signature:

| Asset                             | Rust target                                |
| --------------------------------- | ------------------------------------------ |
| `CcezLLM-windows-x64-setup.exe`   | `x86_64-pc-windows-msvc`                   |
| `CcezLLM-windows-arm64-setup.exe` | `aarch64-pc-windows-msvc` (cross-compiled) |

`latest.json` carries `windows-x86_64` and `windows-aarch64`, so the in-app
updater serves each machine its own installer.

ARM64 cross-compiles on the x64 runner. The native `windows-11-arm`
runner stays off: its ARM64 libclang (LLVM 22) makes bindgen emit opaque
BoringSSL structs (`E0609` on `srtp_protection_profile_st` /
`ssl_early_callback_ctx`), with or without an explicit clang target
(probed 2026-10-07). From x64 the bindings are fine; BoringSSL builds with
`OPENSSL_NO_ASM` there because MSVC has no assembler for its AArch64 asm
(`vendor/boring-sys-imp/build.rs`). `preview.yml` builds both installers
on preview branches as workflow artifacts.

There is still no local Windows build path.

## Installer

NSIS options live in `src-tauri/tauri.conf.json` under `bundle.windows`:
per-user install (`installMode: currentUser`, no UAC prompt) into
`%LOCALAPPDATA%\Ccez LLM`, English only, LZMA, a "Ccez LLM" Start Menu
folder, and an optional desktop shortcut on the finish page. WebView2
comes from the silent download bootstrapper, so the first install needs
internet (every current Windows 10/11 already has WebView2).

The installer also registers the `ccez-llm://` URL scheme for the user
(from `plugins.deep-link.desktop.schemes`), and the uninstaller removes it.

Installing over an existing copy shows NSIS's "Already installed" page
(reinstall or uninstall). In-app updates run the same installer silently.

### First install: SmartScreen

The `.exe` is not Authenticode-signed, so a downloaded installer shows
"Windows protected your PC" → **More info → Run anyway**. The updater
signature (`TAURI_SIGNING_*`) is unrelated to SmartScreen. A code-signing
certificate would remove the prompt; none is configured.

## How the app behaves on Windows

The app keeps its own design; these are the Windows-specific parts.

- **Window**: native title bar titled "Ccez LLM" (`tauri.windows.conf.json`:
  1200x760, centered, opaque; 640x480 minimum so Snap can halve it on
  common laptop screens). No in-window menu bar: every menu item has
  an in-app key or control. Size, position and maximized state persist
  (tauri-plugin-window-state). A window that would not fit the monitor's
  work area (small or scaled screens) shrinks to fit at launch.
- **Scaling**: per-monitor DPI aware; text re-renders crisply at 125%
  without a restart.
- **Shortcuts**: Ctrl everywhere, no Mac glyphs in the list or tooltips.
  Windows-only bindings: **F11** fullscreen, **Ctrl+E** edit newest
  message, **Ctrl+K** search chats (Ctrl+P too), **Ctrl+1…0** reply
  language. AltGr (Ctrl+Alt on Windows) no longer fires the Ctrl+Alt
  chords, so Polish and similar layouts can type ś, ń. Window capture
  (Ctrl+Shift+O/U) is macOS-only and no longer registered globally.
  **Ctrl+W is deliberately unbound** (no hide-to-tray, no delete chat).
- **Deep links**: `ccez-llm://new`, `ccez-llm://chat/<id>`,
  `ccez-llm://send?text=…` (prefill a prompt) and
  `ccez-llm://annotate|speak|inspect?text=…`. A second launch hands the
  link to the running app (loopback singleton, `desktop.rs`) and passes it
  the right to take the foreground.
- **Send text from any app** (the Android share target's counterpart):
  select text anywhere and press **Ctrl+Alt+Space**. The app copies the
  selection (restoring your clipboard text afterwards), comes forward,
  and prefills a prompt. With nothing selected it sends the clipboard
  text. The Windows Share sheet can't list the app: share targets need a
  packaged (MSIX) app with identity, and the NSIS build has none.
- **Tray**: Show / Quit, tooltip "Ccez LLM (Ctrl+Shift+Space to summon)".
- **Keys**: API keys live in Windows Credential Manager (`keyring`
  windows-native).
- **Owner-approved (Oct 2026)**: this shortcut set, Ctrl+W unbound,
  Ctrl+Alt+Space as the send-text chord, and no in-window menu bar.
  Ask before changing any of them.
- **Hidden where they do nothing**: screen-capture OCR, the game line
  overlay, and the dictation toggle when WebView2 offers no recognizer.

## Testing in a VM

The 2026-10-07 run used a throwaway Windows 11 Enterprise evaluation VM
on art-ms-7917 (QEMU/KVM, unattended install, driven through QMP
screenshots and input; installers delivered as a read-only CD image; a
loopback mock endpoint, `scripts/mock-llm.ts`, answered the chat).
Screenshots of that run are attached to the PR that introduced this page.
