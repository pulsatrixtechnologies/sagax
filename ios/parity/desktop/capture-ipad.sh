#!/usr/bin/env bash
# Capture the iPad screens that match the desktop references
# (refs/desktop-<W>x<H>-<NN>-<surface>.png, from capture-desktop.mjs).
#
#   ios/parity/desktop/capture-ipad.sh                       build, every viewport, every surface
#   ios/parity/desktop/capture-ipad.sh --skip-build main chat-approval
#   ios/parity/desktop/capture-ipad.sh --viewport 1366x1024  one viewport
#   ios/parity/desktop/capture-ipad.sh --skins               also main-skin-* (-paritySkin)
#   ios/parity/desktop/capture-ipad.sh --device m5           iPad Pro 13/11-inch (M5) instead
#   ios/parity/desktop/capture-ipad.sh --keep-sims           leave the simulators for the next run
#   PARITY_WAIT=8 ios/parity/desktop/capture-ipad.sh         seconds per screen
#
# Then: python3 ios/parity/desktop/diff-ipad.py [--gate]
#
# Devices. The desktop references are at the iPad point sizes 1366x1024 and
# 1194x834 (and their portraits). The simulators whose screens are exactly
# those sizes are the iPad Pro 12.9-inch (6th generation) and the iPad Pro
# 11-inch (4th generation), the default here, so a capture lines up with its
# reference point for point. The current iPad Pro (M5) screens are 1376x1032
# and 1210x834 pt: `--device m5` captures those, and the references must
# then be made at the same sizes:
#   node ios/parity/desktop/capture-desktop.mjs --viewport 1376x1032,1032x1376,1210x834,834x1210
#
# Each device is a dedicated simulator ("parity-ipad13", "parity-ipad11";
# PARITY_SIM_PREFIX=i2 names them "i2-ipad13", "i2-ipad11" so two worktrees
# can capture at once),
# dark, status bar pinned, deleted at the end unless --keep-sims. The app is
# the Debug simulator build of ios/parity/capture.sh (unsigned; the parity
# launch keeps its bearer in memory), built for testing: the orientation is
# set by one UI test (UITests/ParityOrientationUITests.swift), since iPadOS
# refuses programmatic rotation and simctl cannot rotate. Screens
# are ios/App/ParityLaunch.swift's IPadParityScreen; this script refuses to
# run when that list and surfaces.mjs differ.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PARITY="$(cd "$HERE/.." && pwd)"
IOS="$(cd "$PARITY/.." && pwd)"
ROOT="$(cd "$IOS/.." && pwd)"
OUT="$HERE/out"
BUILD="$PARITY/build"
BUNDLE_ID="ca.pulsatrix.sagax"
WAIT="${PARITY_WAIT:-6}"
# Simulator names: parity-ipad13 / parity-ipad11, or another prefix so two
# worktrees can capture at once (PARITY_SIM_PREFIX=i3 -> i3-ipad13).
SIM_PREFIX="${PARITY_SIM_PREFIX:-parity}"
SIM13="$SIM_PREFIX-ipad13"; SIM11="$SIM_PREFIX-ipad11"

SKIP_BUILD=0
SKINS=0
DEVICE=legacy
KEEP_SIMS=0
VIEWPORTS=()
SCREENS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --skins) SKINS=1 ;;
    --keep-sims) KEEP_SIMS=1 ;;
    --device) DEVICE="$2"; shift ;;
    --viewport) IFS=, read -r -a VIEWPORTS <<< "$2"; shift ;;
    -h|--help) sed -n '2,33p' "$0"; exit 0 ;;
    *) SCREENS+=("$1") ;;
  esac
  shift
done

log() { printf '[capture-ipad] %s\n' "$*" >&2; }
mkdir -p "$OUT"

# ── the screen list: surfaces.mjs and ParityLaunch.swift must agree ──────
LIST="$(node "$HERE/capture-desktop.mjs" --list | awk '/^[0-9]+-/ {print $1}')"
DESKTOP_IDS="$(printf '%s\n' "$LIST" | sed -E 's/^[0-9]+-//')"
SWIFT_IDS="$(awk '/^enum IPadParityScreen/,/^}/' "$IOS/App/ParityLaunch.swift" | sed -nE 's/^ *case [A-Za-z0-9]+ = "([^"]+)".*/\1/p')"
if [ "$DESKTOP_IDS" != "$SWIFT_IDS" ]; then
  log "IPadParityScreen (ios/App/ParityLaunch.swift) and surfaces.mjs differ:"
  diff <(printf '%s\n' "$DESKTOP_IDS") <(printf '%s\n' "$SWIFT_IDS") >&2 || true
  exit 1
fi

case "$DEVICE" in
  legacy)
    DEV13_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-12-9-inch-6th-generation-8GB"
    DEV11_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-4th-generation-8GB"
    V13L=1366x1024; V13P=1024x1366; V11L=1194x834; V11P=834x1194 ;;
  m5)
    DEV13_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB"
    DEV11_TYPE="com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB"
    V13L=1376x1032; V13P=1032x1376; V11L=1210x834; V11P=834x1210 ;;
  *) log "--device legacy|m5"; exit 2 ;;
