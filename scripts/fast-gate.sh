#!/usr/bin/env bash
# fast-gate.sh: the common fast merge gate of every coding role (Sagax,
# Perspicax, Pulsatrix Flow, the web site; on the Mac and in a cloud run
# Pod, where the run image installs it as /usr/local/bin/fast-gate).
#
# typecheck + lint + terms + the tests of the touched files, in parallel,
# 4 checks at a time at most. Never the full suite: that runs once, at the
# version cut. It only reads the repository and writes its logs.
#
#   scripts/fast-gate.sh [--base <ref>] [--jobs <n>] [--only <a,b>] [--list] [--dry-run]
#
#   --base     what "touched" is measured against (default: $FAST_GATE_BASE,
#              else the branch's upstream, else origin/HEAD); the touched
#              files are the commits since the merge base plus the working
#              tree (staged, unstaged, untracked)
#   --jobs     checks at once (default $FAST_GATE_JOBS, else 4; capped at 4)
#   --only     a comma list of check names (typecheck, lint, terms, tests,
#              rust-fmt, rust, py, extra-<name>)
#   --list     print the touched files and the checks, run nothing
#   --dry-run  print each check's command, run nothing
#
# What it detects (from the repository root):
#   package.json   typecheck (script "typecheck", else tsc --noEmit when a
#                  tsconfig.json exists), lint (oxlint, else eslint, on the
#                  touched files), terms (script "check:terms"), tests
#                  (vitest on the touched tests and the tests beside a
#                  touched source: same folder, same stem)
#   Cargo.toml     rust-fmt (cargo fmt --check on the touched crates), rust
#                  (cargo clippy -D warnings then cargo test, on the touched
#                  crates, one job so they do not wait on the build lock)
#   *.py touched   py (py_compile, ruff when installed, unittest on the
#                  touched test_*.py and the test_<stem>.py beside a source)
#   Makefile       terms also runs `make dash-check` when the target exists
#   .fast-gate     extra checks of the repository, one per line,
#                  "<name>: <command>" ("#" starts a comment); each runs as
#                  extra-<name> with FAST_GATE_FILES (newline list) set
#
# Exit 0 when every check passed or was skipped, 1 when one failed, 2 on a
# usage error. The logs stay in $FAST_GATE_LOG_DIR (default a temporary
# directory, printed at the end).
set -u

BASE="${FAST_GATE_BASE:-}"
JOBS="${FAST_GATE_JOBS:-4}"
ONLY=""
LIST=0
DRY=0

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="${2:-}"; shift 2 ;;
    --base=*) BASE="${1#--base=}"; shift ;;
    --jobs) JOBS="${2:-}"; shift 2 ;;
    --jobs=*) JOBS="${1#--jobs=}"; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --only=*) ONLY="${1#--only=}"; shift ;;
    --list) LIST=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "fast-gate: unknown argument $1" >&2; exit 2 ;;
  esac
done

case "$JOBS" in ''|*[!0-9]*) echo "fast-gate: --jobs takes a number" >&2; exit 2 ;; esac
[ "$JOBS" -lt 1 ] && JOBS=1
[ "$JOBS" -gt 4 ] && JOBS=4

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "fast-gate: not inside a git repository" >&2; exit 2; }
cd "$ROOT" || exit 2

LOG_DIR="${FAST_GATE_LOG_DIR:-}"
if [ -z "$LOG_DIR" ]; then
  LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fast-gate.XXXXXX")" || exit 2
else
  mkdir -p "$LOG_DIR" || exit 2
fi

# --- touched files -----------------------------------------------------------

if [ -z "$BASE" ]; then
  BASE="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  # The branch's own remote copy is no base: what it adds is already pushed.
  case "$BASE" in */"$(git rev-parse --abbrev-ref HEAD 2>/dev/null)") BASE="" ;; esac
fi
if [ -z "$BASE" ]; then
  BASE="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)"
fi
SINCE=""
if [ -n "$BASE" ]; then
  SINCE="$(git merge-base HEAD "$BASE" 2>/dev/null || true)"
  [ -z "$SINCE" ] && echo "fast-gate: no merge base with $BASE, the working tree alone"
fi

