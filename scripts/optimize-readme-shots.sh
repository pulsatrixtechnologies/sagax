#!/usr/bin/env bash
# Squeezes the README's still images (docs/readme/): desktop PNGs scaled to
# 1800 px wide (2x of the 900 px the README shows), every PNG through
# pngquant then oxipng. The animated captures (*.webp) are already written
# small by scripts/capture/readme-shots.mjs (lossy WebP, identical frames
# merged) and are left as they are. Needs pngquant, oxipng and sips (macOS).
# Idempotent: run it after every capture.
#   scripts/optimize-readme-shots.sh [DIR]
set -euo pipefail
dir="${1:-$(cd "$(dirname "$0")/.." && pwd)/docs/readme}"
cd "$dir"

for png in *.png; do
  [ -f "$png" ] || continue
  width=$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')
  case "$png" in
    ios-*) ;; # the simulator shots arrive at their final size
    *) if [ "$width" -gt 1800 ]; then sips --resampleWidth 1800 "$png" >/dev/null; fi ;;
  esac
  pngquant --quality 70-95 --speed 1 --strip --force --ext .png "$png"
  oxipng -o 4 --strip safe --quiet "$png"
done

du -sh . | awk '{print "docs/readme:", $1}'
ls -l | awk 'NR > 1 {printf "%8d  %s\n", $5, $9}'