esac
# viewport -> device name, simulator type, orientation
PLAN=(
  "$V13L $SIM13 $DEV13_TYPE landscape"
  "$V13P $SIM13 $DEV13_TYPE portrait"
  "$V11L $SIM11 $DEV11_TYPE landscape"
  "$V11P $SIM11 $DEV11_TYPE portrait"
)

# ── build ────────────────────────────────────────────────────────────────
APP="$BUILD/Build/Products/Debug-iphonesimulator/Sagax.app"
if [ "$SKIP_BUILD" -eq 0 ] || [ ! -d "$APP" ]; then
  log "xcodegen + build (Debug, simulator, unsigned)"
  (cd "$IOS" && xcodegen generate >/dev/null)
  # build-for-testing: the app, and the UI-test runner that turns the device.
  xcodebuild -project "$IOS/Sagax.xcodeproj" -scheme Sagax \
    -configuration Debug -sdk iphonesimulator \
    -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build-for-testing \
    > "$OUT/build.log" 2>&1 || { tail -40 "$OUT/build.log"; log "build failed (see $OUT/build.log)"; exit 1; }
fi
XCTESTRUN="$(ls "$BUILD"/Build/Products/*.xctestrun 2>/dev/null | head -1 || true)"
[ -n "$XCTESTRUN" ] || { log "no .xctestrun in $BUILD (run without --skip-build)"; exit 1; }

# iPadOS refuses programmatic rotation in its windowing mode and simctl has
# no rotate command: one UI test (UITests/ParityOrientationUITests.swift)
# turns the device, which keeps the orientation afterwards.
rotate() { # udid orientation
  TEST_RUNNER_PARITY_ORIENTATION="$2" xcodebuild test-without-building -xctestrun "$XCTESTRUN" \
    -destination "id=$1" -only-testing:SagaxUITests/ParityOrientationUITests/testParityOrientation \
    > "$OUT/rotate.log" 2>&1 || { tail -30 "$OUT/rotate.log"; log "rotation to $2 failed (see $OUT/rotate.log)"; exit 1; }
  # Xcode's test runner can leave the sim Shutting Down after the orientation
  # UITest; boot it back so simctl launch/screenshot still work.
  for _ in $(seq 1 30); do
    state="$(xcrun simctl list devices -j | python3 -c "
import json, sys
want = sys.argv[1]
for devices in json.load(sys.stdin)['devices'].values():
    for d in devices:
        if d.get('udid') == want:
            print(d.get('state') or ''); raise SystemExit
" "$1" 2>/dev/null || true)"
    case "$state" in
      Booted) break ;;
      Shutting\ Down|Shutdown|"")
        xcrun simctl boot "$1" 2>/dev/null || true
        xcrun simctl bootstatus "$1" -b >/dev/null 2>&1 || true
        ;;
    esac
    sleep 0.5
  done
  state="$(xcrun simctl list devices -j | python3 -c "
import json, sys
want = sys.argv[1]
for devices in json.load(sys.stdin)['devices'].values():
    for d in devices:
        if d.get('udid') == want:
            print(d.get('state') or ''); raise SystemExit
" "$1" 2>/dev/null || true)"
  [ "$state" = Booted ] || { log "simulator $1 not Booted after rotate (state=$state)"; exit 1; }
}

RUNTIME="$(xcrun simctl list runtimes -j | python3 -c "
import json, sys
rs = [r for r in json.load(sys.stdin)['runtimes'] if r['platform'] == 'iOS' and r['isAvailable']]
rs.sort(key=lambda r: [int(x) for x in r['version'].split('.')])
print(rs[-1]['identifier'])")"

