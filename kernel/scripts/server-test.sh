#!/usr/bin/env bash
# Runs on the Linux build server. Applies the staged Proteus sources and edits,
# incrementally rebuilds the Linux kernel, then runs one test from stage/tests.
# usage: server-test.sh <test-name> <jobs>      (runs stage/tests/<test-name>.test.sh)
set -uo pipefail

ROOT=/opt/proteus
STAGE="$ROOT/stage"
SRC="$ROOT/chromium/src"
NAME="$1"
DONE="$ROOT/test-$NAME.done"
rm -f "$DONE"
SERVER=
trap 'CODE=$?; [ -n "$SERVER" ] && kill $SERVER 2>/dev/null; echo $CODE > "$DONE"' EXIT
set -e

export PATH="$ROOT/depot_tools:$PATH"
export DEPOT_TOOLS_UPDATE=0

echo "== apply sources"
find "$STAGE" -type f -exec sed -i 's/\r$//' {} +
cp -r "$STAGE/src/." "$SRC/"
# Edit scripts build on one another (a later patch rewrites lines an earlier one
# added), so a script cannot be re-run once its successors have been applied.
# applied-edits.txt records which scripts this checkout already has; only newer
# ones run, in order. On a fresh checkout the file is absent and all of them run.
APPLIED="$ROOT/applied-edits.txt"
touch "$APPLIED"
LAST_APPLIED=$(tail -n 1 "$APPLIED")
for script in "$STAGE"/edits/*.py; do
  name=$(basename "$script")
  # The newest recorded script is re-run on purpose: it is the one under
  # development, and its edits are individually safe to repeat.
  if grep -qx "$name" "$APPLIED" && [ "$name" != "$LAST_APPLIED" ]; then
    continue
  fi
  # A failing edit script must stop the run: building a half-applied patch only
  # produces confusing compile errors.
  if ! python3 "$script" "$SRC" > "$ROOT/edit.log" 2>&1; then
    cat "$ROOT/edit.log"
    echo "EDIT-FAILED $name"
    exit 1
  fi
  grep -v 'already applied' "$ROOT/edit.log" || true
  grep -qx "$name" "$APPLIED" || echo "$name" >> "$APPLIED"
done

cd "$SRC"
echo "== incremental build started $(date -u +%FT%TZ)"
autoninja -j "$2" -C out/Linux chrome > "$ROOT/test-$NAME-build.log" 2>&1 || {
  grep -a -A30 'FAILED' "$ROOT/test-$NAME-build.log" | cut -c1-600 | head -120
  exit 1
}
echo "== build ok $(date -u +%FT%TZ)"

WORK=$(mktemp -d)
cp "$STAGE"/tests/*.html "$WORK/"
PORT=8790
python3 "$STAGE/tests/serve.py" "$WORK" $PORT &
SERVER=$!
sleep 1

# Helpers for the test files -------------------------------------------------
N=0
GPU_FLAGS="--disable-gpu"
# Virtual time makes page timers finish instantly. A test that depends on real
# network time (WebRTC) clears this and holds the page's load event instead.
VT_FLAGS="--virtual-time-budget=6000"
run() {  # run <page> [chrome flags...]  -> prints the page's RESULT line
  N=$((N + 1))
  local page=$1; shift
  timeout 90 ./out/Linux/chrome --headless=new --no-sandbox $GPU_FLAGS \
    --user-data-dir="$WORK/profile-$N" $VT_FLAGS "$@" \
    --dump-dom "http://127.0.0.1:$PORT/$page" 2>/dev/null |
    grep -o 'RESULT [^<]*' || echo "RESULT (none)"
}
field() { echo "$1" | tr ' ' '\n' | grep "^$2=" | cut -d= -f2-; }
FAIL=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 ($2 vs $3)"; FAIL=1; fi; }
differ() { if [ "$2" != "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (both $2)"; FAIL=1; fi; }
show() { echo "$1: $(echo "$2" | tr ' ' '\n' | sed 's/^/    /')"; }

set +e
. "$STAGE/tests/$NAME.test.sh"
set -e

if [ $FAIL -eq 0 ]; then echo "TEST-OK"; else echo "TEST-FAIL"; exit 1; fi
