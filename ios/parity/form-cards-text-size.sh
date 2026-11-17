#!/usr/bin/env bash
# #4490: pending form cards keep drawing, and keep what was typed, through LIVE
# text size changes and cold launches at the largest size.
#
# Runs UITests/FormCardTextSizeUITests on a small simulator it creates and
# deletes (iPhone SE 3rd generation by default), headless. The test asks for
# each size through files; this script applies it with
# `xcrun simctl ui <device> content_size <size>` and acknowledges. Per fixture
# (the unfilled and the filled 12-row form, the 7-row time sheet, the 20-item
# checklist) it switches large <-> largest FORM_SWITCHES times (10), asserting
# the card's title AND last row are drawn and hittable after every step; one
# test types a note and checks text, focus and Done survive; one scrolls up and
# checks the reading place; one lets a bot message arrive while typing; and 2
# runs of 3 cold launches at the largest size (dark French, light English).
#
#   ios/parity/form-cards-text-size.sh
#   FORM_SWITCHES=3 ios/parity/form-cards-text-size.sh     a quicker pass
#   FORM_DEVICE_TYPE=iPhone-16e FORM_RUNTIME=<id> ...
#
# Needs xcodegen. Exit code 0 only when every test passes.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
IOS="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
TYPE="com.apple.CoreSimulator.SimDeviceType.${FORM_DEVICE_TYPE:-iPhone-SE-3rd-generation}"
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
    sleep 0.2
  done
) &
WATCHER=$!

cd "$IOS"
xcodegen generate >/dev/null
status=0
run() { # name, appearance, extra env
  local name="$1" appearance="$2"; shift 2
  rm -f "$SIGNAL"/want-* "$SIGNAL"/done-*
  xcrun simctl ui "$UDID" content_size large
  xcrun simctl ui "$UDID" appearance "$appearance"
  if ! env "TEST_RUNNER_FORM_SIGNAL_DIR=$SIGNAL" "TEST_RUNNER_FORM_SWITCHES=${FORM_SWITCHES:-10}" ${FORM_CAPTURE_DIR:+"TEST_RUNNER_FORM_CAPTURE_DIR=$FORM_CAPTURE_DIR"} "$@" \
    xcodebuild test -project Sagax.xcodeproj -scheme Sagax -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "${FORM_DERIVED:-$WORK/dd}" CODE_SIGNING_ALLOWED=NO \
    -only-testing:"SagaxUITests/FormCardTextSizeUITests/$name" > "$WORK/$name.log" 2>&1; then
    status=1
  fi
  grep -E "error:|Test Case.*(passed|failed)" "$WORK/$name.log" || true; [ -n "${FORM_LOG:-}" ] && cp "$WORK/$name.log" "$FORM_LOG" || true
}
ALL="testTwelveRowsUnfilled testTwelveRowsFilled testTimeSheetFilled testTwentyItemChecklist \
            testTypedNoteKeepsItsTextAndFocus testReadingPlaceSurvivesASizeChange testIncomingMessageLeavesTheTypedFieldAlone"
# FORM_ONLY=<test name> runs one of them (debugging)
for test in ${FORM_ONLY:-$ALL}; do
  run "$test" light
done
if [ -z "${FORM_ONLY:-}" ]; then
  run testColdLaunchesAtTheLargestSize dark TEST_RUNNER_FORM_DARK=1 TEST_RUNNER_FORM_FRENCH=1
  run testColdLaunchesAtTheLargestSize light TEST_RUNNER_FORM_DARK=0 TEST_RUNNER_FORM_FRENCH=0
fi
echo "form-cards-text-size: $([ $status -eq 0 ] && echo PASS || echo FAIL)"
exit $status
