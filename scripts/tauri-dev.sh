#!/bin/sh
# Dev shell with a stable Keychain identity. The password-prompt storm
# comes from unsigned relinks: every fresh `cargo` link gets a new
# ad-hoc identity, macOS treats it as a brand-new app, and re-prompts
# once per Keychain item. A watcher can't fix that (the app launches
# — and hits the Keychain — before any poll can re-sign), so this
# wrapper removes relinks instead of chasing them:
#
#   1. Build the backend first, so cargo is fresh before we sign.
#   2. Sign the fresh binary with the persistent "Ccez Dev" cert.
#   3. Launch with --no-watch: no mid-session rebuilds, so the
#      identity stays put and the shell stays silent.
#
# Rust edits need Ctrl-C plus relaunch (rebuild + re-sign); frontend
# HMR is unaffected. When prompts do appear, click Always Allow —
# never Allow (Allow is single-use and repeats every launch).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cargo build --manifest-path "$ROOT/src-tauri/Cargo.toml" --no-default-features
"$ROOT/scripts/sign-dev-binary.sh"
exec bun run tauri dev --no-watch -- "$@"
