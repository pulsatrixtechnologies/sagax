#!/usr/bin/env bash
# Capture the 21 reference screens from the app against the fixture server.
#
#   ios/parity/capture.sh                       build, seed, capture every screen
#   ios/parity/capture.sh --skip-build          reuse the last build
#   ios/parity/capture.sh 02-chat 13-computer   only these screens
#   PARITY_WAIT=14 ios/parity/capture.sh         seconds to wait per screen (10)
#   PARITY_SKIN=lagoon ios/parity/capture.sh     wear a skin (DEBUG -paritySkin;
#                                                "system" follows the simulator)
#   PARITY_APPEARANCE=light ios/parity/capture.sh  the simulator's appearance;
#                                                also forces -paritySkin system so
#                                                the app's pinned theme (default
#                                                Black/Black) does not keep the
#                                                shot dark
#   PARITY_OUT=/tmp/shots ios/parity/capture.sh  where the PNGs go
#   PARITY_DEVICE=readme-iphone ...               the simulator (created when missing)
#   PARITY_SESSION=/tmp/phone.json ...           a server already running instead of
#                                                the fixture (JSON: endpoint, token,
#                                                environmentId), e.g. the README
#                                                fixture's paired phone
#   PARITY_EXTRA_ARGS="-companion.prefs.rosterChromeAtTop YES" ...  more launch arguments
#   PARITY_HOME=primary ios/parity/capture.sh 01-home  one centred Primary Bot,
#                                                nothing else pinned ("none": no pin, "mixed": primary + pins)
#   ios/parity/capture.sh cards cards-top 22-appearance  extra screens: a chat with
#                                                every card type (store preview; its end
#                                                and its first cards), and
#                                                Settings > Appearance
#
# Then: python3 ios/parity/diff.py [--gate]
#
# The simulator is a dedicated "parity-17pro" (iPhone 17 Pro, 402x874 pt @3x,
# the reference size) in dark mode with the status bar pinned to 6:54. The
# app is built for the simulator with CODE_SIGNING_ALLOWED=NO: the DEBUG
# parity launch keeps the bearer in memory, so the Keychain entitlement that
# pairing needs (see ios/TESTING.md, stage 3) is not involved.
#
# References 12 and 14 show Notifications on: the system grants that once per
# simulator, so on a new PARITY_DEVICE run SettingsUITests/
# testNotificationsSwitchAsksTheSystem on it once before capturing.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IOS="$(cd "$HERE/.." && pwd)"
OUT="${PARITY_OUT:-$HERE/out}"
SKIN="${PARITY_SKIN:-}"
APPEARANCE="${PARITY_APPEARANCE:-dark}"
# Light captures: the app theme wins over simctl appearance. The default
# selection is Black twice, which pins dark (ThemeSelection.pinsAppearance).
# With no explicit PARITY_SKIN, force -paritySkin system so the shot follows
# the light simulator (ThemeStore: suggestedLight on the light half).
if [ -z "$SKIN" ] && [ "$APPEARANCE" = "light" ]; then
  SKIN=system
fi
BUILD="$HERE/build"
DEVICE_NAME="${PARITY_DEVICE:-parity-17pro}"
BUNDLE_ID="ca.pulsatrix.sagax"
WAIT="${PARITY_WAIT:-10}"

SKIP_BUILD=0
SCREENS=()
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) SCREENS+=("$arg") ;;
  esac
