#!/usr/bin/env bash
# measure-rust-build.sh: what the coding run's build cache (deploy/run-dev)
# saves on a Rust build, measured on a real crate. Everything it writes goes
# in a scratch directory (its own targets, its own sccache, a private sccache
# server port); the repository is copied there first (git archive), never
# built in place.
#
#   scripts/measure-rust-build.sh <repo> <package> [scratch-dir]
#   SCCACHE=<path to sccache> (default: sccache on PATH)
#
# Five builds of `cargo build -p <package>` (dev profile, debug=line-tables-only
# like the image):
#   1 cold          no cache at all (a run without the cache disk today)
#   2 fill          cold, filling sccache (the person's first run)
#   3 warm sccache  target emptied, sccache warm (a new environment, or a
#                   target the GC emptied)
#   4 incremental   one source file touched, target kept (the next run on
#                   the same environment: what the cache disk gives)
#   5 no-op         nothing changed
# Prints one line per build, then the sizes of the target and the sccache.
set -euo pipefail

repo="${1:?usage: measure-rust-build.sh <repo> <package> [scratch-dir]}"
package="${2:?usage: measure-rust-build.sh <repo> <package> [scratch-dir]}"
scratch="${3:-$(mktemp -d "${TMPDIR:-/tmp}/px-measure.XXXXXX")}"
sccache_bin="${SCCACHE:-$(command -v sccache || true)}"
[ -x "$sccache_bin" ] || { echo "sccache not found (set SCCACHE=<path>)" >&2; exit 2; }

mkdir -p "$scratch/src"
git -C "$repo" archive HEAD | tar -x -C "$scratch/src"
src="$scratch/src"
manifest="$(cd "$src" && cargo metadata --no-deps --format-version 1 \
  | python3 -c 'import json,sys; p=sys.argv[1]; print(next(x["manifest_path"] for x in json.load(sys.stdin)["packages"] if x["name"]==p))' "$package")"
touch_file="$(dirname "$manifest")/src/lib.rs"
[ -f "$touch_file" ] || touch_file="$(dirname "$manifest")/src/main.rs"

export CARGO_PROFILE_DEV_DEBUG=line-tables-only
export SCCACHE_DIR="$scratch/sccache"
export SCCACHE_SERVER_PORT="${SCCACHE_SERVER_PORT:-4291}"
export SCCACHE_CACHE_SIZE=40G
export SCCACHE_IDLE_TIMEOUT=0

now() { python3 -c 'import time; print(time.time())'; }
build() {
  local label="$1" target="$2" wrapper="$3" start end
  start="$(now)"
  (cd "$src" && CARGO_TARGET_DIR="$target" RUSTC_WRAPPER="$wrapper" cargo build -q -p "$package" >"$scratch/$label.log" 2>&1)
  end="$(now)"
  python3 -c 'import sys; print(f"{sys.argv[1]:<16} {float(sys.argv[3])-float(sys.argv[2]):8.1f} s")' "$label" "$start" "$end"
}
stop_server() { "$sccache_bin" --stop-server >/dev/null 2>&1 || true; }
trap stop_server EXIT

(cd "$src" && cargo fetch -q)
"$sccache_bin" --start-server >/dev/null

echo "package $package ($(rustc --version), $(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu) CPU)"
build "1-cold" "$scratch/t-plain" ""
rm -rf "$scratch/t-plain"
build "2-fill" "$scratch/t-cache" "$sccache_bin"
rm -rf "$scratch/t-cache"
build "3-warm-sccache" "$scratch/t-cache" "$sccache_bin"
touch "$touch_file"
build "4-incremental" "$scratch/t-cache" "$sccache_bin"
build "5-no-op" "$scratch/t-cache" "$sccache_bin"
echo "target  $(du -sh "$scratch/t-cache" | cut -f1)"
echo "sccache $(du -sh "$scratch/sccache" | cut -f1)"
"$sccache_bin" --show-stats | grep -E "Cache hits|Cache misses|Compile requests" || true
