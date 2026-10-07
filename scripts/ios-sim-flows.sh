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

# WKWebView content is missing from describe-all but answers hit tests:
# walk a vertical line of points and report the first element whose
# label or value matches, as "x y". Usage: scan_xy <regex> [x]
scan_xy() {
  [ "$HAVE_IDB" = 1 ] || return 1
  local pat="$1" x="${2:-120}" y
  for y in $(seq 60 10 800); do
    idb ui describe-point --udid "$UDID" --json "$x" "$y" 2>/dev/null | python3 -c '
import json, re, sys
try:
    e = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
if isinstance(e, list):
    e = e[0] if e else {}
fields = [str(e.get(k) or "").strip() for k in ("AXLabel", "AXValue", "title")]
if any(f and re.search(sys.argv[1], f, re.I) for f in fields):
    f = e["frame"]
    print(int(f["x"] + f["width"] / 2), int(f["y"] + f["height"] / 2))
    sys.exit(0)
sys.exit(1)' "$pat" && return 0
  done
  return 1
}

# Tap what scan_xy finds, else the fallback point.
# Usage: tap_scan <regex> [x] [fallback_x fallback_y]
tap_scan() {
  local xy
  if ! xy="$(scan_xy "$1" "${2:-120}")"; then
    [ -n "${3:-}" ] || { echo "  no element for /$1/"; return 1; }
    xy="$3 $4"
    echo "  /$1/ not found by scan; tapping $xy"
  fi
  # shellcheck disable=SC2086
  idb ui tap --udid "$UDID" $xy
  sleep 1
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

# Settings: swipe in from the right edge (the Android gesture).
idb ui swipe --udid "$UDID" --duration 0.3 372 420 120 420
shot settings 2

# Chat against the mock endpoint: add it as a custom provider. Points
# come from the 375x812 layout; the scans find them when they move.
tap_scan 'Add a custom provider' 100 100 200
sleep 1
tap_scan '^Name$|e\.g\. Kimi' 180 180 270 && type_text 'Mock tutor'
tap_scan 'api\.example\.com' 180 180 343 && type_text 'http://127.0.0.1:8787/v1'
tap_scan '^model-id$' 180 180 416 && type_text 'mock-tutor'
tap_scan '^Add provider$' 60 60 462
shot custom-provider 2
# The key field sits under its label and has no placeholder.
if KEY="$(scan_xy '^API key' 40)"; then
  idb ui tap --udid "$UDID" 140 $(( ${KEY#* } + 34 ))
  type_text 'sk-local-mock'
else
  echo "  API key label not found"
fi
shot provider-key 1
# Close the settings sheet: swipe it back out to the right.
idb ui swipe --udid "$UDID" --duration 0.3 40 420 360 420
sleep 2
idb ui tap --udid "$UDID" 150 733
type_text 'How do I politely order a coffee in French?'
sleep 1
tap_scan '^Send' 328 328 769
sleep 3
# One retry when the first tap only dismissed the keyboard accessory.
grep -q "chat request" "$OUT/mock-llm.log" || tap_scan '^Send' 328 328 769
shot chat 8

# Share sheet path: the extension opens exactly this URL.
open_url "ccez-llm://new"
open_url "ccez-llm://send?text=Bonjour%2C%20je%20voudrais%20un%20caf%C3%A9."
shot share-text-prefill 3

xcrun simctl spawn "$UDID" log show --last 10m --predicate "process CONTAINS 'Ccez'" --style compact > "$OUT/app.log" 2>&1
exit 0