TOUCHED="$LOG_DIR/touched.txt"
{
  [ -n "$SINCE" ] && git diff --name-only --diff-filter=ACMR "$SINCE" HEAD
  git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null
  git diff --name-only --diff-filter=ACMR --cached 2>/dev/null
  git ls-files --others --exclude-standard
} | sort -u | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done > "$TOUCHED"

touched_match() { grep -E "$1" "$TOUCHED" || true; }

# --- check registry ----------------------------------------------------------

NAMES=""
add_check() { # name command
  local name="$1" cmd="$2"
  if [ -n "$ONLY" ]; then
    case ",$ONLY," in *",$name,"*) ;; *) return 0 ;; esac
  fi
  NAMES="$NAMES $name"
  printf '%s\n' "$cmd" > "$LOG_DIR/$name.cmd"
}

q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
qlist() { local out="" f; while IFS= read -r f; do [ -n "$f" ] && out="$out $(q "$f")"; done; printf '%s' "$out"; }

# Node / TypeScript
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then PM=pnpm; elif [ -f yarn.lock ]; then PM=yarn; else PM="npm"; fi
  has_script() { node -e 'const s=require("./package.json").scripts||{};process.exit(s[process.argv[1]]?0:1)' "$1" 2>/dev/null; }
  BIN="$ROOT/node_modules/.bin"
  JS="$(touched_match '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte)$')"
  if [ -n "$JS" ]; then
    if has_script typecheck; then add_check typecheck "$PM run -s typecheck"
    elif [ -f tsconfig.json ] && [ -x "$BIN/tsc" ]; then add_check typecheck "$(q "$BIN/tsc") --noEmit"
    fi
    LINTABLE="$(printf '%s\n' "$JS" | grep -vE '(^|/)(dist|build|node_modules)/' || true)"
    if [ -n "$LINTABLE" ]; then
      if [ -x "$BIN/oxlint" ]; then add_check lint "$(q "$BIN/oxlint") --deny-warnings$(printf '%s\n' "$LINTABLE" | qlist)"
      elif [ -x "$BIN/eslint" ]; then add_check lint "$(q "$BIN/eslint") --max-warnings 0$(printf '%s\n' "$LINTABLE" | qlist)"
      fi
    fi
    # The touched tests and the tests beside a touched source.
    TESTS="$LOG_DIR/tests.txt"
    : > "$TESTS"
    printf '%s\n' "$JS" | while IFS= read -r f; do
      case "$f" in
        *.test.*|*.spec.*) printf '%s\n' "$f" ;;
        *)
          stem="${f%.*}"
          for t in "$stem".test.* "$stem".*.test.* "$stem".spec.*; do [ -f "$t" ] && printf '%s\n' "$t"; done
          ;;
      esac
    done | sort -u > "$TESTS"
    if [ -s "$TESTS" ] && [ -x "$BIN/vitest" ]; then
      add_check tests "$(q "$BIN/vitest") run --reporter=dot$(qlist < "$TESTS")"
    fi
  fi
fi

# Terms: the repository's own term scan (any touched file counts).
if [ -s "$TOUCHED" ]; then
  TERMS=""
  if [ -f package.json ] && has_script check:terms; then TERMS="$PM run -s check:terms"; fi
  if [ -f Makefile ] && grep -qE '^dash-check:' Makefile; then
    TERMS="${TERMS:+$TERMS && }make -s dash-check"
  fi
  [ -n "$TERMS" ] && add_check terms "$TERMS"
fi

# Rust
if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then
  RS="$(touched_match '(\.rs|(^|/)Cargo\.toml|(^|/)build\.rs)$')"
  if [ -n "$RS" ]; then
    CRATES="$(printf '%s\n' "$RS" | while IFS= read -r f; do
      d="$(dirname "$f")"
      while :; do
        if [ -f "$d/Cargo.toml" ] && grep -q '^\[package\]' "$d/Cargo.toml"; then
          sed -n '/^\[package\]/,/^\[/{s/^name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p;}' "$d/Cargo.toml" | head -1
          break
        fi
        [ "$d" = "." ] && break
        d="$(dirname "$d")"
      done
    done | sort -u)"
    if [ -n "$CRATES" ]; then
      PKGS="$(printf '%s\n' "$CRATES" | while IFS= read -r c; do printf ' -p %s' "$(q "$c")"; done)"
      add_check rust-fmt "cargo fmt --check$PKGS"
      add_check rust "cargo clippy --all-targets$PKGS -- -D warnings && cargo test$PKGS"
    fi
  fi