CREATED=()
sim_udid() {
  xcrun simctl list devices -j | python3 -c "
import json, sys
for runtime, devices in json.load(sys.stdin)['devices'].items():
    for d in devices:
        if d['name'] == sys.argv[1] and d.get('isAvailable', True):
            print(d['udid']); sys.exit()
" "$1"
}
prepare_sim() { # name type -> udid
  local udid
  udid="$(sim_udid "$1")"
  if [ -z "$udid" ]; then
    log "creating $1 ($2) on $RUNTIME"
    udid="$(xcrun simctl create "$1" "$2" "$RUNTIME")"
  fi
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl ui "$udid" appearance dark
  xcrun simctl status_bar "$udid" override --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100 >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$APP"
  printf '%s' "$udid"
}

# ── fixture server ──────────────────────────────────────────────────────
FIXTURE_OUT="$OUT/ipad-fixture"
mkdir -p "$FIXTURE_OUT"
rm -f "$FIXTURE_OUT/session.json"
PARITY_OUT="$FIXTURE_OUT" node "$PARITY/fixture-server.mjs" > "$FIXTURE_OUT/fixture.log" 2>&1 &
SERVER_PID=$!
cleanup() {
  for name in "$SIM13" "$SIM11"; do
    local udid
    udid="$(sim_udid "$name")"
    [ -n "$udid" ] || continue
    xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    if [ "$KEEP_SIMS" -eq 0 ]; then
      xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
      xcrun simctl delete "$udid" >/dev/null 2>&1 || true
    fi
  done
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 240); do
  [ -f "$FIXTURE_OUT/session.json" ] && break
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$FIXTURE_OUT/fixture.log"; log "fixture server died"; exit 1; }
  sleep 0.5
done
[ -f "$FIXTURE_OUT/session.json" ] || { cat "$FIXTURE_OUT/fixture.log"; log "fixture server never became ready"; exit 1; }
read -r ENDPOINT TOKEN ENVIRONMENT < <(python3 -c "
import json; s = json.load(open('$FIXTURE_OUT/session.json'))
print(s['endpoint'], s['token'], s.get('environmentId') or '')")
log "fixture at $ENDPOINT"

# ── screens ──────────────────────────────────────────────────────────────
wanted() { # file stem -> 0 when selected
  [ ${#SCREENS[@]} -eq 0 ] && return 0
  local s
  for s in "${SCREENS[@]}"; do
    case "$1" in *"-$s"|"$s") return 0 ;; esac
  done
  return 1
}
SKIN_IDS="$(node "$HERE/capture-desktop.mjs" --list | sed -nE 's/^skins \(main screen\): //p' | tr -d ',')"

for row in "${PLAN[@]}"; do
  read -r VIEWPORT NAME TYPE ORIENTATION <<< "$row"
  if [ ${#VIEWPORTS[@]} -gt 0 ] && ! printf '%s\n' "${VIEWPORTS[@]}" | grep -qx "$VIEWPORT"; then continue; fi
  UDID="$(prepare_sim "$NAME" "$TYPE")"
  log "$VIEWPORT on $NAME ($UDID), $ORIENTATION"
  rotate "$UDID" "$ORIENTATION"
  while read -r STEM; do
    [ -n "$STEM" ] || continue
    ID="${STEM#*-}"
    VARIANTS=("$STEM:")
    if [ "$ID" = "main" ] && [ "$SKINS" -eq 1 ]; then
      for skin in $SKIN_IDS; do [ "$skin" = pulsatrix ] || VARIANTS+=("$STEM-skin-$skin:$skin"); done
    fi
    for variant in "${VARIANTS[@]}"; do
      FILE_STEM="${variant%%:*}"; SKIN="${variant#*:}"
      wanted "$FILE_STEM" || continue
      xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
      ARGS=(-parityEndpoint "$ENDPOINT" -parityToken "$TOKEN" -parityIPadScreen "$ID" -parityOrientation "$ORIENTATION")
      [ -n "$ENVIRONMENT" ] && ARGS+=(-parityEnvironment "$ENVIRONMENT")
      [ -n "$SKIN" ] && ARGS+=(-paritySkin "$SKIN")
      xcrun simctl launch "$UDID" "$BUNDLE_ID" "${ARGS[@]}" >/dev/null
      sleep "$WAIT"
      xcrun simctl io "$UDID" screenshot --type=png "$OUT/ipad-$VIEWPORT-$FILE_STEM.png" >/dev/null 2>&1
      log "ipad-$VIEWPORT-$FILE_STEM"
    done
  done <<< "$LIST"
done
log "done; compare with: python3 $HERE/diff-ipad.py"
