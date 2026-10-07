#!/usr/bin/env bash
# Boots an iPhone Simulator, installs the unsigned debug .app built by
# `tauri ios build --target aarch64-sim`, and screenshots each scripted
# flow into OUT_DIR (one PNG per flow, numbered in run order), plus the
# accessibility tree after each step (ax-*.json) for tuning the taps.
# Taps go through idb (facebook/idb) by accessibility label, so the
# WebView's DOM text is the selector, not pixel guesses. Flow steps are
# best-effort: a miss is logged and the next flow still runs.
# Usage: scripts/ios-sim-flows.sh <path/to/App.app> <out-dir>
set -euo pipefail

APP="$1"
OUT="$2"
BUNDLE_ID="studio.ccez.app"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"

# Newest available iPhone runtime + a non-Max Pro device type.
DEVICE_TYPE="$(xcrun simctl list devicetypes -j | python3 -c '
import json, sys
types = [t for t in json.load(sys.stdin)["devicetypes"] if t["name"].startswith("iPhone") and "Pro" in t["name"] and "Max" not in t["name"]]
print(types[-1]["identifier"])')"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
rts = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS" and r["isAvailable"]]
print(rts[-1]["identifier"])')"
echo "device type: $DEVICE_TYPE"
echo "runtime:     $RUNTIME"
UDID="$(xcrun simctl create ccez-preview "$DEVICE_TYPE" "$RUNTIME")"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 || true
xcrun simctl install "$UDID" "$APP"

# The chat flow talks to a canned OpenAI-compatible endpoint; the
# Simulator shares the Mac's loopback.
bun "$HERE/mock-llm.ts" 8787 > "$OUT/mock-llm.log" 2>&1 &
MOCK_PID=$!
trap 'kill $MOCK_PID 2>/dev/null || true' EXIT

HAVE_IDB=0
command -v idb >/dev/null && idb connect "$UDID" >/dev/null 2>&1 && HAVE_IDB=1
echo "idb: $HAVE_IDB"

STEP=0
shot() {
  STEP=$((STEP + 1))
  local name
  name="$(printf '%02d' "$STEP")-$1"
  sleep "${2:-3}"
  xcrun simctl io "$UDID" screenshot "$OUT/$name.png" >/dev/null 2>&1
  [ "$HAVE_IDB" = 1 ] && idb ui describe-all --udid "$UDID" --json > "$OUT/ax-$name.json" 2>/dev/null || true
  echo "shot: $name"
}

# Center of the first accessibility element whose label/value/title
# matches the regex (case-insensitive), as "x y" in points.
find_ax() {
  [ "$HAVE_IDB" = 1 ] || return 1
  idb ui describe-all --udid "$UDID" --json 2>/dev/null | python3 -c '
import json, re, sys
pat = re.compile(sys.argv[1], re.I)
want_type = sys.argv[2] if len(sys.argv) > 2 else ""
raw = sys.stdin.read().strip()
try:
    els = json.loads(raw)
except ValueError:
    els = [json.loads(line) for line in raw.splitlines() if line.strip()]
    if els and isinstance(els[0], list):
        els = els[0]
for e in els:
    fields = [str(e.get(k) or "").strip() for k in ("AXLabel", "AXValue", "title")]
    if want_type and want_type.lower() not in str(e.get("type", "")).lower():
        continue
    if any(f and pat.search(f) for f in fields):
        f = e["frame"]
        print(int(f["x"] + f["width"] / 2), int(f["y"] + f["height"] / 2))
        sys.exit(0)
sys.exit(1)' "$@"
}

tap_ax() {
  local xy
  if xy="$(find_ax "$@")"; then
    # shellcheck disable=SC2086
    idb ui tap --udid "$UDID" $xy
    sleep 1
    return 0
  fi
  echo "  no element for /$1/ ${2:-}"
  return 1
}

type_text() { [ "$HAVE_IDB" = 1 ] && idb ui text --udid "$UDID" "$1" && sleep 0.5; }

# iOS asks before a custom-scheme URL opens an app; accept it.
open_url() {
  xcrun simctl openurl "$UDID" "$1"
  sleep 2
  tap_ax '^Open$' || true
}

set +e
xcrun simctl launch "$UDID" "$BUNDLE_ID"
# First launch boots WebKit cold on CI: wait for the empty-chat hero.
for _ in $(seq 1 60); do
  find_ax 'What can I do for you' >/dev/null && break
  sleep 2
done
shot first-run 2
# The app asks for notification permission at launch (reply-ready
# pings, like Android); accept so the alert doesn't cover later flows.
tap_ax '^Allow$' || true

# The share extension registers with the system (Share sheet entry).
xcrun simctl spawn "$UDID" pluginkit -m -v -p com.apple.share-services > "$OUT/share-extensions.txt" 2>&1
grep -q "studio.ccez.app.share" "$OUT/share-extensions.txt" && echo "share extension: registered" || echo "share extension: NOT registered"

# Share sheet path: the extension opens exactly this URL.
open_url "ccez-llm://send?text=Bonjour%2C%20je%20voudrais%20un%20caf%C3%A9."
shot share-text-prefill 3

# Settings: swipe in from the right edge (the Android gesture).
idb ui swipe --udid "$UDID" --duration 0.3 372 420 120 420
shot settings 2

# Chat against the mock endpoint: add it as a custom provider.
tap_ax 'Add a custom provider'
tap_ax '^Name' 'Text' && type_text 'Mock tutor'
tap_ax 'Base URL' 'Text' && type_text 'http://127.0.0.1:8787/v1'
tap_ax '^Model' 'Text' && type_text 'mock-tutor'
tap_ax '^Add provider$'
shot custom-provider 2
tap_ax 'API key' 'Text' && type_text 'sk-local-mock'
# Close the settings sheet: swipe it back out to the right.
idb ui swipe --udid "$UDID" --duration 0.3 40 420 360 420
sleep 2
tap_ax 'TextArea|Message|Ask' 'Text' || idb ui tap --udid "$UDID" 187 760
type_text 'How do I politely order a coffee in French?'
tap_ax '^Send' || idb ui key --udid "$UDID" 40
shot chat 8

# A fresh chat through the deep link.
open_url "ccez-llm://new"
shot deeplink-new-chat 3

xcrun simctl spawn "$UDID" log show --last 10m --predicate "process CONTAINS 'Ccez'" --style compact > "$OUT/app.log" 2>&1
exit 0