fi

# Python
# The unittest files of the touched Python: a touched test, or test_<stem>.py
# beside a touched module. (A function: bash 3.2 cannot parse case inside $().)
py_tests() {
  while IFS= read -r f; do
    case "$(basename "$f")" in
      test_*.py|*_test.py) printf '%s\n' "$f" ;;
      *) t="$(dirname "$f")/test_$(basename "$f")"; [ -f "$t" ] && printf '%s\n' "$t" ;;
    esac
  done
  return 0
}
PY="$(touched_match '\.py$')"
if [ -n "$PY" ]; then
  PYT="$(printf '%s\n' "$PY" | py_tests | sort -u)"
  PYCMD="python3 -m py_compile$(printf '%s\n' "$PY" | qlist)"
  command -v ruff >/dev/null 2>&1 && PYCMD="$PYCMD && ruff check$(printf '%s\n' "$PY" | qlist)"
  if [ -n "$PYT" ]; then
    # unittest runs each test file from its own folder, as the repositories
    # import their modules beside the test.
    PYCMD="$PYCMD$(printf '%s\n' "$PYT" | while IFS= read -r t; do
      printf " && (cd %s && python3 -m unittest -q %s)" "$(q "$(dirname "$t")")" "$(q "$(basename "$t" .py)")"
    done)"
  fi
  add_check py "$PYCMD"
fi

# The repository's extra checks.
if [ -f .fast-gate ] && [ -s "$TOUCHED" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    name="$(printf '%s' "${line%%:*}" | tr -cd 'A-Za-z0-9_-')"
    cmd="${line#*:}"
    [ -n "$name" ] && [ "$cmd" != "$line" ] && add_check "extra-$name" "$cmd"
  done < .fast-gate
fi

# --- run ---------------------------------------------------------------------

COUNT="$(wc -l < "$TOUCHED" | tr -d ' ')"
echo "fast-gate: $COUNT touched file(s) since ${BASE:-the working tree}${SINCE:+ ($(git rev-parse --short "$SINCE"))}, checks:${NAMES:- none}, $JOBS at a time"

if [ "$LIST" = 1 ]; then
  sed 's/^/  /' "$TOUCHED"
  exit 0
fi
if [ "$DRY" = 1 ]; then
  for n in $NAMES; do echo "[$n] $(cat "$LOG_DIR/$n.cmd")"; done
  exit 0
fi
if [ -z "$NAMES" ]; then
  echo "fast-gate: nothing to check"
  exit 0
fi

export FAST_GATE_FILES
FAST_GATE_FILES="$(cat "$TOUCHED")"

PIDS=""
running() { local n=0 p; for p in $PIDS; do kill -0 "$p" 2>/dev/null && n=$((n + 1)); done; echo "$n"; }
for n in $NAMES; do
  while [ "$(running)" -ge "$JOBS" ]; do sleep 0.2; done
  (
    start=$(date +%s)
    bash -c "$(cat "$LOG_DIR/$n.cmd")" > "$LOG_DIR/$n.log" 2>&1
    code=$?
    echo "$code $(( $(date +%s) - start ))" > "$LOG_DIR/$n.status"
  ) &
  PIDS="$PIDS $!"
done
for p in $PIDS; do wait "$p" 2>/dev/null; done

FAILED=""
for n in $NAMES; do
  read -r code secs < "$LOG_DIR/$n.status"
  if [ "$code" = 0 ]; then
    printf '  ok    %-14s %4ss\n' "$n" "$secs"
  else
    printf '  FAIL  %-14s %4ss  (exit %s, %s)\n' "$n" "$secs" "$code" "$LOG_DIR/$n.log"
    FAILED="$FAILED $n"
  fi
done
for n in $FAILED; do
  echo "--- $n (last 40 lines) ---"
  tail -n 40 "$LOG_DIR/$n.log"
done
echo "fast-gate: logs in $LOG_DIR"
[ -z "$FAILED" ] && { echo "fast-gate: green"; exit 0; }
echo "fast-gate: red:$FAILED"
exit 1