done
if [ ${#SCREENS[@]} -eq 0 ]; then
  SCREENS=(
    01-home 02-chat 03-profile-info 04-profile-info-scrolled 05-routine-detail
    06-routine-instruction 07-profile-more-menu 08-profile-links 09-profile-media
    10-profile-files 11-computer-trackpad-toast 12-settings-top 13-computer
    14-settings-bottom 15-plugins 16-account 17-new-group-chat 18-home-plus-menu
    19-search 20-create-bot 21-bot-computer
  )
fi

mkdir -p "$OUT"
log() { printf '[capture] %s\n' "$*" >&2; }

# ── build ────────────────────────────────────────────────────────────────
APP="$BUILD/Build/Products/Debug-iphonesimulator/Sagax.app"
if [ "$SKIP_BUILD" -eq 0 ] || [ ! -d "$APP" ]; then
  log "xcodegen + build (Debug, simulator, unsigned)"
  (cd "$IOS" && xcodegen generate >/dev/null)
  xcodebuild -project "$IOS/Sagax.xcodeproj" -scheme Sagax \
    -configuration Debug \
    -destination "generic/platform=iOS Simulator" \
    -derivedDataPath "$BUILD" CODE_SIGNING_ALLOWED=NO build \
    > "$OUT/build.log" 2>&1 || { tail -40 "$OUT/build.log"; log "build failed (see $OUT/build.log)"; exit 1; }
fi

# ── simulator ────────────────────────────────────────────────────────────
UDID="$(xcrun simctl list devices -j | python3 -c "
import json, sys
name = sys.argv[1]
for runtime, devices in json.load(sys.stdin)['devices'].items():
    for d in devices:
        if d['name'] == name and d.get('isAvailable', True):
            print(d['udid']); sys.exit()
" "$DEVICE_NAME")"
if [ -z "$UDID" ]; then
  RUNTIME="$(xcrun simctl list runtimes -j | python3 -c "
import json, sys
rs = [r for r in json.load(sys.stdin)['runtimes'] if r['platform'] == 'iOS' and r['isAvailable']]
rs.sort(key=lambda r: [int(x) for x in r['version'].split('.')])
print(rs[-1]['identifier'])")"
  log "creating $DEVICE_NAME on $RUNTIME"
  UDID="$(xcrun simctl create "$DEVICE_NAME" "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" "$RUNTIME")"
fi
log "simulator $DEVICE_NAME ($UDID)"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance "$APPEARANCE"
# The references' keyboard: French (Canada) with English, no swipe-typing
# introduction, no dictation key.
xcrun simctl spawn "$UDID" defaults write -g AppleKeyboards -array \
  "fr_CA@sw=QWERTY-French-Canada;hw=Automatic" "en_US@sw=QWERTY;hw=Automatic" "emoji@sw=Emoji" >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults write com.apple.assistant.support "Dictation Enabled" -bool false >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override --time "6:54" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 \
  --batteryState discharging --batteryLevel 9
xcrun simctl install "$UDID" "$APP"

# ── fixture server ──────────────────────────────────────────────────────
SESSION="${PARITY_SESSION:-$OUT/session.json}"
SERVER_PID=""
cleanup() {
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT
if [ -z "${PARITY_SESSION:-}" ]; then
  rm -f "$OUT/session.json"
  node "$HERE/fixture-server.mjs" > "$OUT/fixture.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 240); do
    [ -f "$OUT/session.json" ] && break
    kill -0 "$SERVER_PID" 2>/dev/null || { cat "$OUT/fixture.log"; log "fixture server died"; exit 1; }
    sleep 0.5
  done
  [ -f "$OUT/session.json" ] || { cat "$OUT/fixture.log"; log "fixture server never became ready"; exit 1; }
fi
read -r ENDPOINT TOKEN ENVIRONMENT < <(python3 -c "
import json, sys; s = json.load(open(sys.argv[1]))
print(s['endpoint'], s['token'], s.get('environmentId') or '')" "$SESSION")
log "fixture at $ENDPOINT"

# ── screens ──────────────────────────────────────────────────────────────
for screen in "${SCREENS[@]}"; do
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  # The references are the standard home: a list density saved on this
  # simulator (Settings > Advanced, or a roster UI test) must not change them.
  ARGS=(-parityEndpoint "$ENDPOINT" -parityToken "$TOKEN" -parityScreen "$screen"
    -companion.prefs.rosterDensity standard)
  [ -n "$ENVIRONMENT" ] && ARGS+=(-parityEnvironment "$ENVIRONMENT")
  # "cards": the store preview's Scout chat with every card type, no fixture.
  [ "$screen" = "cards" ] && ARGS=(-store-preview -cards-preview -open-first -companion.prefs.rosterDensity standard)
  [ "$screen" = "cards-top" ] && ARGS=(-store-preview -cards-preview -cards-top -open-first -companion.prefs.rosterDensity standard)
  [ -n "$SKIN" ] && ARGS+=(-paritySkin "$SKIN")
  # PARITY_EXTRA_ARGS="-companion.prefs.rosterChromeAtTop YES": launch
  # arguments added as they are (space-separated)
  [ -n "${PARITY_EXTRA_ARGS:-}" ] && read -r -a EXTRA <<< "$PARITY_EXTRA_ARGS" && ARGS+=(${EXTRA[@]+"${EXTRA[@]}"})
  xcrun simctl launch "$UDID" "$BUNDLE_ID" "${ARGS[@]}" >/dev/null
  sleep "$WAIT"
  xcrun simctl io "$UDID" screenshot --type=png "$OUT/$screen.png" >/dev/null 2>&1
  log "$screen -> $OUT/$screen.png"
done
log "done; compare with: python3 $HERE/diff.py"
