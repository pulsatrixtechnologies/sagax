#!/usr/bin/env bash
# Regression check for the main-thread stack overflow of Sagax iOS 0.8.71
# (TestFlight build 140): opening a chat crashed on the first MessageRow
# drawn because the Release body getters of MessageRow carried giant stack
# frames (kindContent 58 KB, content 31 KB static, more at run time).
#
# Reads the static frame size of every MessageRow-family body getter in a
# Release arm64 binary (the `sub sp, sp, #imm` of its prologue, or the size
# handed to the stack probe when the compiler calls one) and fails when one
# exceeds the budget, or when the frames nested in one pull (MessageRow.body,
# content, kindContent) add up past it. 0.8.71: 91 152 bytes for that chain.
#
# Usage: scripts/check-ios-stack-frames.sh <.xcarchive or unstripped Sagax binary> [budget bytes]
# The archive comes from: xcodebuild archive -project ios/Sagax.xcodeproj -scheme Sagax \
#   -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
set -euo pipefail

target="${1:?binary or xcarchive}"
budget="${2:-65536}"
symbols="$target"
if [[ -d "$target" && "$target" == *.xcarchive ]]; then
  # the archived app is stripped: symbols come from its dSYM
  symbols="$target/dSYMs/Sagax.app.dSYM/Contents/Resources/DWARF/Sagax"
  target="$target/Products/Applications/Sagax.app/Sagax"
fi
[[ -f "$target" ]] || { echo "no binary at $target" >&2; exit 2; }
[[ -f "$symbols" ]] || { echo "no symbols at $symbols" >&2; exit 2; }

# MessageRow's body, content and kindContent getters, and the body of each
# per-kind child view, by mangled symbol (private types carry a file hash).
pattern='MessageRowV(4body|7content[0-9A-Za-z_]*|11kindContent[0-9A-Za-z_]*)Qrvg$|(TextKindRow|OptionsKindRow|SecretKindRow|ActivityKindRow|DigestKindRow|RoutineRunKindRow|RosterKindRow|TextFallbackRow|MessageKindContent)[0-9A-Za-z_]*V4bodyQrvg$'
syms=$(xcrun nm -n "$symbols" | awk '$2 ~ /^[tT]$/ { print $1, $3 }' | grep -E "$pattern" || true)

if [[ -z "$syms" ]]; then
  echo "no MessageRow body getters found (stripped binary?)" >&2
  exit 2
fi

status=0
chain=0
while read -r addr sym; do
  start=$((16#$addr))
  stop=$((start + 160))
  listing=$(xcrun llvm-objdump -d --start-address="$start" --stop-address="$stop" "$target" 2>/dev/null)
  max=0
  # `mov w9, #0xe5c0 ; =58816`: the size handed to the stack probe.
  while read -r v; do
    [[ -n "$v" && "$v" -gt "$max" ]] && max=$v
  done < <(printf '%s\n' "$listing" | sed -nE 's/.*mov[[:space:]]+w9, #0x[0-9a-f]+[[:space:]]*;[[:space:]]*=([0-9]+).*/\1/p')
  # `sub sp, sp, #0x1c0` or `sub sp, sp, #0xe, lsl #12 ; =0xe000`
  while read -r line; do
    if [[ "$line" =~ =0x([0-9a-f]+) ]]; then
      v=$((16#${BASH_REMATCH[1]}))
    elif [[ "$line" =~ sp,\ sp,\ #0x([0-9a-f]+) ]]; then
      v=$((16#${BASH_REMATCH[1]}))
    else
      v=0
    fi
    (( v > max )) && max=$v
  done < <(printf '%s\n' "$listing" | grep -E 'sub[[:space:]]+sp, sp, #' || true)
  name=$(printf '%s' "$sym" | xcrun swift-demangle --simplified 2>/dev/null || printf '%s' "$sym")
  # body -> content -> kindContent are nested in one AttributeGraph pull: their frames stack up.
  case "$name" in MessageRow.body.getter|MessageRow.content.getter|MessageRow.kindContent.getter) chain=$((chain + max));; esac
  if (( max > budget )); then
    printf 'FAIL %7d bytes  %s\n' "$max" "$name"
    status=1
  else
    printf 'ok   %7d bytes  %s\n' "$max" "$name"
  fi
done <<< "$syms"
if (( chain > budget )); then
  printf 'FAIL %7d bytes  MessageRow body+content+kindContent (one pull)\n' "$chain"; status=1
else
  printf 'ok   %7d bytes  MessageRow body+content+kindContent (one pull)\n' "$chain"
fi
exit $status
