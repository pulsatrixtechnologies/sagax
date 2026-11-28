#!/usr/bin/env bash
# The chat-open stack measure of the iPhone app (#5159), headless.
#
# TestFlight 0.8.71, 0.8.153 and 0.8.167 crashed the instant a chat opened:
# the main thread's stack (1 MB on a phone) overflowed in SwiftUI's layout
# recursion. This builds the app for the simulator optimized like a Release
# (-O, whole module; the DEBUG flag stays for the probe and the fixtures),
# boots a throwaway simulator without any window (xcodebuild, never
# Simulator.app), opens a long conversation of rich rows and fails when the
# deepest point the main stack reached passes the budget of
# ios/UITests/ChatOpenStackUITests.swift. The simulator is deleted after.
#
# STACK_MEASURE is on the build settings below: it compiles out the
# `#if DEBUG && !STACK_MEASURE` layout probes of the transcript (a metrics
# probe above the list, one parity probe on every row, the call-debug panel),
# which a phone running Release never lays out. The measure therefore reads
# the tree a phone builds, and ChatOpenStackUITests fails a run where the
# flag was not set (#5169). DEBUG stays spelled out below: the pbxproj sets
# this build setting itself, and a command-line setting replaces it instead of
# adding to it, so `$(inherited)` would not hand DEBUG back.
#
# MemoryManagerUITests rides along on the same build: opening a memory source
# is a navigation push, and it crashed in `EnvironmentObject.error()` in
# TestFlight 0.8.42 (#5159).
#
# Run it before every TestFlight archive. A failure is a crash on a phone.
#
# Usage: scripts/check-ios-chat-stack.sh [derived-data-dir]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
derived="${1:-${TMPDIR:-/tmp}/sagax-chat-stack-dd}"
cd "$root/ios"
[[ -d Sagax.xcodeproj ]] || xcodegen generate >/dev/null

runtime="$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["isAvailable"] and x["platform"]=="iOS"]; print(r[-1]["identifier"])')"
sim="$(xcrun simctl create "sagax-chat-stack-$$" "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro" "$runtime")"
cleanup() { xcrun simctl shutdown "$sim" >/dev/null 2>&1 || true; xcrun simctl delete "$sim" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log="$derived/chat-stack.log"
mkdir -p "$derived"
status=0
nice -n 10 xcodebuild test -project Sagax.xcodeproj -scheme Sagax -configuration Debug \
  -destination "platform=iOS Simulator,id=$sim" -derivedDataPath "$derived" \
  -only-testing:SagaxUITests/ChatOpenStackUITests \
  -only-testing:SagaxUITests/MemoryManagerUITests \
  CODE_SIGNING_ALLOWED=NO SWIFT_OPTIMIZATION_LEVEL=-O SWIFT_COMPILATION_MODE=wholemodule \
  "SWIFT_ACTIVE_COMPILATION_CONDITIONS=DEBUG STACK_MEASURE" \
  > "$log" 2>&1 || status=$?
grep -E "STACK-PROBE|error: -\[|Test Case .*(passed|failed)" "$log" || true
if [[ $status -ne 0 ]]; then
  echo "chat-open stack check FAILED (log: $log)"
  exit 1
fi
echo "chat-open stack check OK"
