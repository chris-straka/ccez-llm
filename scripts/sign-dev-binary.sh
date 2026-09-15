#!/bin/sh
# Re-sign the Tauri dev binary with the persistent local "Ccez Dev"
# self-signed cert, so macOS Keychain keeps recognizing it across
# cargo rebuilds. Unsigned/ad-hoc rebuilds get a fresh code identity
# every time and re-prompt once per Keychain item; a stable cert
# identity makes one round of Always Allow stick for good.
# Idempotent: safe to re-run any time. See AGENTS.md ("dev Keychain").
set -eu
BIN="$(cd "$(dirname "$0")/.." && pwd)/src-tauri/target/debug/ccez-llm"
if [ ! -x "$BIN" ]; then
  echo "sign-dev-binary: no dev binary yet at $BIN" >&2
  echo "sign-dev-binary: launch the dev shell once first, then re-run this." >&2
  exit 1
fi
if ! security find-certificate -c "Ccez Dev" >/dev/null 2>&1; then
  echo "sign-dev-binary: no 'Ccez Dev' signing cert in the login keychain." >&2
  echo "sign-dev-binary: create it once (self-signed Code Signing cert named exactly 'Ccez Dev'), then re-run." >&2
  exit 1
fi
exec codesign -f -s "Ccez Dev" "$BIN"
