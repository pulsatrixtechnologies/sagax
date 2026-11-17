#!/usr/bin/env bash
# #4490: the form cards survive a LIVE text size change (large, largest
# accessibility, large, largest). Drives UITests/FormCardTextSizeUITests, which
# asks for each size through files; this script applies it to a simulator it
# creates (and deletes) with `xcrun simctl ui <device> content_size <size>`.
#
#   ios/parity/form-cards-text-size.sh
#   FORM_DEVICE_TYPE=iPhone-17-Pro ios/parity/form-cards-text-size.sh
#
# Headless: the simulator app is never opened. Needs `xcodegen`. Exit code 0 when
# both sequences keep the transcript drawn.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IOS="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
TYPE="com.apple.CoreSimulator.SimDeviceType.${FORM_DEVICE_TYPE:-iPhone-16e}"
RUNTIME="${FORM_RUNTIME:-$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')}"
UDID="$(xcrun simctl create form-cards-text-size "$TYPE" "$RUNTIME")"
WATCHER=""
cleanup() {
  [ -n "$WATCHER" ] && kill "$WATCHER" 2>/dev/null || true
  xcrun simctl shutdown "$UDID" 2>/dev/null || true
  xcrun simctl delete "$UDID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

xcrun simctl boot "$UDID"
xcrun simctl ui "$UDID" content_size large
SIGNAL="$WORK/signal"; mkdir -p "$SIGNAL"

# applies each size the test asks for, then acknowledges it
(
  while true; do
    for want in "$SIGNAL"/want-*; do
      [ -e "$want" ] || continue
      step="${want##*want-}"
      [ -e "$SIGNAL/done-$step" ] && continue
      xcrun simctl ui "$UDID" content_size "$(cat "$want")"
      touch "$SIGNAL/done-$step"
    done
    sleep 0.3
  done
) &
WATCHER=$!

cd "$IOS"
xcodegen generate >/dev/null
# the test runs twice (twelve rows, time sheet); each needs its own steps
status=0
for test in testTwelveRowFormSurvivesTextSizeChanges testTimeSheetSurvivesTextSizeChanges; do
  rm -f "$SIGNAL"/want-* "$SIGNAL"/done-*
  xcrun simctl ui "$UDID" content_size large
  if ! TEST_RUNNER_FORM_SIGNAL_DIR="$SIGNAL" xcodebuild test -project Sagax.xcodeproj -scheme Sagax \
    -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath "$WORK/dd" CODE_SIGNING_ALLOWED=NO \
    -only-testing:"SagaxUITests/FormCardTextSizeUITests/$test" > "$WORK/$test.log" 2>&1; then
    status=1
  fi
  grep -E "error:|Test Case|TEST (SUCCEEDED|FAILED)" "$WORK/$test.log" || true
done
exit $status
